import { randomUUID } from "node:crypto";
import { stableHash } from "../utils/hash";

export interface PrivateNotionMemberIdentity {
  memberId: string;
  staffId: string;
  rootPageId: string;
  title: string;
  sourceHash: string;
  recordId: string;
}

export interface PrivateNotionMemberPageState {
  memberId: string;
  staffId: string;
  rootPageId: string;
  status: "creating" | "ready" | "rejected" | "review";
  attemptId: string;
  pageId?: string;
  title: string;
  sourceRecordId: string;
  sourceHash: string;
}

export function privateNotionMemberIdentity(record: any, request: any, profile: any, staff: any,
  rootPageId: string, staffRootPageId: string): PrivateNotionMemberIdentity {
  const phone = (value: unknown) => String(value || "").replace(/\D/g, "").replace(/^82(?=10)/, "0");
  const nativeId = String(profile?.studiomateMemberId || profile?.memberId || record?.memberId || "");
  const normalizeId = (value: string) => value.replaceAll("-", "").toLowerCase();
  const same = (key: string) => Boolean(record?.[key]) && String(record[key]) === String(request?.[key]);
  if (!record?.recordId || !record?.requestId || !request?.requestId || !same("memberId") || !same("staffId") || !same("bookingId")
    || record.requestId !== request?.requestId || record.studioId !== "5330" || request.studioId !== "5330"
    || profile?.studioId !== "5330" || staff?.studioId !== "5330" || staff?.active !== true
    || String(staff.staffId) !== String(record.staffId) || !["instructor", "owner", "manager"].includes(staff.role)
    || !rootPageId || !staffRootPageId || normalizeId(rootPageId) !== normalizeId(staffRootPageId)
    || !/^[a-f0-9]{32}$/.test(normalizeId(rootPageId)) || !/^\d+$/.test(nativeId)
    || (/^\d+$/.test(String(record.memberId)) && nativeId !== String(record.memberId))
    || profile.status === "merged" || profile.supersededByMemberId
    || !String(profile?.name || "").trim() || (profile.memberId && String(profile.memberId) !== String(record.memberId))
    || !/^01[016789]\d{7,8}$/.test(phone(profile.phone)) || phone(profile.phone) !== phone(record.memberPhone)
    || phone(profile.phone) !== phone(request.memberPhone) || record.cancelledAt || request.status === "cancelled"
    || record.notionProjectionControl?.aliasOfRecordId
    || !(record.postSubmittedAt || request.postStatus === "submitted")) {
    throw new Error("Notion 회원 폴더 자동 연결 확인 필요: 회원·강사·제출 원본 신원이 일치하지 않습니다.");
  }
  const identity = { memberId: nativeId, staffId: String(record.staffId), rootPageId: normalizeId(rootPageId),
    title: `${String(profile.name).trim()}님`, recordId: String(record.recordId) };
  return { ...identity, sourceHash: stableHash({ ...identity, requestId: request.requestId,
    bookingId: record.bookingId, sourceMemberId: record.memberId, phone: phone(profile.phone) }) };
}

export async function ensurePrivateNotionMemberPage(identity: PrivateNotionMemberIdentity, deps: {
  transact: <T>(update: (current?: PrivateNotionMemberPageState) => { next?: PrivateNotionMemberPageState; result: T }) => Promise<T>;
  validate: () => Promise<void>;
  assertAbsent: () => Promise<void>;
  create: () => Promise<string>;
  verify: (pageId: string) => Promise<void>;
  rejected: (error: unknown) => boolean;
}): Promise<string> {
  const attemptId = randomUUID();
  const sameBinding = (state: PrivateNotionMemberPageState) => state.memberId === identity.memberId
    && state.staffId === identity.staffId && state.rootPageId === identity.rootPageId;
  await deps.validate();
  const claim = await deps.transact<string | null>((current) => {
    if (current && !sameBinding(current)) throw new Error("Notion 회원 폴더 연결 원장 충돌: 자동 생성을 차단했습니다.");
    if (current?.status === "ready" && current.pageId) return { result: current.pageId };
    if (current && (current.status !== "rejected" || current.pageId)) throw new Error("Notion 회원 폴더 생성 중 또는 결과 확인 필요: 중복 생성을 차단했습니다.");
    return { next: { memberId: identity.memberId, staffId: identity.staffId, rootPageId: identity.rootPageId,
      title: identity.title, sourceHash: identity.sourceHash, sourceRecordId: identity.recordId,
      status: "creating", attemptId }, result: null };
  });
  if (claim) { await deps.validate(); await deps.verify(claim); return claim; }
  let dispatched = false, pageId = "";
  try {
    await deps.validate();
    await deps.assertAbsent();
    await deps.validate();
    dispatched = true;
    pageId = await deps.create();
    if (!/^[a-f0-9]{32}$/i.test(pageId.replaceAll("-", ""))) throw new Error("Notion 회원 폴더 생성 응답 확인 필요");
    await deps.verify(pageId);
    await deps.validate();
    await deps.transact((current) => {
      if (!current || !sameBinding(current) || current.attemptId !== attemptId || current.status !== "creating") {
        throw new Error("Notion 회원 폴더 생성 선점 확인 필요");
      }
      return { next: { ...current, status: "ready", pageId }, result: undefined };
    });
    return pageId;
  } catch (error) {
    await deps.transact((current) => current?.attemptId === attemptId && current.status === "creating"
      ? { next: { ...current, status: !pageId && (!dispatched || deps.rejected(error)) ? "rejected" : "review", ...(pageId ? { pageId } : {}) }, result: undefined }
      : { result: undefined });
    throw error;
  }
}
