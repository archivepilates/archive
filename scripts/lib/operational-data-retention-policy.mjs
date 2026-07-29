export function isLiveValidationBookingEligible(bookingId, booking) {
  return (
    String(bookingId || "").startsWith("live_validation_") &&
    booking?.appStatus === "cancel" &&
    booking?.sourceStatus === "live_validation_cancelled" &&
    String(booking?.sessionOrder?.excludedReason || "").startsWith("live_validation_cleanup")
  );
}

export function hasCompleteCleanupMarkedRelations(sessions, requests, records) {
  const groups = [sessions, requests, records];
  return (
    groups.every((group) => Array.isArray(group) && group.length > 0) &&
    groups.flat().every((data) => cleanupMarked(data))
  );
}

export function isExpiredMediaSessionCandidate(session) {
  return (
    ["pending", "failed"].includes(String(session?.status || "")) &&
    !session?.driveFileId
  );
}

export function isExpiredUnsignedSignupCandidate(contract) {
  return (
    ["cancelled", "expired"].includes(String(contract?.status || "")) &&
    !contract?.submittedAt &&
    !contract?.signature
  );
}

export function hasDeletionBlockingReferences(ledger, candidates, sends) {
  return [ledger, candidates, sends].some(
    (group) => Array.isArray(group) && group.length > 0,
  );
}

export function shouldApplyOperationalDataPurge(args) {
  return Boolean(args?.["purge-operational-data"]);
}

export function cleanupMarked(data) {
  return [
    data?.cancellationReason,
    data?.sourceStatus,
    data?.sessionOrder?.excludedReason,
  ].some((value) => String(value || "").startsWith("live_validation_cleanup"));
}
