#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { createStudioMatePointUI } from "./lib/studiomate-point-ui.mjs";
import { digest, executePointAction, phone, samePointState, verifyPointOutcome } from "./lib/studiomate-referral-points.mjs";
import { memberDispatchWindow } from "./lib/member-dispatch-window.mjs";

// Operator-only reversible test; never constructs a real newcomer, purchase,
// production referral receipt or production reward claim.
const args = process.argv.slice(2);
const continueBeforeFinal = args.includes("--resume-preconfirmation");
const restoreBeforeFinal = args.includes("--restore-preconfirmation");
const verifyRestoredOnly = args.includes("--verify-restored");
const inputPhone = phone(args[args.indexOf("--phone") + 1]);
assert(args.includes("--apply") && inputPhone && args.includes("--phone"), "Explicit bounded live-test arguments required");
const target = { memberId: "1982133", name: "김기효", phone: inputPhone };
assert(digest(inputPhone) === "7e06c5f5dfa893a3b3cee1beb56e9ebca0f565881ff7025294144d079d6d0363", "Only the approved test account is allowed");
const root = "/Users/archivepilates/ArchiveIN/automation/referral-point-tests/20261102";
await mkdir(root, { recursive: true, mode: 0o700 });
const file = path.join(root, "journal.json");
const initial = { scope: "operator_test_only", targetId: target.memberId, phoneHash: digest(inputPhone),
  status: "prepared", actions: {}, createdAt: new Date().toISOString() };
let journal;
try { journal = JSON.parse(await readFile(file, "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  await writeFile(file, JSON.stringify(initial), { flag: "wx", mode: 0o600 }); journal = initial;
}
assert(journal.targetId === target.memberId && journal.phoneHash === digest(inputPhone), "Test identity binding changed");
if (Object.keys(journal.actions).length && !continueBeforeFinal && !restoreBeforeFinal && !verifyRestoredOnly) {
  console.log(JSON.stringify({ status: journal.status, replayBlocked: true, actions: Object.values(journal.actions).map(a => a.status) }));
  process.exit(0);
}
const persist = async () => {
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(journal, null, 2), { mode: 0o600 });
  await rename(temp, file);
};
const allowed = () => {
  if (!memberDispatchWindow(Date.now()).allowed) throw new Error("test_deferred_outside_member_window");
  return true;
};
const ledger = {
  get: async key => journal.actions[key] || null,
  async claim(key, record) {
    if (journal.actions[key]) return false;
    journal.actions[key] = record; await persist(); return true;
  },
  async update(key, patch) {
    assert(journal.actions[key]); Object.assign(journal.actions[key], patch); await persist();
  },
};
const release = await acquireStudioMateBrowserLock({ owner: "referral-points-kim-test", waitMs: 15_000 });
// Another invocation may have completed while this process waited for the lock.
journal = JSON.parse(await readFile(file, "utf8"));
if (Object.keys(journal.actions).length && !continueBeforeFinal && !restoreBeforeFinal && !verifyRestoredOnly) {
  await release();
  console.log(JSON.stringify({ status: journal.status, replayBlocked: true }));
  process.exit(0);
}
let context;
try {
  allowed();
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext("/Users/archivepilates/ArchiveIN/automation/browser-profile", { headless: true });
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  const native = createStudioMatePointUI(page);
  const baseline = await native.read(target);
  if (verifyRestoredOnly) {
    const creditKey = digest(["referral-test-20261102", target.memberId, "credit"]);
    const restoreKey = digest(["referral-test-20261102", target.memberId, "restore"]);
    const credit = journal.actions[creditKey], restore = journal.actions[restoreKey];
    assert(credit?.status === "verified" && restore && ["dispatching", "verified"].includes(restore.status));
    verifyPointOutcome(restore.before, baseline, target, restore.action);
    assert.equal(baseline.remaining, journal.baseline.remaining);
    await ledger.update(restoreKey, { status: "verified", after: baseline, verifiedAt: new Date().toISOString(),
      readOnlyReconciliation: "native_negative_usage_counter_normalized" });
    assert.equal((await executePointAction({ action: credit.action, target, native, ledger })).attempts, 0);
    assert.equal((await executePointAction({ action: restore.action, target, native, ledger })).attempts, 0);
    journal.status = "verified_restored"; journal.completedAt = new Date().toISOString(); await persist();
    console.log(JSON.stringify({ status: journal.status, before: journal.baseline.remaining, afterCredit: credit.after.remaining,
      afterRestore: baseline.remaining, duplicateAttempts: 0, nativeHistoryVerified: true, readOnlyReconciliation: true,
      productionClaims: 0, memberMessages: 0 }));
  } else if (restoreBeforeFinal) {
    const creditKey = digest(["referral-test-20261102", target.memberId, "credit"]);
    const restore = { key: digest(["referral-test-20261102", target.memberId, "restore"]),
      direction: "debit", points: 20_000, reason: "REFTEST_261102_R" };
    const saved = journal.actions[restore.key];
    assert(journal.actions[creditKey]?.status === "verified" && samePointState(journal.actions[creditKey].after, baseline));
    assert(saved?.status === "review" && saved.reason === "point_final_confirmation_amount_mismatch" &&
      samePointState(saved.before, baseline) && !baseline.history.some(row => row.reason.includes(restore.reason)));
    await ledger.update(restore.key, { reconciliation: { kind: "final_amount_guard_stopped_before_click",
      baselineUnchanged: true, nativeReasonAbsent: true, checkedAt: new Date().toISOString() } });
    await native.prepare(target, restore); assert(samePointState(await native.readCurrent(target), baseline)); allowed();
    await native.confirm(target, restore, async () => {
      allowed(); await ledger.update(restore.key, { status: "dispatching", finalConfirmationPreparedAt: new Date().toISOString() });
    });
    const final = await native.read(target); verifyPointOutcome(baseline, final, target, restore);
    assert.equal(final.remaining, journal.baseline.remaining);
    await ledger.update(restore.key, { status: "verified", after: final, verifiedAt: new Date().toISOString() });
    const repeat = await executePointAction({ action: restore, target, native, ledger, revalidate: allowed });
    assert(repeat.status === "duplicate" && repeat.attempts === 0);
    journal.status = "verified_restored"; journal.completedAt = new Date().toISOString(); await persist();
    console.log(JSON.stringify({ status: journal.status, before: journal.baseline.remaining,
      afterCredit: journal.actions[creditKey].after.remaining, duplicateAttempts: 0, afterRestore: final.remaining,
      nativeHistoryVerified: true, productionClaims: 0, memberMessages: 0 }));
  } else {
  if (continueBeforeFinal) assert(samePointState(baseline, journal.baseline), "Original baseline changed; no continuation allowed");
  else { journal.baseline = baseline; await persist(); }
  const credit = { key: digest(["referral-test-20261102", target.memberId, "credit"]),
    direction: "credit", points: 20_000, reason: "REFTEST_261102_A" };
  let award;
  if (continueBeforeFinal) {
    // One operator continuation of the observed two-dialog preconfirmation stop.
    // Original claim and diagnostics remain intact. Never use this for a final
    // confirmation timeout, changed balance, existing native reason or other error.
    const old = journal.actions[credit.key];
    assert(old?.status === "review" && old.reason.includes("strict mode violation") &&
      old.reason.includes("point-edit-final-check-dialog") && samePointState(old.before, baseline));
    assert(!baseline.history.some(row => row.reason.includes(credit.reason)));
    await ledger.update(credit.key, { reconciliation: { kind: "final_confirmation_never_invoked",
      baselineUnchanged: true, nativeReasonAbsent: true, checkedAt: new Date().toISOString() } });
    await native.prepare(target, credit);
    assert(samePointState(await native.readCurrent(target), baseline)); allowed();
    await native.confirm(target, credit, async () => {
      allowed(); await ledger.update(credit.key, { status: "dispatching", finalConfirmationAt: new Date().toISOString() });
    });
    const after = await native.read(target); verifyPointOutcome(baseline, after, target, credit);
    await ledger.update(credit.key, { status: "verified", after, verifiedAt: new Date().toISOString() });
    award = { status: "verified", after: after.remaining };
  } else award = await executePointAction({ action: credit, target, native, ledger, revalidate: allowed });
  assert(award.status === "verified");
  const repeat = await executePointAction({ action: credit, target, native, ledger, revalidate: allowed });
  assert(repeat.status === "duplicate" && repeat.attempts === 0);
  const still = await native.read(target); assert(still.remaining === baseline.remaining + 20_000);
  const restore = { key: digest(["referral-test-20261102", target.memberId, "restore"]),
    direction: "debit", points: 20_000, reason: "REFTEST_261102_R" };
  const restored = await executePointAction({ action: restore, target, native, ledger,
    revalidate: async () => allowed() && journal.actions[credit.key]?.status === "verified" });
  assert(restored.status === "verified");
  const final = await native.read(target); assert.equal(final.remaining, baseline.remaining);
  journal.status = "verified_restored"; journal.completedAt = new Date().toISOString(); await persist();
  console.log(JSON.stringify({ status: journal.status, before: baseline.remaining, afterCredit: award.after,
    duplicateAttempts: repeat.attempts, afterRestore: final.remaining, nativeHistoryVerified: true,
    productionClaims: 0, memberMessages: 0 }));
  }
} catch (error) {
  journal.status = "review_do_not_replay"; journal.reason = error.message; await persist();
  console.error(JSON.stringify({ status: journal.status, reason: error.message, replayForbidden: true }));
  process.exitCode = 1;
} finally { try { await context?.close(); } finally { await release(); } }
