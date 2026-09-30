import { createHash } from "node:crypto";
import { CONTRACT_LANE, isFreshContractDiscoverySource } from "./studiomate-membership-contract-observer.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Hints only schedule native readback. They never authorize a contract or send.
export async function loadPendingContractDiscovery({ db, discovery, source, now = Date.now() }) {
  if (discovery?.ok !== true || !isFreshContractDiscoverySource(source, now)) return discovery;
  const snap = await db.collection("workLanes").doc(CONTRACT_LANE)
    .collection("purchaseHints").where("status", "==", "native_verification_required").limit(200).get();
  const all = snap.docs.map((doc) => ({ ...doc.data(), hintId: doc.id }));
  const valid = (hint) =>
    /^[a-f0-9]{64}$/.test(hint.phoneFingerprint || "") &&
    /^[a-f0-9]{64}$/.test(hint.fingerprint || "") &&
    hint.hintId === hash([hint.phoneFingerprint, hint.fingerprint]) &&
    Number.isFinite(Date.parse(hint.previousDownloadedAt)) &&
    Date.parse(hint.previousDownloadedAt) < Date.parse(hint.sourceDownloadedAt) &&
    Date.parse(hint.sourceDownloadedAt) <= Date.parse(source.downloadedAt);
  const invalid = all.filter((hint) => !valid(hint));
  if (invalid.length) {
    const batch = db.batch();
    for (const hint of invalid) batch.update(db.doc(`workLanes/${CONTRACT_LANE}/purchaseHints/${hint.hintId}`), {
      status: "review", reason: "invalid_pending_contract_hint", updatedAt: new Date(now),
    });
    await batch.commit();
  }
  const candidates = all.filter((hint) => valid(hint) && !discovery.coverageLossIds?.includes(hint.phoneFingerprint))
    .sort((a, b) => a.sourceDownloadedAt.localeCompare(b.sourceDownloadedAt) || a.hintId.localeCompare(b.hintId));
  const byPhone = new Map();
  for (const hint of candidates) if (!byPhone.has(hint.phoneFingerprint)) byPhone.set(hint.phoneFingerprint, hint);
  const pending = [...byPhone.values()].slice(0, 5);
  return {
    ...discovery,
    candidates: pending.length,
    pendingCount: candidates.length,
    pendingScanLimited: snap.size === 200,
    invalidPendingCount: invalid.length,
    sourceDownloadedAt: source.downloadedAt,
    candidateFingerprints: pending.map((h) => h.phoneFingerprint),
    candidateHints: pending.map((h) => ({
      hintId: h.hintId, phoneFingerprint: h.phoneFingerprint,
      previousDownloadedAt: h.previousDownloadedAt,
    })),
  };
}
