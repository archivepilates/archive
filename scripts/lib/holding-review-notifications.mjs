import { calculateLiveHolding } from "./holding-notice-live-readback.mjs";
import { holdingFingerprint } from "./studiomate-holding-source.mjs";

const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const ALERTS = "workLanes/holding-allowance-notice/reviewAlerts";

/** A ticket edit is only a discovery hint; a fully reconciled, finished hold is not a send failure. */
export function finishedHoldingDiscovery(raw, job, now = new Date()) {
  if (job.transition !== "ticket_changed") return false;
  if (raw.memberId !== job.memberId || raw.ticketName !== job.ticketName) throw new Error("holding_discovery_scope_mismatch");
  const live = calculateLiveHolding(raw, { now });
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  return !live.currentHold && live.holds.every(hold => hold.cancelledAt || hold.end < today);
}

/** Internal reporting only. An ambiguous mail attempt remains claimed and is never blindly replayed. */
export async function reportHoldingReviewOnce({ db, job, reason, observationFingerprint = "", send, now = () => new Date() }) {
  if (!digest(job.jobId) || typeof reason !== "string" || !reason ||
      observationFingerprint && !digest(observationFingerprint)) throw new Error("holding_review_identity_required");
  const fingerprint = holdingFingerprint(["holding_review_alert_v1", job.jobId, reason,
    observationFingerprint || job.ticketRevision || "source_unavailable"]);
  const ref = db.doc(`${ALERTS}/${fingerprint}`);
  const claimed = await db.runTransaction(async tx => {
    if ((await tx.get(ref)).exists) return false;
    tx.create(ref, { schemaVersion: 1, fingerprint, jobId: job.jobId, memberId: job.memberId || null,
      reason, observationFingerprint, status: "claimed_no_retry", claimedAt: now().toISOString() });
    return true;
  });
  if (!claimed) return { duplicateBlocked: true };
  try {
    const result = await send(fingerprint);
    if (result?.ok !== true || typeof result.messageId !== "string" || !result.messageId)
      throw new Error("holding_review_email_unconfirmed");
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.fingerprint !== fingerprint || current.status !== "claimed_no_retry")
        throw new Error("holding_review_claim_changed");
      tx.update(ref, { status: "sent", messageId: result.messageId, confirmedAt: now().toISOString() });
    });
    return { duplicateBlocked: false, messageId: result.messageId };
  } catch (error) {
    // Keep the pre-send claim even when the child or the acknowledgement fails after transport.
    throw error;
  }
}
