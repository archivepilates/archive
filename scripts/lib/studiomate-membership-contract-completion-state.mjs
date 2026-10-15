const OPEN = new Set(["waiting", "review"]);

export function needsMembershipContractObservation(source, id, studioId, { refresh = false } = {}) {
  const signedRefresh = source?.status === "signed" && Boolean(source.completion) && (refresh || source.welcomeStatus === "queued");
  return source?.schemaVersion === 1 && source.source === "studiomate_native_contract" &&
    source.bindingVerified === true && source.studioId === studioId &&
    source.contractId === id && source.binding?.contractId === id &&
    (signedRefresh || (OPEN.has(source.status) && !source.completion && !source.signatureReceipt)) && source.observationHold !== true &&
    source.welcomeStatus !== "accepted";
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
  return { status: "review", completion: deleteField, welcomeStatus: "review", welcomeReason: outcome.reason,
    ...(source.completion ? { invalidatedCompletion: source.completion } : {}) };
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
