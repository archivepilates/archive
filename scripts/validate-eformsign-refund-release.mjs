#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const checks = [
  ["core/refunds/index.html", ["data-refund-dashboard", "환불 안내·동의서", "refundEligibilityCheck", "refundTicketKind\" required disabled"]],
  ["core/assets/app.js", ["getStudioCollectionBy(db, runtime, \"refundCases\"", "eligibilityReviewConfirmed"]],
  ["firebase/kangsain-functions/functions/src/refund/refundPolicy.ts", ["archive-refund-notion-2026-08-19-v1", "REFUND_PENALTY_RATE = 0.1"]],
  ["firebase/kangsain-functions/firestore.rules", ["sameStudioClaim", "match /refundCases/{caseId}"]],
  ["firebase/kangsain-functions/functions/src/refund/refundOperations.ts", ["eformsignRefundJobs", "agreement_queued", "eligibilityReviewConfirmed", "inferRefundTicketKind", "assertRefundRequestWindow", "sourceTicketSnapshot", "refundCaseId(staff.studioId, member.memberId, input.ticketKey)"]],
  ["scripts/lib/eformsign-refund-browser-contract.mjs", ["companySignature", "documentName", "documentId", "assertRefundJobStillWithinValidity", "assertRefundSourceUnchanged", "staleRefundJobRecoveryStatus", "extractEformsignDocumentId"]],
  ["scripts/process-eformsign-refund-jobs.mjs", ["if (config.loginOnly)", "authenticated = true", "recoverStaleJobs", "assertLiveRefundSource", "send_review_required", "acquireEformsignBrowserLock", "assertRefundJobStillWithinValidity", "eformsignDocumentId"]],
  ["firebase/kangsain-functions/macmini-studiomate/com.archive.eformsign-refund-queue.plist", ["process-eformsign-refund-jobs.mjs", "--apply"]],
];

const failures = [];
for (const [file, snippets] of checks) {
  if (!existsSync(file)) {
    failures.push(`missing ${file}`);
    continue;
  }
  const source = readFileSync(file, "utf8");
  for (const snippet of snippets) if (!source.includes(snippet)) failures.push(`${file} missing ${snippet}`);
}

if (failures.length) {
  console.error(`validate-eformsign-refund-release failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("validate-eformsign-refund-release passed");
