import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHoldingObservation, reconcileHoldingObservation } from "../lib/studiomate-holding-source.mjs";
import { queueHoldingNotice, approveHoldingNotice, dispatchHoldingNotice, holdingApprovalSnapshot, holdingMemberFingerprint,
  HOLDING_NOTICE_SETTINGS, HOLDING_NOTICE_TEMPLATE_CODE } from "../../firebase/kangsain-functions/functions/src/alimtalk/holdingNoticeQueue";

test("full issuance/hold evidence -> no-send baseline -> one reviewed candidate -> one claimed mock transport", async () => {
  let clock = new Date("2026-10-07T01:00:00.000Z");
  const stamp = () => ({ seconds: clock.getTime() / 1000, nanoseconds: 0 });
  const raw: any = { source: "studiomate_ticket_history_dom", studioId: "5330", memberId: "100", memberName: "Synthetic",
    ticketName: "Annual Synthetic", memberUrl: "https://arcpilates.studiomate.kr/users/detail?id=100",
    observedAt: clock.toISOString(), historyComplete: true, activeHoldsComplete: true, activeHolds: [],
    history: [{ at: "2026. 01. 01. 09:00", staff: "Fixture", type: "발급", changes: [
      { field: "이용시작일", before: "내역없음", after: "2026. 01. 01." },
      { field: "이용종료일", before: "내역없음", after: "2026. 12. 31." },
    ] }] };
  function review(holds: any[]) {
    const normalized = normalizeHoldingObservation(raw);
    return { schemaVersion: 1, ticketId: "200", reviewedBy: "fixture-operator", reviewedAt: clock.toISOString(),
      nativeTicketBindingVerified: true, completeHistoryVerified: true, holds,
      observationFingerprint: normalized.observationFingerprint, issuanceFingerprint: normalized.issuanceFingerprint };
  }
  const baseline = reconcileHoldingObservation(raw, review([]), null, clock).source;
  assert.deepEqual(baseline.noticeEligibleHoldIds, []);
  clock = new Date("2026-10-07T01:06:00.000Z");
  raw.observedAt = clock.toISOString();
  raw.history.push({ at: "2026. 10. 07. 10:05", staff: "Fixture", type: "수강권 정지", changes: [
    { field: "정지시작일", before: "내역없음", after: "2026. 10. 08." },
    { field: "정지종료일", before: "내역없음", after: "2026. 10. 10." },
  ] });
  raw.activeHolds = [{ start: "2026. 10. 08.", end: "2026. 10. 10." }];
  const creation = normalizeHoldingObservation(raw).history[1].fingerprint;
  const holdId = "hold_00000000-0000-4000-8000-000000000001";
  const decision = review([{ id: holdId, kind: "member", status: "registered", start: "2026-10-08", end: "2026-10-10",
    creationEvidenceFingerprint: creation, evidenceFingerprints: [creation] }]);
  const plan = reconcileHoldingObservation(raw, decision, baseline, clock);
  assert.equal(plan.candidateKeys.length, 1);
  const id = plan.candidateKeys[0];
  const member = { memberId: "100", studioId: "5330", name: "Synthetic", phone: "01000000001", memberGrade: "일반" };
  const values = new Map<string, any>([
    [HOLDING_NOTICE_SETTINGS, { mode: "live", autoSendEnabled: true, canonicalSourcePromoted: true, nativeE2eVerified: true,
      studioId: "5330", templateId: HOLDING_NOTICE_TEMPLATE_CODE, cutoverAt: "2026-10-07T00:00:00.000Z" }],
    [`memberTicketHolds/${plan.source.sourceId}`, plan.source], ["memberProfiles/100", member],
  ]);
  const snap = (path: string) => ({ exists: values.has(path), data: () => structuredClone(values.get(path)) });
  const db = { doc: (path: string) => ({ path, get: async () => snap(path) }),
    runTransaction: async (fn: any) => {
      const writes: any[] = [];
      const result = await fn({ get: async (ref: any) => { assert.equal(writes.length, 0); return snap(ref.path); },
        create: (ref: any, data: any) => { assert.equal(values.has(ref.path), false); writes.push([ref.path, data]); },
        update: (ref: any, data: any) => { assert.equal(values.has(ref.path), true); writes.push([ref.path, { ...values.get(ref.path), ...data }]); } });
      for (const [path, value] of writes) values.set(path, structuredClone(value));
      return result;
    } };
  const deps: any = { db, now: () => clock, timestamp: stamp, verifyRecipientInTransaction: async () => "",
    loadEvidence: async () => ({ recipientIssue: "", templateIssue: "", providerHistoryComplete: true,
      providerDuplicate: false, memberFingerprint: holdingMemberFingerprint(member) }) };
  assert.equal((await queueHoldingNotice(deps, plan.source.sourceId, holdId)).status, "reviewed");
  assert.equal((await queueHoldingNotice(deps, plan.source.sourceId, holdId)).status, "existing");
  assert.ok(values.has(`alimtalkCandidates/${id}`), "Node collector and TS dispatcher share exactly the same event key");
  const displayedSnapshot = holdingApprovalSnapshot(values.get(`alimtalkCandidates/${id}`));
  clock = new Date("2026-10-07T01:07:00.000Z");
  assert.equal((await approveHoldingNotice(deps, { candidateId: id, expectedSnapshot: displayedSnapshot,
    reviewedByUid: "fixture-operator", studioId: "5330" })).status, "queued");
  const candidate = values.get(`alimtalkCandidates/${id}`);
  candidate.status = "processing";
  await assert.rejects(dispatchHoldingNotice(deps, candidate, async () => ({ messageId: "not-used" })), /post_candidate_readback/);
  raw.observedAt = clock.toISOString();
  const refreshed = reconcileHoldingObservation(raw, decision, plan.source, clock).source;
  assert.equal(refreshed.sourceVersion, plan.source.sourceVersion);
  values.set(`memberTicketHolds/${plan.source.sourceId}`, refreshed);
  let posts = 0;
  const transport = async (variables: any) => {
    posts++;
    assert.equal(values.get(`holdingNoticeClaims/${id}`).status, "attempting");
    assert.equal(variables["#{전체홀딩일수}"], "73");
    assert.equal(variables["#{사용홀딩일수}"], "3");
    assert.equal(variables["#{잔여홀딩일수}"], "70");
    return { messageId: "mock-only-receipt" };
  };
  assert.equal((await dispatchHoldingNotice(deps, candidate, transport)).messageId, "mock-only-receipt");
  await assert.rejects(dispatchHoldingNotice(deps, candidate, transport));
  assert.equal(posts, 1);
  assert.equal(values.get(`holdingNoticeClaims/${id}`).status, "accepted");
});
