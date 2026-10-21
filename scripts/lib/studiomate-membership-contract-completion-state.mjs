const OPEN = new Set(["waiting", "review"]);

export function verifiedLegacyMembershipWelcomeDisposition(source, nowMs = Date.now()) {
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const nativeId = value => typeof value === "string" && /^[1-9]\d{0,63}$/.test(value);
  const instant = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
    const at = Date.parse(value);
    return Number.isFinite(at) && new Date(at).toISOString() === (value.length === 20 ? value.replace("Z", ".000Z") : value) ? at : NaN;
  };
  const disposition = source?.welcomeDisposition;
  const binding = source?.binding;
  if (!record(source) || source.schemaVersion !== 1 || source.source !== "studiomate_native_contract" ||
      source.studioId !== "5330" || source.bindingVerified !== true || source.welcomeStatus !== "not_required" ||
      typeof source.contractId !== "string" || !/^[a-f0-9]{64}$/.test(source.contractId) ||
      (source.id !== undefined && source.id !== source.contractId) || !record(binding) ||
      binding.contractId !== source.contractId || binding.studioId !== source.studioId || !nativeId(binding.memberId) ||
      !record(disposition) || disposition.reason !== "legacy_member_before_contract_cutover" ||
      disposition.verified !== true || disposition.source !== "studiomate_native_member_ticket" ||
      disposition.memberId !== binding.memberId || disposition.contractId !== source.contractId) return false;
  for (const identity of [source.completion, source.signatureReceipt]) {
    if (identity != null && (!record(identity) || identity.memberId !== binding.memberId ||
        identity.contractId !== source.contractId || identity.studioId !== source.studioId)) return false;
  }
  const checkedAt = instant(disposition.checkedAt);
  const registeredAt = instant(disposition.registeredAt);
  const cutoverAt = instant(disposition.cutoverAt);
  const prior = disposition.priorRegularIssuanceIds;
  return Number.isFinite(nowMs) && Number.isFinite(checkedAt) && Number.isFinite(registeredAt) && Number.isFinite(cutoverAt) &&
    registeredAt <= cutoverAt && cutoverAt <= checkedAt && checkedAt <= nowMs &&
    Array.isArray(prior) && prior.length > 0 && prior.every(nativeId) && new Set(prior).size === prior.length &&
    !prior.includes(binding.userTicketId) &&
    (!source.selection?.member?.registeredAt || source.selection.member.registeredAt === disposition.registeredAt) &&
    (!source.selection?.policy?.cutoverAt || source.selection.policy.cutoverAt === disposition.cutoverAt);
}

export function terminalMembershipWelcome(source, nowMs = Date.now()) {
  return source?.welcomeStatus === "accepted" || verifiedLegacyMembershipWelcomeDisposition(source, nowMs);
}

export function needsMembershipContractObservation(source, id, studioId, { refresh = false } = {}) {
  const terminal = terminalMembershipWelcome(source);
  const signedRefresh = source?.status === "signed" && Boolean(source.completion || (refresh && source.signatureReceipt)) &&
    (refresh || source.welcomeStatus === "queued");
  return source?.schemaVersion === 1 && source.source === "studiomate_native_contract" &&
    source.bindingVerified === true && source.studioId === studioId &&
    source.contractId === id && source.binding?.contractId === id &&
    (signedRefresh || (OPEN.has(source.status) && !source.completion && !source.signatureReceipt)) && source.observationHold !== true &&
    (!terminal || refresh);
}

export function compactMembershipContractObservations(rows) {
  if (!Array.isArray(rows)) throw new Error("invalid_observation_history");
  const ordered = [...rows].sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));
  const key = row => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => k !== "observedAt")));
  const result = [];
  let previousKey, first, last;
  const flush = () => {
    if (!first) return;
    result.push(first);
    if (last.observedAt !== first.observedAt || JSON.stringify(first) !== JSON.stringify(last)) result.push(last);
  };
  for (const row of ordered) {
    const current = key(row);
    if (current !== previousKey) { flush(); first = row; previousKey = current; }
    last = row;
  }
  flush();
  if (result.length > 100) throw new Error("invalid_observation_history");
  return result;
}

export function membershipContractObservationHistory(source) {
  return compactMembershipContractObservations([
    ...(source.binding.previousObservations || []), ...(source.observationTail || []),
    ...(source.lastObservation ? [source.lastObservation] : []),
  ]);
}

export function membershipContractObservationTail(source, observation) {
  try {
    return { overflow: false, rows: compactMembershipContractObservations([
      ...(source.observationTail || []), ...(source.lastObservation ? [source.lastObservation] : []),
      ...(observation ? [observation] : []),
    ]) };
  } catch {
    // Preserve the old evidence; the caller retains the latest observation and an explicit hold.
    return { overflow: true, rows: source.observationTail || [] };
  }
}

export function membershipContractCompletionSafetyPatch(outcome, source, deleteField) {
  if (outcome.status !== "review" || outcome.reason === "native_contract_read_failed") return {};
  return { status: "review", completion: deleteField,
    ...(terminalMembershipWelcome(source) ? { welcomeStatus: source.welcomeStatus } : { welcomeStatus: "review", welcomeReason: outcome.reason }),
    ...(source.completion ? { invalidatedCompletion: source.completion } : {}) };
}

export function membershipContractWelcomeObservationPatch(outcome, source) {
  if (!outcome.completion && !outcome.signatureReceipt) return {};
  if (terminalMembershipWelcome(source)) return { welcomeStatus: source.welcomeStatus };
  if (source.welcomeStatus === "not_required") return { welcomeStatus: "review", welcomeReason: "invalid_legacy_welcome_disposition" };
  if (outcome.completion) return { welcomeStatus: source.welcomeStatus === "queued" ? "queued" : "ready" };
  return { welcomeStatus: source.welcomeStatus === "queued" ? "queued" : "review", welcomeReason: "late_signature_welcome_review_required" };
}

export function resolveMembershipContractSignature(outcome, signature, domStatus) {
  if (signature.receipt) return { ...outcome, signatureReceipt: signature.receipt,
    ...(!outcome.completion ? { status: "signed", reason: "verified_native_signature_receipt" } : {}) };
  // A native identity/history conflict always vetoes even a fresh completion.
  const intervalOnly = outcome.completion?.signatureTimeSource === "observed_transition" && signature.reason === "native_signature_receipt_time_mismatch";
  if (domStatus === "signed" && !intervalOnly) return { ...outcome, completion: null, status: "review", reason: signature.reason };
  if (domStatus !== "signed" && signature.reason === "native_member_signature_required" && outcome.reason === "invalid_native_binding")
    return { ...outcome, status: "waiting", reason: "native_member_signature_required" };
  return outcome;
}

export function membershipContractNextObservation(outcome, source, nowMs) {
  if (terminalMembershipWelcome(source, nowMs)) return null;
  if (outcome.completion || outcome.signatureReceipt) return null;
  if (outcome.status === "review" && outcome.reason !== "native_contract_read_failed") return null;
  const review = outcome.status === "review";
  const attempts = review ? Math.min((source.observationReviewAttempts || 0) + 1, 6) : 0;
  const old = nowMs - Date.parse(source.binding?.selectedAt) > 7 * 86400_000;
  const delay = old ? 6 * 3600_000 : review ? Math.min(15 * 60_000 * 2 ** (attempts - 1), 6 * 3600_000) : 10 * 60_000;
  return { at: nowMs + delay, reviewAttempts: attempts };
}

// Recover stopped records with a bounded cursor; reserve slots to avoid due-job starvation.
export function selectMembershipContractObservationTargets(due, recovery, studioId, limit = 5) {
  const valid = doc => needsMembershipContractObservation(doc.data(), doc.id, studioId);
  const stopped = recovery.filter(doc => valid(doc) && !doc.data().nextObservationAt).slice(0, 2);
  const chosen = new Map(stopped.map(doc => [doc.id, doc]));
  for (const doc of due) {
    if (chosen.size >= limit) break;
    if (valid(doc)) chosen.set(doc.id, doc);
  }
  return [...chosen.values()];
}
