#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, lstatSync, openSync, writeFileSync, closeSync, fsyncSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MEMBERSHIP_CONTRACT_RECOVERY_BINDINGS as bindings,
  membershipContractRecoveryClosureHash as hash, planMembershipContractRecoveryClosure as planClosure,
} from './lib/membership-contract-recovery-closure.mjs';

const args = process.argv.slice(2);
const value = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (args.some(arg => arg !== '--apply' && !/^--(at|expected-config-hash|expected-plan-hash)=/.test(arg)))
  throw new Error('invalid_closure_arguments');
const apply = args.includes('--apply'), at = value('at') || new Date().toISOString();
const now = Date.parse(at);
if (!Number.isFinite(now) || Math.abs(Date.now() - now) > 300000) throw new Error('fresh_closure_clock_required');
const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'archive-pilates', credential: admin.credential.cert(
  path.join(os.homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json')) });
const db = admin.firestore(), settings = 'systemSettings/membershipContractAutomation';
const plain = snapshot => JSON.parse(JSON.stringify(snapshot.data()));
async function readInputs(get) {
  const config = plain(await get(db.doc(settings)));
  const rows = async (root, ids) => Promise.all(ids.map(async id => {
    const ref = db.doc(`${root}/${id}`), snapshot = await get(ref);
    if (!snapshot.exists) throw new Error('closure_source_missing');
    return { id, path: ref.path, data: plain(snapshot) };
  }));
  return { config, jobs: await rows('studiomateMembershipContractJobs', bindings.map(x => x.jobId)),
    contracts: await rows('studiomateMembershipContracts', bindings.map(x => x.contractId)),
    hints: await rows('workLanes/studiomate-membership-contract-automation/purchaseHints',
      config.signatureMaintenanceRecovery.entries.map(x => x.hintId)), now,
    expectedConfigHash: hash(config) };
}
const inputs = await readInputs(ref => ref.get()), plan = planClosure(inputs), planHash = hash(plan);
if (!apply) {
  console.log(JSON.stringify({ mode: 'plan', at, configHash: inputs.expectedConfigHash, planHash,
    acceptedDispatches: 5, writerEnabled: false, signatureCompletion: 'not_asserted' }));
} else {
  if (value('expected-config-hash') !== inputs.expectedConfigHash || value('expected-plan-hash') !== planHash)
    throw new Error('closure_plan_changed');
  const directory = path.join(os.homedir(), 'ArchiveIN/operations/contract-settlement-recovery-20261106');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid())
    throw new Error('private_closure_audit_required');
  const intent = path.join(directory, 'contract-closure-intent.json');
  const fd = openSync(intent, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify({ at, planHash, plan })); fsyncSync(fd); } finally { closeSync(fd); }
  await db.runTransaction(async tx => {
    const current = await readInputs(ref => tx.get(ref));
    if (current.expectedConfigHash !== inputs.expectedConfigHash) throw new Error('closure_source_changed');
    const fresh = planClosure(current);
    if (hash(fresh) !== planHash) throw new Error('closure_source_changed');
    const auditRef = db.doc(fresh.audit.path);
    if ((await tx.get(auditRef)).exists) throw new Error('closure_prior_intent_requires_review');
    tx.update(db.doc(settings), fresh.settingPatch);
    for (const row of fresh.hintPatches) tx.update(db.doc(row.path), row.patch);
    tx.create(auditRef, fresh.audit.data);
  });
  const after = plain(await db.doc(settings).get());
  const expected = structuredClone(inputs.config);
  expected.signatureMaintenanceRecovery.status = 'completed';
  expected.signatureMaintenanceRecovery.closure = plan.settingPatch['signatureMaintenanceRecovery.closure'];
  if (hash(after) !== hash(expected) || after.contractWriterEnabled !== false) throw new Error('closure_readback_mismatch');
  for (const row of [...inputs.jobs, ...inputs.contracts])
    if (hash(plain(await db.doc(row.path).get())) !== hash(row.data)) throw new Error('closure_source_changed_after_apply');
  for (const row of plan.hintPatches) {
    const before = inputs.hints.find(x => x.path === row.path).data;
    const expectedHint = { ...before, ...row.patch };
    if (hash(plain(await db.doc(row.path).get())) !== hash(expectedHint)) throw new Error('closure_hint_readback_mismatch');
  }
  const receipt = path.join(directory, 'contract-closure-verified.json');
  const receiptFd = openSync(receipt, 'wx', 0o600);
  try { writeFileSync(receiptFd, JSON.stringify({ at: new Date().toISOString(), planHash, state: 'verified',
    acceptedDispatchCount: 5, writerEnabled: false, sourceJobsAndContractsUnchanged: true })); fsyncSync(receiptFd); }
  finally { closeSync(receiptFd); }
  console.log(JSON.stringify({ state: 'verified', planHash, writerEnabled: false, acceptedDispatches: 5,
    sourceJobsAndContractsUnchanged: true, signatureCompletion: 'not_asserted' }));
}
