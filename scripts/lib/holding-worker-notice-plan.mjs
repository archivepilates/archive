import { automaticHoldingEvidence } from "./holding-notice-automatic.mjs";
import { automaticHoldingPeriodChangeEvidence, automaticHoldingPeriodChangeReadback } from "./holding-period-change-policy.mjs";
import { reconcileExistingHoldingAttempt, verifiedOperatorHoldingPlan } from "./holding-notice-operator-dispatch.mjs";

/** Called only after reconciling the exact original attempt; never writes queues or sends. */
export async function selectHoldingWorkerNoticePlan({ db, raw, config, member, originalPlan, originalProof,
  originalPrior, stamp, request, now = () => new Date(), reconcile = reconcileExistingHoldingAttempt,
  onPlanSelected = () => {} }) {
  const original = { plan: originalPlan, proof: originalProof, prior: originalPrior, isPeriodChange: false };
  if (!originalPrior) {
    automaticHoldingEvidence(raw, config, now());
    return original;
  }
  if (!originalPrior.deliveryComplete || config?.periodChangeNotice?.enabled !== true) return original;

  const originalSend = (await db.doc(`alimtalkSends/${originalPlan.id}`).get()).data();
  const history = await db.collection("alimtalkSends").where("memberPhone", "==", member.phone).limit(500).get();
  if (history.size >= 500) throw new Error("incomplete_holding_receipt_history");
  const completedChanges = history.docs.map(doc => doc.data());
  const proof = automaticHoldingPeriodChangeReadback(raw, config, originalSend, now(), completedChanges);
  if (!proof) return original;
  const plan = verifiedOperatorHoldingPlan(raw, member, { ...proof.approval, memberPhone: member.phone }, now());
  // Route reconciliation errors to this change, never to the delivered registration event.
  onPlanSelected(plan);
  const prior = await reconcile({ db, stamp, plan, request });
  if (!prior) automaticHoldingPeriodChangeEvidence(raw, config, originalSend, now(), completedChanges);
  return { plan, proof, prior, isPeriodChange: true };
}
