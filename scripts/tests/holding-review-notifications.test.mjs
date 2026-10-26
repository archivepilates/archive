import test from "node:test";
import assert from "node:assert/strict";
import { finishedHoldingDiscovery, reportHoldingReviewOnce } from "../lib/holding-review-notifications.mjs";
import { HOLDING_SOURCE } from "../lib/studiomate-holding-source.mjs";

const NOW = new Date("2026-10-26T04:00:00.000Z");
const job = { jobId: "a".repeat(64), memberId: "901", ticketName: "Synthetic annual pass", transition: "ticket_changed" };
const delta = (field, before, after) => ({ field, before, after });
const evidence = () => ({ source: HOLDING_SOURCE, studioId: "5330", memberId: job.memberId,
  memberName: "Synthetic Member", ticketName: job.ticketName,
  memberUrl: "https://arcpilates.studiomate.kr/users/detail?id=901", observedAt: NOW.toISOString(),
  historyComplete: true, activeHoldsComplete: true, currentHold: null,
  activeHolds: [{ start: "2026-10-17", end: "2026-10-25" }],
  history: [{ at: "2026. 01. 01. 12:00", type: "발급", staff: "Synthetic",
    changes: [delta("이용시작일", "내역없음", "2026-01-01"), delta("이용종료일", "내역없음", "2026-12-31")] },
  { at: "2026. 10. 26. 11:45", type: "수강권정지", staff: "Synthetic",
    changes: [delta("정지시작일", "내역없음", "2026-10-17"), delta("정지종료일", "내역없음", "2026-10-25")] }] });

test("fully reconciled retrospective and shortened completed holds are no-send discovery exclusions", () => {
  assert.equal(finishedHoldingDiscovery(evidence(), job, NOW), true);
  const raw = evidence();
  raw.history[1].at = "2026. 10. 07. 11:45";
  raw.history[1].changes[1].after = "2026-10-31";
  raw.history.push({ at: "2026. 10. 26. 12:00", type: "수강권정지", staff: "Synthetic",
    changes: [delta("정지종료일", "2026-10-31", "2026-10-25")] });
  assert.equal(finishedHoldingDiscovery(raw, job, NOW), true);
});

test("current, future, missing controls, and non-ticket-change discoveries are not silently excluded", () => {
  for (const range of [{ start: "2026-10-26", end: "2026-10-30" }, { start: "2026-10-27", end: "2026-10-30" }]) {
    const raw = evidence();
    raw.activeHolds = [range];
    raw.history[1].changes = [delta("정지시작일", "내역없음", range.start), delta("정지종료일", "내역없음", range.end)];
    assert.equal(finishedHoldingDiscovery(raw, job, NOW), false);
    raw.currentHold = range;
    assert.equal(finishedHoldingDiscovery(raw, job, NOW), false);
  }
  assert.equal(finishedHoldingDiscovery(evidence(), { ...job, transition: "continued" }, NOW), false);
});

test("incomplete, stale, or mismatched source cannot establish a finished discovery", () => {
  for (const mutate of [raw => { raw.historyComplete = false; }, raw => { raw.activeHoldsComplete = false; },
    raw => { raw.observedAt = "2026-10-26T03:00:00.000Z"; }, raw => { raw.activeHolds = []; },
    raw => { raw.memberId = "902"; }]) {
    const raw = evidence(); mutate(raw);
    assert.throws(() => finishedHoldingDiscovery(raw, job, NOW));
  }
});

class Store {
  docs = new Map();
  tail = Promise.resolve();
  doc(path) { return { path }; }
  async runTransaction(fn) {
    const prior = this.tail;
    let release; this.tail = new Promise(resolve => { release = resolve; }); await prior;
    const writes = [];
    try {
      const result = await fn({ get: async ref => ({ exists: this.docs.has(ref.path), data: () => structuredClone(this.docs.get(ref.path)) }),
        create: (ref, row) => { assert.equal(this.docs.has(ref.path), false); writes.push([ref.path, structuredClone(row)]); },
        update: (ref, row) => writes.push([ref.path, { ...this.docs.get(ref.path), ...structuredClone(row) }]) });
      for (const [path, row] of writes) this.docs.set(path, row);
      return result;
    } finally { release(); }
  }
}

test("concurrent and hourly reimports report an unchanged native issue exactly once", async () => {
  const db = new Store(); let mails = 0;
  const input = { db, job, reason: "holding_allowance_overage", observationFingerprint: "b".repeat(64),
    send: async () => { mails++; return { ok: true, messageId: "synthetic" }; }, now: () => NOW };
  await Promise.all([reportHoldingReviewOnce(input), reportHoldingReviewOnce(input)]);
  const repeated = await reportHoldingReviewOnce({ ...input, job: { ...job, sourceImportId: "new-import", downloadedAt: NOW.toISOString() } });
  assert.equal(repeated.duplicateBlocked, true);
  assert.equal(mails, 1);
  assert.equal([...db.docs.values()][0].status, "sent");
  assert.ok([...db.docs.keys()].every(path => path.startsWith("workLanes/holding-allowance-notice/reviewAlerts/")));
});

test("changed source or reason can report once without clearing a previous claim", async () => {
  const db = new Store(); let mails = 0;
  const input = { db, job, reason: "first", observationFingerprint: "b".repeat(64),
    send: async () => ({ ok: true, messageId: `synthetic-${++mails}` }), now: () => NOW };
  await reportHoldingReviewOnce(input);
  await reportHoldingReviewOnce({ ...input, observationFingerprint: "c".repeat(64) });
  await reportHoldingReviewOnce({ ...input, reason: "second" });
  assert.equal(mails, 3);
  assert.equal(db.docs.size, 3);
});

test("ambiguous child result or transport error stays claimed and cannot resend", async () => {
  for (const sendResult of [undefined, { ok: true }, new Error("synthetic timeout")]) {
    const db = new Store(); let mails = 0;
    const input = { db, job, reason: "review", observationFingerprint: "b".repeat(64), now: () => NOW,
      send: async () => { mails++; if (sendResult instanceof Error) throw sendResult; return sendResult; } };
    await assert.rejects(reportHoldingReviewOnce(input));
    assert.equal((await reportHoldingReviewOnce(input)).duplicateBlocked, true);
    assert.equal(mails, 1);
    assert.equal([...db.docs.values()][0].status, "claimed_no_retry");
  }
});
