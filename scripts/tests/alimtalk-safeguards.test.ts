import assert from "node:assert/strict";
import test from "node:test";
import type { AlimtalkCandidateDoc } from "../../firebase/kangsain-functions/functions/src/types/models";
import {
  automaticMemberExclusionReason,
  isAutomaticMemberAlimtalkType,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/recipientExclusion";
import {
  memberCareCandidatesConflict,
  renewalReminderIdentity,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/dedupe";
import { isPastDueAutomaticCandidate } from "../../firebase/kangsain-functions/functions/src/alimtalk/rebuildAlimtalkCandidates";
import {
  compareProviderMessagesWithLedger,
  providerMessageEvidence,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/providerLedgerAudit";

function timestamp() {
  return { toMillis: () => Date.now(), toDate: () => new Date() } as never;
}

function candidate(
  type: AlimtalkCandidateDoc["type"],
  overrides: Partial<AlimtalkCandidateDoc> = {},
): AlimtalkCandidateDoc {
  return {
    candidateId: `candidate-${type}`,
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트",
    memberPhone: "01011112222",
    type,
    status: "candidate",
    templateCode: `template-${type}`,
    title: "알림",
    reason: "테스트",
    sourceDate: "2026-09-02",
    payload: {},
    lastError: null,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  };
}

test("automatic member flows exclude current staff but keep instructor lesson work messages", () => {
  assert.equal(isAutomaticMemberAlimtalkType("reservation_open"), true);
  assert.equal(isAutomaticMemberAlimtalkType("long_absence"), true);
  assert.equal(isAutomaticMemberAlimtalkType("instructor_lesson_material"), false);
  assert.equal(isAutomaticMemberAlimtalkType("onsite_welcome"), false);
});

test("staff grade and active staff phone are excluded without treating instructor members as staff", () => {
  assert.equal(
    automaticMemberExclusionReason(
      { memberId: "member-1", phone: "010-1111-2222", memberGrade: "스텝" },
      new Set(),
    ),
    "스텝 계정 알림톡 제외",
  );
  assert.equal(
    automaticMemberExclusionReason(
      { memberId: "member-1", phone: "010-1111-2222", memberGrade: "회원" },
      new Set(["01011112222"]),
    ),
    "현재 근무 스텝 계정 알림톡 제외",
  );
  assert.equal(
    automaticMemberExclusionReason(
      { memberId: "member-1", phone: "010-1111-2222", memberGrade: "강사회원" },
      new Set(),
    ),
    "",
  );
});

test("member care cooldown is symmetric between renewal and long absence", () => {
  const renewal = candidate("remaining_low", { payload: { renewalCaseId: "renewal-1", ticketName: "그룹 30회" } });
  const absence = candidate("long_absence");
  assert.equal(memberCareCandidatesConflict(renewal, absence), true);
  assert.equal(memberCareCandidatesConflict(absence, renewal), true);
});

test("renewal messages share a cooldown only for the same renewal case", () => {
  const count = candidate("remaining_low", { payload: { renewalCaseId: "renewal-1", ticketName: "그룹 30회" } });
  const expiry = candidate("ticket_expiring", { payload: { renewalCaseId: "renewal-1", ticketName: "그룹 30회" } });
  const other = candidate("ticket_expiring", { payload: { renewalCaseId: "renewal-2", ticketName: "그룹 30회" } });
  assert.equal(memberCareCandidatesConflict(count, expiry), true);
  assert.equal(memberCareCandidatesConflict(count, other), false);
  assert.equal(renewalReminderIdentity(count), "case:renewal-1");
});

test("only today-policy automatic candidates expire after their source date", () => {
  assert.equal(isPastDueAutomaticCandidate(candidate("reservation_open"), "2026-09-03"), true);
  assert.equal(isPastDueAutomaticCandidate(candidate("new_member"), "2026-09-03"), false);
  assert.equal(isPastDueAutomaticCandidate(candidate("pricing_info"), "2026-09-03"), false);
  assert.equal(
    isPastDueAutomaticCandidate(candidate("remaining_low", { status: "sent" }), "2026-09-03"),
    false,
  );
});

test("SOLAPI list evidence ignores non-Alimtalk rows and detects provider-only sends", () => {
  assert.equal(providerMessageEvidence("sms-1", { messageId: "sms-1", type: "SMS" }), null);
  const evidence = providerMessageEvidence("ata-1", {
    messageId: "ata-1",
    groupId: "group-1",
    type: "ATA",
    status: "COMPLETE",
    statusCode: "4000",
    kakaoOptions: { templateId: "template-1" },
  });
  assert.ok(evidence);
  const result = compareProviderMessagesWithLedger("2026-09-02", [evidence], new Set(["other-id"]));
  assert.deepEqual(result.missingInLedger.map((row) => row.messageId), ["ata-1"]);
  assert.equal(compareProviderMessagesWithLedger("2026-09-02", [evidence], new Set(["group-1"])).missingInLedger.length, 0);
  assert.equal(
    compareProviderMessagesWithLedger(
      "2026-09-02",
      [{ ...evidence, messageId: "pending-1", status: "PENDING", statusCode: "" }],
      new Set(),
    ).providerMessageCount,
    0,
  );
});
