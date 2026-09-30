import assert from "node:assert/strict";
import test from "node:test";
import fixtures from "./fixtures/ticket-fact-templates.json";
import { ticketFactTemplateIssue, ticketFactContractFingerprint } from "../../firebase/kangsain-functions/functions/src/alimtalk/ticketNoticePolicy";
import { directTicketCandidate } from "../../firebase/kangsain-functions/functions/src/alimtalk/rebuildAlimtalkCandidates";
import { renewalCandidateProfileIssue } from "../../firebase/kangsain-functions/functions/src/alimtalk/renewalSendGuard";
import { alimtalkDedupeKey, memberCareCandidatesConflict, findCompletedDuplicateForCandidate } from "../../firebase/kangsain-functions/functions/src/alimtalk/dedupe";
import { refs } from "../../firebase/kangsain-functions/functions/src/firestore/refs";
import type { AlimtalkCandidateDoc, MemberProfileDoc } from "../../firebase/kangsain-functions/functions/src/types/models";
import type { AlimtalkTemplateState } from "../../firebase/kangsain-functions/functions/src/alimtalk/templateStatus";

function stamp(day: string) {
  const date = new Date(day + "T00:00:00+09:00");
  return { toDate: () => date, toMillis: () => date.getTime() } as never;
}
const target = { name: "그룹 30회", userTicketId: "source-ticket", classType: "G", remainingCount: 3, expiresAt: stamp("2026-10-10"), expiryLevel: "warning" as const };
const profile: MemberProfileDoc = {
  memberId: "fixture-member", studioId: "fixture-studio", name: "합성회원", phone: "01000000001",
  registeredAt: null, activeTickets: [target, { ...target, userTicketId: "followup-ticket", remainingCount: 30, expiresAt: stamp("2026-12-31") }],
  syncedAt: stamp("2026-09-30"), updatedAt: stamp("2026-09-30"),
};
const candidate = (): AlimtalkCandidateDoc => directTicketCandidate(profile, target, "2026-09-30")!;

test("all four reviewed factual templates pass; body/button/version changes require review", () => {
  for (const item of fixtures) {
    const state: AlimtalkTemplateState = { templateCode: item.code, status: "APPROVED", source: "solapi", name: "", label: "", lastError: null, content: item.content, buttons: item.buttons };
    const subject = { type: "remaining_low" as const, templateCode: item.code };
    assert.equal(ticketFactContractFingerprint(state), item.hash);
    assert.equal(ticketFactTemplateIssue(subject, state), "");
    assert.match(ticketFactTemplateIssue(subject, { ...state, content: item.content + "\n재등록해 주세요." }), /본문 또는 버튼 변경/);
    assert.match(ticketFactTemplateIssue(subject, { ...state, buttons: [...item.buttons, { name: "구매", type: "WL", mobileUrl: "https://example.invalid", desktopUrl: "" }] }), /본문 또는 버튼 변경/);
    assert.match(ticketFactTemplateIssue(subject, { ...state, status: "REJECTED" }), /승인 원문/);
    assert.match(ticketFactTemplateIssue(subject, null), /승인 원문/);
    assert.match(ticketFactTemplateIssue({ ...subject, templateCode: "unreviewed" }, state), /검증되지 않은/);
  }
  assert.equal(ticketFactTemplateIssue({ type: "reservation_open", templateCode: "other" }, null), "");
});

test("another purchased ticket does not suppress original factual notice", () => {
  const notice = candidate();
  assert.ok(notice);
  assert.equal(notice.payload.noticePurpose, "ticket_facts");
  assert.equal(renewalCandidateProfileIssue(notice, profile), "");
  assert.notEqual(notice.candidateId, directTicketCandidate(profile, { ...target, userTicketId: "second-low-ticket" }, "2026-09-30")?.candidateId);
});

test("ambiguous or no longer eligible source tickets remain blocked", () => {
  const notice = candidate();
  assert.match(renewalCandidateProfileIssue(notice, { ...profile, activeTickets: [{ ...target, remainingCount: 0 }] }), /대상 아님/);
  assert.match(renewalCandidateProfileIssue(notice, { ...profile, activeTickets: [{ ...target, remainingCount: 20 }] }), /대상 아님/);
  assert.match(renewalCandidateProfileIssue({ ...notice, payload: { ticketName: target.name } }, profile), /식별 불가/);
  assert.match(renewalCandidateProfileIssue(notice, { ...profile, activeTickets: [{ ...target, availableFrom: stamp("2026-10-01") }] }), /대상 아님/);
});

test("reservation open stays outside member-care cooldown and preserves weekly identity", () => {
  const fact = candidate();
  const open = { ...fact, type: "reservation_open" as const, payload: { reservationWeek: "2026-10-05" } };
  assert.equal(memberCareCandidatesConflict(open, fact), false);
  assert.equal(memberCareCandidatesConflict(fact, open), false);
  assert.equal(memberCareCandidatesConflict(fact, { ...fact, type: "long_absence" }), true);
  assert.equal(alimtalkDedupeKey(open), alimtalkDedupeKey({ ...open, templateCode: "next-version", memberPhone: "+821000000001" }));
  assert.notEqual(alimtalkDedupeKey(open), alimtalkDedupeKey({ ...open, payload: { reservationWeek: "2026-10-12" } }));
});

test("reservation send lookup never queries member-care history and blocks same-week sends", async () => {
  const oldSends = refs.alimtalkSends;
  const oldSend = refs.alimtalkSend;
  const queries: string[] = [];
  let duplicate = false;
  const query = {
    where(field: string) { queries.push(field); return query; },
    async get() { return { docs: duplicate ? [{ id: "same-week", data: () => ({ createdAt: { toMillis: () => Date.now() } }) }] : [] }; },
  };
  refs.alimtalkSends = (() => query) as typeof refs.alimtalkSends;
  refs.alimtalkSend = (() => ({ get: async () => ({ exists: false }) })) as typeof refs.alimtalkSend;
  try {
    const open = { ...candidate(), type: "reservation_open" as const, payload: { reservationWeek: "2026-10-05" } };
    assert.equal(await findCompletedDuplicateForCandidate(open, alimtalkDedupeKey(open), 6), "");
    assert.deepEqual(queries, ["dedupeKey", "status"]);
    duplicate = true;
    assert.equal(await findCompletedDuplicateForCandidate(open, alimtalkDedupeKey(open), 6), "same-week");
  } finally {
    refs.alimtalkSends = oldSends;
    refs.alimtalkSend = oldSend;
  }
});
