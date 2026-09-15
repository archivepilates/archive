import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REFERRAL_POLICY, assessReferral, referralKey } from './imweb-referral-policy.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const providerReason = key => `imweb-referral:${key}`;
const record = row => row ? { ...row, providerReason: providerReason(row.rewardKey) } : null;
const timestamp = value => {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Timezone-qualified timestamp required');
  }
  return new Date(value).toISOString();
};

// Private adapter only: canonical members and provider logs must be verified upstream.
// Use one absolute DB path in an existing owner-only directory on the local worker.
export class ReferralLedger {
  #filename;
  #db = null;

  constructor(filename) {
    if (typeof filename !== 'string' || !isAbsolute(filename)) throw new Error('Absolute SQLite path required');
    this.#filename = filename;
  }

  #open(create = false) {
    if (this.#db) return this.#db;
    if (!create && !existsSync(this.#filename)) return null;
    const directory = lstatSync(dirname(this.#filename));
    if (!directory.isDirectory() || (directory.mode & 0o077)) throw new Error('SQLite directory must be private');
    try { closeSync(openSync(this.#filename, 'ax', 0o600)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const file = lstatSync(this.#filename);
    if (!file.isFile() || (file.mode & 0o077)) throw new Error('SQLite file must be private and not a symlink');
    const db = new DatabaseSync(this.#filename);
    try {
      db.exec(`PRAGMA busy_timeout = 10000; PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS referral_rewards (
          rewardKey TEXT PRIMARY KEY NOT NULL, inviterKey TEXT NOT NULL,
          month TEXT NOT NULL, policyVersion TEXT NOT NULL,
          amountWon INTEGER NOT NULL CHECK (amountWon IN (0, 3000)),
          status TEXT NOT NULL CHECK (status IN ('pending', 'dispatching', 'paid', 'held', 'rejected')),
          reason TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
          providerLogKey TEXT UNIQUE,
          CHECK ((status = 'rejected' AND amountWon = 0) OR (status <> 'rejected' AND amountWon = 3000))
        ) STRICT;
        CREATE INDEX IF NOT EXISTS referral_budget ON referral_rewards(inviterKey, month);`);
      this.#db = db;
      return db;
    } catch (error) { db.close(); throw error; }
  }

  #transaction(action) {
    const db = this.#open(true);
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(db); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  get(rewardKey) {
    return record(this.#open()?.prepare('SELECT * FROM referral_rewards WHERE rewardKey = ?').get(rewardKey));
  }

  unresolvedRecords() {
    return (this.#open()?.prepare(`SELECT * FROM referral_rewards
      WHERE status IN ('pending', 'dispatching', 'held') ORDER BY createdAt, rewardKey`).all() || []).map(record);
  }

  reserve({ member, inviter, now, policy = REFERRAL_POLICY, sourceVerified = false }) {
    const input = { member, inviter, now, policy, sourceVerified: sourceVerified === true };
    const initial = assessReferral(input);
    if (!initial.eligible) return { ...initial, record: null };
    if (typeof policy.version !== 'string' || !policy.version.trim() || policy.version.length > 80) {
      throw new Error('Policy version required');
    }
    const inviterKey = referralKey(inviter);
    const at = timestamp(now);
    return this.#transaction(db => {
      const existingReward = this.get(initial.rewardKey);
      // Every reserved amount counts forever in its month, including held outcomes.
      const { total } = db.prepare(`SELECT COALESCE(SUM(amountWon), 0) AS total
        FROM referral_rewards WHERE inviterKey = ? AND month = ?`).get(inviterKey, initial.month);
      const decision = assessReferral({ ...input, existingReward, monthlyReservedWon: total });
      if (!decision.eligible && decision.reason !== 'monthly_limit') return { ...decision, record: existingReward };
      db.prepare(`INSERT INTO referral_rewards
        (rewardKey, inviterKey, month, policyVersion, amountWon, status, reason, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(initial.rewardKey, inviterKey, initial.month,
        policy.version, decision.rewardWon, decision.eligible ? 'pending' : 'rejected', decision.reason, at, at);
      return { ...decision, record: this.get(initial.rewardKey) };
    });
  }

  // The sole dispatch grant. A crash after this transition never permits reclaim.
  claim(rewardKey, now = new Date().toISOString()) {
    if (!this.#open()) return null;
    return record(this.#db.prepare(`UPDATE referral_rewards SET status = 'dispatching', updatedAt = ?
      WHERE rewardKey = ? AND status = 'pending' RETURNING *`).get(timestamp(now), rewardKey));
  }

  holdUnknown(rewardKey, now = new Date().toISOString()) {
    if (!this.#open()) return false;
    return this.#db.prepare(`UPDATE referral_rewards
      SET status = 'held', reason = 'provider_outcome_unknown', updatedAt = ?
      WHERE rewardKey = ? AND status = 'dispatching'`).run(timestamp(now), rewardKey).changes === 1;
  }

  // proof: { sourceVerified: true, logId, member: canonical recipient, amountWon, reason }.
  // logId must identify a provider log uniquely within its site/unit; no raw log is retained.
  verifyPaid(rewardKey, proof, now = new Date().toISOString()) {
    if (proof?.sourceVerified !== true || typeof proof.logId !== 'string' || !proof.logId.trim()) return false;
    let recipientKey;
    try { recipientKey = referralKey(proof.member); } catch { return false; }
    if (!this.#open()) return false;
    const logKey = hash([proof.member.siteCode, proof.member.unitCode, proof.logId.trim()]);
    const at = timestamp(now);
    return this.#transaction(db => {
      const row = this.get(rewardKey);
      if (!row || row.inviterKey !== recipientKey || proof.amountWon !== row.amountWon ||
          proof.reason !== row.providerReason || !['dispatching', 'held', 'paid'].includes(row.status)) return false;
      if (row.status === 'paid') return row.providerLogKey === logKey;
      if (db.prepare('SELECT rewardKey FROM referral_rewards WHERE providerLogKey = ?').get(logKey)) return false;
      db.prepare(`UPDATE referral_rewards SET status = 'paid', reason = 'provider_log_verified',
        providerLogKey = ?, updatedAt = ? WHERE rewardKey = ?`).run(logKey, at, rewardKey);
      return true;
    });
  }

  close() {
    this.#db?.close();
    this.#db = null;
  }
}
