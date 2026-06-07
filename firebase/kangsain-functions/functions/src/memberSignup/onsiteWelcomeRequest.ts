import { createHash, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { OnsiteWelcomeRequestDoc } from "../types/models";
import { sendOnsiteWelcomeAlimtalkForRequest } from "../alimtalk/onsiteWelcomeAlimtalk";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import { nowTimestamp } from "../utils/date";

export async function onsiteWelcomeRequestHandler(request: any, response: any): Promise<void> {
  try {
    if (request.method === "POST") {
      const body = request.body || {};
      if (body.action === "send") {
        const doc = await readAuthorizedRequest(body.requestId || body.id, body.accessToken || body.token);
        if (!doc.signupUrl || !doc.contractId) throw new Error("회원가입서 링크가 아직 준비되지 않았습니다.");
        if (!["lookup_ready", "ready"].includes(doc.status)) {
          throw new Error("현재 알림톡 전송 요청을 할 수 없는 상태입니다.");
        }
        if (await hasSentAlimtalkHistory(doc)) {
          throw new Error("이미 웰컴 알림톡 발송 이력이 있는 회원입니다.");
        }
        await sendOnsiteWelcomeAlimtalkForRequest(doc);
        const updated = (await refs.onsiteWelcomeRequest(doc.requestId).get()).data() || doc;
        response.json({ ok: true, request: await publicRequest(updated) });
        return;
      }
      if (body.action === "discard") {
        const doc = await readAuthorizedRequest(body.requestId || body.id, body.accessToken || body.token);
        if (doc.status === "sent" || doc.alimtalkSendId) {
          throw new Error("이미 알림톡이 발송된 이력은 폐기할 수 없습니다.");
        }
        if (doc.contractId) {
          const contractSnap = await refs.memberSignupContract(doc.contractId).get();
          const contract = contractSnap.data();
          if (contract?.status === "submitted") {
            throw new Error("이미 회원이 제출한 가입서는 폐기할 수 없습니다.");
          }
          const cancelledAt = nowTimestamp();
          const purgeAfter = Timestamp.fromMillis(cancelledAt.toMillis() + 1000 * 60 * 60 * 24);
          await refs.memberSignupContract(doc.contractId).set(
            {
              status: "cancelled",
              expiresAt: cancelledAt,
              cancelledAt,
              cancelReason: "onsite_welcome_discarded",
              purgeAfter,
              updatedAt: cancelledAt,
            },
            { merge: true },
          );
        }
        await refs.onsiteWelcomeRequest(doc.requestId).set(
          {
            status: "cancelled",
            progressPercent: 0,
            progressLabel: "운영자가 잘못 생성된 요청을 폐기했습니다.",
            lastError: null,
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
        const updated = (await refs.onsiteWelcomeRequest(doc.requestId).get()).data() || doc;
        response.json({ ok: true, request: await publicRequest(updated) });
        return;
      }
      const phone = digitsOnly(body.phone);
      if (!/^01\d{8,9}$/.test(phone)) throw new Error("휴대폰 번호를 정확히 입력해주세요.");
      const accessToken = randomBytes(24).toString("base64url");
      const requestId = `owr-${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
      const now = nowTimestamp();
      const doc: OnsiteWelcomeRequestDoc = {
        requestId,
        studioId: String(body.studioId || DEFAULT_STUDIO_ID),
        status: "pending",
        accessTokenHash: sha256(accessToken),
        phone,
        phoneLast4: phone.slice(-4),
        memberNameHint: cleanText(body.memberName, 60),
        source: "onsite_welcome_page",
        progressPercent: 5,
        progressLabel: "현장 웰컴 요청 접수",
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      await refs.onsiteWelcomeRequest(requestId).set(doc, { merge: true });
      response.json({ ok: true, requestId, accessToken });
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
  const canSendAlimtalk =
    ["lookup_ready", "ready"].includes(doc.status) &&
    Boolean(doc.signupUrl && doc.contractId) &&
    !hasAlimtalkSentHistory &&
    contractStatus !== "cancelled";
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
  const syncProcessing = ["processing", "syncing", "pending"].includes(studioMateSyncStatus);
  const syncStageLabel =
    studioMateSyncStatus === "pending" ? "개별 반영 대기" : syncDeferred ? "정기 반영 대기" : "스튜디오메이트 동기화중";
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

function digitsOnly(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function cleanText(value: unknown, max: number): string {
  return String(value || "").trim().slice(0, max);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
