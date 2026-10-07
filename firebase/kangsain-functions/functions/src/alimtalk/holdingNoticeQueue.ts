import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { isAlimtalkTestRecipient, normalizeRecipientPhone } from "./testRecipients";

type Data = Record<string, any>;
type Variables = Record<string, string>;
type QueueResult = { status: "blocked" | "existing" | "reviewed"; reason: string; candidateId?: string };
export interface HoldingNoticeDependencies {
  db: Firestore;
  now(): Date;
  timestamp(): unknown;
  verifyRecipientInTransaction(tx: Transaction, source: Data, member: Data): Promise<string>;
  loadEvidence(source: Data, candidate?: Data): Promise<{
    recipientIssue: string;
    templateIssue: string;
    providerHistoryComplete: boolean;
    providerDuplicate: boolean;
    memberFingerprint: string;
  }>;
}

export const HOLDING_NOTICE_TEMPLATE_CODE = "KA01TP2610061247076605VQTRV7FTPK";
export const HOLDING_NOTICE_SETTINGS = "settings/holdingNotice";
export const HOLDING_NOTICE_SOURCE_COLLECTION = "memberTicketHolds";
export const HOLDING_NOTICE_CLAIM_COLLECTION = "holdingNoticeClaims";
const MAX_AGE_MS = 15 * 60_000;
const DAY = 86_400_000;
const record = (v: any): v is Data => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: any): v is string => typeof v === "string" && !!v && v.trim() === v;
const nativeId = (v: any): v is string => typeof v === "string" && /^[1-9]\d*$/.test(v);
const digest = (v: any): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const identifier = (v: any): v is string => text(v) && v.length <= 512 && !v.includes("/");
const hash = (value: any) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
const fingerprint = (value: any) => hash(stable(value));

/** Evidence adapters must hash the full canonical memberProfiles document with this helper. */
export const holdingMemberFingerprint = (member: Data): string => fingerprint(member);

function instant(value: any): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString() === value ? at : NaN;
}
function timestampMillis(value: any): number {
  if (!record(value)) return NaN;
  try {
    if (typeof value.toMillis === "function") {
      const at = value.toMillis();
      return typeof at === "number" && Number.isFinite(at) ? at : NaN;
    }
    if (Number.isSafeInteger(value.seconds) && Number.isInteger(value.nanoseconds) &&
        value.nanoseconds >= 0 && value.nanoseconds < 1e9) {
      const at = value.seconds * 1000 + value.nanoseconds / 1e6;
      return Number.isFinite(at) && Math.abs(at) <= 8.64e15 ? at : NaN;
    }
  } catch { return NaN; }
  return NaN;
}
function day(value: any): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  return instant(`${value}T00:00:00.000Z`) / DAY;
}
const overrides = (data: Data) => Object.keys(data).some((key) => /test|override/i.test(key));
function attempted(data: Data, depth = 0): boolean {
  if (depth > 5) return true;
  if ((Object.hasOwn(data, "attempts") && data.attempts !== 0) ||
      (Object.hasOwn(data, "attempted") && data.attempted !== false)) return true;
  return Object.entries(data).some(([key, value]) => {
    if (value == null || value === "") return false;
    if (/provider|solapi|outbound|messageId|groupId|sendId|sentAt|delivered|dispatch|acceptedAt|attemptedAt|attemptStartedAt|sendingStartedAt|lastAttempt|sendStartedAt|response|receipt/i.test(key)) return true;
    return record(value) ? attempted(value, depth + 1)
      : Array.isArray(value) && value.some((item) => record(item) && attempted(item, depth + 1));
  });
}

export function isHoldingNoticeCandidate(candidate: unknown): boolean {
  return record(candidate) && (candidate.templateCode === HOLDING_NOTICE_TEMPLATE_CODE ||
    (record(candidate.payload) && (Object.hasOwn(candidate.payload, "holdingNotice") ||
      Object.hasOwn(candidate.payload, "holdingSourceId"))));
}

export function holdingAutomationEnabled(config: unknown): boolean {
  return record(config) && config.mode === "live" && config.autoSendEnabled === true &&
    config.canonicalSourcePromoted === true && config.nativeE2eVerified === true &&
    Number.isFinite(instant(config.cutoverAt));
}

export function holdingSourceId(identity: { studioId: string; memberId: string; ticketId: string }): string {
  if (!record(identity) || ![identity.studioId, identity.memberId, identity.ticketId].every(nativeId))
    throw new Error("holding_native_identity_required");
  return `holding_ticket_${hash([identity.studioId, identity.memberId, identity.ticketId])}`;
}
export const candidateKey = (source: Data, holdId: string) =>
  `holding_notice_${hash([source.studioId, source.memberId, source.ticketId, holdId])}`;

/** Only an explicit operator approval hook may persist this top-level candidate binding. */
export function holdingApprovalSnapshot(candidate: Data): string {
  return fingerprint([candidate.payload?.holdingSourceVersion, candidate.payload?.holdId,
    normalizeRecipientPhone(candidate.memberPhone), candidate.payload?.variables]);
}

/** Processing means operator approval was applied by the existing queue, not by this module. */
export function holdingClaimIssue(candidate: unknown): string {
  if (!record(candidate) || candidate.type !== "manual_review" || candidate.status !== "processing" ||
      candidate.templateCode !== HOLDING_NOTICE_TEMPLATE_CODE || candidate.attempts !== 0 || candidate.maxAttempts !== 1 ||
      !record(candidate.payload) || candidate.payload.holdingNotice !== true ||
      !/^holding_ticket_[a-f0-9]{64}$/.test(candidate.payload.holdingSourceId || "") ||
      !digest(candidate.payload.holdingSourceVersion) || !identifier(candidate.payload.holdId) ||
      ![candidate.studioId, candidate.memberId].every(nativeId) ||
      !/^holding_notice_[a-f0-9]{64}$/.test(candidate.candidateId || "") ||
      candidate.dedupeKey !== candidate.candidateId || candidate.sourceActionKey !== candidate.candidateId ||
      !digest(candidate.holdingApprovalSnapshot) || candidate.holdingApprovalSnapshot !== holdingApprovalSnapshot(candidate) ||
      candidate.queuedBy !== "operator" || !text(candidate.reviewedByUid) ||
      candidate.reviewedByUid === "system" || candidate.reviewedByUid.startsWith("system:") ||
      !Number.isFinite(timestampMillis(candidate.reviewedAt)) ||
      !Number.isFinite(timestampMillis(candidate.createdAt)) || overrides(candidate) || overrides(candidate.payload) ||
      attempted(candidate) || isAlimtalkTestRecipient(candidate)) return "holding_candidate_not_unattempted_approved";
  return "";
}

function sourcePlan(source: Data | undefined, sourceId: string, holdId: string, config: Data | undefined,
  now: Date, candidate?: Data): { issue: string; variables?: Variables } {
  const fail = (issue: string) => ({ issue });
  if (!holdingAutomationEnabled(config)) return fail("holding_automation_disabled");
  if (config?.templateId !== HOLDING_NOTICE_TEMPLATE_CODE) return fail("holding_template_configuration_mismatch");
  const clock = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(clock)) return fail("holding_clock_invalid");
  if (!source || source.schemaVersion !== 1 || source.source !== "studiomate_ticket_history_dom" || source.sourceId !== sourceId ||
      ![source.studioId, source.memberId, source.ticketId].every(nativeId) || holdingSourceId(source as any) !== sourceId ||
      source.identityVerified !== true || source.holdsComplete !== true || !digest(source.sourceVersion) ||
      !digest(source.observationFingerprint) || !text(source.memberName) || !text(source.ticketName) ||
      (config?.studioId !== undefined && source.studioId !== config.studioId)) return fail("holding_canonical_source_invalid");
  const observed = instant(source.observedAt), baseline = instant(source.baselineAt);
  const review = source.identityReview;
  if (!record(review) || !text(review.reviewedBy) || review.observationFingerprint !== source.observationFingerprint ||
      !Number.isFinite(instant(review.reviewedAt)) || instant(review.reviewedAt) > clock)
    return fail("holding_identity_review_invalid");
  if (!Number.isFinite(observed) || observed > clock || clock - observed > MAX_AGE_MS ||
      observed < instant(config!.cutoverAt)) return fail("holding_source_stale_or_outside_cutover");
  if (!Number.isFinite(baseline) || baseline > observed || !Array.isArray(source.baselineHoldIds) ||
      !source.baselineHoldIds.every(identifier) || !Array.isArray(source.noticeEligibleHoldIds) ||
      !source.noticeEligibleHoldIds.every(identifier) || !identifier(holdId) ||
      source.baselineHoldIds.includes(holdId) || !source.noticeEligibleHoldIds.includes(holdId))
    return fail("holding_baseline_or_eligibility_blocked");
  if (candidate) {
    const created = timestampMillis(candidate.createdAt), reviewed = timestampMillis(candidate.reviewedAt);
    if (!Number.isFinite(created) || !Number.isFinite(reviewed) || created > clock || reviewed > clock ||
        reviewed < created || observed <= created) return fail("holding_post_candidate_readback_required");
    if (candidate.candidateId !== candidateKey(source, holdId) || candidate.studioId !== source.studioId ||
        candidate.memberId !== source.memberId || candidate.memberName !== source.memberName ||
        candidate.payload.holdingSourceVersion !== source.sourceVersion)
      return fail("holding_candidate_source_mismatch");
  }
  const original = source.originalPeriod;
  if (!record(original) || original.source !== "issuance_record" || !text(original.evidenceRef) ||
      !Number.isSafeInteger(original.days) || original.days < 1 || !Array.isArray(source.holds))
    return fail("holding_original_or_history_incomplete");
  if (!Array.isArray(source.historyFingerprints) || !source.historyFingerprints.length ||
      !source.historyFingerprints.every(digest) || !digest(source.issuanceFingerprint) ||
      !source.historyFingerprints.includes(source.issuanceFingerprint)) return fail("holding_history_evidence_incomplete");
  const byId = new Map<string, Data>();
  for (const hold of source.holds) {
    if (!record(hold) || !identifier(hold.id) || !["registered", "cancelled"].includes(hold.status) ||
        !["member", "center_closure"].includes(hold.kind) || !text(hold.evidenceRef) ||
        !digest(hold.creationEvidenceFingerprint) || !source.historyFingerprints.includes(hold.creationEvidenceFingerprint))
      return fail("holding_history_invalid");
    const prior = byId.get(hold.id);
    if (prior && ["start", "end", "status", "kind", "creationEvidenceFingerprint", "registeredAt"].some((key) => prior[key] !== hold[key]))
      return fail("holding_conflicting_identity");
    byId.set(hold.id, hold);
  }
  const selected = byId.get(holdId);
  if (!selected || selected.status !== "registered" || selected.kind !== "member") return fail("holding_cancelled_or_missing");
  const registered = instant(selected.registeredAt);
  if (!Number.isFinite(registered) || registered > clock || registered <= baseline || registered < instant(config!.cutoverAt))
    return fail("holding_registration_outside_baseline_or_cutover");
  const intervals: number[][] = [];
  for (const hold of byId.values()) {
    if (hold.status === "cancelled") continue;
    const start = day(hold.start), end = day(hold.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return fail("holding_dates_invalid");
    if (hold.kind !== "member") continue;
    if (hold.id !== holdId && start <= day(selected.end) && day(selected.start) <= end)
      return fail("holding_overlapping_identity");
    intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const [start, end] of intervals) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const used = merged.reduce((sum, [start, end]) => sum + end - start + 1, 0);
  const total = Math.floor(original.days / 5);
  if (used > total) return fail("holding_allowance_overage");
  const variables = {
    "#{이름}": source.memberName, "#{수강권명}": source.ticketName,
    "#{홀딩시작일}": selected.start, "#{홀딩종료일}": selected.end,
    "#{이번홀딩일수}": String(day(selected.end) - day(selected.start) + 1),
    "#{전체홀딩일수}": String(total), "#{사용홀딩일수}": String(used), "#{잔여홀딩일수}": String(total - used),
  };
  if (candidate && (!record(candidate.payload.variables) || Object.keys(candidate.payload.variables).length !== 8 ||
      !Object.entries(variables).every(([key, value]) => candidate.payload.variables[key] === value)))
    return fail("holding_approved_variables_mismatch");
  return { issue: "", variables };
}

function memberIssue(member: Data | undefined, source: Data, candidate?: Data): string {
  if (!member || member.memberId !== source.memberId || member.studioId !== source.studioId ||
      member.name !== source.memberName || typeof member.phone !== "string" ||
      !/^[+\d\s().-]+$/.test(member.phone) || !/^0\d{8,10}$/.test(normalizeRecipientPhone(member.phone)) ||
      (candidate && normalizeRecipientPhone(candidate.memberPhone) !== normalizeRecipientPhone(member.phone)))
    return "holding_current_member_mismatch";
  if (/강사|스텝|직원|staff|instructor/i.test(String(member.memberGrade || "")) || member.active === false ||
      (member.classification !== undefined && member.classification !== "member") ||
      isAlimtalkTestRecipient({ memberId: source.memberId, memberName: member.name, memberPhone: member.phone }))
    return "holding_staff_or_ineligible_member";
  return "";
}

async function inspect(deps: HoldingNoticeDependencies, sourceId: string, holdId: string, candidate?: Data) {
  if (!/^holding_ticket_[a-f0-9]{64}$/.test(sourceId) || !identifier(holdId)) throw new Error("holding_source_identity_invalid");
  if (candidate && holdingClaimIssue(candidate)) throw new Error(holdingClaimIssue(candidate));
  const settingsRef = deps.db.doc(HOLDING_NOTICE_SETTINGS);
  const sourceRef = deps.db.doc(`${HOLDING_NOTICE_SOURCE_COLLECTION}/${sourceId}`);
  const config = (await settingsRef.get()).data();
  // Disabled integration never scans canonical member/source data or provider history.
  if (!holdingAutomationEnabled(config)) throw new Error("holding_automation_disabled");
  const source = (await sourceRef.get()).data();
  const plan = sourcePlan(source, sourceId, holdId, config, deps.now(), candidate);
  if (plan.issue || !source || !plan.variables) throw new Error(plan.issue);
  const memberRef = deps.db.doc(`memberProfiles/${source.memberId}`);
  const member = (await memberRef.get()).data();
  const issue = memberIssue(member, source, candidate);
  if (issue || !member) throw new Error(issue);
  const evidence = await deps.loadEvidence(source, candidate);
  if (!evidence || evidence.recipientIssue !== "" || evidence.templateIssue !== "" ||
      evidence.providerHistoryComplete !== true || evidence.providerDuplicate !== false ||
      evidence.memberFingerprint !== holdingMemberFingerprint(member))
    throw new Error(evidence?.recipientIssue || evidence?.templateIssue || "holding_evidence_incomplete_or_duplicate");
  return { source, config, member, sourceRef, settingsRef, memberRef, variables: plan.variables,
    sourceHash: fingerprint(source), configHash: fingerprint(config), memberHash: holdingMemberFingerprint(member) };
}

async function currentReads(deps: HoldingNoticeDependencies, tx: Transaction,
  checked: Awaited<ReturnType<typeof inspect>>, sourceId: string, holdId: string, candidate?: Data) {
  const source = (await tx.get(checked.sourceRef)).data();
  const config = (await tx.get(checked.settingsRef)).data();
  const member = (await tx.get(checked.memberRef)).data();
  const plan = sourcePlan(source, sourceId, holdId, config, deps.now(), candidate);
  if (plan.issue || !source || !member || fingerprint(source) !== checked.sourceHash ||
      fingerprint(config) !== checked.configHash || holdingMemberFingerprint(member) !== checked.memberHash ||
      memberIssue(member, source, candidate)) throw new Error(plan.issue || "holding_source_settings_or_member_changed");
  const recipientIssue = await deps.verifyRecipientInTransaction(tx, source, member);
  if (recipientIssue !== "") throw new Error(recipientIssue || "holding_transactional_recipient_unverified");
  return plan.variables!;
}

export async function queueHoldingNotice(deps: HoldingNoticeDependencies, sourceId: string, holdId: string): Promise<QueueResult> {
  try {
    const checked = await inspect(deps, sourceId, holdId);
    const id = candidateKey(checked.source, holdId);
    const candidateRef = deps.db.doc(`alimtalkCandidates/${id}`);
    const sendRef = deps.db.doc(`alimtalkSends/${id}`);
    const claimRef = deps.db.doc(`${HOLDING_NOTICE_CLAIM_COLLECTION}/${id}`);
    return await deps.db.runTransaction<QueueResult>(async (tx) => {
      const variables = await currentReads(deps, tx, checked, sourceId, holdId);
      const existing = await tx.get(candidateRef), send = await tx.get(sendRef), claim = await tx.get(claimRef);
      if (send.exists || claim.exists) return { status: "blocked", reason: "holding_prior_send_or_claim", candidateId: id };
      const payload = { holdingSourceId: sourceId, holdingSourceVersion: checked.source.sourceVersion,
        holdId, variables, holdingNotice: true };
      const phone = normalizeRecipientPhone(checked.member.phone);
      if (existing.exists) {
        const current = existing.data();
        if (!current || current.status === "sent" || current.attempts !== 0 || current.maxAttempts !== 1 || attempted(current))
          return { status: "blocked", reason: "holding_existing_candidate_attempted_or_unknown", candidateId: id };
        if (current.candidateId !== id || current.type !== "manual_review" ||
            current.templateCode !== HOLDING_NOTICE_TEMPLATE_CODE || current.studioId !== checked.source.studioId ||
            current.memberId !== checked.source.memberId || current.dedupeKey !== id || current.sourceActionKey !== id ||
            !record(current.payload) || current.payload.holdingNotice !== true ||
            current.payload.holdingSourceId !== sourceId || current.payload.holdId !== holdId ||
            !Number.isFinite(timestampMillis(current.createdAt)) || overrides(current) || overrides(current.payload))
          return { status: "blocked", reason: "holding_existing_candidate_invalid", candidateId: id };
        const unchanged = current.payload.holdingSourceVersion === payload.holdingSourceVersion &&
          record(current.payload.variables) && Object.keys(current.payload.variables).length === 8 &&
          Object.entries(variables).every(([key, value]) => current.payload.variables[key] === value) &&
          current.memberPhone === phone && current.memberName === checked.source.memberName;
        if (unchanged) return { status: "existing", reason: "candidate_already_exists", candidateId: id };
        const at = deps.timestamp();
        if (!Number.isFinite(timestampMillis(at))) throw new Error("holding_timestamp_invalid");
        // A revised event keeps its identity and creation time, but never its prior approval.
        tx.update(candidateRef, { status: "reviewed", payload, memberPhone: phone, memberName: checked.source.memberName,
          queuedBy: null, reviewedByUid: null, reviewedAt: null, holdingApprovalSnapshot: null,
          reason: "홀딩 원천 변경 · 운영자 재승인 필요", reasonCode: "holding_content_changed_review_required",
          lastError: null, updatedAt: at });
        return { status: "reviewed", reason: "holding_content_changed_review_required", candidateId: id };
      }
      const at = deps.timestamp();
      if (!Number.isFinite(timestampMillis(at))) throw new Error("holding_timestamp_invalid");
      tx.create(candidateRef, {
        candidateId: id, studioId: checked.source.studioId, memberId: checked.source.memberId,
        memberName: checked.source.memberName, memberPhone: phone,
        type: "manual_review", status: "reviewed", templateCode: HOLDING_NOTICE_TEMPLATE_CODE,
        title: "수강권 홀딩 현황 안내 v2", reason: "검증된 신규 홀딩 · 운영자 승인 대기",
        sourceActionKey: id, sourceDate: new Date(deps.now().getTime() + 9 * 3600_000).toISOString().slice(0, 10),
        payload,
        dedupeKey: id, attempts: 0, maxAttempts: 1, lastError: null, createdAt: at, updatedAt: at,
      });
      return { status: "reviewed", reason: "operator_review_required", candidateId: id };
    });
  } catch (error) {
    return { status: "blocked", reason: error instanceof Error ? error.message : "holding_inspection_failed" };
  }
}

/** The authenticated adapter must supply its verified manager UID and studio, never client identity fields. */
export async function approveHoldingNotice(deps: HoldingNoticeDependencies, input: {
  candidateId: string; expectedSnapshot: string; reviewedByUid: string; studioId: string;
}): Promise<{ status: "queued" | "existing"; candidateId: string }> {
  if (!record(input) || !/^holding_notice_[a-f0-9]{64}$/.test(input.candidateId || "") ||
      !digest(input.expectedSnapshot) || !nativeId(input.studioId) || !text(input.reviewedByUid) ||
      input.reviewedByUid === "system" || input.reviewedByUid.startsWith("system:"))
    throw new Error("holding_approval_input_invalid");
  return deps.db.runTransaction(async (tx) => {
    const candidateRef = deps.db.doc(`alimtalkCandidates/${input.candidateId}`);
    const current = (await tx.get(candidateRef)).data();
    const config = (await tx.get(deps.db.doc(HOLDING_NOTICE_SETTINGS))).data();
    if (!holdingAutomationEnabled(config)) throw new Error("holding_automation_disabled");
    if (!current || current.candidateId !== input.candidateId || current.studioId !== input.studioId ||
        !["reviewed", "queued"].includes(current.status)) throw new Error("holding_approval_candidate_invalid");
    if (input.expectedSnapshot !== holdingApprovalSnapshot(current)) throw new Error("holding_approval_snapshot_changed");
    const at = current.status === "queued" ? current.reviewedAt : deps.timestamp();
    const clock = deps.now().getTime();
    const proposed = current.status === "queued" ? { ...current, status: "processing" } : {
      ...current, status: "processing", queuedBy: "operator", reviewedByUid: input.reviewedByUid,
      reviewedAt: at, holdingApprovalSnapshot: input.expectedSnapshot,
    };
    if (holdingClaimIssue(proposed) || !Number.isFinite(clock) || timestampMillis(at) > clock ||
        timestampMillis(current.createdAt) > timestampMillis(at) ||
        (current.status === "queued" && current.reviewedByUid !== input.reviewedByUid))
      throw new Error("holding_approval_binding_invalid");
    const sourceId = current.payload.holdingSourceId, holdId = current.payload.holdId;
    const source = (await tx.get(deps.db.doc(`${HOLDING_NOTICE_SOURCE_COLLECTION}/${sourceId}`))).data();
    // Approval may precede post-candidate readback; dispatch independently requires that later readback.
    const plan = sourcePlan(source, sourceId, holdId, config, new Date(clock));
    if (plan.issue) throw new Error(plan.issue);
    if (!source || current.payload.holdingSourceVersion !== source.sourceVersion ||
        current.candidateId !== candidateKey(source, holdId) || current.studioId !== source.studioId ||
        current.memberId !== source.memberId || current.memberName !== source.memberName ||
        !record(current.payload.variables) || Object.keys(current.payload.variables).length !== 8 ||
        !Object.entries(plan.variables!).every(([key, value]) => current.payload.variables[key] === value))
      throw new Error("holding_approval_source_changed");
    const send = await tx.get(deps.db.doc(`alimtalkSends/${input.candidateId}`));
    const claim = await tx.get(deps.db.doc(`${HOLDING_NOTICE_CLAIM_COLLECTION}/${input.candidateId}`));
    if (send.exists || claim.exists) throw new Error("holding_prior_send_or_claim");
    if (current.status === "queued") return { status: "existing", candidateId: input.candidateId };
    tx.update(candidateRef, { status: "queued", queuedBy: "operator", reviewedByUid: input.reviewedByUid,
      reviewedAt: at, holdingApprovalSnapshot: input.expectedSnapshot, updatedAt: at });
    return { status: "queued", candidateId: input.candidateId };
  });
}

/** Claims survive all failures; reconciliation may record receipts but must never re-POST. */
export async function dispatchHoldingNotice<T extends { messageId: string; groupId?: string }>(
  deps: HoldingNoticeDependencies, candidate: Data, transport: (variables: Variables) => Promise<T>,
): Promise<T> {
  const issue = holdingClaimIssue(candidate);
  if (issue) throw new Error(issue);
  const { holdingSourceId: sourceId, holdId } = candidate.payload;
  const checked = await inspect(deps, sourceId, holdId, candidate);
  const candidateRef = deps.db.doc(`alimtalkCandidates/${candidate.candidateId}`);
  const sendRef = deps.db.doc(`alimtalkSends/${candidate.candidateId}`);
  const claimRef = deps.db.doc(`${HOLDING_NOTICE_CLAIM_COLLECTION}/${candidate.candidateId}`);
  const variables = await deps.db.runTransaction(async (tx) => {
    const actual = (await tx.get(candidateRef)).data();
    if (!actual || holdingClaimIssue(actual) || fingerprint(actual) !== fingerprint(candidate))
      throw new Error("holding_candidate_changed_or_attempted");
    const recalculated = await currentReads(deps, tx, checked, sourceId, holdId, actual);
    const send = await tx.get(sendRef), claim = await tx.get(claimRef);
    if (send.exists || claim.exists) throw new Error("holding_prior_send_or_claim");
    const at = deps.timestamp();
    if (!Number.isFinite(timestampMillis(at))) throw new Error("holding_timestamp_invalid");
    tx.create(claimRef, { candidateId: candidate.candidateId, sourceId, sourceVersion: checked.source.sourceVersion,
      holdId, status: "attempting", attemptedAt: at, variables: recalculated, memberFingerprint: checked.memberHash });
    tx.create(sendRef, { sendId: candidate.candidateId, candidateId: candidate.candidateId,
      studioId: candidate.studioId, memberId: candidate.memberId, memberName: candidate.memberName,
      memberPhone: candidate.memberPhone, templateCode: HOLDING_NOTICE_TEMPLATE_CODE, dedupeKey: candidate.candidateId,
      status: "processing", providerOutcome: "attempting", attempts: 1, maxAttempts: 1, variables: recalculated,
      lastError: null, createdByUid: candidate.reviewedByUid, createdAt: at, updatedAt: at, nextRunAt: at });
    tx.update(candidateRef, { attempts: 1, maxAttempts: 1, providerAttemptedAt: at, updatedAt: at });
    return recalculated;
  });
  let receipt: T | undefined;
  try {
    const result = await transport({ ...variables });
    if (!result || !text(result.messageId)) throw new Error("holding_provider_acceptance_unknown");
    receipt = result;
    await deps.db.runTransaction(async (tx) => {
      const claim = (await tx.get(claimRef)).data();
      if (!claim || claim.status !== "attempting") throw new Error("holding_claim_outcome_changed");
      const at = deps.timestamp();
      const accepted = { status: "accepted", messageId: result.messageId,
        ...(text(result.groupId) ? { groupId: result.groupId } : {}), updatedAt: at };
      tx.update(claimRef, accepted);
      tx.update(sendRef, { status: "done", providerOutcome: "accepted", solapiMessageId: result.messageId,
        ...(text(result.groupId) ? { solapiGroupId: result.groupId } : {}), updatedAt: at });
      tx.update(candidateRef, { status: "sent", attempts: 1, maxAttempts: 1, sentAt: at, updatedAt: at });
    });
    return result;
  } catch (error) {
    const provisional = record(error) && record(error.holdingReceipt) && text(error.holdingReceipt.messageId)
      ? error.holdingReceipt : undefined;
    const retainedReceipt = receipt || provisional;
    // A second persistence failure must not mask the transport error or erase the claim.
    await deps.db.runTransaction(async (tx) => {
      const claim = (await tx.get(claimRef)).data();
      if (!claim || claim.status === "accepted") return;
      const at = deps.timestamp();
      tx.update(claimRef, { status: receipt ? "accepted" : "unknown", updatedAt: at,
        ...(retainedReceipt ? { messageId: retainedReceipt.messageId,
          ...(text(retainedReceipt.groupId) ? { groupId: retainedReceipt.groupId } : {}) } : {}) });
      tx.update(sendRef, { status: "failed", providerOutcome: receipt ? "accepted_ledger_error" : "unknown",
        attempts: 1, maxAttempts: 1, lastError: "홀딩 발송 결과 대조 필요 · 재발송 금지", updatedAt: at,
        ...(retainedReceipt ? { solapiMessageId: retainedReceipt.messageId,
          ...(text(retainedReceipt.groupId) ? { solapiGroupId: retainedReceipt.groupId } : {}) } : {}) });
      tx.update(candidateRef, { status: "failed", reasonCode: "holding_reconciliation_required",
        attempts: 1, maxAttempts: 1, lastError: "홀딩 발송 결과 대조 필요 · 재발송 금지", updatedAt: at });
    }).catch(() => undefined);
    throw error;
  }
}
