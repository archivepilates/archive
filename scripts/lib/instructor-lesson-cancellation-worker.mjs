import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./studiomate-browser-lock.mjs";
import { createInstructorCancellationBrowser } from "./instructor-lesson-cancellation-browser.mjs";
import { buildInstructorCancellationPlan, assertInstructorCancellationReadback } from "./instructor-lesson-cancellation-contract.mjs";
import { formatOperationsReport } from "./operations-email-format.mjs";

export const INSTRUCTOR_CANCELLATION_COLLECTION = "studiomateInstructorLessonCancellations";
const blocked = registration => Boolean(registration?.cancellation?.jobId);
const time = value => value?.toMillis?.() || Date.parse(value || "") || 0;

export async function runInstructorCancellationJob({ db, admin, ref, adapter, now = () => new Date(), notify = notifyReview }) {
  const stamp = () => admin.firestore.FieldValue.serverTimestamp();
  const token = randomUUID();
  const job = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const row = snapshot.data();
    if (!row || row.status !== "pending" || row.externalEffectStarted) return null;
    const registration = await tx.get(db.doc(`instructorLessonRegistrations/${row.registrationId}`));
    if (!blocked(registration.data()) || registration.data().cancellation.jobId !== ref.id) return null;
    tx.update(ref, { status: "processing", claimToken: token, claimedAt: stamp(), updatedAt: stamp(),
      leaseExpiresAt: admin.firestore.Timestamp.fromMillis(now().getTime() + 10 * 60_000) });
    tx.update(registration.ref, { "cancellation.status": "processing", updatedAt: stamp() });
    return { ...row, jobId: ref.id };
  });
  if (!job) return { status: "not_claimed", jobId: ref.id };
  const registrationRef = db.doc(`instructorLessonRegistrations/${job.registrationId}`);
  async function commit(patch, registrationPatch) {
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      const registration = await tx.get(registrationRef);
      if (current.data()?.claimToken !== token || current.data()?.status !== "processing"
        || registration.data()?.cancellation?.jobId !== ref.id) throw new Error("취소 작업 소유권이 변경됐습니다.");
      tx.update(ref, { ...patch, updatedAt: stamp() });
      if (registrationPatch) tx.update(registrationRef, { ...registrationPatch, updatedAt: stamp() });
    });
  }
  try {
    const currentProfile = (await db.doc(job.profilePath).get()).data();
    if (!currentProfile || String(currentProfile.studioId) !== job.studioId
      || String(currentProfile.phone || "").replace(/\D/g, "") !== job.memberPhone
      || String(currentProfile.name || currentProfile.memberName || "") !== job.memberName
      || job.paymentRefundAllowed !== false || !job.requestedBy?.staffId
      || now().getTime() - time(job.createdAt) > 24 * 3600_000) throw new Error("취소 승인·회원 원본 또는 요청 유효기간 확인 필요");
    const plannedAt = now();
    const first = buildInstructorCancellationPlan(job, await adapter.read(job), plannedAt);
    const latest = await adapter.read(job);
    buildInstructorCancellationPlan(job, latest, now());
    const fresh = buildInstructorCancellationPlan(job, latest, plannedAt);
    if (first.fingerprint !== fresh.fingerprint) throw new Error("수강권 또는 예약이 확인 중 변경됐습니다.");
    await adapter.disable(job, fresh, async () => {
      await commit({ externalEffectStarted: true, effectType: "native_ticket_disable_with_booking_cascade",
        effectStartedAt: stamp(), userTicketId: fresh.userTicketId, planFingerprint: fresh.fingerprint,
        approvedBookingKeys: fresh.snapshot.bookings.rows.map(row => row.key) });
    });
    await commit({ nativeAccepted: true });
    const verified = assertInstructorCancellationReadback(fresh, await adapter.read(job));
    assertInstructorCancellationReadback(fresh, await adapter.read(job));
    await commit({ status: "completed", nativeVerified: true, completedAt: stamp(), lastError: null,
      verification: verified }, { status: "cancelled", "cancellation.status": "completed",
      "cancellation.nativeVerified": true, "cancellation.userTicketId": fresh.userTicketId,
      "cancellation.completedAt": stamp(), "cancellation.lastError": null,
      nextAction: "수강권·예약 취소 완료 · 결제 환불은 별도 확인", lastError: null });
    return { jobId: ref.id, status: "completed", nativeVerified: true };
  } catch (error) {
    const detail = String(error.message || "취소 결과 확인 필요").slice(0, 300);
    await commit({ status: "review_required", lastError: detail }, { status: "cancellation_review",
      "cancellation.status": "review_required", "cancellation.lastError": detail,
      nextAction: "StudioMate 취소 원본 확인 · 자동 재시도 금지", lastError: detail });
    await notify({ jobId: ref.id, detail, memberId: job.memberId });
    return { jobId: ref.id, status: "review_required", error: detail };
  }
}

export async function processInstructorLessonCancellations({ db, admin, apply, profileDir, headless = true, limit = 1,
  adapterFactory = createInstructorCancellationBrowser, browserFactory, notify = notifyReview,
  acquireLock = acquireStudioMateBrowserLock }) {
  if (!apply) return { processed: 0, reviewRequired: 0, mode: "dry-run" };
  const collection = db.collection(INSTRUCTOR_CANCELLATION_COLLECTION);
  const processing = await collection.where("status", "==", "processing").limit(20).get();
  const candidates = await collection.where("status", "==", "pending").limit(Math.max(1, Math.min(5, limit))).get();
  const results = [];
  if (processing.empty && candidates.empty) return { processed: 0, reviewRequired: 0, results };
  let context;
  let release;
  try { release = await acquireLock({ owner: "instructor-lesson-cancellation", waitMs: 0 }); }
  catch (error) {
    if (String(error.message).includes("browser profile is locked by")) return { processed: 0, reviewRequired: 0, deferred: true };
    throw error;
  }
  try {
  // Recovery shares the same browser lock: it cannot invalidate an owner between checkpoint and click.
  for (const doc of processing.docs) {
    const row = doc.data();
    if (time(row.leaseExpiresAt) > Date.now()) continue;
    let changed = false;
    await db.runTransaction(async tx => {
      changed = false;
      const fresh = (await tx.get(doc.ref)).data();
      if (fresh?.status !== "processing" || time(fresh.leaseExpiresAt) > Date.now()) return;
      const r = db.doc(`instructorLessonRegistrations/${fresh.registrationId}`);
      const registration = await tx.get(r);
      if (registration.data()?.cancellation?.jobId !== doc.id) return;
      const patch = { lastError: "취소 작업 중단 후 결과 확인 필요 · 자동 재시도 금지", updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      tx.update(doc.ref, { ...patch, status: "review_required" });
      tx.update(r, { ...patch, status: "cancellation_review", "cancellation.status": "review_required", "cancellation.lastError": patch.lastError });
      changed = true;
    });
    if (changed) {
      results.push({ jobId: doc.id, status: "review_required", recovered: true });
      await notify({ jobId: doc.id, memberId: row.memberId, detail: "취소 작업 임대 만료 · 원본 조회 후 확인 필요" });
    }
  }
  if (!candidates.empty) {
      const launch = browserFactory || (async () => {
        const { chromium } = await import("playwright");
        return chromium.launchPersistentContext(profileDir, { headless, serviceWorkers: "block" });
      });
      context = await launch();
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      for (const doc of candidates.docs) {
        results.push(await runInstructorCancellationJob({ db, admin, ref: doc.ref, adapter: adapterFactory(page), notify }));
      }
  }
  } finally {
      let closed = !context;
      try { if (context) { await context.close(); closed = true; } }
      finally { if (closed) await release(); }
  }
  return { processed: results.length, reviewRequired: results.filter(r => r.status === "review_required").length, results };
}

async function notifyReview({ jobId, detail, memberId }) {
  const report = formatOperationsReport({ area: "강사레슨", status: "확인필요", title: "수강 취소 원본 확인",
    observedAt: new Date().toISOString(), context: "ARCHIVE CORE / 강사레슨 취소",
    conclusion: "수강권·예약 취소 결과 확인이 필요합니다. 자동 재실행하지 않습니다.",
    key: [`원인: ${detail}`, `원천: ${INSTRUCTOR_CANCELLATION_COLLECTION}/${jobId}`],
    verification: ["사용불가 처리·예약 취소 완료 여부 미확정"], caution: ["결제 환불은 실행하지 않으며, 이미 처리됐을 수 있는 취소를 반복하지 않습니다."],
    next: ["StudioMate에서 해당 수강권과 예약 상태를 확인하세요."],
    details: ["https://core.archivepilates.com/instructor-lessons/", `https://arcpilates.studiomate.kr/users/detail?id=${memberId}`] });
  try {
    execFileSync(process.execPath, ["firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs"], {
      cwd: new URL("../../", import.meta.url), timeout: 45000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GOOGLE_SERVICE_ACCOUNT_KEY: path.join(os.homedir(), "ArchiveIN/secrets/google/archive-codex-operator.json"),
        AUTOMATION_REPORT_FROM: "home@archivepilates.com", AUTOMATION_REPORT_TO: "home@archivepilates.com",
        AUTOMATION_REPORT_SUBJECT: report.subject, AUTOMATION_REPORT_LABEL: "자동화 확인필요", AUTOMATION_REPORT_BODY: report.body },
    });
  } catch { console.error(`강사레슨 취소 확인 메일 전송 확인 필요: ${jobId}`); }
}
