import { createHash } from "node:crypto";
import { normalizeMembershipPhone } from "./membershipContractPolicy";
import {
  MEMBERSHIP_WELCOME_TEMPLATE,
  membershipWelcomeKey,
  planMembershipContractWelcome,
} from "./membershipWelcomePolicy";
import { membershipWelcomeReadbackIssue } from "./membershipWelcomeReadback";
import { membershipWelcomeOutboundMarker as outboundMarker } from "./membershipWelcomeHistory";

export const MEMBERSHIP_CONTRACT_COLLECTION = "studiomateMembershipContracts";
export const MEMBERSHIP_WELCOME_CLAIMS = "membershipWelcomeClaims";
export const MEMBERSHIP_AUTOMATION_SETTINGS = "systemSettings/membershipContractAutomation";
export const MEMBERSHIP_READBACK_REQUESTS = "adminSyncRequests";
type Data = Record<string, any>;
export interface MembershipWelcomeDependencies {
  db: FirebaseFirestore.Firestore;
  now(): Date;
  timestamp(): FirebaseFirestore.Timestamp;
  loadEvidence(
    source: Data,
    ignoreCandidateId?: string,
  ): Promise<{ history: Data; template: Data; recipientIssue: string }>;
}

const fingerprint = (value: Data) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const membershipAutomationEnabled = (config: Data | undefined) =>
  config?.enabled === true &&
  config?.mode === "live" &&
  config?.sourcePromoted === true &&
  config?.nativeE2eVerified === true;
const enabled = membershipAutomationEnabled;
export const isMembershipWelcomeCandidate = (candidate: Data) =>
  candidate.type === "membership_welcome" || candidate.templateCode === MEMBERSHIP_WELCOME_TEMPLATE.templateId;
const overrideMarker = (value: Data) => Object.keys(value).some((key) => /test|override/i.test(key));

export function membershipWelcomeClaimIssue(candidate: Data) {
  if (
    candidate.type !== "membership_welcome" ||
    candidate.templateCode !== MEMBERSHIP_WELCOME_TEMPLATE.templateId ||
    candidate.attempts !== 0 ||
    candidate.maxAttempts !== 1 ||
    outboundMarker(candidate) ||
    overrideMarker(candidate) ||
    overrideMarker(candidate.payload || {})
  )
    return "membership_attempt_state_not_verified";
  return "";
}

function sourceIssue(source: Data | undefined, sourceId: string, config: Data | undefined, now: Date) {
  if (!enabled(config)) return "membership_automation_disabled";
  if (
    !source ||
    source.schemaVersion !== 1 ||
    source.source !== "studiomate_native_contract" ||
    source.contractId !== sourceId ||
    !/^[a-f0-9]{64}$/.test(sourceId) ||
    source.bindingVerified !== true ||
    !source.selection ||
    !source.completion ||
    source.completion.contractId !== sourceId ||
    source.studioId !== config?.studioId ||
    source.studioId !== source.completion.studioId ||
    source.status !== "signed"
  )
    return "canonical_contract_not_verified";
  if (
    !Number.isFinite(Date.parse(config?.cutoverAt)) ||
    Date.parse(source.selection.now) < Date.parse(config?.cutoverAt) ||
    Date.parse(source.completion.checkedAt) > now.getTime() ||
    now.getTime() - Date.parse(source.completion.checkedAt) > 30 * 60_000
  )
    return "contract_outside_cutover_or_stale";
  return "";
}

export async function inspectMembershipWelcome(
  deps: MembershipWelcomeDependencies,
  sourceId: string,
  candidate?: Data,
) {
  if (!/^[a-f0-9]{64}$/.test(sourceId)) return { issue: "invalid_contract_id" };
  const configSnap = await deps.db.doc(MEMBERSHIP_AUTOMATION_SETTINGS).get();
  const config = configSnap.data();
  if (!enabled(config)) return { issue: "membership_automation_disabled" };
  const sourceSnap = await deps.db.collection(MEMBERSHIP_CONTRACT_COLLECTION).doc(sourceId).get();
  const source = sourceSnap.data();
  const issue = sourceIssue(source, sourceId, config, deps.now());
  if (issue || !source) return { issue };
  const phone = normalizeMembershipPhone(source.completion.memberPhone);
  const id = membershipWelcomeKey(source.studioId, phone);
  if (
    candidate &&
    (candidate.candidateId !== id ||
      candidate.type !== "membership_welcome" ||
      candidate.templateCode !== MEMBERSHIP_WELCOME_TEMPLATE.templateId ||
      candidate.studioId !== source.studioId ||
      candidate.memberId !== source.completion.memberId ||
      candidate.memberName !== source.memberName ||
      !source.memberName ||
      normalizeMembershipPhone(candidate.memberPhone) !== phone ||
      candidate.maxAttempts !== 1 ||
      candidate.payload?.sourceContractId !== sourceId ||
      overrideMarker(candidate) ||
      overrideMarker(candidate.payload || {}))
  ) {
    return { issue: "membership_candidate_source_mismatch" };
  }
  const evidence = await deps.loadEvidence(source, candidate?.candidateId);
  if (evidence.recipientIssue) return { issue: evidence.recipientIssue };
  const readbackIssue = membershipWelcomeReadbackIssue(source, deps.now(), candidate);
  if (readbackIssue) return { issue: readbackIssue };
  const plan = planMembershipContractWelcome({
    selection: source.selection,
    completion: source.completion,
    ...evidence,
    now: deps.now().toISOString(),
  });
  if (!plan.eligibleForCandidate) return { issue: plan.reason };
  return {
    issue: "",
    source,
    config,
    sourceHash: fingerprint(source),
    configHash: fingerprint(config!),
    candidateId: id,
    memberIds: evidence.history.memberIds as string[],
  };
}

export async function queueMembershipWelcome(deps: MembershipWelcomeDependencies, sourceId: string) {
  const checked = await inspectMembershipWelcome(deps, sourceId);
  if (checked.issue || !checked.source) return { status: "blocked", reason: checked.issue };
  const { source, candidateId } = checked;
  const candidateRef = deps.db.collection("alimtalkCandidates").doc(candidateId!);
  const refreshRef = deps.db
    .collection(MEMBERSHIP_READBACK_REQUESTS)
    .doc(`membership_contract_readback_${sourceId}`);
  return deps.db.runTransaction(async (tx) => {
    const current = await tx.get(deps.db.collection(MEMBERSHIP_CONTRACT_COLLECTION).doc(sourceId));
    const config = await tx.get(deps.db.doc(MEMBERSHIP_AUTOMATION_SETTINGS));
    const existing = await tx.get(candidateRef);
    if (existing.exists) return { status: "existing", reason: "candidate_already_exists" };
    if (
      fingerprint(current.data() || {}) !== checked.sourceHash ||
      fingerprint(config.data() || {}) !== checked.configHash ||
      sourceIssue(current.data(), sourceId, config.data(), deps.now()) ||
      membershipWelcomeReadbackIssue(current.data()!, deps.now())
    )
      return { status: "blocked", reason: "source_changed" };
    const at = deps.timestamp();
    tx.create(candidateRef, {
      candidateId,
      studioId: source.studioId,
      memberId: source.completion.memberId,
      memberName: source.memberName,
      memberPhone: source.completion.memberPhone,
      type: "membership_welcome",
      status: "queued",
      templateCode: MEMBERSHIP_WELCOME_TEMPLATE.templateId,
      title: MEMBERSHIP_WELCOME_TEMPLATE.name,
      reason: "신규 정규회원 계약서 본인 서명 완료",
      sourceDate: new Date(deps.now().getTime() + 9 * 3600_000).toISOString().slice(0, 10),
      payload: { sourceContractId: sourceId },
      dedupeKey: candidateId,
      attempts: 0,
      maxAttempts: 1,
      queuedBy: "auto",
      lastError: null,
      createdAt: at,
      updatedAt: at,
    });
    // Candidate creation does not prove that the member/ticket/payment source
    // is still current. Ask the existing Mac mini queue runner for one exact,
    // post-candidate native readback before the provider send is claimable.
    tx.create(refreshRef, {
      requestMode: "membership_contract_readback",
      status: "pending",
      contractId: sourceId,
      candidateId,
      createdAt: at,
      updatedAt: at,
    });
    tx.update(current.ref, {
      welcomeCandidateId: candidateId,
      welcomeStatus: "queued",
      nextObservationAt: at,
      updatedAt: at,
    });
    return { status: "queued", reason: "" };
  });
}

/** Durable pre-POST claims remain even after a crash or timeout; never blindly retry. */
export async function dispatchMembershipWelcome<T extends { messageId: string }>(
  deps: MembershipWelcomeDependencies,
  candidate: Data,
  transport: () => Promise<T>,
): Promise<T> {
  const checked = await inspectMembershipWelcome(deps, String(candidate.payload?.sourceContractId || ""), candidate);
  if (checked.issue || !checked.source || !checked.memberIds?.includes(checked.source.completion.memberId))
    throw new Error(checked.issue || "member_aliases_missing");
  const claimIds = [
    candidate.candidateId,
    ...checked.memberIds.map((id) => `member_${fingerprint({ studio: candidate.studioId, id })}`),
  ];
  const claimRefs = claimIds.map((id) => deps.db.collection(MEMBERSHIP_WELCOME_CLAIMS).doc(id));
  const candidateRef = deps.db.collection("alimtalkCandidates").doc(candidate.candidateId);
  const sourceRef = deps.db.collection(MEMBERSHIP_CONTRACT_COLLECTION).doc(checked.source.contractId);
  await deps.db.runTransaction(async (tx) => {
    const liveCandidate = await tx.get(candidateRef);
    const source = await tx.get(sourceRef);
    const config = await tx.get(deps.db.doc(MEMBERSHIP_AUTOMATION_SETTINGS));
    const claims = await tx.getAll(...claimRefs);
    const actual = liveCandidate.data();
    if (
      !actual ||
      actual.status !== "processing" ||
      actual.attempts !== 0 ||
      actual.maxAttempts !== 1 ||
      outboundMarker(actual) ||
      overrideMarker(actual) ||
      overrideMarker(actual.payload || {}) ||
      actual.type !== candidate.type ||
      actual.templateCode !== candidate.templateCode ||
      actual.memberPhone !== candidate.memberPhone ||
      actual.memberId !== candidate.memberId ||
      actual.memberName !== candidate.memberName ||
      actual.studioId !== candidate.studioId ||
      JSON.stringify(actual.payload) !== JSON.stringify(candidate.payload) ||
      claims.some((doc) => doc.exists)
    )
      throw new Error("welcome_already_attempted_or_not_claimed");
    if (
      fingerprint(source.data() || {}) !== checked.sourceHash ||
      fingerprint(config.data() || {}) !== checked.configHash ||
      sourceIssue(source.data(), source.id, config.data(), deps.now()) ||
      membershipWelcomeReadbackIssue(source.data()!, deps.now(), actual)
    )
      throw new Error("welcome_source_changed_before_send");
    const at = deps.timestamp();
    for (const ref of claimRefs)
      tx.create(ref, { candidateId: candidate.candidateId, status: "attempting", attemptedAt: at });
    tx.update(candidateRef, { attempts: 1, maxAttempts: 1, providerAttemptedAt: at, updatedAt: at });
  });
  try {
    const result = await transport();
    if (!result.messageId) throw new Error("provider_acceptance_unknown");
    const batch = deps.db.batch();
    for (const ref of claimRefs)
      batch.update(ref, { status: "accepted", messageId: result.messageId, updatedAt: deps.timestamp() });
    batch.update(sourceRef, { welcomeStatus: "accepted", updatedAt: deps.timestamp() });
    await batch.commit();
    return result;
  } catch (error) {
    // Original error wins even if recording the ambiguity also fails. Claims are retained.
    const batch = deps.db.batch();
    for (const ref of claimRefs) batch.update(ref, { status: "unknown", updatedAt: deps.timestamp() });
    batch.update(sourceRef, { welcomeStatus: "review", updatedAt: deps.timestamp() });
    await batch.commit().catch(() => undefined);
    throw error;
  }
}
