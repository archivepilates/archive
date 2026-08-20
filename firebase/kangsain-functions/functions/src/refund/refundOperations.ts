import { createHash } from "node:crypto";
import type { CallableRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { requireManager, requireStaff } from "../security/authGuards";
import type { MemberProfileDoc, StaffDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { AppError, errorMessage } from "../utils/errors";
import {
  assertRefundRequestWindow,
  calculateRefund,
  deriveRefundPeriodUsage,
  inferRefundContractDays,
  inferRefundTicketKind,
  type RefundCalculation,
  type RefundTicketKind,
} from "./refundPolicy";

const REFUND_CASES = "refundCases";
const EFORMSIGN_REFUND_JOBS = "eformsignRefundJobs";
const STUDIOMATE_REFUND_SMS_JOBS = "studiomateRefundSmsJobs";
const REFUND_AGREEMENT_TEMPLATE_ID = "fbdd279c2d7447938bc4e997f249c7b5";
const MAX_MATCHES = 30;

type ActiveTicket = NonNullable<MemberProfileDoc["activeTickets"]>[number];

type ResolvedRefundMember = {
  memberId: string;
  profile: MemberProfileDoc & Record<string, unknown>;
};

type RefundPreviewInput = {
  memberId: string;
  memberName: string;
  memberPhone: string;
  ticketKey: string;
  requestedAt: string;
  paidAmount: number | null;
  ticketKind: RefundTicketKind;
  normalUnitAmount: number | null;
  usedCount: number | null;
  totalContractWeeks: number | null;
  usedWeeks: number | null;
  giftDeductionAmount: number | null;
  manualReason: string;
  paymentSourceNote: string;
  eligibilityReviewConfirmed: boolean;
};

export async function getRefundMemberTicketsHandler(request: CallableRequest): Promise<Record<string, unknown>> {
  const staff = await manager(request);
  const memberId = cleanText(request.data?.memberId, 120);
  const memberName = cleanText(request.data?.memberName, 40);
  const memberPhone = normalizePhone(request.data?.memberPhone);
  if (!memberId && !memberPhone) {
    validateMemberName(memberName);
    const candidates = await searchRefundMembers(staff, memberName);
    return { ok: true, candidates };
  }
  const member = memberId
    ? await resolveMemberById(staff, memberId)
    : await resolveMember(staff, memberName, memberPhone);
  const tickets = (member.profile.activeTickets || [])
    .filter(isCurrentRefundCandidateTicket)
    .map((ticket) => safeTicket(ticket));
  const canonicalPhone = requireMemberPhone(member.profile.phone);
  return {
    ok: true,
    member: {
      memberId: member.memberId,
      memberName: member.profile.name,
      memberPhone: canonicalPhone,
      maskedPhone: maskPhone(canonicalPhone),
      sourceUpdatedAt: timestampIso(member.profile.sourceUpdatedAt || member.profile.updatedAt),
    },
    tickets,
    policy: {
      title: "ARCHIVE PILATES 환불규정",
      summary: "모든 환불에 결제금액의 10% 위약금과 사용분을 공제",
      countTicketRule: "1회 정상 단가 × (StudioMate 총횟수 − 잔여횟수)",
      periodTicketRule: "결제금액 × StudioMate 사용기간 ÷ 총 이용기간",
      sourceUrl: "https://app.notion.com/p/313d49eae4bf80179269f09d02597ede",
    },
  };
}

export async function previewRefundHandler(request: CallableRequest): Promise<Record<string, unknown>> {
  const staff = await manager(request);
  const input = parsePreviewInput(request.data);
  const member = await resolvePreviewMember(staff, input);
  const ticket = findTicket(member.profile.activeTickets || [], input.ticketKey);
  const { calculation, paymentSource } = calculateFromTicket(input, ticket, member.profile.name);
  return safePreview(member, ticket, calculation, paymentSource, input.requestedAt);
}

export async function sendRefundAgreementHandler(request: CallableRequest): Promise<Record<string, unknown>> {
  const staff = await manager(request);
  if (request.data?.confirmed !== true) throw new AppError("INVALID_ARGUMENT", "환불금액 확인이 필요합니다.");
  const input = parsePreviewInput(request.data);
  const expectedHash = cleanText(request.data?.calculationHash, 80);
  if (!expectedHash) throw new AppError("INVALID_ARGUMENT", "환불 계산을 먼저 실행하세요.");
  const member = await resolvePreviewMember(staff, input);
  const memberPhone = requireMemberPhone(member.profile.phone);
  const ticket = findTicket(member.profile.activeTickets || [], input.ticketKey);
  const { calculation, paymentSource } = calculateFromTicket(input, ticket, member.profile.name);
  if (calculation.calculationHash !== expectedHash) {
    throw new AppError("INVALID_ARGUMENT", "환불금액이 변경되었습니다. 다시 계산한 뒤 확인하세요.");
  }
  const ticketSnapshot = safeTicket(ticket, input.requestedAt);
  const eformsignTemplateId = REFUND_AGREEMENT_TEMPLATE_ID;
  const caseId = refundCaseId(staff.studioId, member.memberId, input.ticketKey);
  const caseRef = db.collection(REFUND_CASES).doc(caseId);
  const jobRef = db.collection(EFORMSIGN_REFUND_JOBS).doc(caseId);
  const now = nowTimestamp();
  const locked = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(caseRef);
    const existingJob = await transaction.get(jobRef);
    const data = existing.data() || {};
    if (data.status === "agreement_sent") {
      return {
        duplicate: true,
        documentId: String(data.eformsignDocumentId || ""),
        documentUrl: String(data.eformsignDocumentUrl || ""),
      };
    }
    if (["agreement_queued", "sending", "send_review_required"].includes(String(data.status || ""))) {
      throw new AppError(
        "INVALID_ARGUMENT",
        "동일 환불동의서의 발송 결과를 먼저 확인하세요. 중복 발송 방지를 위해 재발송을 막았습니다.",
      );
    }
    if (existingJob.exists) {
      throw new AppError(
        "INVALID_ARGUMENT",
        "동일 환불동의서 작업이 이미 있습니다. 작업 상태를 먼저 확인하세요.",
      );
    }
    transaction.set(
      caseRef,
      {
        caseId,
        studioId: staff.studioId,
        memberId: member.memberId,
        memberName: member.profile.name,
        memberPhone,
        memberPhoneLast4: memberPhone.slice(-4),
        ticketKey: input.ticketKey,
        ticketName: ticket.name,
        ticketSnapshot,
        paymentSource,
        calculation,
        calculationHash: calculation.calculationHash,
        policyVersion: calculation.policyVersion,
        operatorMessage: calculation.message,
        status: "agreement_queued",
        queuedAt: now,
        eformsignTemplateId,
        createdByUid: staff.uid,
        createdByName: staff.name,
        createdAt: data.createdAt || now,
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.set(
      jobRef,
      {
        jobId: caseId,
        caseId,
        studioId: staff.studioId,
        memberId: member.memberId,
        memberName: member.profile.name,
        memberPhone,
        memberPhoneLast4: memberPhone.slice(-4),
        ticketKey: input.ticketKey,
        ticketName: ticket.name,
        ticketExpiresAt: timestampIso(ticket.expiresAt),
        ticketSourceSnapshot: sourceTicketSnapshot(ticket),
        paymentAmount: calculation.paidAmount,
        penaltyAmount: calculation.penaltyAmount,
        usedAmount: calculation.usedAmount + calculation.giftDeductionAmount,
        refundAmount: calculation.refundAmount,
        calculationHash: calculation.calculationHash,
        templateId: eformsignTemplateId,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        createdByUid: staff.uid,
        createdAt: now,
        updatedAt: now,
      },
      { merge: false },
    );
    return { duplicate: false, documentId: "", documentUrl: "" };
  });
  if (locked.duplicate) {
    return {
      ok: true,
      status: "duplicate_blocked",
      caseId,
      documentId: locked.documentId,
      documentUrl: locked.documentUrl,
    };
  }

  return { ok: true, status: "agreement_queued", caseId, documentId: "" };
}

export async function queueRefundStudioMateSmsHandler(request: CallableRequest): Promise<Record<string, unknown>> {
  const staff = await manager(request);
  if (request.data?.confirmed !== true) throw new AppError("INVALID_ARGUMENT", "회원 문자 발송 확인이 필요합니다.");
  const input = parsePreviewInput(request.data);
  const expectedHash = cleanText(request.data?.calculationHash, 80);
  if (!expectedHash) throw new AppError("INVALID_ARGUMENT", "환불 계산을 먼저 실행하세요.");
  const member = await resolvePreviewMember(staff, input);
  const memberPhone = requireMemberPhone(member.profile.phone);
  const ticket = findTicket(member.profile.activeTickets || [], input.ticketKey);
  const { calculation, paymentSource } = calculateFromTicket(input, ticket, member.profile.name);
  if (calculation.calculationHash !== expectedHash) {
    throw new AppError("INVALID_ARGUMENT", "환불금액이 변경되었습니다. 다시 계산한 뒤 확인하세요.");
  }

  const caseId = refundCaseId(staff.studioId, member.memberId, input.ticketKey);
  const jobId = refundSmsJobId(caseId, calculation.calculationHash);
  const caseRef = db.collection(REFUND_CASES).doc(caseId);
  const jobRef = db.collection(STUDIOMATE_REFUND_SMS_JOBS).doc(jobId);
  const ticketSnapshot = safeTicket(ticket, input.requestedAt);
  const now = nowTimestamp();
  const result = await db.runTransaction(async (transaction) => {
    const [existingCase, existingJob] = await Promise.all([
      transaction.get(caseRef),
      transaction.get(jobRef),
    ]);
    const caseData = existingCase.data() || {};
    const jobData = existingJob.data() || {};
    const existingStatus = String(jobData.status || "");
    if (existingStatus === "sent") {
      return { duplicate: true, status: "sms_already_sent" };
    }
    if (["pending", "retry", "processing", "sending", "send_review_required"].includes(existingStatus)) {
      return { duplicate: true, status: "sms_duplicate_blocked" };
    }
    if (jobData.sendClickedAt) {
      throw new AppError(
        "INVALID_ARGUMENT",
        "이전 문자 발송 결과를 먼저 확인하세요. 중복 발송 방지를 위해 재발송을 막았습니다.",
      );
    }

    const smsNotice = {
      jobId,
      status: "queued",
      title: "ARCHIVE PILATES 환불 안내",
      message: calculation.message,
      calculationHash: calculation.calculationHash,
      queuedAt: now,
      updatedAt: now,
    };
    transaction.set(
      caseRef,
      {
        caseId,
        studioId: staff.studioId,
        memberId: member.memberId,
        memberName: member.profile.name,
        memberPhone,
        memberPhoneLast4: memberPhone.slice(-4),
        ticketKey: input.ticketKey,
        ticketName: ticket.name,
        ticketSnapshot,
        paymentSource,
        calculation,
        calculationHash: calculation.calculationHash,
        policyVersion: calculation.policyVersion,
        operatorMessage: calculation.message,
        status: caseData.status || "calculated",
        smsNotice,
        createdByUid: caseData.createdByUid || staff.uid,
        createdByName: caseData.createdByName || staff.name,
        createdAt: caseData.createdAt || now,
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.set(
      jobRef,
      {
        jobId,
        caseId,
        studioId: staff.studioId,
        memberId: member.memberId,
        studiomateMemberId: cleanText(member.profile.studiomateMemberId, 120),
        memberName: member.profile.name,
        memberPhone,
        memberPhoneLast4: memberPhone.slice(-4),
        ticketKey: input.ticketKey,
        ticketName: ticket.name,
        ticketExpiresAt: timestampIso(ticket.expiresAt),
        ticketSourceSnapshot: sourceTicketSnapshot(ticket),
        calculationHash: calculation.calculationHash,
        smsTitle: smsNotice.title,
        smsMessage: smsNotice.message,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        createdByUid: staff.uid,
        createdAt: jobData.createdAt || now,
        queuedAt: now,
        updatedAt: now,
        lastError: null,
      },
      { merge: true },
    );
    return { duplicate: false, status: "sms_queued" };
  });

  return { ok: true, status: result.status, caseId, jobId, duplicate: result.duplicate };
}

async function manager(request: CallableRequest): Promise<StaffDoc> {
  const staff = await requireStaff(request);
  requireManager(staff);
  return staff;
}

function parsePreviewInput(data: any): RefundPreviewInput {
  const memberId = cleanText(data?.memberId, 120);
  const memberName = cleanText(data?.memberName, 40);
  const memberPhone = normalizePhone(data?.memberPhone);
  if (!memberId) validateMemberLookup(memberName, memberPhone);
  const ticketKey = cleanText(data?.ticketKey, 120);
  if (!ticketKey) throw new AppError("INVALID_ARGUMENT", "환불할 수강권을 선택하세요.");
  const requestedAt = cleanText(data?.requestedAt, 40) || new Date().toISOString();
  if (Number.isNaN(new Date(requestedAt).getTime())) throw new AppError("INVALID_ARGUMENT", "환불 요청일을 확인하세요.");
  return {
    memberId,
    memberName,
    memberPhone,
    ticketKey,
    requestedAt,
    paidAmount: nullableMoney(data?.paidAmount),
    ticketKind: refundTicketKind(data?.ticketKind),
    normalUnitAmount: nullableMoney(data?.normalUnitAmount),
    usedCount: nullableNumber(data?.usedCount, "사용 횟수", true),
    totalContractWeeks: nullableNumber(data?.totalContractWeeks, "총 계약 주수"),
    usedWeeks: nullableNumber(data?.usedWeeks, "실제 사용 주수"),
    giftDeductionAmount: nullableMoney(data?.giftDeductionAmount),
    manualReason: cleanText(data?.manualReason, 300),
    paymentSourceNote: cleanText(data?.paymentSourceNote, 300),
    eligibilityReviewConfirmed: data?.eligibilityReviewConfirmed === true,
  };
}

function calculateFromTicket(input: RefundPreviewInput, ticket: ActiveTicket, memberName: string) {
  try {
    assertRefundRequestWindow({ requestedAt: input.requestedAt, expiresAt: timestampIso(ticket.expiresAt) });
  } catch (err) {
    throw new AppError("INVALID_ARGUMENT", errorMessage(err));
  }
  const canonicalTicketKind = inferRefundTicketKind(ticket.maxCount, ticket.usableCount);
  if (input.ticketKind !== canonicalTicketKind) {
    throw new AppError("INVALID_ARGUMENT", "수강권 유형이 원천 데이터와 다릅니다. 회원을 다시 조회하세요.");
  }
  if (!input.eligibilityReviewConfirmed) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "무료·증정·이벤트·프로모션 혜택과 완료수업·노쇼 공제 여부를 확인하세요.",
    );
  }
  const canonicalPaymentAmount = ticketPaymentAmount(ticket);
  const paidAmount = input.paidAmount ?? canonicalPaymentAmount;
  if (!paidAmount) throw new AppError("INVALID_ARGUMENT", "실결제금액 원천이 없습니다. 결제내역 확인 후 금액과 근거를 입력하세요.");
  const override = canonicalPaymentAmount == null || canonicalPaymentAmount !== paidAmount;
  if (override && !input.paymentSourceNote) {
    throw new AppError("INVALID_ARGUMENT", "실결제금액을 직접 입력한 원천과 확인 근거를 작성하세요.");
  }
  const totalCount = nullableSourceNumber(ticket.maxCount ?? ticket.usableCount);
  const remainingCount = nullableSourceNumber(ticket.remainingCount);
  if (canonicalTicketKind === "count") {
    if (totalCount == null || remainingCount == null || remainingCount > totalCount) {
      throw new AppError("INVALID_ARGUMENT", "StudioMate 총횟수·잔여횟수 원천을 확인할 수 없어 계산을 중단했습니다.");
    }
  }
  let calculation: RefundCalculation;
  try {
    calculation = calculateRefund({
      memberName,
      ticketName: ticket.name,
      ticketKind: input.ticketKind,
      paidAmount,
      totalCount,
      remainingCount,
      normalUnitAmount: input.normalUnitAmount,
      usedCount: null,
      totalContractWeeks: input.totalContractWeeks,
      usedWeeks: input.usedWeeks,
      giftDeductionAmount: input.giftDeductionAmount,
      manualReason: input.manualReason,
      usageSource: canonicalTicketKind === "count" ? "studiomate_active_ticket" : "operator_verified",
    });
  } catch (err) {
    throw new AppError("INVALID_ARGUMENT", errorMessage(err));
  }
  return {
    calculation,
    paymentSource: {
      type: override ? "operator_verified" : "memberProfiles.activeTickets",
      sourceAmount: canonicalPaymentAmount,
      operatorNote: override ? input.paymentSourceNote : "",
    },
  };
}

async function resolvePreviewMember(staff: StaffDoc, input: RefundPreviewInput): Promise<ResolvedRefundMember> {
  return input.memberId
    ? resolveMemberById(staff, input.memberId)
    : resolveMember(staff, input.memberName, input.memberPhone);
}

async function resolveMemberById(staff: StaffDoc, memberId: string): Promise<ResolvedRefundMember> {
  const snapshot = await db.collection("memberProfiles").doc(memberId).get();
  if (!snapshot.exists) throw new AppError("NOT_FOUND", "선택한 회원카드를 찾지 못했습니다.");
  const profile = snapshot.data() as MemberProfileDoc & Record<string, unknown>;
  if (profile.studioId !== staff.studioId) throw new AppError("PERMISSION_DENIED", "선택한 회원에 접근할 수 없습니다.");
  const member = await resolveCanonicalMember({ memberId: snapshot.id, profile });
  if (member.memberId !== memberId) {
    throw new AppError("INVALID_ARGUMENT", "회원카드가 병합되었습니다. 이름으로 다시 검색해 선택하세요.");
  }
  requireMemberPhone(member.profile.phone);
  return member;
}

async function searchRefundMembers(staff: StaffDoc, memberName: string) {
  const normalizedName = normalizeName(memberName);
  const queries = [
    db.collection("memberProfiles").where("normalizedName", "==", normalizedName).limit(MAX_MATCHES).get(),
    db.collection("memberProfiles").where("name", "==", memberName).limit(MAX_MATCHES).get(),
    db.collection("memberProfiles").where("aliasNames", "array-contains", memberName).limit(MAX_MATCHES).get(),
  ];
  const snapshots = await Promise.all(queries);
  const raw = new Map<string, ResolvedRefundMember>();
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      const profile = document.data() as MemberProfileDoc & Record<string, unknown>;
      if (profile.studioId !== staff.studioId || !memberNameMatches(profile, memberName)) continue;
      raw.set(document.id, { memberId: document.id, profile });
    }
  }
  const canonical = await Promise.all([...raw.values()].map(resolveCanonicalMember));
  const unique = new Map<string, ResolvedRefundMember>();
  for (const member of canonical) unique.set(member.memberId, member);
  return [...unique.values()]
    .filter((member) => isCurrentRefundMember(member.profile))
    .map((member) => {
      const phone = normalizePhone(member.profile.phone);
      const activeTicketCount = (member.profile.activeTickets || []).filter(isCurrentRefundCandidateTicket).length;
      return {
        memberId: member.memberId,
        memberName: member.profile.name,
        maskedPhone: maskPhone(phone),
        phoneLast4: phone.slice(-4),
        activeTicketCount,
        sourceUpdatedAt: timestampIso(member.profile.sourceUpdatedAt || member.profile.updatedAt),
      };
    })
    .sort((a, b) => b.activeTicketCount - a.activeTicketCount || a.memberId.localeCompare(b.memberId))
    .slice(0, MAX_MATCHES);
}

async function resolveMember(staff: StaffDoc, memberName: string, memberPhone: string): Promise<ResolvedRefundMember> {
  let snapshots = await db
    .collection("memberProfiles")
    .where("phone", "in", phoneLookupValues(memberPhone))
    .limit(MAX_MATCHES)
    .get();
  if (snapshots.empty) {
    snapshots = await db.collection("memberProfiles").where("phoneLast4", "==", memberPhone.slice(-4)).limit(100).get();
  }
  const initial = snapshots.docs
    .map((snapshot) => ({ memberId: snapshot.id, profile: snapshot.data() as MemberProfileDoc & Record<string, unknown> }))
    .filter((item) => item.profile.studioId === staff.studioId && normalizePhone(item.profile.phone) === memberPhone);
  const canonical = await Promise.all(initial.map(resolveCanonicalMember));
  const unique = new Map(canonical.map((item) => [item.memberId, item]));
  const nameMatches = [...unique.values()].filter((item) => memberNameMatches(item.profile, memberName));
  if (!nameMatches.length) throw new AppError("NOT_FOUND", "이름과 연락처가 일치하는 회원을 찾지 못했습니다.");
  if (nameMatches.length > 1) throw new AppError("INVALID_ARGUMENT", "같은 연락처의 회원카드가 여러 개입니다. 회원 병합 후 진행하세요.");
  return nameMatches[0];
}

async function resolveCanonicalMember(item: ResolvedRefundMember): Promise<ResolvedRefundMember> {
  let current = item;
  const visited = new Set([item.memberId]);
  for (let index = 0; index < 3; index += 1) {
    const nextId = cleanText(current.profile.canonicalMemberId || current.profile.mergedInto, 120);
    if (!nextId || visited.has(nextId)) break;
    visited.add(nextId);
    const snapshot = await db.collection("memberProfiles").doc(nextId).get();
    if (!snapshot.exists) break;
    const profile = snapshot.data() as MemberProfileDoc & Record<string, unknown>;
    if (profile.studioId !== item.profile.studioId) break;
    current = { memberId: snapshot.id, profile };
  }
  return current;
}

function memberNameMatches(profile: MemberProfileDoc & Record<string, unknown>, memberName: string): boolean {
  const expected = normalizeName(memberName);
  const aliases = Array.isArray(profile.aliasNames) ? profile.aliasNames : [];
  return [profile.name, profile.normalizedName, ...aliases].some((value) => normalizeName(value) === expected);
}

function findTicket(tickets: ActiveTicket[], expectedKey: string): ActiveTicket {
  const candidates = tickets.filter(isRefundCandidateTicket);
  const matches = candidates.filter((item) => ticketKey(item) === expectedKey);
  if (!matches.length) throw new AppError("NOT_FOUND", "수강권 정보가 변경되었습니다. 회원을 다시 조회하세요.");
  if (matches.length > 1) {
    throw new AppError("INVALID_ARGUMENT", "동일 수강권 식별자가 여러 개입니다. 수강권 원천을 정리한 뒤 진행하세요.");
  }
  return matches[0];
}

function isRefundCandidateTicket(ticket: ActiveTicket): boolean {
  const status = String(ticket.status || "active").toLowerCase();
  return !["refunded", "cancelled", "canceled", "deleted", "inactive", "환불", "취소"].includes(status);
}

function isCurrentRefundCandidateTicket(ticket: ActiveTicket): boolean {
  if (!isRefundCandidateTicket(ticket)) return false;
  const expiresAt = timestampIso(ticket.expiresAt);
  if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) return false;
  const kind = inferRefundTicketKind(ticket.maxCount, ticket.usableCount);
  if (kind === "count") {
    const remainingCount = nullableSourceNumber(ticket.remainingCount);
    return remainingCount != null && remainingCount > 0;
  }
  return Boolean(periodUsageFromTicket(ticket, new Date().toISOString()));
}

function isCurrentRefundMember(profile: MemberProfileDoc & Record<string, unknown>): boolean {
  const phone = normalizePhone(profile.phone);
  return /^010\d{8}$/.test(phone)
    && (profile.activeTickets || []).some(isCurrentRefundCandidateTicket);
}

function safeTicket(ticket: ActiveTicket, usageAsOf = new Date().toISOString()) {
  const paymentAmount = ticketPaymentAmount(ticket);
  const totalCount = nullableSourceNumber(ticket.maxCount ?? ticket.usableCount);
  const remainingCount = nullableSourceNumber(ticket.remainingCount);
  const suggestedTicketKind = inferRefundTicketKind(ticket.maxCount, ticket.usableCount);
  const inferredContractDays = inferRefundContractDays(ticket.name);
  const suggestedContractWeeks = inferredContractDays != null
    ? Math.round((inferredContractDays / 7) * 100) / 100
    : contractWeeks(ticket.availableFrom, ticket.expiresAt);
  const expiresAt = timestampIso(ticket.expiresAt);
  const periodUsage = suggestedTicketKind === "period"
    ? periodUsageFromTicket(ticket, usageAsOf)
    : null;
  const countUsageReady = totalCount != null && remainingCount != null && remainingCount <= totalCount;
  const usageReady = suggestedTicketKind === "count" ? countUsageReady : Boolean(periodUsage);
  return {
    ticketKey: ticketKey(ticket),
    userTicketId: ticket.userTicketId || "",
    ticketId: ticket.ticketId || "",
    ticketName: ticket.name,
    classType: ticket.classType || "",
    status: ticket.status || "active",
    paymentAmount,
    paymentSourceAvailable: paymentAmount != null,
    totalCount,
    remainingCount,
    usedCount: totalCount != null && remainingCount != null ? Math.max(0, totalCount - remainingCount) : null,
    availableFrom: timestampIso(ticket.availableFrom),
    expiresAt,
    suggestedTicketKind,
    suggestedContractWeeks,
    totalContractDays: periodUsage?.totalDays ?? null,
    usedDays: periodUsage?.excludedDays === 0 ? periodUsage.usedDays : null,
    remainingDays: periodUsage?.remainingDays ?? null,
    excludedDays: periodUsage?.excludedDays ?? 0,
    usageAsOf,
    expiredNow: expiresAt ? new Date(expiresAt).getTime() < Date.now() : false,
    sourceFile: ticket.sourceFile || "",
    sourceImportId: ticket.sourceImportId || "",
    calculationReady: Boolean(paymentAmount) && usageReady,
    eligibilityWarnings: refundEligibilityWarnings(ticket, paymentAmount),
  };
}

function safePreview(
  member: ResolvedRefundMember,
  ticket: ActiveTicket,
  calculation: RefundCalculation,
  paymentSource: Record<string, unknown>,
  usageAsOf: string,
) {
  return {
    ok: true,
    member: {
      memberId: member.memberId,
      memberName: member.profile.name,
      memberPhone: normalizePhone(member.profile.phone),
    },
    ticket: safeTicket(ticket, usageAsOf),
    calculation,
    paymentSource,
  };
}

function ticketPaymentAmount(ticket: ActiveTicket): number | null {
  for (const value of [ticket.paymentAmount, ticket.amountTotal, ticket.price]) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return Math.round(amount);
  }
  return null;
}

function ticketKey(ticket: ActiveTicket): string {
  if (ticket.userTicketId) return `userTicket:${ticket.userTicketId}`;
  if (ticket.ticketId) return `ticket:${ticket.ticketId}`;
  return `derived:${createHash("sha256")
    .update(
      JSON.stringify({
        name: ticket.name,
        availableFrom: timestampIso(ticket.availableFrom),
        purchasedAt: timestampIso(ticket.purchasedAt),
        paymentAt: timestampIso(ticket.paymentAt),
      }),
    )
    .digest("hex")
    .slice(0, 24)}`;
}

function refundCaseId(studioId: string, memberId: string, ticketKeyValue: string): string {
  return `refund_${createHash("sha256")
    .update(`${studioId}|${memberId}|${ticketKeyValue}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function refundSmsJobId(caseId: string, calculationHash: string): string {
  return `refund_sms_${createHash("sha256")
    .update(`${caseId}|${calculationHash}|refund_estimate`)
    .digest("hex")
    .slice(0, 32)}`;
}

function sourceTicketSnapshot(ticket: ActiveTicket) {
  return {
    ticketKey: ticketKey(ticket),
    ticketName: String(ticket.name || ""),
    status: String(ticket.status || "active"),
    paymentAmount: ticketPaymentAmount(ticket),
    totalCount: nullableSourceNumber(ticket.maxCount ?? ticket.usableCount),
    remainingCount: nullableSourceNumber(ticket.remainingCount),
    availableFrom: timestampIso(ticket.availableFrom),
    purchasedAt: timestampIso(ticket.purchasedAt),
    paymentAt: timestampIso(ticket.paymentAt),
    expiresAt: timestampIso(ticket.expiresAt),
  };
}

function nullableSourceNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return value == null || value === "" || !Number.isFinite(numberValue) ? null : numberValue;
}

function validateMemberLookup(memberName: string, memberPhone: string): void {
  validateMemberName(memberName);
  if (!/^010\d{8}$/.test(memberPhone)) throw new AppError("INVALID_ARGUMENT", "010으로 시작하는 11자리 연락처를 입력하세요.");
}

function validateMemberName(memberName: string): void {
  if (normalizeName(memberName).length < 2) throw new AppError("INVALID_ARGUMENT", "회원 이름을 2자 이상 입력하세요.");
}

function requireMemberPhone(value: unknown): string {
  const phone = normalizePhone(value);
  if (!/^010\d{8}$/.test(phone)) {
    throw new AppError("INVALID_ARGUMENT", "선택한 회원의 StudioMate 연락처 원천을 확인하세요.");
  }
  return phone;
}

function maskPhone(phone: string): string {
  return phone.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-****-$3");
}

function normalizePhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return /^8210\d{8}$/.test(digits) ? `0${digits.slice(2)}` : digits;
}

function phoneLookupValues(phone: string): string[] {
  const formatted = phone.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
  const international = `+82${phone.slice(1)}`;
  return [...new Set([phone, formatted, international, international.replace("+", "")])];
}

function normalizeName(value: unknown): string {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength);
}

function nullableMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new AppError("INVALID_ARGUMENT", "금액을 확인하세요.");
  return Math.round(amount);
}

function nullableNumber(value: unknown, label: string, integer = false): number | null {
  if (value == null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0 || (integer && !Number.isInteger(numberValue))) {
    throw new AppError("INVALID_ARGUMENT", `${label} 값을 확인하세요.`);
  }
  return Math.round(numberValue * 100) / 100;
}

function refundTicketKind(value: unknown): RefundTicketKind {
  if (value === "count" || value === "period") return value;
  throw new AppError("INVALID_ARGUMENT", "수강권 유형을 선택하세요.");
}

function refundEligibilityWarnings(ticket: ActiveTicket, paymentAmount: number | null): string[] {
  const warnings: string[] = [];
  const name = String(ticket.name || "");
  const kind = inferRefundTicketKind(ticket.maxCount, ticket.usableCount);
  if (paymentAmount == null) warnings.push("실결제금액 원천 확인 필요");
  if (kind === "count") {
    const totalCount = nullableSourceNumber(ticket.maxCount ?? ticket.usableCount);
    const remainingCount = nullableSourceNumber(ticket.remainingCount);
    if (totalCount == null || remainingCount == null || remainingCount > totalCount) {
      warnings.push("총횟수·잔여횟수 원천 확인 필요");
    }
  } else {
    const periodUsage = periodUsageFromTicket(ticket, new Date().toISOString());
    if (!periodUsage) warnings.push("이용 시작일·만료일 원천 확인 필요");
    else if (periodUsage.excludedDays > 0) warnings.push(`홀딩·연장 ${periodUsage.excludedDays}일 확인 필요`);
  }
  if (/무료|증정|체험|이벤트|프로모션|쿠폰|직원|강사/i.test(name)) {
    warnings.push("무료·증정·이벤트·프로모션 적용 여부 확인 필요");
  }
  return warnings;
}

function contractWeeks(availableFrom: unknown, expiresAt: unknown): number | null {
  const start = timestampIso(availableFrom);
  const end = timestampIso(expiresAt);
  if (!start || !end) return null;
  const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
  if (!Number.isFinite(days) || days <= 0) return null;
  return Math.round((days / 7) * 100) / 100;
}

function periodUsageFromTicket(
  ticket: ActiveTicket,
  requestedAt: string,
): { totalDays: number; usedDays: number; remainingDays: number; excludedDays: number } | null {
  return deriveRefundPeriodUsage({
    availableFrom: timestampIso(ticket.availableFrom),
    expiresAt: timestampIso(ticket.expiresAt),
    requestedAt,
    contractDays: inferRefundContractDays(ticket.name),
  });
}

function timestampIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  const raw = value as { toDate?: () => Date; _seconds?: number; seconds?: number };
  if (typeof raw.toDate === "function") return raw.toDate().toISOString();
  const seconds = Number(raw._seconds ?? raw.seconds);
  if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
