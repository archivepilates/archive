import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc, OnsiteWelcomeRequestDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { ensureShortLink } from "../utils/shortLinks";
import { alimtalkDedupeKey, findCompletedDuplicate, normalizePhone } from "./dedupe";
import { autoSendabilityIssue } from "./eligibility";
import { processAlimtalkQueue } from "./processAlimtalkQueue";
import { isAlimtalkTemplateApproved } from "./templateStatus";
import { ALIMTALK_TEMPLATES } from "./templates";

const ONSITE_WELCOME_SETTINGS_DOC = "onsiteWelcomeAlimtalk";

export async function sendOnsiteWelcomeAlimtalkForRequest(
  request: OnsiteWelcomeRequestDoc,
): Promise<"queued" | "sent" | "failed" | "skipped" | "template_pending"> {
  if (!["lookup_ready", "ready"].includes(request.status)) {
    throw new Error("현장 웰컴 알림톡을 전송할 수 없는 상태입니다.");
  }
  return enqueueAndSendOnsiteWelcome(request);
}

async function enqueueAndSendOnsiteWelcome(
  request: OnsiteWelcomeRequestDoc,
): Promise<"queued" | "sent" | "failed" | "skipped" | "template_pending"> {
  const templateCode = await onsiteWelcomeTemplateCode();
  if (!templateCode) {
    await markRequestTemplatePending(request.requestId, "신규회원 웰컴 v4 템플릿 코드 설정 대기");
    return "template_pending";
  }
  if (!(await isAlimtalkTemplateApproved(templateCode))) {
    await markRequestTemplatePending(request.requestId, `신규회원 웰컴 v4 템플릿 승인 대기: ${templateCode}`);
    return "template_pending";
  }

  const memberPhone = normalizePhone(request.lookup?.memberPhone || request.phone || "");
  const memberName = String(request.lookup?.memberName || request.memberNameHint || "").trim();
  const memberId = String(request.lookup?.memberId || memberPhone || request.requestId);
  if (!memberPhone) throw new Error("현장 웰컴 알림톡 전화번호 없음");
  if (!memberName) throw new Error("현장 웰컴 알림톡 회원명 없음");
  if (!request.signupUrl || !request.contractId) throw new Error("회원가입서 링크 없음");

  const duplicate = await existingWelcomeSend({ memberId, memberPhone, templateCode });
  if (duplicate) {
    await refs.onsiteWelcomeRequest(request.requestId).set(
      {
        status: "error",
        progressPercent: 100,
        progressLabel: "이미 웰컴 알림톡 발송 이력이 있습니다",
        lastError: `중복 발송 방지: ${duplicate}`,
        completedAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return "skipped";
  }

  const link = await ensureShortLink({
    type: "member_signup",
    targetUrl: request.signupUrl,
    sourceId: request.requestId,
  });
  const candidate = onsiteWelcomeCandidate({
    request,
    templateCode,
    memberId,
    memberName,
    memberPhone,
    signupLinkId: link.linkId,
    signupShortUrl: link.shortUrl,
  });
  const issue = await autoSendabilityIssue(candidate, todayKst());
  if (issue) throw new Error(issue);
  const dedupeKey = alimtalkDedupeKey(candidate);
  const completedDuplicate = await findCompletedDuplicate(dedupeKey, null);
  if (completedDuplicate) throw new Error(`중복 발송 차단: ${completedDuplicate}`);

  await refs.alimtalkCandidate(candidate.candidateId).set({ ...candidate, dedupeKey }, { merge: true });
  await refs.onsiteWelcomeRequest(request.requestId).set(
    {
      alimtalkCandidateId: candidate.candidateId,
      progressPercent: 96,
      progressLabel: "웰컴 알림톡 발송 중",
      lastError: null,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );

  await processAlimtalkQueue();
  const sentCandidate = (await refs.alimtalkCandidate(candidate.candidateId).get()).data();
  if (sentCandidate?.status === "sent") {
    await refs.onsiteWelcomeRequest(request.requestId).set(
      {
        status: "sent",
        alimtalkCandidateId: candidate.candidateId,
        alimtalkSendId: candidate.candidateId,
        progressPercent: 100,
        progressLabel: "웰컴 알림톡 발송 완료",
        lastError: null,
        completedAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return "sent";
  }
  if (sentCandidate?.status === "queued" || sentCandidate?.status === "processing") return "queued";
  await markRequestError(request.requestId, sentCandidate?.lastError || "웰컴 알림톡 발송 실패");
  return "failed";
}

async function onsiteWelcomeTemplateCode(): Promise<string> {
  const snap = await db.collection("systemSettings").doc(ONSITE_WELCOME_SETTINGS_DOC).get();
  return String(snap.data()?.templateCode || process.env.ONSITE_WELCOME_ALIMTALK_TEMPLATE_ID || ALIMTALK_TEMPLATES.onsite_welcome.code || "").trim();
}

async function existingWelcomeSend(input: { memberId: string; memberPhone: string; templateCode: string }): Promise<string> {
  const templateCodes = [ALIMTALK_TEMPLATES.new_member.code, input.templateCode].filter(Boolean);
  const byPhone = await refs.alimtalkSends().where("memberPhone", "==", input.memberPhone).where("status", "==", "done").limit(30).get();
  const phoneDuplicate = byPhone.docs.find((doc) => templateCodes.includes(doc.data().templateCode));
  if (phoneDuplicate) return phoneDuplicate.id;

  const byMember = await refs.alimtalkSends().where("memberId", "==", input.memberId).where("status", "==", "done").limit(30).get();
  const memberDuplicate = byMember.docs.find((doc) => templateCodes.includes(doc.data().templateCode));
  return memberDuplicate?.id || "";
}

function onsiteWelcomeCandidate(input: {
  request: OnsiteWelcomeRequestDoc;
  templateCode: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  signupLinkId: string;
  signupShortUrl: string;
}): AlimtalkCandidateDoc {
  const { request } = input;
  const candidateId = `onsite_welcome_${request.requestId}`;
  return {
    candidateId,
    studioId: request.studioId,
    memberId: input.memberId,
    memberName: input.memberName,
    memberPhone: input.memberPhone,
    type: "onsite_welcome",
    status: "queued",
    templateCode: input.templateCode,
    title: "현장 웰컴",
    reason: "현장 웰컴 즉시발송",
    sourceActionKey: request.requestId,
    sourceDate: todayKst(),
    payload: {
      memberName: input.memberName,
      ticketName: request.lookup?.ticketName || "",
      contractId: request.contractId || "",
      signupUrl: request.signupUrl || "",
      shortLinkId: input.signupLinkId,
      shortUrl: input.signupShortUrl,
      sourceRequestId: request.requestId,
    },
    attempts: 0,
    maxAttempts: 1,
    queuedBy: "operator",
    reviewedByUid: "system:onsite-welcome",
    reviewedAt: nowTimestamp(),
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

async function markRequestTemplatePending(requestId: string, message: string): Promise<void> {
  await refs.onsiteWelcomeRequest(requestId).set(
    {
      progressPercent: 92,
      progressLabel: message,
      lastError: message,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

async function markRequestError(requestId: string, message: string): Promise<void> {
  await refs.onsiteWelcomeRequest(requestId).set(
    {
      status: "error",
      progressPercent: 100,
      progressLabel: "웰컴 알림톡 발송 실패",
      lastError: message,
      completedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}
