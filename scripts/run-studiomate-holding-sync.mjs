#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { normalizeHoldingObservation, reconcileHoldingObservation, holdingSourceId } from "./lib/studiomate-holding-source.mjs";
import { HOLDING_ROSTER_JOBS, HOLDING_ROSTER_STATE, holdingRosterReadbackIssue, holdingRosterReadbackIsCurrent } from "./lib/studiomate-holding-roster.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "archive-pilates" });
const db = admin.firestore();
const apply = process.argv.includes("--apply");
const fromRoster = process.argv.includes("--from-roster");
const settings = (await db.doc("settings/holdingNotice").get()).data();
function authorized(config, target) {
  return config?.calculationMode !== "live_studiomate_readback" && config?.sourceScanEnabled === true && config?.canonicalSourcePromoted === true &&
    config?.sourceReadbackVerified === true && !!config?.promotionAuditId && config?.studioId === "5330" &&
    config.scanTargets?.some(t => t.memberId === target.memberId && t.ticketName === target.ticketName);
}
async function readbackIsCurrent(tx, target) {
  if (!fromRoster) return true;
  const current = (await tx.get(db.doc(`${HOLDING_ROSTER_JOBS}/${target.jobId}`))).data();
  return holdingRosterReadbackIsCurrent(current, target);
}
async function invalidate(target, reason, fingerprint = null) {
  if (!apply || !authorized(settings, target)) return;
  const sources = await db.collection("memberTicketHolds").where("memberId", "==", target.memberId).limit(50).get();
  for (const prior of sources.docs) {
    if (prior.data().ticketName !== target.ticketName) continue;
    await db.runTransaction(async tx => {
      const current = await tx.get(prior.ref);
      const config = (await tx.get(db.doc("settings/holdingNotice"))).data();
      if (!await readbackIsCurrent(tx, target)) return;
      if (!authorized(config, target) || current.data()?.sourceVersion !== prior.data().sourceVersion) return;
      tx.update(prior.ref, { identityVerified: false, noticeStatus: "review", lastError: reason,
        latestObservationFingerprint: fingerprint });
    });
  }
}
async function recordReadback(target, status, reason = "") {
  if (!apply || !target.jobId) return;
  await db.runTransaction(async tx => {
    const ref = db.doc(`${HOLDING_ROSTER_JOBS}/${target.jobId}`);
    const current = (await tx.get(ref)).data();
    if (current?.discoveryVersion !== target.discoveryVersion || current.status !== "pending") return;
    tx.update(ref, { status, reason, lastCheckedAt: new Date().toISOString(), sendAllowed: false });
  });
}
async function scanTargets() {
  if (!fromRoster) return settings.scanTargets;
  if (settings.rosterDiscoveryEnabled !== true) return [];
  const baseline = (await db.doc(HOLDING_ROSTER_STATE).get()).data();
  const age = Date.now() - Date.parse(baseline?.downloadedAt);
  if (baseline?.schemaVersion !== 2 || baseline.mode !== "discovery_only" || !Number.isFinite(age) || age < 0 || age > 90 * 60_000)
    throw new Error("fresh_holding_roster_required");
  // Provisional jobs authorize reads only. Canonical writes still require the separate audited target allowlist.
  const jobs = await db.collection(HOLDING_ROSTER_JOBS).where("status", "==", "pending").limit(401).get();
  if (jobs.size > 400) throw new Error("holding_readback_backlog_review_required");
  const valid = [];
  for (const doc of jobs.docs) {
    const job = { ...doc.data(), jobId: doc.id };
    if (holdingRosterReadbackIssue(job, undefined) === "holding_roster_job_invalid") {
      await recordReadback(job, "review", "holding_roster_job_invalid");
      continue;
    }
    valid.push(job);
  }
  return valid
    .sort((a, b) => String(a.lastCheckedAt || a.requestedAt).localeCompare(String(b.lastCheckedAt || b.requestedAt)))
    .slice(0, 10);
}
if (settings?.sourceScanEnabled !== true) {
  console.log(JSON.stringify({ ok: true, skipped: "holding_source_scan_disabled", sendAllowed: false }));
} else {
  const targets = await scanTargets();
  if (!Array.isArray(targets) || (!fromRoster && !targets.length) || targets.length > 10 ||
    targets.some(t => !/^[1-9]\d*$/.test(t.memberId) || typeof t.ticketName !== "string" || !t.ticketName.trim()) ||
    new Set(targets.map(t => `${t.memberId}|${t.ticketName}`)).size !== targets.length)
    throw new Error("Explicit bounded scan targets required");
  const results = [];
  for (const target of targets) {
    try {
      if (fromRoster) {
        const currentProfile = (await db.doc(`memberProfiles/${target.memberId}`).get()).data();
        const issue = holdingRosterReadbackIssue(target, currentProfile);
        if (issue) throw new Error(issue);
      }
      if (settings.calculationMode === "live_studiomate_readback") {
        // Discovery is a read hint, not a balance cache or authorization to message a member.
        await recordReadback(target, "observed", "live_ticket_detail_deferred_until_dispatch");
        results.push({ memberId: target.memberId, status: "discovery_only", reason: "live_ticket_detail_deferred_until_dispatch" });
        continue;
      }
      const run = spawnSync(process.execPath, ["scripts/collect-studiomate-holding-source.mjs", "--member-id", target.memberId,
        "--ticket-name", target.ticketName], { cwd: process.cwd(), env: process.env, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120000 });
      if (run.status !== 0) throw new Error("holding_browser_collection_failed");
      const output = JSON.parse(run.stdout.trim());
      if (output.ok !== true || !output.file) throw new Error("holding_collection_incomplete");
      const raw = JSON.parse(await readFile(output.file, "utf8"));
      const obs = normalizeHoldingObservation(raw);
      if (obs.memberId !== target.memberId || obs.ticketName !== target.ticketName)
        throw new Error("holding_roster_readback_scope_mismatch");
      const reviewPath = `workLanes/holding-allowance-notice/identityReviews/${obs.observationFingerprint}`;
      const review = (await db.doc(reviewPath).get()).data();
      const priorSources = await db.collection("memberTicketHolds").where("memberId", "==", target.memberId).limit(50).get();
      if (priorSources.size === 50) throw new Error("holding_source_scope_incomplete");
      if (apply) {
        await db.doc(`workLanes/holding-allowance-notice/observations/${obs.observationFingerprint}`).set({ ...raw,
          observationFingerprint: obs.observationFingerprint, identityStatus: review ? "review_available" : "review_required" });
      }
      if (!review) {
        // A changed native observation revokes the old source's sending authority.
        await invalidate(target, "changed_observation_identity_review_required", obs.observationFingerprint);
        await recordReadback(target, "observed", "native_ticket_and_stable_hold_mapping_required");
        results.push({ memberId: target.memberId, status: "review_required", reason: "native_ticket_and_stable_hold_mapping_required" });
        continue;
      }
      const id = holdingSourceId({ ...obs, ticketId: review.ticketId });
      const prior = priorSources.docs.find(d => d.id === id)?.data() || null;
      const plan = reconcileHoldingObservation(raw, review, prior);
      if (apply && authorized(settings, target)) {
        const refreshed = await db.runTransaction(async tx => {
          const config = (await tx.get(db.doc("settings/holdingNotice"))).data();
          const current = await tx.get(db.collection("memberTicketHolds").doc(id));
          if (!await readbackIsCurrent(tx, target)) return false;
          if (!authorized(config, target))
            throw new Error("audited_source_promotion_required");
          const next = reconcileHoldingObservation(raw, review, current.data() || null);
          tx.set(current.ref, next.source);
          return true;
        });
        if (!refreshed) {
          results.push({ memberId: target.memberId, status: "superseded" });
          continue;
        }
      }
      await recordReadback(target, "observed", authorized(settings, target) ? "" : "audited_source_promotion_required");
      results.push({ memberId: target.memberId, status: apply && authorized(settings, target) ? "source_refreshed" : "shadow_verified",
        eligibleEvents: plan.candidateKeys.length, summary: plan.summary });
    } catch (error) {
      await invalidate(target, "holding_native_readback_failed");
      await recordReadback(target, /holding_roster_(native_member_recheck_failed|job_invalid)/.test(error.message) ? "review" : "pending", error.message);
      results.push({ memberId: target.memberId, status: "failed", reason: error.message });
    }
  }
  const ok = results.every(r => r.status !== "failed");
  console.log(JSON.stringify({ ok, mode: apply ? "apply-source-only" : "dry-run", results, sendAllowed: false }));
  if (!ok) process.exitCode = 1;
}
