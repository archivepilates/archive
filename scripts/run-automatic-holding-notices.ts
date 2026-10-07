import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "../firebase/kangsain-functions/functions/src/config/firebase";
import { nowTimestamp } from "../firebase/kangsain-functions/functions/src/utils/date";
import { automaticMemberExclusionReason } from "../firebase/kangsain-functions/functions/src/alimtalk/recipientExclusion";
import { normalizeRecipientPhone } from "../firebase/kangsain-functions/functions/src/alimtalk/testRecipients";
import { HOLDING_NOTICE_TEMPLATE_ID, holdingTemplateIssue } from "./lib/holding-allowance-notice.mjs";
import { holdingFingerprint } from "./lib/studiomate-holding-source.mjs";
import { HOLDING_ROSTER_JOBS, HOLDING_ROSTER_STATE, holdingRosterReadbackIssue, holdingRosterReadbackIsCurrent } from "./lib/studiomate-holding-roster.mjs";
import { HOLDING_AUTO_EVENTS, holdingAutomaticConfigIssue, automaticHoldingEvidence, automaticHoldingEvent } from "./lib/holding-notice-automatic.mjs";
import { dispatchVerifiedOperatorHolding, reconcileVerifiedOperatorHolding, verifiedOperatorHoldingPlan } from "./lib/holding-notice-operator-dispatch.mjs";
import { recordAutomationStatus } from "./lib/archive-core-ops-logging.mjs";
import { createHoldingWorkerDeadline, selectHoldingWorkerJobs, loadHoldingReceiptCandidates,
  recordHoldingReceiptCheck, transitionHoldingWorkerEvent, runHoldingWorkerChild } from "./lib/holding-automatic-worker-state.mjs";

const apply = process.argv.includes("--apply");
const settingsRef = db.doc("settings/holdingNotice");
async function main() {
  const deadline = createHoldingWorkerDeadline();
  const stop = () => deadline.stop(new Error("holding_worker_stopped"));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try { await run(deadline); }
  finally {
    deadline.dispose();
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    try { await db.terminate(); }
    catch {
      console.error("holding_worker_firestore_termination_failed");
      process.exitCode = 1;
    }
  }
}
async function run(deadline: ReturnType<typeof createHoldingWorkerDeadline>) {
  if (process.argv.slice(2).some(arg => arg !== "--apply")) throw new Error("Unknown argument");
  const credential = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS || "", "utf8"));
  if (credential.project_id !== "archive-pilates" || credential.client_email !== "archive-codex-operator@archive-pilates.iam.gserviceaccount.com" ||
      (process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT) !== "archive-pilates") throw new Error("Expected archive-pilates operator account");
  const config = (await settingsRef.get()).data();
  const issue = holdingAutomaticConfigIssue(config);
  if (issue) {
    console.log(JSON.stringify({ ok: true, mode: "automatic-live-readback", skipped: issue, sendAllowed: false }));
    return;
  }
  const baselineRef = db.doc(HOLDING_ROSTER_STATE);
  const baseline = (await baselineRef.get()).data();
  const age = Date.now() - Date.parse(baseline?.downloadedAt);
  if (baseline?.schemaVersion !== 2 || baseline.mode !== "discovery_only" || baseline.initializedAt !== config!.baselineInitializedAt ||
      !Number.isFinite(age) || age < 0 || age > 90 * 60_000) throw new Error("fresh_automatic_holding_roster_required");
  const pending = await db.collection(HOLDING_ROSTER_JOBS).where("status", "==", "pending").limit(401).get();
  if (pending.size > 400) throw new Error("holding_readback_backlog_review_required");
  const jobs = selectHoldingWorkerJobs(pending.docs.map(doc => ({ ...doc.data(), jobId: doc.id })));
  const child = (command: string, args: string[], maxMs: number, env = process.env) => runHoldingWorkerChild(command, args,
    { deadline, maxMs, env, onCleanupSlow: () => console.error("holding_worker_child_cleanup_pending; waiting without SIGKILL") }) as Promise<string>;
  const secret = async (name: string) => (await child("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`,
    "--project=archive-pilates", "--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com"],
    20000)).trim();
  let credentials: { key: string; secret: string } | undefined;
  const request = async (url: string, method = "GET", body?: unknown) => {
    if (method === "POST" && !apply) throw new Error("dry_run_cannot_send");
    deadline.timeout(20000);
    credentials ||= { key: await secret("SOLAPI_API_KEY"), secret: await secret("SOLAPI_API_SECRET") };
    const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
    const signature = createHmac("sha256", credentials.secret).update(date + salt).digest("hex");
    const response = await fetch(`https://api.solapi.com${url}`, { method,
      headers: { Authorization: `HMAC-SHA256 apiKey=${credentials.key}, date=${date}, salt=${salt}, signature=${signature}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([deadline.signal, AbortSignal.timeout(deadline.timeout(20_000))]) });
    if (!response.ok) throw new Error(`holding_provider_http_${response.status}`);
    return response.json();
  };
  const readLatest = async ({ memberId, ticketName }: { memberId: string; ticketName: string }) => {
    // Leave cleanup time inside the same deadline; never SIGKILL a collector holding the shared profile.
    const output = await child(process.execPath, ["scripts/collect-studiomate-holding-source.mjs", "--member-id", memberId,
      "--ticket-name", ticketName, "--stdout"], Math.min(120000, deadline.remaining() - 30_000));
    const response = JSON.parse(output.trim());
    if (response.ok !== true || response.mode !== "read-only-memory" || response.raw?.memberId !== memberId || response.raw?.ticketName !== ticketName)
      throw new Error("automatic_live_readback_scope_mismatch");
    return response.raw;
  };
  const results: any[] = [];
  const eventStatus = (id: string, status: string, promoted = true) => transitionHoldingWorkerEvent({ db,
    eventsCollection: HOLDING_AUTO_EVENTS, id, status, promoted });
  // Receipts may complete after the browser run exits. This pass is GET-only, never a send retry.
  if (apply) {
    const open = await loadHoldingReceiptCandidates({ db, eventsCollection: HOLDING_AUTO_EVENTS, deadline,
      onUnresolved: (row: any) => results.push({ ...row, status: "review" }) });
    for (const event of open) {
      if (deadline.remaining() < 30_000) break;
      await recordHoldingReceiptCheck({ db, id: event.id });
      try {
        const checked = await reconcileVerifiedOperatorHolding({ db, stamp: nowTimestamp, id: event.id, request });
        if (checked.deliveryComplete) {
          await eventStatus(event.id, "delivered");
          results.push({ id: event.id, status: "delivered", receiptOnly: true });
        }
        else if (["FAILED", "DELETED", "REJECTED"].includes(checked.providerStatus) ||
            checked.providerStatus === "COMPLETE" && String(checked.providerStatusCode) !== "4000")
          throw new Error(`holding_receipt_terminal_failure:${checked.providerStatusCode}`);
      } catch (error: any) {
        await recordHoldingReceiptCheck({ db, id: event.id, error: error.message });
        results.push({ id: event.id, status: "review", reason: error.message });
      }
    }
  }
  const mark = async (job: any, status: string, reason: string) => {
    if (!apply) return;
    await db.runTransaction(async tx => {
      const ref = db.doc(`${HOLDING_ROSTER_JOBS}/${job.jobId}`), current = (await tx.get(ref)).data();
      if (holdingRosterReadbackIsCurrent(current, job))
        tx.update(ref, { status, reason, lastCheckedAt: new Date().toISOString(), sendAllowed: false });
    });
  };
  for (const job of jobs) {
    if (deadline.remaining() < 60_000) break;
    let eventId: string | undefined;
    let promoted = false;
    try {
      const profile = (await db.doc(`memberProfiles/${job.memberId}`).get()).data();
      const invalid = holdingRosterReadbackIssue(job, profile);
      if (invalid) throw new Error(invalid);
      if (job.sourceImportId !== baseline.sourceImportId || job.downloadedAt !== baseline.downloadedAt)
        throw new Error("holding_orphan_discovery_hint_excluded");
      if (job.transition === "left" || job.baselineOnly === true) {
        await mark(job, "observed", "holding_baseline_or_absent_no_send");
        results.push({ memberId: job.memberId, status: "excluded", reason: "baseline_or_absent" }); continue;
      }
      const staff = await db.collection("staffs").where("studioId", "==", "5330").where("active", "==", true).get();
      const exclusion = automaticMemberExclusionReason(profile as any,
        new Set(staff.docs.map(doc => normalizeRecipientPhone(doc.data().phone || ""))));
      if (exclusion) {
        await mark(job, "observed", exclusion);
        results.push({ memberId: job.memberId, status: "excluded", reason: exclusion }); continue;
      }
      const raw = await readLatest(job);
      const proof = automaticHoldingEvidence(raw, config);
      const approval = { ...proof.approval, memberPhone: profile!.phone };
      const plan = verifiedOperatorHoldingPlan(raw, profile, approval);
      eventId = plan.id;
      const event = automaticHoldingEvent(plan, proof.selected, config);
      if (!apply) { results.push({ memberId: job.memberId, status: "verified_no_send", id: plan.id }); continue; }
      const eventRef = db.doc(`${HOLDING_AUTO_EVENTS}/${plan.id}`);
      await db.runTransaction(async tx => {
        deadline.timeout(1);
        const currentConfig = (await tx.get(settingsRef)).data();
        const currentBaseline = (await tx.get(baselineRef)).data();
        const currentJob = (await tx.get(db.doc(`${HOLDING_ROSTER_JOBS}/${job.jobId}`))).data();
        const currentEvent = await tx.get(eventRef);
        if (holdingFingerprint(currentConfig) !== holdingFingerprint(config) || holdingAutomaticConfigIssue(currentConfig) ||
            currentBaseline?.sourceImportId !== job.sourceImportId || currentBaseline.downloadedAt !== job.downloadedAt ||
            !holdingRosterReadbackIsCurrent(currentJob, job)) throw new Error("holding_promotion_source_changed");
        if (!currentEvent.exists) tx.create(eventRef, event);
      });
      promoted = true;
      // From this point the canonical event, not the provisional hint, authorizes a send.
      const priorSend = (await db.doc(`alimtalkSends/${plan.id}`).get()).data();
      const priorClaim = (await db.doc(`holdingNoticeClaims/${plan.id}`).get()).data();
      if (priorSend || priorClaim) {
        if (priorSend?.solapiMessageId) {
          const receipt = await reconcileVerifiedOperatorHolding({ db, stamp: nowTimestamp, id: plan.id, request });
          if (receipt.deliveryComplete) await eventStatus(plan.id, "delivered");
        }
        else throw new Error("holding_prior_claim_reconciliation_required");
        await mark(job, "observed", "holding_prior_attempt_no_resend");
        results.push({ memberId: job.memberId, status: "duplicate_blocked", id: plan.id }); continue;
      }
      const template = await request(`/kakao/v2/templates/${HOLDING_NOTICE_TEMPLATE_ID}`);
      const templateIssue = holdingTemplateIssue(template);
      if (templateIssue) throw new Error(templateIssue);
      const result = await dispatchVerifiedOperatorHolding({ db, stamp: nowTimestamp, plan, template, request, readLatest, automatic: true,
        recipientIssue: async (tx: FirebaseFirestore.Transaction, member: any) => {
          const staff = await tx.get(db.collection("staffs").where("studioId", "==", "5330").where("active", "==", true));
          return automaticMemberExclusionReason(member, new Set(staff.docs.map(doc => normalizeRecipientPhone(doc.data().phone || ""))));
        } });
      if (result.deliveryComplete) await eventStatus(plan.id, "delivered");
      await mark(job, "observed", result.deliveryComplete ? "holding_delivered" : "holding_accepted_check_receipt_only");
      results.push({ memberId: job.memberId, status: result.deliveryComplete ? "delivered" : result.duplicateBlocked ? "duplicate_blocked" : "accepted", id: result.id });
    } catch (error: any) {
      const reason = error.message || "holding_automatic_failed";
      if (deadline.signal.aborted || reason === "holding_worker_deadline_reached" || reason === "holding_worker_child_timeout") {
        if (eventId && await eventStatus(eventId, "reconciliation_required", promoted))
          results.push({ id: eventId, status: "review", reason: "holding_worker_stopped_after_claim_reconciliation_required" });
        await mark(job, "pending", "holding_worker_deadline_deferred");
        break;
      }
      const historical = reason === "holding_historical_registration_excluded";
      await mark(job, historical ? "observed" : "review", reason);
      results.push({ memberId: job.memberId, status: historical ? "excluded" : "review", reason, ...(eventId ? { id: eventId } : {}) });
      if (apply && !historical) {
        if (eventId) await eventStatus(eventId, "reconciliation_required", promoted);
        const body = [`주체: ARCHIVE IN / 홀딩 신규 자동발송`, `결론: 회원 ${job.memberId} 홀딩 안내를 보류했습니다.`,
          `발생: ${new Date().toISOString()}`, `원인: ${reason}`, `현재: 후보·접수 여부 확인 필요. 자동 재발송하지 않습니다.`,
          `원천: 회원 ${job.memberId} / ${job.sourceImportId}${eventId ? ` / ${eventId}` : ""}`,
          `상세: https://arcpilates.studiomate.kr/users/detail?id=${job.memberId}`,
          "다음: 최초 발급·실제 정지기간과 발송 원장을 확인하세요."].join("\n");
        try {
          await child(process.execPath, ["firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs"], 45000, { ...process.env,
              AUTOMATION_REPORT_FROM: "home@archivepilates.com", AUTOMATION_REPORT_TO: "home@archivepilates.com",
              AUTOMATION_REPORT_EVENT_ID: `holding_auto_review_${holdingFingerprint([job.jobId, reason])}`,
              AUTOMATION_REPORT_SUBJECT: "[홀딩 안내][확인필요] 원본·발송 원장 확인 필요",
              AUTOMATION_REPORT_LABEL: "자동화 확인필요", AUTOMATION_REPORT_BODY: body });
        } catch { results.push({ memberId: job.memberId, status: "review", reason: "holding_review_email_unconfirmed" }); }
      }
    }
  }
  const receiptReviews = results.filter(row => row.status === "review" && !row.memberId);
  if (apply && receiptReviews.length && deadline.remaining() > 5_000) {
    try {
      await child(process.execPath, ["firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs"], 45000, { ...process.env,
        AUTOMATION_REPORT_FROM: "home@archivepilates.com", AUTOMATION_REPORT_TO: "home@archivepilates.com",
        AUTOMATION_REPORT_EVENT_ID: `holding_receipt_review_${holdingFingerprint(receiptReviews.map(row => [row.id, row.reason]))}`,
        AUTOMATION_REPORT_SUBJECT: "[홀딩 안내][확인필요] 접수 원장 확인 필요",
        AUTOMATION_REPORT_LABEL: "자동화 확인필요",
        AUTOMATION_REPORT_BODY: ["주체: ARCHIVE IN / 홀딩 신규 자동발송", "결론: 접수 결과 대조를 완료하지 못했습니다. 재발송하지 않습니다.",
          `확인필요: ${receiptReviews.length}건`, ...receiptReviews.slice(0, 10).map(row => `원천: ${row.id} / 원인: ${row.reason}`),
          "현재: 기존 발송·클레임 유지. 원장 대조만 재확인합니다.",
          "상세: https://console.firebase.google.com/project/archive-pilates/firestore/databases/-default-/data/~2FholdingNoticeEvents",
          "다음: 해당 발송 원장과 접수 결과를 확인하세요."].join("\n") });
    } catch { results.push({ status: "review", reason: "holding_receipt_review_email_unconfirmed" }); }
  }
  const review = results.filter(row => row.status === "review");
  if (apply) await recordAutomationStatus(db, { automationId: "holding-notice-automatic", title: "수강권 홀딩 자동 안내",
    ownerArea: "alimtalk", status: review.length ? "warning" : "healthy",
    lastResult: `전달 ${results.filter(row => row.status === "delivered").length} · 접수 ${results.filter(row => row.status === "accepted").length} · 확인필요 ${review.length}`,
    warnings: review.map(row => `${row.memberId || row.id || "worker"}: ${row.reason}`) });
  console.log(JSON.stringify({ ok: true, mode: apply ? "automatic-live-readback" : "dry-run-no-send", results,
    reviewRequired: review.length, deferred: pending.size - results.filter(row => row.memberId && row.reason !== "holding_review_email_unconfirmed").length,
    deadlineReached: deadline.remaining() === 0, sendAllowed: apply && !deadline.signal.aborted }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
