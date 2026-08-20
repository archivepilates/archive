#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const checks = [
  ["core/refunds/index.html", ["data-refund-dashboard", "환불 안내·동의서", "refundCountUsage", "refundPeriodRange", "refundPeriodRemaining", "refundPeriodUsage", "refundOptionalDetails", "refundResultBalance", "refundConfirmCheck", "refundSmsButton"]],
  ["core/assets/app.js", ["getStudioCollectionBy(db, runtime, \"refundCases\"", "refundConfirmCheck", "queueRefundStudioMateSms", "handleRefundSmsSend"]],
  ["firebase/kangsain-functions/functions/src/refund/refundPolicy.ts", ["archive-refund-studiomate-source-2026-08-20-v4", "REFUND_PENALTY_RATE = 0.1", "deriveRefundPeriodUsage", "remainingBalanceAmount", "remainingWeeks", "studiomate_period_weeks", "ARCHIVE PILATES 환불 예상금액 안내"]],
  ["firebase/kangsain-functions/firestore.rules", ["sameStudioClaim", "match /refundCases/{caseId}", "match /studiomateRefundSmsJobs/{jobId}"]],
  ["firebase/kangsain-functions/functions/src/refund/refundOperations.ts", ["eformsignRefundJobs", "studiomateRefundSmsJobs", "agreement_queued", "sms_queued", "request.data?.confirmed !== true", "automaticPeriodWeekUsage", "inferRefundTicketKind", "assertRefundRequestWindow", "searchRefundMembers", "resolveMemberById", "canonicalTicketKind === \"count\" ? \"studiomate_active_ticket\"", "sourceTicketSnapshot", "refundCaseId(staff.studioId, member.memberId, input.ticketKey)"]],
  ["scripts/lib/eformsign-refund-browser-contract.mjs", ["companySignature", "documentName", "documentId", "assertRefundJobStillWithinValidity", "assertRefundSourceUnchanged", "staleRefundJobRecoveryStatus", "extractEformsignDocumentId"]],
  ["scripts/process-eformsign-refund-jobs.mjs", ["if (config.loginOnly)", "authenticated = true", "recoverStaleJobs", "assertLiveRefundSource", "send_review_required", "acquireEformsignBrowserLock", "assertRefundJobStillWithinValidity", "eformsignDocumentId"]],
  ["firebase/kangsain-functions/macmini-studiomate/com.archive.eformsign-refund-queue.plist", ["process-eformsign-refund-jobs.mjs", "--apply"]],
  ["scripts/lib/studiomate-refund-sms-contract.mjs", ["assertRefundSmsSourceUnchanged", "classifyStudioMateSmsSendEvidence", "send_review_required"]],
  ["scripts/process-studiomate-refund-sms-jobs.mjs", ["studiomateRefundSmsJobs", "acquireStudioMateBrowserLock", "sendRefundSms", "send_review_required"]],
  ["firebase/kangsain-functions/macmini-studiomate/com.archive.studiomate-refund-sms-queue.plist", ["process-studiomate-refund-sms-jobs.mjs", "--apply"]],
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
