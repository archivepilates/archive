import assert from "node:assert/strict";
import test from "node:test";
import type { AlimtalkCandidateDoc, BookingDoc, MemberProfileDoc } from "../../firebase/kangsain-functions/functions/src/types/models";
import {
  assessRenewalTicket,
  hasSameKindAlternativeTicket,
  isRenewalManagedTicket,
  renewalBookingKind,
  renewalRecommendation,
  renewalSourceTicketKey,
  renewalTicketKind,
  renewalUsageSummary,
} from "../../firebase/kangsain-functions/functions/src/renewal/renewalPolicy";
import { renewalCandidateProfileIssue } from "../../firebase/kangsain-functions/functions/src/alimtalk/renewalSendGuard";

type Ticket = NonNullable<MemberProfileDoc["activeTickets"]>[number];

function timestamp(value = "2026-08-01T00:00:00+09:00") {
  const date = new Date(value);
  return {
    toDate: () => date,
    toMillis: () => date.getTime(),
  } as never;
}

function booking(date: string, ticketName: string, attendanceStatus = "attended"): BookingDoc {
  return {
    bookingId: `${date}_${ticketName}`,
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트",
    memberPhone: "01000000000",
    lectureId: `lecture_${date}`,
    staffId: "staff-1",
    staffName: "강사",
    lectureDate: date,
    lectureStartAt: timestamp(`${date}T10:00:00+09:00`),
    lectureEndAt: null,
    memberRegisteredAt: null,
    sourceStatus: "예약 확정",
    appStatus: "reserved",
    attendanceStatus: attendanceStatus as BookingDoc["attendanceStatus"],
    syncStatus: "synced",
    ticketName,
    ticketRemainingCount: null,
    ticketExpiresAt: null,
    ticketExpiryLevel: "normal",
    memberTagIds: [],
    lastMemoPreview: "",
    lastMemoAt: null,
    lastChangedBy: "test",
    sourceHash: "test",
    sourceUpdatedAt: null,
    syncedAt: timestamp(),
    updatedAt: timestamp(),
  };
}

test("duet is treated as private for tickets and bookings", () => {
  assert.equal(renewalTicketKind({ name: "듀엣 레슨 20회권", classType: "G" }), "private");
  assert.equal(renewalBookingKind(booking("2026-07-01", "듀엣 레슨 20회권")), "private");
});

test("usage pace counts attended, absent and late cancel but not cancelled", () => {
  const rows = [
    booking("2026-07-05", "그룹 30회"),
    booking("2026-07-12", "그룹 30회", "absent"),
    booking("2026-07-19", "그룹 30회", "late_cancel"),
    booking("2026-07-26", "그룹 30회", "cancelled"),
  ];
  const summary = renewalUsageSummary(rows, "group", "2026-08-01");
  assert.equal(summary.consumedCount, 3);
  assert.equal(summary.weeklyPace, 0.4);
  assert.equal(summary.lastUsageDate, "2026-07-19");
});

test("assessment predicts depletion from the recent eight-week pace", () => {
  const rows = ["2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28", "2026-07-05", "2026-07-12", "2026-07-19", "2026-07-26"].map(
    (date) => booking(date, "프라이빗 20회"),
  );
  const ticket: Ticket = {
    name: "프라이빗 20회",
    classType: "P",
    remainingCount: 4,
    expiresAt: timestamp("2026-12-31T23:59:59+09:00"),
    expiryLevel: "normal",
  };
  const assessment = assessRenewalTicket({ ticket, bookings: rows, sourceDate: "2026-08-01" });
  assert.ok(assessment);
  assert.equal(assessment.kind, "private");
  assert.equal(assessment.predictedDepletionDate, "2026-08-29");
  assert.equal(assessment.recommendation, "프라이빗 20회 중심 상담");
});

test("long-ticket recommendations stay capped at fifty unless usage is high", () => {
  assert.equal(renewalRecommendation("group", 1.5), "그룹 20회 중심 상담");
  assert.equal(renewalRecommendation("group", 2.2), "그룹 30회 중심 상담");
  assert.equal(renewalRecommendation("group", 3.2), "그룹 50회 중심 상담");
});

test("renewal source key does not change when expiry or remaining count is corrected", () => {
  const ticket: Ticket = {
    name: "그룹 30회",
    classType: "G",
    maxCount: 30,
    remainingCount: 5,
    availableFrom: timestamp("2026-07-01T00:00:00+09:00"),
    expiresAt: timestamp("2026-10-01T23:59:59+09:00"),
    expiryLevel: "warning",
  };
  const before = renewalSourceTicketKey("member-1", "group", ticket);
  ticket.remainingCount = 3;
  ticket.expiresAt = timestamp("2026-10-10T23:59:59+09:00");
  assert.equal(renewalSourceTicketKey("member-1", "group", ticket), before);
});

test("same-name ticket records are still treated as separate follow-up tickets", () => {
  const expiring: Ticket = {
    name: "그룹 30회",
    classType: "G",
    remainingCount: 3,
    expiresAt: timestamp("2026-08-20T23:59:59+09:00"),
    expiryLevel: "warning",
  };
  const followUp: Ticket = {
    name: "그룹 30회",
    classType: "G",
    remainingCount: 30,
    availableFrom: timestamp("2026-08-21T00:00:00+09:00"),
    expiresAt: timestamp("2026-12-31T23:59:59+09:00"),
    expiryLevel: "normal",
  };
  assert.equal(hasSameKindAlternativeTicket([expiring, followUp], expiring, "2026-08-01"), true);
});

test("compensation coupons are not renewal tickets or replacement tickets", () => {
  const expiring: Ticket = {
    name: "그룹 30회",
    classType: "G",
    remainingCount: 3,
    expiresAt: timestamp("2026-08-20T23:59:59+09:00"),
    expiryLevel: "warning",
  };
  const coupon: Ticket = {
    name: "2026' 여름휴가 보상 쿠폰",
    classType: "G",
    remainingCount: 1,
    expiresAt: timestamp("2026-08-17T23:59:59+09:00"),
    expiryLevel: "warning",
  };
  assert.equal(hasSameKindAlternativeTicket([expiring, coupon], expiring, "2026-08-01"), false);
  assert.equal(assessRenewalTicket({ ticket: coupon, bookings: [], sourceDate: "2026-08-01" }), null);
  assert.equal(isRenewalManagedTicket({ name: "신규 스텝 교육용 수강권" }), false);
  assert.equal(isRenewalManagedTicket({ name: "여름휴가 보상권" }), false);
});

test("send guard blocks gift vouchers and compensation coupons", () => {
  const profile: MemberProfileDoc = {
    memberId: "member-1",
    studioId: "5330",
    name: "테스트",
    phone: "01000000000",
    registeredAt: null,
    activeTickets: [
      {
        name: "그룹1회상품권",
        classType: "G",
        remainingCount: 1,
        expiresAt: timestamp("2026-08-25T23:59:59+09:00"),
        expiryLevel: "warning",
      },
    ],
    syncedAt: timestamp(),
    updatedAt: timestamp(),
  };
  const candidate: AlimtalkCandidateDoc = {
    candidateId: "candidate-gift-voucher",
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트",
    memberPhone: "01000000000",
    type: "remaining_low",
    status: "queued",
    templateCode: "template",
    title: "수강권",
    reason: "잔여횟수 부족",
    sourceDate: "2026-08-01",
    payload: { ticketName: "그룹1회상품권", remainingCount: "1" },
    lastError: null,
    createdAt: timestamp(),
    updatedAt: timestamp(),
  };
  assert.equal(renewalCandidateProfileIssue(candidate, profile), "재등록 안내 제외 수강권");
});

test("another risky same-kind ticket does not suppress renewal management", () => {
  const first: Ticket = {
    name: "그룹 30회",
    classType: "G",
    remainingCount: 3,
    expiresAt: timestamp("2026-08-20T23:59:59+09:00"),
    expiryLevel: "warning",
  };
  const second: Ticket = {
    name: "그룹 20회",
    classType: "G",
    remainingCount: 2,
    expiresAt: timestamp("2026-08-25T23:59:59+09:00"),
    expiryLevel: "warning",
  };
  assert.equal(hasSameKindAlternativeTicket([first, second], first, "2026-08-01"), false);
  assert.equal(hasSameKindAlternativeTicket([first, second], second, "2026-08-01"), false);
});

test("an incomplete same-kind ticket is not treated as a healthy follow-up", () => {
  const target: Ticket = {
    name: "그룹 30회",
    classType: "G",
    remainingCount: 3,
    expiresAt: timestamp("2026-08-20T23:59:59+09:00"),
    expiryLevel: "warning",
  };
  const incomplete: Ticket = { name: "그룹 신규권", classType: "G" };
  assert.equal(hasSameKindAlternativeTicket([target, incomplete], target, "2026-08-01"), false);
});

test("send guard blocks a stale candidate after a follow-up ticket is added", () => {
  const target: Ticket = {
    userTicketId: "target",
    name: "그룹 30회",
    classType: "G",
    remainingCount: 3,
    expiresAt: timestamp("2026-08-20T23:59:59+09:00"),
    expiryLevel: "warning",
  };
  const profile: MemberProfileDoc = {
    memberId: "member-1",
    studioId: "5330",
    name: "테스트",
    phone: "01000000000",
    registeredAt: null,
    activeTickets: [target],
    syncedAt: timestamp(),
    updatedAt: timestamp(),
  };
  const candidate: AlimtalkCandidateDoc = {
    candidateId: "candidate-1",
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트",
    memberPhone: "01000000000",
    type: "remaining_low",
    status: "queued",
    templateCode: "template",
    title: "수강권",
    reason: "잔여횟수 부족",
    sourceDate: "2026-08-01",
    payload: { userTicketId: "target", ticketName: "그룹 30회", remainingCount: "3" },
    lastError: null,
    createdAt: timestamp(),
    updatedAt: timestamp(),
  };
  assert.equal(renewalCandidateProfileIssue(candidate, profile), "");
  profile.activeTickets?.push({
    userTicketId: "private-backup",
    name: "프라이빗 20회",
    classType: "P",
    remainingCount: 20,
    availableFrom: timestamp("2026-08-02T00:00:00+09:00"),
    expiresAt: timestamp("2026-12-31T23:59:59+09:00"),
    expiryLevel: "normal",
  });
  assert.equal(renewalCandidateProfileIssue(candidate, profile), "");
  profile.activeTickets?.push({
    userTicketId: "backup",
    name: "그룹 30회",
    classType: "G",
    remainingCount: 30,
    availableFrom: timestamp("2026-08-02T00:00:00+09:00"),
    expiresAt: timestamp("2026-12-31T23:59:59+09:00"),
    expiryLevel: "normal",
  });
  assert.equal(renewalCandidateProfileIssue(candidate, profile), "현재 또는 사용예정 동일 유형 후속 수강권 보유");
});

test("send guard blocks a same-name follow-up ticket without stable ticket ids", () => {
  const profile: MemberProfileDoc = {
    memberId: "member-1",
    studioId: "5330",
    name: "테스트",
    phone: "01000000000",
    registeredAt: null,
    activeTickets: [
      {
        name: "그룹 30회",
        classType: "G",
        remainingCount: 3,
        expiresAt: timestamp("2026-08-20T23:59:59+09:00"),
        expiryLevel: "warning",
      },
      {
        name: "그룹 30회",
        classType: "G",
        remainingCount: 30,
        availableFrom: timestamp("2026-08-21T00:00:00+09:00"),
        expiresAt: timestamp("2026-12-31T23:59:59+09:00"),
        expiryLevel: "normal",
      },
    ],
    syncedAt: timestamp(),
    updatedAt: timestamp(),
  };
  const candidate: AlimtalkCandidateDoc = {
    candidateId: "candidate-same-name",
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트",
    memberPhone: "01000000000",
    type: "remaining_low",
    status: "queued",
    templateCode: "template",
    title: "수강권",
    reason: "잔여횟수 부족",
    sourceDate: "2026-08-01",
    payload: { ticketName: "그룹 30회", remainingCount: "3" },
    lastError: null,
    createdAt: timestamp(),
    updatedAt: timestamp(),
  };
  assert.equal(
    renewalCandidateProfileIssue(candidate, profile),
    "현재 또는 사용예정 동일 유형 후속 수강권 보유",
  );
});
