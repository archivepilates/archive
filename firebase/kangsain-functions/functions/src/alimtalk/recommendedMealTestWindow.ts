import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import type { AlimtalkCandidateDoc } from "../types/models";
import { memberDispatchWindow, MemberDispatchDeferredError } from "../memberSignup/memberDispatchWindow";
import { primaryAlimtalkTestRecipient, normalizeRecipientPhone } from "./testRecipients";
import { ALIMTALK_TEMPLATES } from "./templates";

export const MEAL_TEST_CAMPAIGN = "meal-choice-test-20261029";
export const MEAL_TEST_REQUEST = "meal-test-20261029-3minute-v2";
export const MEAL_TEST_CANDIDATE = `${MEAL_TEST_REQUEST}-invite`;
export const MEAL_TEST_APPROVAL = "systemSettings/recommendedMealTestWindow20261029";

export function isMealWindowTest(candidate: Partial<AlimtalkCandidateDoc>): boolean {
  return candidate.payload?.quietHoursTestCampaign === MEAL_TEST_CAMPAIGN;
}

export function mealTestWindowApprovalValid(candidate: Partial<AlimtalkCandidateDoc>, approval: Record<string, unknown> | undefined,
  now = Date.now()): boolean {
  const target = primaryAlimtalkTestRecipient();
  const from = typeof approval?.notBefore === "string" ? Date.parse(approval.notBefore) : NaN;
  const until = typeof approval?.expiresAt === "string" ? Date.parse(approval.expiresAt) : NaN;
  return Number.isFinite(now) && Number.isFinite(from) && Number.isFinite(until) && now >= from && now < until
    && until - from <= 86400000 && approval?.approved === true && approval.status === "approved" && approval.campaign === MEAL_TEST_CAMPAIGN
    && !approval.attemptStartedAt && approval.candidateId === MEAL_TEST_CANDIDATE
    && approval.memberId === target.memberId && approval.templateCode === ALIMTALK_TEMPLATES.recommended_meal_survey.code
    && approval.phoneSha256 === createHash("sha256").update(target.phone).digest("hex")
    && candidate.candidateId === MEAL_TEST_CANDIDATE && candidate.memberId === target.memberId
    && candidate.memberName === target.name && normalizeRecipientPhone(candidate.memberPhone || "") === target.phone
    && candidate.templateCode === ALIMTALK_TEMPLATES.recommended_meal_survey.code
    && candidate.type === "recommended_meal_survey" && candidate.sourceActionKey === MEAL_TEST_REQUEST
    && candidate.payload?.surveyId === MEAL_TEST_REQUEST && isMealWindowTest(candidate)
    && candidate.queuedBy === "operator" && !!candidate.reviewedByUid;
}

export async function candidateDispatchWindow(candidate: Partial<AlimtalkCandidateDoc>, reader?: (ref: FirebaseFirestore.DocumentReference) => Promise<FirebaseFirestore.DocumentSnapshot>) {
  const normal = memberDispatchWindow();
  if (!isMealWindowTest(candidate)) return normal;
  const ref = db.doc(MEAL_TEST_APPROVAL);
  const approval = (await (reader ? reader(ref) : ref.get())).data();
  if (!mealTestWindowApprovalValid(candidate, approval)) return { ...normal, allowed: false, reason: "meal_test_approval_invalid_or_spent", nextAllowedAt: null };
  return { ...normal, allowed: true, reason: "approved_single_meal_test", nextAllowedAt: null };
}

export async function assertCandidateDispatchAllowed(candidate: AlimtalkCandidateDoc, consume = false): Promise<void> {
  if (!isMealWindowTest(candidate)) {
    if (!memberDispatchWindow().allowed) throw new MemberDispatchDeferredError();
    return;
  }
  if (!consume) {
    if (!(await candidateDispatchWindow(candidate)).allowed) throw new Error("meal_test_approval_invalid_or_spent");
    return;
  }
  await db.runTransaction(async tx => {
    const ref = db.doc(MEAL_TEST_APPROVAL);
    const approval = (await tx.get(ref)).data();
    const current = (await tx.get(db.doc(`alimtalkCandidates/${candidate.candidateId}`))).data();
    const send = await tx.get(db.doc(`alimtalkSends/${candidate.candidateId}`));
    const request = (await tx.get(db.doc(`recommendedMealProgramRequests/${MEAL_TEST_REQUEST}`))).data();
    if (!mealTestWindowApprovalValid(candidate, approval) || current?.status !== "processing"
      || !mealTestWindowApprovalValid(current as Partial<AlimtalkCandidateDoc>, approval)
      || request?.status !== "queued" || request.memberId !== candidate.memberId
      || normalizeRecipientPhone(String(request.memberPhone || "")) !== normalizeRecipientPhone(candidate.memberPhone)
      || request.candidateId !== candidate.candidateId || request.templateCode !== candidate.templateCode
      || request.submittedAt || request.cancelledAt
      || current.queueLeaseId !== (candidate as AlimtalkCandidateDoc & { queueLeaseId?: string }).queueLeaseId
      || !current.queueLeaseId || send.exists) throw new Error("meal_test_claim_changed_or_already_attempted");
    tx.update(ref, { attemptStartedAt: Timestamp.now(), candidateId: candidate.candidateId,
      queueLeaseId: current.queueLeaseId, status: "attempted_do_not_replay" });
  });
}
