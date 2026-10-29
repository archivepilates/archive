#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createSign, randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { appendIdleHeartbeatIfDue } from "./lib/idle-heartbeat.mjs";
import { deriveInstructorLessonRegistrationState } from "./lib/instructor-lesson-registration-contract.mjs";
import { applySignupBirthDate, assertSignupProfileSource, signupProfileMemoPresent } from "./lib/instructor-signup-profile.mjs";
import { assertSignupProfileV2Source } from "./lib/instructor-signup-profile-v2.mjs";
import { applySignupProfileV2 } from "./lib/instructor-signup-profile-v2-writer.mjs";
import { assertHoldingMemoWriteSource, holdingMemoContentPresent, assertHoldingMemoMemberProfile, pendingHoldingMemoAlerts, settleHoldingMemoAlert } from "./lib/holding-delivery-memo.mjs";
import { preparePendingMemberOperations } from "./lib/member-operation-service.mjs";
import { readHoldingMemberProfile } from "./lib/holding-member-identity.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const limit = Number(valueArg("--limit") || process.env.STUDIOMATE_MEMO_WRITE_LIMIT || "10");
const jobId = valueArg("--job-id") || process.env.STUDIOMATE_MEMO_WRITE_JOB_ID || "";
const signupSelectorFlags=process.argv.slice(2).filter(arg=>arg==='--signup-job-ids'||arg.startsWith('--signup-job-ids='));
const signupJobIds = valueArg('--signup-job-ids') ? valueArg('--signup-job-ids').split(',') : [];
if(signupSelectorFlags.length&&(signupSelectorFlags.length!==1||!signupJobIds.length))throw new Error('Missing or duplicate bounded signup selector');
if (signupJobIds.length && (jobId || signupJobIds.length>10 || new Set(signupJobIds).size!==signupJobIds.length
  || signupJobIds.some(id=>!/^instructor_member_completion_[a-f0-9]{32}$/.test(id)))) throw new Error('Invalid bounded signup memo selection');
const config = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates",
  baseUrl: process.env.STUDIOMATE_WEB_BASE_URL || "https://arcpilates.studiomate.kr",
  apiBaseUrl: process.env.STUDIOMATE_API_BASE_URL || "https://api.studiomate.kr",
  profileDir: expandHome(process.env.STUDIOMATE_EMERGENCY_PROFILE_DIR || "~/ArchiveIN/automation/browser-profile"),
  runLogPath: expandHome(process.env.STUDIOMATE_MEMO_WRITE_RUN_LOG || "~/ArchiveIN/emergency/runs/studiomate-memo-write.jsonl"),
  headless: process.env.HEADLESS !== "false",
  waitForLogin: process.env.WAIT_FOR_LOGIN === "true",
  operatorEmail: process.env.ARCHIVE_OPERATOR_EMAIL || "home@archivepilates.com",
  delegatedUser: process.env.GOOGLE_DELEGATED_USER || "home@archivepilates.com",
  googleCredentialsPath:
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json",
};

if (!admin.apps.length) admin.initializeApp({ projectId: config.projectId });
const db = admin.firestore();

const result = {
  ok: false,
  mode: apply ? "apply" : "dry-run",
  source: "studiomate_memo_playwright_queue",
  startedAt: new Date().toISOString(),
  processed: 0,
  written: 0,
  skipped: 0,
  failed: 0,
  jobId: jobId || null,
  jobs: [],
};

await mkdir(config.profileDir, { recursive: true });
await mkdir(path.dirname(config.runLogPath), { recursive: true });

// Explicit acceptance/delivery policies share the existing outbox; no historical backfill.
if (apply && !jobId && !signupJobIds.length) {
  try {
    result.holdingMemoProjection = await preparePendingMemberOperations({db,stamp:()=>admin.firestore.Timestamp.now()});
    for (const alert of await pendingHoldingMemoAlerts(db)) {
      if (!result.holdingMemoProjection.some(item=>item.id===alert.id)) result.holdingMemoProjection.push(alert);
    }
  } catch {
    result.holdingMemoProjection = [{status:"review",reason:"holding_memo_outbox_read_unavailable"}];
  }
  for (const item of result.holdingMemoProjection.filter(item=>item.status==="review")) {
    result.failed += 1;
    if (!item.id) {
      if (!reportHoldingMemoProjection(item)) result.holdingMemoEmailUnconfirmed=true;
      continue;
    }
    try {
      const ref=db.doc(`alimtalkSends/${item.id}`), ledger=(await ref.get()).data();
      if (ledger?.holdingMemoStatus!=="review") {
        await settleHoldingMemoAlert({db,stamp:()=>admin.firestore.Timestamp.now(),id:item.id,observed:ledger,status:"resolved"});
        continue;
      }
      if (!ledger?.holdingMemoFailureEmailSentAt) {
        if (!reportHoldingMemoProjection(item)) throw new Error("holding_memo_alert_delivery_unconfirmed");
        await settleHoldingMemoAlert({db,stamp:()=>admin.firestore.Timestamp.now(),id:item.id,observed:ledger,status:"sent"});
      } else {
        await settleHoldingMemoAlert({db,stamp:()=>admin.firestore.Timestamp.now(),id:item.id,observed:ledger,status:"sent"});
      }
    } catch { result.holdingMemoEmailUnconfirmed=true; }
  }
}

function reportHoldingMemoProjection(item) {
  const day=new Date(Date.now()+9*3600_000).toISOString().slice(0,10);
  const eventKey=item.id?`holding_memo_projection_review:${item.id}`:`holding_memo_outbox_read_unavailable:${day}`;
  const eventId=createHash("sha256").update(eventKey).digest("hex");
  const report=spawnSync(process.execPath,[fileURLToPath(new URL("../firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs",import.meta.url))],{
    encoding:"utf8",timeout:45000,maxBuffer:1024*1024,env:{...process.env,GOOGLE_SERVICE_ACCOUNT_KEY:config.googleCredentialsPath,
      AUTOMATION_REPORT_FROM:config.delegatedUser,AUTOMATION_REPORT_TO:config.operatorEmail,AUTOMATION_REPORT_EVENT_ID:eventId,
      AUTOMATION_REPORT_SUBJECT:item.id?"[홀딩 안내][확인필요] 회원 메모 원본 확인 필요":"[홀딩 안내][실패] 회원 메모 원장 조회 실패",
      AUTOMATION_REPORT_LABEL:item.id?"자동화 확인필요":"자동화 실패",
      AUTOMATION_REPORT_BODY:["주체: ARCHIVE CORE / 홀딩 안내 메모","결론: 발송 안내 메모 생성 또는 원장 조회를 완료하지 못했습니다.",
        `원인: ${item.reason}`,`원천: ${item.id?`alimtalkSends/${item.id}`:"alimtalkSends / holdingMemoStatus=ready"}`,
        "현재: 다른 메모 작업은 계속 처리하며 알림톡을 재발송하지 않습니다.",
        "상세: https://core.archivepilates.com/automation/","다음: 회원 연결·전달 원장·네트워크와 메모 처리기 로그를 확인하세요."].join("\n")}});
  return report.status===0;
}
const jobs = await loadPendingJobs(limit);
if (!jobs.length) {
  result.ok = result.failed===0;
  result.finishedAt = new Date().toISOString();
  appendIdleHeartbeatIfDue(config.runLogPath, result, 15 * 60 * 1000);
  process.exit(result.ok?0:1);
}

let releaseBrowserLock = null;
let context = null;
let capturedAuthorization = "";

try {
  releaseBrowserLock = await acquireStudioMateBrowserLock({ owner: "studiomate-memo-write-queue" });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(config.profileDir, { headless: config.headless });
  const page = await context.newPage();
  page.on("request", (request) => {
    if (!request.url().includes("api.studiomate.kr")) return;
    capturedAuthorization = request.headers().authorization || capturedAuthorization;
  });
  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 });
  await assertLoggedIn(page);
  if (!capturedAuthorization) {
    await page.waitForTimeout(1500);
  }
  if (!capturedAuthorization && jobs.some(({data}) => data.profileUpdate?.version !== 2)) {
    throw new Error("StudioMate browser authorization header was not captured.");
  }

  for (const { ref, data } of jobs) {
    const item = { jobId: data.jobId || ref.id, memberName: data.memberName, status: "pending" };
    let activeData = data;
    let claimedThisRun = false;
    try {
      if (!apply) {
        result.processed += 1;
        item.status = "dry-run";
        result.skipped += 1;
      } else {
        activeData = await claimMemoJob(ref);
        if (!activeData) {
          item.status = "skipped";
          result.skipped += 1;
          result.jobs.push(item);
          continue;
        }
        claimedThisRun = true;
        result.processed += 1;
        const writeResult = await writeMemo(page, activeData, capturedAuthorization);
        const profileNeedsReview = activeData.profileUpdate?.version === 2 && ['birthDate','address'].some(
          key => ['conflict','review','unknown','awaiting_address_lookup_approval'].includes(writeResult.profileStatus?.[key]?.status));
        const donePatch = {
            status: "done",
            attempts: Number(activeData.attempts || 0),
            claimToken: null,
            ...(writeResult.studiomateMemberId ? { studiomateMemberId: writeResult.studiomateMemberId } : {}),
            ...(writeResult.profileStatus ? { profileStatus: writeResult.profileStatus } : {}),
            ...(activeData.profileUpdate?.version === 2 ? { profileSyncStatus: profileNeedsReview ? 'review_required' : 'synced',memoWriteState:'verified' } : {}),
            writtenAt: admin.firestore.Timestamp.now(),
            lastError: null,
            updatedAt: admin.firestore.Timestamp.now(),
          };
        if (activeData.profileUpdate?.version === 2) {
          await db.runTransaction(async tx=>{const current=await tx.get(ref);
            if(current.get('claimToken')!==activeData.claimToken||current.get('status')!=='processing')throw new Error('Signup profile writer lease changed');
            tx.update(ref,donePatch);});
        } else await ref.set(donePatch,{merge:true});
        await updateMemberMemoSyncStatus(activeData.jobId || ref.id, {
          syncStatus: "synced",
          syncedAt: admin.firestore.Timestamp.now(),
          syncError: null,
          ...(activeData.profileUpdate?.version === 2 ? { profileSyncStatus: profileNeedsReview ? 'review_required' : 'synced', profileStatus: writeResult.profileStatus } : {}),
        });
        await updateMemberSignupContractSyncStatus(activeData, {
          status: "done",
          reason: "StudioMate member signup memo was written by individual Playwright sync.",
          updatedAt: admin.firestore.Timestamp.now(),
        });
        await updateInstructorLessonRegistrationMemoStatus(activeData, {
          status: "done",
          reason: activeData.profileUpdate?.version === 2
            ? profileNeedsReview ? '가입서 완료 메모 반영 · 회원정보 일부 확인필요(기존 값 보존)' : '가입서 완료 메모·회원정보 빈칸 보완 확인'
            : activeData.profileUpdate ? "StudioMate 생년월일·가입서 메모 반영 완료" : "StudioMate 회원 메모 반영 완료",
          profileNeedsReview,
          profileStatus: writeResult.profileStatus,
        });
        await markMemberIdLookupDone(activeData, writeResult.studiomateMemberId);
        item.status = "done";
        result.written += 1;
      }
    } catch (error) {
      const attempts = data.source==="holding_notice_delivery"
        ? claimedThisRun ? Number(activeData.attempts || 0) : Number(data.attempts || 0)+1
        : Number(activeData.attempts || 0) || Number(data.attempts || 0) + 1;
      const maxAttempts = Number(activeData.maxAttempts || data.maxAttempts || 3);
      const message = activeData.profileUpdate
        ? (error?.nonRetryable ? error.message : "가입서 정보 반영 중 StudioMate 메모 저장·재조회 실패. 원본 확인 후 재처리합니다.")
        : error instanceof Error ? error.message : String(error);
      const status = error?.nonRetryable || attempts >= maxAttempts ? "failed" : "retry";
      const failurePatch = {
          status,
          attempts,
          claimToken: null,
          lastError: message,
          ...(activeData.profileUpdate?.version===2?{failureStage:error?.failureStage || 'memo_read_or_write',failureCode:error?.failureCode || 'unknown'}:{}),
          updatedAt: admin.firestore.Timestamp.now(),
        };
      if (activeData.profileUpdate?.version === 2) {
        const owned=await db.runTransaction(async tx=>{
          const current=await tx.get(ref);
          if(current.get('claimToken')!==activeData.claimToken||current.get('status')!=='processing')return false;
          tx.update(ref,failurePatch);return true;
        });
        if(!owned){item.status='review_required';item.error='Signup writer outcome retained; current lease or completed state changed';result.failed++;result.jobs.push(item);continue;}
      } else await ref.set(failurePatch,{merge:true});
      await updateMemberMemoSyncStatus(activeData.jobId || ref.id, {
        syncStatus: status,
        syncError: message,
      });
      await updateMemberSignupContractSyncStatus(activeData, {
        status,
        reason: message,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      await updateInstructorLessonRegistrationMemoStatus(activeData, { status, reason: message });
      if (status === "failed") {
        await sendMemoWriteFailureEmailOnce(ref, activeData, message);
      }
      item.status = status;
      item.error = message;
      result.failed += 1;
    }
    result.jobs.push(item);
  }
  result.ok = result.failed === 0;
} catch (error) {
  result.ok = false;
  result.error = error instanceof Error ? error.message : String(error);
  await markLoadedJobsFailed(result.error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(path.dirname(config.runLogPath), "last-studiomate-memo-write-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await appendFile(config.runLogPath, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (context) await context.close();
  if (releaseBrowserLock) await releaseBrowserLock();
}

async function loadPendingJobs(max) {
  if(signupJobIds.length){
    const snapshots=await db.getAll(...signupJobIds.map(id=>db.doc(`studiomateMemoWriteJobs/${id}`)));
    for(const snapshot of snapshots){
      const data=snapshot.data();
      if(!snapshot.exists||data.jobId!==snapshot.id||data.source!=='instructor_member_eformsign'||data.profileUpdate?.version!==2)
        throw new Error('Bounded signup memo source mismatch');
    }
    return snapshots.filter(s=>['pending','retry'].includes(s.get('status'))).map(s=>({ref:s.ref,data:s.data()}));
  }
  if (jobId) {
    const doc = await db.collection("studiomateMemoWriteJobs").doc(jobId).get();
    if (!doc.exists) return [];
    const data = doc.data();
    if (!["pending", "retry"].includes(String(data?.status || ""))) return [];
    return [{ ref: doc.ref, data }];
  }
  const snap = await db
    .collection("studiomateMemoWriteJobs")
    .where("status", "in", ["pending", "retry"])
    .get();
  return snap.docs
    .map((doc) => ({ ref: doc.ref, data: doc.data() }))
    .sort((a, b) => timestampMillis(a.data.updatedAt || a.data.createdAt) - timestampMillis(b.data.updatedAt || b.data.createdAt))
    .slice(0, max);
}

async function claimMemoJob(ref) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !["pending", "retry"].includes(String(snapshot.data()?.status || ""))) return null;
    const data = snapshot.data() || {};
    if (data.source === "holding_notice_delivery") {
      const id=String(data.holdingNoticeId || "");
      if (!/^holding_operator_notice_[a-f0-9]{64}$/.test(id)) throw new Error("holding_delivery_memo_source_mismatch");
      const send=(await transaction.get(db.doc(`alimtalkSends/${id}`))).data();
      const candidate=(await transaction.get(db.doc(`alimtalkCandidates/${id}`))).data();
      const claim=(await transaction.get(db.doc(`holdingNoticeClaims/${id}`))).data();
      const memo=(await transaction.get(db.doc(`memberMemos/${ref.id}`))).data();
      try {
        assertHoldingMemoWriteSource({job:data,memo,send,candidate,claim});
        const profile=await readHoldingMemberProfile({db,memberId:data.memberId,reader:transaction});
        assertHoldingMemoMemberProfile(profile,data);
      } catch (error) {
        if (/^(holding_delivery_memo_|operator_member_changed|holding_(native_member|unique_linked|verified_member|member_lookup|member_phone))/.test(error.message || "")) error.nonRetryable=true;
        throw error;
      }
    }
    if (data.source === "instructor_member_eformsign" && data.registrationId) {
      const registration = await transaction.get(db.collection("instructorLessonRegistrations").doc(data.registrationId));
      if (registration.data()?.cancellation?.jobId) {
        transaction.update(ref, { status: "cancelled", lastError: "강사레슨 수강 취소로 정보 반영 중단", updatedAt: admin.firestore.Timestamp.now() });
        return null;
      }
    }
    const attempts = Number(data.attempts || 0) + 1;
    const claimToken = randomUUID();
    transaction.set(ref, {
      status: "processing",
      attempts,
      claimToken,
      claimedBy: `${os.hostname()}:${process.pid}`,
      claimedAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      lastError: null,
    }, { merge: true });
    return { ...data, attempts, claimToken };
  });
}

async function updateMemberMemoSyncStatus(memoId, patch) {
  if (!memoId) return;
  await db
    .collection("memberMemos")
    .doc(String(memoId))
    .set(
      {
        ...patch,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
}

async function updateMemberSignupContractSyncStatus(job, patch) {
  if (!String(job.source || "").startsWith("member_signup")) return;
  const contractId = String(job.contractId || "").trim();
  if (!contractId) return;
  await db.collection("memberSignupContracts").doc(contractId).set(
    {
      studiomateSyncStatus: patch.status,
      studiomateProfileSyncStatus: patch.status,
      studiomateProfileSync: {
        status: patch.status,
        reason: patch.reason || "",
        updatedAt: patch.updatedAt || admin.firestore.Timestamp.now(),
      },
      updatedAt: patch.updatedAt || admin.firestore.Timestamp.now(),
    },
    { merge: true },
  );
}

async function updateInstructorLessonRegistrationMemoStatus(job, patch) {
  if (String(job.source || "") !== "instructor_member_eformsign") return;
  if (job.profileUpdate?.version === 2) {
    const latest=(await db.doc(`studiomateMemoWriteJobs/${job.jobId}`).get()).data();
    const ids=[...new Set([job.registrationId,...(job.registrationIds || []),...(latest?.registrationIds || [])].filter(Boolean))];
    for (const registrationId of ids) {
      await db.runTransaction(async transaction=>{
        const registrationRef=db.doc(`instructorLessonRegistrations/${registrationId}`);
        const [snapshot,sourceSnapshot]=await Promise.all([transaction.get(registrationRef),transaction.get(db.doc(`eformsignInstructorMemberJobs/${registrationId}`))]);
        const current=snapshot.data(),source=sourceSnapshot.data();
        if (!current || current.cancellation?.jobId || source?.profileMemoJobId!==job.jobId
          || source.documentId!==job.profileUpdate.documentId || String(source.studiomateMemberId)!==String(job.memberId)
          || String(current.studiomateMemberId || current.evidence?.studiomateMemberId)!==String(job.memberId)
          || digitsOnly(current.memberPhone)!==digitsOnly(job.memberPhone) || String(current.memberName).trim()!==String(job.memberName).trim()) return;
        const now=admin.firestore.Timestamp.now(),completed=patch.status==='done';
        const steps={...current.steps,memo:{...current.steps?.memo,
          status:completed&&!patch.profileNeedsReview?'verified':patch.status==='retry'?'retry':'review_required',
          label:'가입서 정보 반영',detail:String(patch.reason || '').slice(0,240),updatedAt:now}};
        const state=deriveInstructorLessonRegistrationState({mode:current.mode,steps});
        transaction.set(registrationRef,{status:state.status,nextAction:state.nextAction,steps,
          profileEnrichment:{status:completed?(patch.profileNeedsReview?'review_required':'synced'):patch.status,fields:patch.profileStatus || {},updatedAt:now},
          ...(state.status==='completed'?{completedAt:current.completedAt || now}:{}),updatedAt:now},{merge:true});
      });
    }
    return;
  }
  const registrationId = String(job.registrationId || "").trim();
  if (!registrationId) return;
  const registrationRef = db.collection("instructorLessonRegistrations").doc(registrationId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(registrationRef);
    const sourceSnapshot = await transaction.get(db.collection("eformsignInstructorMemberJobs").doc(String(job.profileSourceJobId || registrationId)));
    const profileMemoJobId = sourceSnapshot.data()?.profileMemoJobId;
    // Older completion-only memos cannot finish the newer profile-and-memo step.
    if (profileMemoJobId && profileMemoJobId !== job.jobId) return;
    if (!snapshot.exists) return;
    const current = snapshot.data() || {};
    const currentMemo = current.steps?.memo || {};
    if (current.cancellation?.jobId) return;
    const alreadyCompleted = current.status === "completed" && currentMemo.status === "verified";
    const completed = patch.status === "done";
    if (alreadyCompleted && !completed) return;

    const failed = patch.status === "failed";
    const now = admin.firestore.Timestamp.now();
    const steps = {
      ...(current.steps || {}),
      memo: {
        ...currentMemo,
        status: completed ? patch.profileNeedsReview ? "review_required" : "verified" : failed ? "review_required" : "retry",
        label: job.profileUpdate ? "가입서 정보 반영" : "가입서 완료 메모",
        detail: String(patch.reason || "").slice(0, 240),
        updatedAt: now,
      },
    };
    const state = deriveInstructorLessonRegistrationState({ mode: current.mode, steps });
    transaction.set(registrationRef, {
      status: state.status,
      nextAction: state.nextAction,
      steps,
      ...(job.profileUpdate?.version === 2 ? { profileEnrichment: {status: patch.profileNeedsReview ? 'review_required' : 'synced',fields:patch.profileStatus || {},updatedAt:now} } : {}),
      ...(state.status === "completed" ? { completedAt: current.completedAt || now } : {}),
      updatedAt: now,
    }, { merge: true });
  });
}

async function markLoadedJobsFailed(message) {
  for (const { ref, data } of jobs) {
    const latest = (await ref.get()).data() || {};
    if (!["pending", "retry"].includes(String(latest.status || ""))) continue;
    const attempts = Number(latest.attempts || data.attempts || 0) + 1;
    await ref.set(
      {
        status: "failed",
        attempts,
        lastError: message,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
    await updateMemberMemoSyncStatus(data.jobId || ref.id, {
      syncStatus: "failed",
      syncError: message,
    });
    await updateInstructorLessonRegistrationMemoStatus(data, { status: "failed", reason: message });
    try {
      await sendMemoWriteFailureEmailOnce(ref, { ...data, attempts }, message);
    } catch (emailError) {
      result.error = `${message}; failure email failed: ${
        emailError instanceof Error ? emailError.message : String(emailError)
      }`;
    }
  }
}

async function sendMemoWriteFailureEmailOnce(ref, job, message) {
  const latest = (await ref.get()).data() || {};
  if (latest.failureEmailSentAt) return;
  const jobId = String(job.jobId || ref.id);
  const subject = job.source==="holding_notice_delivery" ? "[홀딩 안내][실패] 회원 메모 반영 확인 필요" : `[ARCHIVE IN] StudioMate 메모쓰기 실패: ${job.memberName || jobId}`;
  const body = [
    ...(job.source==="holding_notice_delivery" ? ["주체: ARCHIVE CORE / 홀딩 안내 메모", "결론: 홀딩 안내 메모의 원본 검증 또는 StudioMate 반영을 완료하지 못했습니다.",
      `원천: alimtalkSends/${job.holdingNoticeId} / memberMemos/${jobId}`,
      `상세: https://arcpilates.studiomate.kr/users/detail?id=${job.memberId}`,
      "다음: 메모 작업만 확인하세요. 알림톡은 재발송하지 않습니다.", ""] : []),
    "StudioMate 회원메모 쓰기 작업이 실패했습니다.",
    "",
    `작업ID: ${jobId}`,
    `회원: ${job.memberName || "-"}`,
    `회원ID: ${job.memberId || "-"}`,
    `수업일: ${job.lectureDate || "-"}`,
    `출처: ${job.source || "-"}`,
    `시도횟수: ${Number(latest.attempts || job.attempts || 0)}/${Number(latest.maxAttempts || job.maxAttempts || 3)}`,
    "",
    "오류:",
    message,
    "",
    "조치:",
    "StudioMate 로그인/회원 상세 화면의 메모 버튼 상태를 확인한 뒤 작업을 retry 상태로 되돌려 재시도하세요.",
  ].join("\n");
  await sendGmail({
    to: config.operatorEmail,
    subject,
    body,
  });
  await ref.set(
    {
      failureEmailSentAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true },
  );
}

async function sendGmail({ to, subject, body }) {
  const accessToken = await googleAccessToken(["https://www.googleapis.com/auth/gmail.send"]);
  const raw = Buffer.from(
    [
      `From: ARCHIVE IN <${config.delegatedUser}>`,
      `To: ${to}`,
      `Subject: ${encodeMimeHeader(subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
    ].join("\r\n"),
  ).toString("base64url");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) {
    throw new Error(`Gmail failure email send failed ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

async function googleAccessToken(scopes) {
  const key = JSON.parse(await readFile(config.googleCredentialsPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    {
      alg: "RS256",
      typ: "JWT",
    },
    {
      iss: key.client_email,
      scope: scopes.join(" "),
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
      sub: config.delegatedUser,
    },
    key.private_key,
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google token failed ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token;
}

function signJwt(header, payload, privateKey) {
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(privateKey, "base64url")}`;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

async function writeMemo(page, job, authorization) {
  const memberId = String(job.memberId || "");
  const content = String(job.content || "");
  if (!memberId || !content) throw new Error("memberId/content is required");
  const studiomateMemberId = await resolveStudioMateMemberId(page, job);
  let profileStatus;
  if (job.profileUpdate) {
    let profileStage='signed_source_read';
    try {
      const source = (await db.collection("eformsignInstructorMemberJobs").doc(String(job.profileSourceJobId || job.registrationId || "")).get()).data();
      const registration = job.registrationId ? (await db.collection("instructorLessonRegistrations").doc(String(job.registrationId)).get()).data() : null;
      if (job.profileUpdate.version === 2) {
        profileStage='signed_source_validation';
        assertSignupProfileV2Source(job, source, registration);
        profileStage='native_profile_read_or_save';
        profileStatus = await applySignupProfileV2(page, job, studiomateMemberId, config.baseUrl, { recordProgress: async progress => {
          profileStage='profile_progress_claim';
          const ref=db.doc(`studiomateMemoWriteJobs/${job.jobId}`);
          await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.get('claimToken')!==job.claimToken||snap.get('status')!=='processing')throw new Error('Signup profile writer lease changed');
            profileStage='profile_progress_source';
            const sourceNow=(await tx.get(db.doc(`eformsignInstructorMemberJobs/${job.profileSourceJobId}`))).data();
            const registrationNow=job.registrationId?(await tx.get(db.doc(`instructorLessonRegistrations/${job.registrationId}`))).data():null;
            assertSignupProfileV2Source(job,sourceNow,registrationNow);
            profileStage='profile_progress_write';
            tx.update(ref,{profileStatus:progress,updatedAt:admin.firestore.Timestamp.now()});});
          profileStage='native_profile_read_or_save';
        } });
      } else {
        assertSignupProfileSource(job, source, registration);
        profileStatus = await applySignupBirthDate(page, job, studiomateMemberId, config.baseUrl);
      }
    } catch (error) {
      const safeError = new Error(/기존 생년월일/.test(String(error?.message || ""))
        ? "StudioMate 기존 생년월일과 가입서가 다릅니다. 덮어쓰지 않고 확인필요"
        : "가입서 원본·회원 일치·회원정보 저장 검증 실패. 원본 확인 후 재처리하세요.");
      safeError.nonRetryable = true;
      safeError.failureStage=profileStage;
      safeError.failureCode=String(error?.code || error?.name || 'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);
      throw safeError;
    }
  }
  if (await studioMateMemoExists(page, studiomateMemberId, content)) {
    return { studiomateMemberId, alreadyExists: true, profileStatus };
  }
  if (job.profileUpdate?.version === 2) {
    if(job.memoWriteState==='intent'){
      const error=new Error('가입서 완료 메모의 이전 저장 결과를 확인해야 합니다. 중복 저장하지 않습니다.');error.nonRetryable=true;throw error;
    }
    await writeMemoViaUi(page, studiomateMemberId, content, {beforeSave:async()=>{
      const ref=db.doc(`studiomateMemoWriteJobs/${job.jobId}`);
      await db.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        if(snap.get('claimToken')!==job.claimToken||snap.get('status')!=='processing'||snap.get('memoWriteState')==='intent')
          throw Object.assign(new Error('가입서 완료 메모 저장 선점이 변경되어 중단했습니다.'),{nonRetryable:true});
        tx.update(ref,{memoWriteState:'intent',memoWriteIntentAt:admin.firestore.Timestamp.now(),updatedAt:admin.firestore.Timestamp.now()});
      });
    }});
    if (!(await studioMateMemoExists(page, studiomateMemberId, content))) throw new Error('Signup completion memo readback unavailable');
    return {studiomateMemberId,profileStatus};
  }
  try {
    await writeMemoViaBrowserRequest(page, studiomateMemberId, content, authorization);
    if (!(await studioMateMemoExists(page, studiomateMemberId, content))) {
      throw new Error("StudioMate memo API success was not visible on the member detail page.");
    }
    return { studiomateMemberId, profileStatus };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/403|비정상|abnormal/i.test(message)) throw error;
  }
  await writeMemoViaUi(page, studiomateMemberId, content);
  return { studiomateMemberId, profileStatus };
}

async function studioMateMemoExists(page, memberId, content) {
  await page.goto(new URL(`/users/detail?id=${encodeURIComponent(memberId)}`, config.baseUrl).toString(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  const body = await page.locator("body").innerText({ timeout: 10000 });
  return bodyContainsMemoContent(body, content);
}

async function resolveStudioMateMemberId(page, job) {
  const current = String(job.studiomateMemberId || job.memberId || "");
  if (/^\d+$/.test(current)) return current;

  const phone = digitsOnly(job.memberPhone || "");
  const name = String(job.memberName || "").trim();
  const query = phone || name;
  if (!query) throw new Error("StudioMate member id lookup requires memberPhone or memberName.");

  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 });
  await assertLoggedIn(page);
  const search = page.locator('input[placeholder="이름 또는 전화번호로 검색"]').first();
  if (!(await search.isVisible().catch(() => false))) throw new Error("StudioMate member search input was not found.");
  await search.fill(query);
  await page.waitForTimeout(1200);

  const clicked = await clickSearchResult(page, { phone, name });
  if (!clicked) {
    throw new Error(`StudioMate member search result not found for ${name || "-"} ${phone || "-"}.`);
  }
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const url = new URL(page.url());
  const resolved = url.searchParams.get("id") || "";
  if (!/^\d+$/.test(resolved)) {
    throw new Error(`StudioMate member search did not open a member detail page: ${page.url()}`);
  }
  return resolved;
}

async function markMemberIdLookupDone(job, studiomateMemberId) {
  const memberId = String(job.memberId || "");
  if (!memberId || !studiomateMemberId || !memberId.startsWith("excel_")) return;
  const now = admin.firestore.Timestamp.now();
  await Promise.all([
    db.collection("memberProfiles").doc(memberId).set(
      {
        studiomateMemberId,
        studiomateMemberIdResolvedAt: now,
        updatedAt: now,
      },
      { merge: true },
    ),
    db.collection("studiomateMemberIdLookupJobs").doc(`studiomate_member_id_lookup_${memberId}`).set(
      {
        jobId: `studiomate_member_id_lookup_${memberId}`,
        studioId: job.studioId || "5330",
        memberId,
        memberName: job.memberName || "",
        memberPhone: job.memberPhone || "",
        status: "done",
        attempts: admin.firestore.FieldValue.increment(1),
        studiomateMemberId,
        resolvedAt: now,
        updatedAt: now,
        lastError: null,
        source: "studiomate_memo_write_resolution",
      },
      { merge: true },
    ),
  ]);
}

async function writeMemoViaBrowserRequest(page, memberId, content, authorization) {
  const result = await page.evaluate(
    async ({ apiBaseUrl, authorization, memberId, content }) => {
      const response = await fetch(new URL("/v2/staff/memo", apiBaseUrl).toString(), {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          "web-version": "1.0.23",
        },
        body: JSON.stringify({ member_id: memberId, memo: content }),
      });
      return {
        ok: response.ok,
        status: response.status,
        text: (await response.text()).slice(0, 300),
      };
    },
    { apiBaseUrl: config.apiBaseUrl, authorization, memberId, content },
  );
  if (!result.ok) throw new Error(`StudioMate memo write failed ${result.status}: ${result.text}`);
}

async function writeMemoViaUi(page, memberId, content, {beforeSave} = {}) {
  await page.goto(new URL(`/users/detail?id=${encodeURIComponent(memberId)}`, config.baseUrl).toString(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  const beforeBody = await page.locator("body").innerText({ timeout: 10000 });
  if (bodyContainsMemoContent(beforeBody, content)) return;
  await page.getByText("메모 추가", { exact: true }).click({ timeout: 15000 });
  const textarea = page.locator("textarea").last();
  await textarea.fill(content, { timeout: 15000 });
  if(beforeSave)await beforeSave();
  await page.getByText("저장", { exact: true }).last().click({ timeout: 15000 });
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText({ timeout: 10000 });
  if (!bodyContainsMemoContent(body, content)) {
    throw new Error("StudioMate memo UI save did not show the expected content after save.");
  }
}

function bodyContainsMemoContent(body, content) {
  if (content.startsWith("[홀딩 안내]")) return holdingMemoContentPresent(body,content);
  if (content.includes("[ARCHIVE PILATES 강사회원 가입서 정보]") || content.startsWith('[ARCHIVE PILATES 강사회원 가입서 완료]')) return signupProfileMemoPresent(body, content);
  const normalizedBody = normalizeMemoText(body);
  const normalizedContent = normalizeMemoText(content);
  if (!normalizedContent) return false;
  const firstLine = normalizeMemoText(content.split("\n")[0] || "");
  const tail = normalizedContent.slice(-30);
  return Boolean(firstLine && normalizedBody.includes(firstLine) && tail && normalizedBody.includes(tail));
}

function normalizeMemoText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const seconds = Number(value.seconds ?? value._seconds);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function clickSearchResult(page, { phone, name }) {
  const results = page.locator(".members .member");
  const count = await results.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = results.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const text = await candidate.innerText().catch(() => "");
    const textPhone = digitsOnly(text);
    const matchesPhone = phone && textPhone.includes(phone.slice(-8));
    const matchesName = name && text.includes(name);
    if (matchesPhone || matchesName) {
      await candidate.click({ timeout: 5000 });
      return true;
    }
  }
  return false;
}

async function assertLoggedIn(page) {
  await ensureStudioMateLoggedIn(page, { headless: config.headless, waitForLogin: config.waitForLogin });
}

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return "";
}

function expandHome(value) {
  if (!value) return value;
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}
