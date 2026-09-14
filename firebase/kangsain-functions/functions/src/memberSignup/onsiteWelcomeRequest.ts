import { createHash } from "node:crypto";
import type { OnsiteWelcomeRequestDoc } from "../types/models";
import { refs } from "../firestore/refs";

export async function onsiteWelcomeRequestHandler(request: any, response: any): Promise<void> {
  try {
    if (request.method === "POST") {
      response.status(410).json({
        ok: false,
        code: "onsite_welcome_retired",
        error: "현장 웰컴 신규 접수와 발송이 종료되었습니다. StudioMate에서 회원등록을 진행해 주세요.",
        replacementUrl: "https://arcpilates.studiomate.kr/users/create",
      });
      return;
    }

    if (request.method === "GET") {
      const requestId = cleanText(request.query?.id, 120);
      const accessToken = cleanText(request.query?.token, 160);
      const doc = await readAuthorizedRequest(requestId, accessToken);
      response.json({ ok: true, request: await publicRequest(doc) });
      return;
    }

    response.set("Allow", "GET, POST").status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    response.status(400).json({ ok: false, error: message });
  }
}

async function readAuthorizedRequest(idInput: unknown, tokenInput: unknown): Promise<OnsiteWelcomeRequestDoc> {
  const requestId = cleanText(idInput, 120);
  const accessToken = cleanText(tokenInput, 160);
  if (!/^owr-[a-z0-9-]{8,120}$/i.test(requestId) || !accessToken) {
    throw new Error("요청 링크가 올바르지 않습니다.");
  }
  const snap = await refs.onsiteWelcomeRequest(requestId).get();
  const doc = snap.data();
  if (!doc || doc.accessTokenHash !== sha256(accessToken)) {
    throw new Error("요청 상태를 확인할 권한이 없습니다.");
  }
  return doc;
}

async function publicRequest(doc: OnsiteWelcomeRequestDoc) {
  const contract = doc.contractId ? (await refs.memberSignupContract(doc.contractId).get()).data() : null;
  const contractStatus = contract?.status || "";
  const studioMateSyncStatus = normalizeStudioMateSyncStatus(
    (contract as any)?.studiomateProfileSyncStatus || (contract as any)?.studiomateSyncStatus,
  );
  const hasAlimtalkSentHistory = await hasSentAlimtalkHistory(doc);
  const canSendAlimtalk = false;
  return {
    requestId: doc.requestId,
    status: doc.status,
    phoneLast4: doc.phoneLast4,
    memberNameHint: doc.memberNameHint || "",
    progressPercent: doc.progressPercent,
    progressLabel: doc.progressLabel,
    lookup: doc.lookup
      ? {
          memberName: doc.lookup.memberName || "",
          ticketName: doc.lookup.ticketName || "",
          startDate: doc.lookup.startDate || "",
          endDate: doc.lookup.endDate || "",
        }
      : null,
    signupUrl: doc.signupUrl || "",
    alimtalkCandidateId: doc.alimtalkCandidateId || "",
    alimtalkSendId: doc.alimtalkSendId || "",
    contractStatus,
    studioMateSyncStatus,
    hasAlimtalkSentHistory,
    canSendAlimtalk,
    stages: buildStages(doc, contractStatus, studioMateSyncStatus),
    lastError: doc.lastError || "",
  };
}

async function hasSentAlimtalkHistory(doc: OnsiteWelcomeRequestDoc): Promise<boolean> {
  if (doc.status === "sent" || doc.alimtalkSendId) return true;
  const phone = doc.phone || "";
  if (!phone) return false;
  const snap = await refs.onsiteWelcomeRequests().where("phone", "==", phone).limit(30).get();
  return snap.docs.some((entry) => {
    const data = entry.data();
    if (data.requestId === doc.requestId) return false;
    return data.status === "sent" || Boolean(data.alimtalkSendId);
  });
}

function buildStages(doc: OnsiteWelcomeRequestDoc, contractStatus: string, studioMateSyncStatus: string) {
  const alimtalkDone = doc.status === "sent" || Boolean(doc.alimtalkSendId);
  const writing = contractStatus === "opened";
  const submitted = contractStatus === "submitted";
  const syncDone = ["synced", "done"].includes(studioMateSyncStatus);
  const syncDeferred = ["pending_excel_reconcile", "manual_required", "skipped"].includes(studioMateSyncStatus);
  const syncProcessing = ["processing", "syncing", "pending", "retry"].includes(studioMateSyncStatus);
  const syncStageLabel =
    studioMateSyncStatus === "pending"
      ? "개별 반영 대기"
      : studioMateSyncStatus === "retry"
        ? "개별 반영 재시도 대기"
        : syncDeferred
          ? "정기 반영 대기"
          : "스튜디오메이트 동기화중";
  const syncDoneLabel = syncDeferred ? "스튜디오메이트 확인 대기" : "스튜디오메이트 동기화 완료";
  const syncStageState = syncDone ? "done" : submitted && !syncDeferred && (syncProcessing || !studioMateSyncStatus) ? "active" : "pending";
  return [
    { key: "alimtalk_sent", label: "알림톡 발송", state: alimtalkDone ? "done" : doc.status === "ready" ? "active" : "pending" },
    { key: "member_writing", label: "회원 작성중", state: writing ? "active" : submitted ? "done" : alimtalkDone ? "pending" : "pending" },
    { key: "member_submitted", label: "회원 작성완료", state: submitted ? "done" : "pending" },
    { key: "studiomate_syncing", label: syncStageLabel, state: syncStageState },
    { key: "studiomate_synced", label: syncDoneLabel, state: syncDone ? "done" : "pending" },
  ];
}

function normalizeStudioMateSyncStatus(value: unknown): string {
  return String(value || "").trim();
}

function cleanText(value: unknown, max: number): string {
  return String(value || "").trim().slice(0, max);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
