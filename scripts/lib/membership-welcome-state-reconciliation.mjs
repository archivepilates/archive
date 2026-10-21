import { createHash } from "node:crypto";

const template = "KA01TP260914091233543JoFDsn7KfCr";
export function planWelcomeStateReconciliation({ contractId, memberId, contract, candidate, send }) {
  const block = (reason) => ({ eligible: false, reason });
  if (!/^[a-f0-9]{64}$/.test(contractId || "") || !/^[1-9]\d*$/.test(memberId || "")) return block("invalid_exact_identity");
  if (!contract || contract.contractId !== contractId || contract.source !== "studiomate_native_contract" ||
      contract.studioId !== "5330" || contract.bindingVerified !== true || contract.status !== "signed" ||
      contract.completion?.memberId !== memberId || contract.binding?.memberId !== memberId) return block("source_identity_mismatch");
  const phone = String(contract.completion?.memberPhone || "").replace(/\D/g, "");
  if (!/^01[016789]\d{7,8}$/.test(phone) || String(contract.binding?.memberPhone || "").replace(/\D/g, "") !== phone)
    return block("source_phone_mismatch");
  const candidateId = `membership_welcome_${createHash("sha256").update(JSON.stringify(["5330", "new_member_welcome", phone])).digest("hex")}`;
  if (contract.welcomeCandidateId !== candidateId || !candidate || candidate.candidateId !== candidateId ||
      candidate.type !== "membership_welcome" || candidate.templateCode !== template || candidate.studioId !== "5330" ||
      candidate.memberId !== memberId || candidate.memberName !== contract.memberName ||
      String(candidate.memberPhone || "").replace(/\D/g, "") !== phone || candidate.payload?.sourceContractId !== contractId)
    return block("candidate_identity_mismatch");
  if (!send || send.candidateId !== candidateId || send.templateCode !== template || send.memberId !== memberId ||
      send.studioId !== "5330" || (send.memberPhone && String(send.memberPhone).replace(/\D/g, "") !== phone))
    return block("send_identity_mismatch");
  if (contract.welcomeStatus === "review") return block("already_review");
  if (contract.welcomeStatus !== "queued" || candidate.status !== "failed" || send.status !== "failed" ||
      !candidate.lastError || candidate.lastError !== send.lastError) return block("outcome_not_verified_failed");
  // Correct only the stale display state. Attempts, claims and all provider evidence are untouched.
  return { eligible: true, candidateId, reason: String(candidate.lastError), patch: {
    welcomeStatus: "review", welcomeReason: String(candidate.lastError),
  } };
}
