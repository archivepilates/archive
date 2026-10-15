import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./studiomate-browser-lock.mjs";
import { normalizeQueuedTicketSourceSnapshot } from "./eformsign-refund-browser-contract.mjs";

const nativeId = (value) => (
  typeof value === "string" && /^[1-9]\d{0,63}$/.test(value)
) || (Number.isSafeInteger(value) && value > 0);
const text = (value) => typeof value === "string" && value.length > 0 && value.trim() === value;
const positiveCount = (value) => Number.isSafeInteger(value) && value > 0;
const nonnegativeCount = (value) => Number.isSafeInteger(value) && value >= 0;
const usableSourceStatus = (value) => ["active", "scheduled"].includes(value)
  || /^(?:사용중|이용중)(?:\s*\(\d+일\s*남음\))?$/.test(value);

export function refundNativeMemberPointer(job, profile) {
  const pointers = [job?.studiomateMemberId, profile?.studiomateMemberId];
  const memberId = job?.memberId;
  if (typeof memberId === "number" || (typeof memberId === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(memberId.trim()))) {
    pointers.push(memberId);
  }
  const ids = new Set();
  for (const pointer of pointers) {
    if (pointer == null || pointer === "") continue;
    if (!nativeId(pointer)) throw new Error("환불 작업의 StudioMate 회원 ID 포인터가 올바르지 않습니다.");
    ids.add(String(pointer));
  }
  if (ids.size > 1) throw new Error("환불 작업의 StudioMate 회원 ID 포인터가 서로 다릅니다.");
  return ids.values().next().value;
}

export function assertNativeRefundTicketSource(job, memberResult, ticketRead) {
  const source = refundSource(job);
  const memberId = assertNativeMember(job, memberResult);
  if (ticketRead?.status !== "verified" || ticketRead.reason !== "complete_native_ticket_list" || !Array.isArray(ticketRead.tickets)) {
    throw new Error("네이티브 수강권 전체 목록을 검증하지 못해 환불 안내 발송을 중단했습니다.");
  }
  const ids = new Set();
  // List completeness is reader-verified; historical rows may still have empty display/date fields.
  for (const ticket of ticketRead.tickets) {
    if (!ticket || !nativeId(ticket.userTicketId)
      || String(ticket.memberId) !== memberId || String(ticket.studioId) !== String(job.studioId)) {
      throw new Error("네이티브 수강권 목록의 식별자·회원·스튜디오 원천이 불완전합니다.");
    }
    const id = String(ticket.userTicketId);
    if (ids.has(id)) throw new Error("네이티브 수강권 ID가 중복되어 환불 대상을 확정할 수 없습니다.");
    ids.add(id);
  }
  const availableFrom = kstDay(source.availableFrom);
  const expiresAt = kstDay(source.expiresAt);
  // Match before checking usability: an inactive duplicate must not be hidden by an active row.
  const matches = ticketRead.tickets.filter((ticket) => ticket.title === source.ticketName
    && ticket.availabilityStartAt === availableFrom && ticket.expireAt === expiresAt);
  if (matches.length !== 1) {
    throw new Error("네이티브 수강권의 제목·시작일·만료일이 일치하는 대상이 없거나 여러 개입니다. 원천을 다시 확인하세요.");
  }
  const ticket = matches[0];
  if (ticket.source !== "studiomate_native_ticket" || ticket.verified !== true || ticket.complete !== true
    || !nativeId(ticket.productId) || !text(ticket.title)
    || !nativeDay(ticket.availabilityStartAt) || !nativeDay(ticket.expireAt)) {
    throw new Error("네이티브 수강권 대상의 식별자·완전성·날짜 원천을 검증하지 못했습니다.");
  }
  const userTicketKey = /^userTicket:([1-9]\d*)$/.exec(source.ticketKey);
  const productKey = /^ticket:([1-9]\d*)$/.exec(source.ticketKey);
  if ((userTicketKey && userTicketKey[1] !== String(ticket.userTicketId))
    || (productKey && productKey[1] !== String(ticket.productId))) {
    throw new Error("환불 작업의 수강권 ID와 네이티브 수강권 ID가 다릅니다.");
  }
  if (ticket.cancelled !== false || ticket.refunded !== false) {
    throw new Error("네이티브 수강권에 환불·취소 표시가 있거나 표시 검증이 불완전합니다. 실제 정산 여부는 별도 확인이 필요합니다.");
  }
  if (ticket.usable !== true || !["active", "scheduled"].includes(ticket.status)
    || ticket.active !== (ticket.status === "active")) {
    throw new Error("네이티브 수강권이 비활성 또는 이용 불가 상태입니다. 실제 환불 정산 여부를 뜻하지 않으며 발송은 중단합니다.");
  }
  if (ticket.isShared !== false) throw new Error("네이티브 공유 수강권 여부가 불명확하거나 공유권이므로 자동 환불 안내를 중단합니다.");
  if (source.totalCount !== null && (!nonnegativeCount(ticket.maxCoupon) || ticket.maxCoupon !== source.totalCount)) {
    throw new Error("네이티브 수강권 총횟수와 환불 계산 원천이 다릅니다.");
  }
  if (source.remainingCount !== null && (!Number.isSafeInteger(ticket.remainingCoupon)
    || ticket.remainingCoupon < 0 || ticket.remainingCoupon !== source.remainingCount)) {
    throw new Error("네이티브 수강권 잔여횟수와 환불 계산 원천이 다릅니다.");
  }
  const payment = ticket.payment;
  if (payment?.verified !== true || payment.complete !== true || payment.status !== "paid"
    || !positiveCount(payment.paidAmount) || payment.paidAmount !== source.paymentAmount
    || payment.totalAmount !== source.paymentAmount || payment.outstandingAmount !== 0 || payment.refundedAmount !== 0) {
    throw new Error("네이티브 결제 원천이 미검증·미수·환불 표시 상태이거나 실결제금액이 계산 원천과 다릅니다.");
  }
  return Object.freeze({
    studiomateMemberId: memberId,
    userTicketId: String(ticket.userTicketId),
    productId: String(ticket.productId),
    sourceProof: Object.freeze({
      source: "studiomate_native_ticket",
      verified: true,
      complete: true,
      studioId: String(job.studioId),
      status: ticket.status,
      availableFrom,
      expiresAt,
      totalCount: source.totalCount,
      remainingCount: source.remainingCount,
      paymentAmount: payment.paidAmount,
    }),
  });
}

export async function readNativeRefundSource(job, { page, profileDir, headless = true } = {}) {
  refundSource(job);
  if (typeof headless !== "boolean" || (profileDir !== undefined && !text(profileDir))) {
    throw new Error("네이티브 환불 원천 조회의 브라우저 옵션이 올바르지 않습니다.");
  }
  let context;
  let readPage;
  let release;
  let stage = "브라우저 준비";
  try {
    if (page) {
      // The caller owns the existing lock and composer; only our new page may navigate.
      readPage = await page.context().newPage();
    } else {
      stage = "공용 브라우저 잠금 획득";
      release = await acquireStudioMateBrowserLock({ owner: "refund-native-source-read", waitMs: 0 });
      stage = "공용 브라우저 준비";
      const { chromium } = await import("playwright");
      const directory = profileDir?.startsWith("~/") ? path.join(os.homedir(), profileDir.slice(2))
        : profileDir || path.join(os.homedir(), "ArchiveIN/automation/browser-profile");
      context = await chromium.launchPersistentContext(directory, { headless, serviceWorkers: "block" });
      readPage = await context.newPage();
    }
    stage = "읽기 전용 세션 확인";
    const { api, readExactStudioMateMember, readStudioMateUserTickets } = await readonlyBootstrap(readPage);
    stage = "정확한 회원 원천 조회";
    const memberResult = await readExactStudioMateMember(api, job.memberPhone);
    const memberId = assertNativeMember(job, memberResult);
    stage = "수강권 전체 원천 조회";
    const ticketRead = await readStudioMateUserTickets(api, memberId);
    return assertNativeRefundTicketSource(job, memberResult, ticketRead);
  } catch (error) {
    if (error instanceof Error && /^(네이티브|환불 작업)/.test(error.message)) throw error;
    // Do not propagate session headers, native response bodies, or member identifiers.
    throw new Error(`네이티브 환불 원천의 ${stage}에 실패했습니다. 로그인·잠금·조회 권한을 확인한 뒤 원천을 재검증하세요.`);
  } finally {
    try {
      await readPage?.close();
    } finally {
      try {
        await context?.close();
      } finally {
        await release?.();
      }
    }
  }
}

async function readonlyBootstrap(page) {
  await page.route("**/*", (route) => ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
    ? route.continue() : route.abort("blockedbyclient"));
  const { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets } =
    await import("./studiomate-native-contract-source.mjs");
  const api = await captureStudioMateNativeApiClient(page);
  return { api: Object.freeze({ get: (pathname) => api.get(pathname) }), readExactStudioMateMember, readStudioMateUserTickets };
}

function refundSource(job) {
  if (!job || !text(job.memberName) || !/^010\d{8}$/.test(job.memberPhone)
    || !nativeId(job.studioId) || !text(job.ticketKey) || !text(job.ticketName)) {
    throw new Error("환불 작업의 회원 이름·정규화 연락처·스튜디오·수강권 식별 원천이 올바르지 않습니다.");
  }
  const source = normalizeQueuedTicketSourceSnapshot(job.ticketSourceSnapshot);
  if (source.ticketKey !== job.ticketKey || source.ticketName !== job.ticketName || !usableSourceStatus(source.status)) {
    throw new Error("환불 작업의 수강권 제목·식별자·상태가 계산 스냅샷과 일치하지 않습니다.");
  }
  if (source.totalCount !== null && (!nonnegativeCount(source.totalCount)
    || (source.remainingCount !== null && source.remainingCount > source.totalCount))) {
    throw new Error("환불 작업의 총횟수·잔여횟수 계산 원천이 올바르지 않습니다.");
  }
  if (!positiveCount(source.paymentAmount)) throw new Error("환불 작업의 양수 실결제금액 원천이 없어 네이티브 결제를 검증할 수 없습니다.");
  const start = kstDay(source.availableFrom);
  const end = kstDay(source.expiresAt);
  if (!start || !end || start > end) throw new Error("환불 작업의 시작일·만료일 원천이 없어 한국 날짜로 수강권을 확인할 수 없습니다.");
  return source;
}

function assertNativeMember(job, result) {
  const member = result?.member;
  if (result?.status !== "verified" || result.reason !== "exact_phone_match" || result.matchCount !== 1
    || !nativeId(member?.memberId) || member.name !== job.memberName || member.phone !== job.memberPhone) {
    throw new Error("네이티브 회원의 전체 연락처·이름·고유 ID를 정확히 한 명으로 검증하지 못했습니다.");
  }
  if (member.inactive !== false) {
    throw new Error("네이티브 회원이 비활성이거나 상태 검증이 불완전하여 환불 안내 발송을 중단했습니다.");
  }
  if (job.studiomateMemberId != null && job.studiomateMemberId !== ""
    && (!nativeId(job.studiomateMemberId) || String(job.studiomateMemberId) !== String(member.memberId))) {
    throw new Error("환불 작업의 StudioMate 회원 ID와 네이티브 회원 ID가 다릅니다.");
  }
  return String(member.memberId);
}

function kstDay(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "";
  return new Date(Date.parse(value) + 9 * 3600_000).toISOString().slice(0, 10);
}

function nativeDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}
