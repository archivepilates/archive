#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { recordAutomationStatus } from "./lib/archive-core-ops-logging.mjs";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { appendIdleHeartbeatIfDue } from "./lib/idle-heartbeat.mjs";
import {
  INSTRUCTOR_LESSON_TICKET_NAME,
  INSTRUCTOR_LESSON_TICKET_PRICE,
  deriveInstructorLessonRegistrationState,
  exactMemberCandidates,
  isInstructorMemberGrade,
  isInstructorLessonNewMemberTestRecipient,
  normalizeInstructorLessonName,
  normalizeInstructorLessonPhone,
  paymentMethodLabel,
  selectExactInstructorLessonTicket,
  staleExternalActionStatus,
} from "./lib/instructor-lesson-registration-contract.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const config = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates",
  baseUrl: process.env.STUDIOMATE_WEB_BASE_URL || "https://arcpilates.studiomate.kr",
  profileDir: expandHome(process.env.STUDIOMATE_EMERGENCY_PROFILE_DIR || "~/ArchiveIN/automation/browser-profile"),
  headless: process.env.HEADLESS !== "false",
  waitForLogin: process.env.WAIT_FOR_LOGIN === "true",
  limit: Math.max(1, Number(valueArg("--limit") || process.env.INSTRUCTOR_LESSON_REGISTRATION_LIMIT || "1")),
  jobId: valueArg("--job-id") || process.env.INSTRUCTOR_LESSON_REGISTRATION_JOB_ID || "",
  simulateNewMemberTest: args.has("--simulate-new-member-test"),
  runLogPath: expandHome(
    process.env.INSTRUCTOR_LESSON_REGISTRATION_RUN_LOG
      || "~/ArchiveIN/automation/runs/instructor-lesson-registration.jsonl",
  ),
  lastResultPath: expandHome(
    process.env.INSTRUCTOR_LESSON_REGISTRATION_LAST_RESULT
      || "~/ArchiveIN/automation/reports/instructor-lesson-registration/latest.json",
  ),
};

if (!admin.apps.length) admin.initializeApp({ projectId: config.projectId });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const summary = {
  ok: false,
  mode: apply ? "apply" : "dry-run",
  source: "studiomate_instructor_lesson_playwright_queue",
  startedAt: new Date().toISOString(),
  processed: 0,
  completed: 0,
  waiting: 0,
  reviewRequired: 0,
  failed: 0,
  jobs: [],
};

await mkdir(path.dirname(config.runLogPath), { recursive: true });
await mkdir(path.dirname(config.lastResultPath), { recursive: true });
if (apply) await recoverStaleJobs();

const candidates = await loadCandidates(config.limit);
if (config.simulateNewMemberTest) {
  if (!config.jobId) throw new Error("신규회원 테스트는 --job-id로 한 건을 지정해야 합니다.");
  if (candidates.length !== 1 || !isInstructorLessonNewMemberTestRecipient(candidates[0].data)) {
    throw new Error("신규회원 테스트는 김기효 테스트 계정 한 건에만 사용할 수 있습니다.");
  }
}
if (!candidates.length) {
  summary.ok = true;
  summary.finishedAt = new Date().toISOString();
  appendIdleHeartbeatIfDue(config.runLogPath, summary, 30 * 60 * 1000);
  await writeFile(config.lastResultPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}

if (!apply) {
  summary.ok = true;
  summary.jobs = candidates.map(({ ref, data }) => ({
    jobId: ref.id,
    memberName: data.memberName,
    phoneLast4: normalizeInstructorLessonPhone(data.memberPhone).slice(-4),
    lessonDate: data.lessonDate,
    currentStep: data.currentStep,
    status: data.status,
  }));
  summary.finishedAt = new Date().toISOString();
  await persistSummary();
  process.exit(0);
}

let releaseBrowserLock = null;
let context = null;
try {
  if (candidates.length) {
    releaseBrowserLock = await acquireStudioMateBrowserLock({
      owner: "instructor-lesson-registration-queue",
      waitMs: 5 * 60 * 1000,
    });
    const { chromium } = await import("playwright");
    context = await chromium.launchPersistentContext(config.profileDir, { headless: config.headless });
    for (const openPage of context.pages()) await openPage.close();
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60_000 });
    await ensureStudioMateLoggedIn(page, { headless: config.headless, waitForLogin: config.waitForLogin });
    for (const candidate of candidates) await runCandidate(candidate, page);
  }
} finally {
  await context?.close().catch(() => {});
  await releaseBrowserLock?.().catch(() => {});
}

summary.ok = summary.failed === 0 && summary.reviewRequired === 0;
summary.finishedAt = new Date().toISOString();
await persistSummary();
if (!summary.ok) process.exitCode = 1;

async function runCandidate(candidate, page) {
  const claimed = await claimJob(candidate.ref);
  if (!claimed) return;
  const newMemberSimulation = config.simulateNewMemberTest && isInstructorLessonNewMemberTestRecipient(claimed);
  if (claimed.blocked) {
    summary.processed += 1;
    summary.reviewRequired += 1;
    summary.jobs.push({
      jobId: candidate.ref.id,
      memberName: claimed.memberName,
      phoneLast4: normalizeInstructorLessonPhone(claimed.memberPhone).slice(-4),
      lessonDate: claimed.lessonDate,
      currentStep: claimed.currentStep,
      status: "review_required",
      error: "외부 작업 실행 흔적이 있어 자동 재시도를 차단했습니다.",
    });
    return;
  }
  const item = {
    jobId: candidate.ref.id,
    memberName: claimed.memberName,
    phoneLast4: normalizeInstructorLessonPhone(claimed.memberPhone).slice(-4),
    lessonDate: claimed.lessonDate,
    currentStep: claimed.currentStep,
    status: "processing",
  };
  summary.processed += 1;
  try {
    if (!page) throw new Error("StudioMate 브라우저가 준비되지 않았습니다.");
    const processed = await processStudioMateRegistration(page, candidate.ref, {
      ...claimed,
      newMemberSimulation,
    });
    item.status = processed.status;
    item.detail = processed.detail;
    if (processed.status === "completed") summary.completed += 1;
    else summary.waiting += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = (await candidate.ref.get()).data() || claimed;
    if (current.claimToken && current.claimToken !== claimed.claimToken) {
      item.status = "review_required";
      item.error = "작업 임대가 변경되어 현재 작업자가 오류 상태를 덮어쓰지 않았습니다.";
      summary.reviewRequired += 1;
      summary.jobs.push(item);
      return;
    }
    const status = staleExternalActionStatus(current);
    await markFailure(candidate.ref, current, message, status);
    item.status = status;
    item.error = message;
    if (status === "review_required") summary.reviewRequired += 1;
    else summary.failed += 1;
  }
  summary.jobs.push(item);
}

async function processStudioMateRegistration(page, ref, job) {
  let memberId = String(job.studiomateMemberId || "");
  let mode = String(job.mode || "unresolved");
  let simulatedNewMember = false;
  if (!memberId || job.currentStep === "member") {
    const lookup = await lookupExactMember(page, job);
    if (lookup.matches.length > 1) {
      throw new Error("같은 전화번호의 StudioMate 회원이 2명 이상입니다. 회원카드를 먼저 병합·확인하세요.");
    }
    if (lookup.matches.length === 1) {
      const selected = lookup.matches[0];
      await selected.locator.click();
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      const detail = await readVerifiedMemberDetail(page, lookup.apiMemberId);
      if (job.newMemberSimulation) {
        memberId = detail.memberId;
        mode = "new_member";
        simulatedNewMember = true;
      } else if (!isInstructorMemberGrade(detail.gradeText)) {
        throw new Error("기존 StudioMate 회원이 강사회원 등급이 아닙니다. 운영자가 회원등급을 확인하세요.");
      } else {
        memberId = detail.memberId;
        mode = job.memberCreatedByRegistration === true ? "new_member" : "returning_member";
      }
    } else {
      if (!lookup.verifiedZero) {
        throw new Error("StudioMate 검색 결과가 있으나 전화번호 정확 일치를 증명하지 못해 신규 생성을 중단했습니다.");
      }
      const created = await createInstructorMember(page, ref, job);
      memberId = created.memberId;
      mode = "new_member";
    }
    await completeStep(ref, job.claimToken, "member", {
      mode,
      studiomateMemberId: memberId,
      memberCreatedByRegistration: mode === "new_member" && !simulatedNewMember,
      newMemberSimulation: simulatedNewMember,
      detail: simulatedNewMember
        ? "김기효 테스트 계정으로 신규 강사회원 후속 흐름 시뮬레이션"
        : mode === "new_member"
          ? "강사회원 신규 생성 검증 완료"
          : "기존 강사회원 정확매칭 완료",
      nextStep: "ticket",
    });
  }

  await openMemberDetail(page, memberId);
  const activeTicket = await findActiveInstructorTicket(page, job.lessonDate);
  let ticketId = String(job.ticketId || "");
  if (activeTicket) {
    ticketId = activeTicket.ticketId || ticketId;
  } else {
    const issued = await issueInstructorLessonTicket(page, ref, { ...job, mode, studiomateMemberId: memberId });
    ticketId = issued.ticketId;
  }
  await completeStep(ref, job.claimToken, "ticket", {
    ticketId,
    detail: activeTicket ? "기존 동일 수강일 수강권 재사용" : "강사레슨 (2T) 발급 검증 완료",
    nextStep: "followup",
  });
  await preparePostTicketSteps(ref, job.claimToken, {
    ...job,
    mode,
    studiomateMemberId: memberId,
    ticketId,
  });

  return completeStudioMateRegistration(ref, job.claimToken, {
    mode,
    memberId,
    ticketId,
  });
}

async function lookupExactMember(page, job) {
  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60_000 });
  const search = page.locator('input[placeholder="이름 또는 전화번호로 검색"]').first();
  await search.waitFor({ state: "visible" });
  const searchResponse = page.waitForResponse(
    (response) => response.request().method() === "GET" && /\/v2\/staff\/members\/top-bar-search(?:\?|$)/.test(response.url()),
    { timeout: 15_000 },
  ).catch(() => null);
  await search.fill(normalizeInstructorLessonPhone(job.memberPhone));
  const response = await searchResponse;
  if (!response) throw new Error("StudioMate 회원 검색 응답을 확인하지 못했습니다.");
  const payload = await response.json().catch(() => null);
  if (!response.ok() || !payload) throw new Error(`StudioMate 회원 검색 실패: ${response.status()}`);
  const apiMembers = memberRowsFromPayload(payload);
  if (!apiMembers) throw new Error("StudioMate 회원 검색 응답 구조를 확인하지 못했습니다.");
  const rows = page.locator(".members .member");
  const candidates = [];
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const locator = rows.nth(index);
    if (!(await locator.isVisible().catch(() => false))) continue;
    const text = await locator.innerText().catch(() => "");
    candidates.push({ locator, text, name: memberNameFromSearchText(text), phone: memberPhoneFromText(text) });
  }
  const matches = exactMemberCandidates(candidates, { phone: job.memberPhone, name: job.memberName });
  const apiMatches = exactMemberCandidates(apiMembers, { phone: job.memberPhone, name: job.memberName });
  if (apiMembers.length > 0 && apiMatches.length !== 1) {
    throw new Error("StudioMate 검색 응답에 회원이 있으나 전화번호 정확 일치가 1건이 아닙니다.");
  }
  if (apiMatches.length === 1 && matches.length !== 1) {
    throw new Error("StudioMate 검색 API와 화면의 전화번호 정확 일치 결과가 다릅니다.");
  }
  return {
    matches,
    candidates,
    apiMemberId: apiMatches.length === 1 ? String(apiMatches[0].id || "") : "",
    verifiedZero: apiMembers.length === 0 && candidates.length === 0,
  };
}

async function createInstructorMember(page, ref, job) {
  await page.goto(new URL("/users/create", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60_000 });
  const nameInput = page.locator('input[placeholder="이름을 입력해주세요"]').first();
  const phoneInput = page.locator('input[placeholder="휴대폰 번호"]').first();
  await nameInput.fill(normalizeInstructorLessonName(job.memberName));
  await phoneInput.fill(normalizeInstructorLessonPhone(job.memberPhone));

  const gradeField = page.locator(".member-form__header__user-grade").first();
  const gradeInput = gradeField.locator('input[placeholder="선택"]').first();
  await gradeInput.click();
  const gradeOptions = page.locator(".el-select-dropdown__item:visible").filter({ hasText: "강사회원" });
  if ((await gradeOptions.count()) !== 1) throw new Error("StudioMate 강사회원 등급 선택값을 정확히 찾지 못했습니다.");
  await gradeOptions.first().click();
  if (!isInstructorMemberGrade(await gradeInput.inputValue())) {
    throw new Error("StudioMate 강사회원 등급 선택 검증에 실패했습니다.");
  }

  await startExternalEffect(ref, job.claimToken, "member", "member_create");
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/v2\/staff\/members(?:\?|$)/.test(response.url()),
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "회원 등록 완료", exact: true }).click();
  const response = await responsePromise;
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok()) throw new Error(`StudioMate 회원 생성 실패: ${response.status()} ${JSON.stringify(payload).slice(0, 500)}`);
  await page.waitForURL(/\/users\/detail\?id=\d+/, { timeout: 30_000 });
  const createdMemberId = new URL(page.url()).searchParams.get("id") || "";
  const lookup = await lookupExactMember(page, job);
  if (lookup.matches.length !== 1 || !lookup.apiMemberId || lookup.apiMemberId !== createdMemberId) {
    throw new Error("생성 후 StudioMate 검색 원천에서 동일 회원 ID·전화번호를 확인하지 못했습니다.");
  }
  await lookup.matches[0].locator.click();
  const detail = await readVerifiedMemberDetail(page, lookup.apiMemberId);
  if (!isInstructorMemberGrade(detail.gradeText)) throw new Error("생성된 회원의 강사회원 등급을 확인하지 못했습니다.");
  return { memberId: detail.memberId };
}

async function readVerifiedMemberDetail(page, expectedMemberId) {
  await page.waitForURL(/\/users\/detail\?id=\d+/, { timeout: 30_000 });
  const memberId = new URL(page.url()).searchParams.get("id") || "";
  if (!/^\d+$/.test(memberId)) throw new Error("StudioMate 회원 ID를 확인하지 못했습니다.");
  if (!expectedMemberId || memberId !== String(expectedMemberId)) {
    throw new Error("StudioMate 검색 원천의 회원 ID와 상세 화면 ID가 다릅니다.");
  }
  const gradeText = await page.locator(".member-detail__header__user-grade").innerText().catch(() => "");
  if (!gradeText) throw new Error("StudioMate 회원 상세의 회원등급을 확인하지 못했습니다.");
  return { memberId, gradeText };
}

async function openMemberDetail(page, memberId) {
  await page.goto(new URL(`/users/detail?id=${encodeURIComponent(memberId)}`, config.baseUrl).toString(), {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.locator(".member-detail__header").waitFor({ state: "visible", timeout: 30_000 });
}

async function findActiveInstructorTicket(page, lessonDate) {
  const cards = page
    .locator(".member-basic__user-tickets")
    .first()
    .locator(".userticket-card, .ticket-card");
  const matches = [];
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    const locator = cards.nth(index);
    const text = await locator.innerText().catch(() => "");
    const title = normalizeInstructorLessonName(await locator.locator("h3").innerText().catch(() => ""));
    if (title !== INSTRUCTOR_LESSON_TICKET_NAME) continue;
    const dates = ticketDates(text);
    if (dates.length < 2) throw new Error("강사레슨 수강권의 이용 시작일·종료일을 확인하지 못했습니다.");
    if (dates[0] !== lessonDate || dates.at(-1) !== lessonDate) continue;
    matches.push({ locator, text, ticketId: await locator.getAttribute("data-id").catch(() => "") || "" });
  }
  if (matches.length > 1) throw new Error("동일 수강일의 강사레슨 (2T) 수강권이 2개 이상입니다.");
  return matches[0] || null;
}

async function issueInstructorLessonTicket(page, ref, job) {
  const cards = page
    .locator(".member-basic__user-tickets")
    .first()
    .locator(".userticket-card, .ticket-card");
  const addCard = cards.filter({ hasText: "새로운 수강권 만들기" });
  if ((await addCard.count()) !== 1) throw new Error("StudioMate 수강권 추가 버튼을 찾지 못했습니다.");
  await addCard.click();
  const dialog = page.locator(".ticket-issue-modal");
  await dialog.waitFor({ state: "visible" });
  const search = dialog.locator('input[placeholder="수강권명 검색"]').first();
  await search.fill(INSTRUCTOR_LESSON_TICKET_NAME);
  await page.waitForFunction(
    (ticketName) => [...document.querySelectorAll(".ticket-issue-modal .ticket-card h3")]
      .some((node) => String(node.textContent || "").replace(/\s+/g, " ").trim() === ticketName),
    INSTRUCTOR_LESSON_TICKET_NAME,
  );
  const ticketCards = dialog.locator(".ticket-card");
  const ticketSummaries = [];
  for (let index = 0; index < await ticketCards.count(); index += 1) {
    const locator = ticketCards.nth(index);
    ticketSummaries.push({
      locator,
      title: normalizeInstructorLessonName(await locator.locator("h3").innerText().catch(() => "")),
      text: await locator.innerText().catch(() => ""),
    });
  }
  const selected = selectExactInstructorLessonTicket(ticketSummaries);
  await selected.locator.locator(".ticket-card__click-listener").click();

  const startInput = dialog.locator('input[placeholder="이용시작일"]').first();
  await setElementDate(startInput, job.lessonDate);
  const endInput = dialog.locator('input[placeholder="이용종료일"]').first();
  await setElementDate(endInput, job.lessonDate);
  await dialog.getByRole("button", { name: "다음", exact: true }).click();
  await dialog.getByRole("button", { name: "완료", exact: true }).waitFor({ state: "visible" });
  await selectPaymentMethod(dialog, job.paymentMethod);

  await startExternalEffect(ref, job.claimToken, "ticket", "ticket_issue");
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/v2\/staff\/user-tickets(?:\?|$)/.test(response.url()),
    { timeout: 15_000 },
  ).catch(() => null);
  await dialog.getByRole("button", { name: "완료", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 30_000 });
  const response = await responsePromise;
  const payload = response
    ? await response.json().catch(async () => ({ raw: await response.text() }))
    : null;
  if (response && !response.ok()) {
    throw new Error(`StudioMate 수강권 발급 실패: ${response.status()} ${JSON.stringify(payload).slice(0, 500)}`);
  }
  await openMemberDetail(page, job.studiomateMemberId);
  const verified = await findActiveInstructorTicket(page, job.lessonDate);
  if (!verified) throw new Error("발급 후 StudioMate 상세에서 강사레슨 (2T) 수강권을 확인하지 못했습니다.");
  const ticketId = String(payload?.data?.[0]?.id || payload?.[0]?.id || verified.ticketId || "");
  return { ticketId };
}

async function preparePostTicketSteps(ref, claimToken, job) {
  const registrationRef = registration(ref.id);
  const eformRef = db.collection("eformsignInstructorMemberJobs").doc(ref.id);
  await db.runTransaction(async (transaction) => {
    const [jobSnapshot, registrationSnapshot, eformSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(registrationRef),
      transaction.get(eformRef),
    ]);
    const currentJob = jobSnapshot.data() || {};
    if (!jobSnapshot.exists || currentJob.status !== "processing" || currentJob.claimToken !== claimToken) {
      throw new Error("수강권 확인 뒤 작업 임대가 변경되어 후속 처리 준비를 중단했습니다.");
    }
    if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
    const registrationData = registrationSnapshot.data() || {};
    const currentSteps = registrationData.steps || {};
    const now = FieldValue.serverTimestamp();
    const newMember = String(job.mode || currentJob.mode || "") === "new_member";
    const eformStep = currentSteps.eformsign || {};
    const memoStep = currentSteps.memo || {};
    const confirmationStep = currentSteps.confirmation || {};
    const steps = {
      ...currentSteps,
      eformsign: newMember
        ? (eformStep.status && eformStep.status !== "pending"
          ? eformStep
          : stepValue("queued", "강사회원 가입서", "수강권 발급 뒤 이폼싸인 브라우저 큐 등록"))
        : stepValue("not_required", "강사회원 가입서", "재수강 강사회원은 재발송하지 않음"),
      memo: newMember
        ? (memoStep.status && memoStep.status !== "pending"
          ? memoStep
          : stepValue("waiting_external", "가입서 완료 메모", "가입서 완료 뒤 자동 등록"))
        : stepValue("not_required", "가입서 완료 메모", "재수강 건"),
      bookings: stepValue("not_required", "반배정·예약", "수업 생성 시 운영자가 StudioMate에서 직접 처리"),
      confirmation: confirmationStep.status && confirmationStep.status !== "pending"
        ? confirmationStep
        : stepValue("pending", "예약확정 안내", "수강권 발급 확인 후 알림톡 자동 등록"),
    };
    transaction.update(registrationRef, {
      mode: job.mode || currentJob.mode,
      steps,
      nextAction: newMember ? "강사회원 가입서 발송·작성 대기" : "없음",
      updatedAt: now,
    });
    if (newMember && !eformSnapshot.exists && String(steps.eformsign?.status || "") !== "verified") {
      transaction.set(eformRef, {
        jobId: ref.id,
        registrationId: ref.id,
        studioId: job.studioId,
        memberName: job.memberName,
        memberPhone: normalizeInstructorLessonPhone(job.memberPhone),
        lessonDate: job.lessonDate,
        studiomateMemberId: job.studiomateMemberId,
        ticketName: INSTRUCTOR_LESSON_TICKET_NAME,
        ticketPrice: INSTRUCTOR_LESSON_TICKET_PRICE,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        externalEffectStarted: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
}

async function completeStudioMateRegistration(ref, claimToken, { mode, memberId, ticketId }) {
  const registrationRef = registration(ref.id);
  let state = { status: "processing", nextAction: "회원·수강권 검증 중" };
  await db.runTransaction(async (transaction) => {
    const [jobSnapshot, registrationSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(registrationRef),
    ]);
    const currentJob = jobSnapshot.data() || {};
    if (!jobSnapshot.exists || currentJob.status !== "processing" || currentJob.claimToken !== claimToken) {
      throw new Error("수강권 발급 완료 전 작업 임대가 변경되었습니다.");
    }
    if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
    const registrationData = registrationSnapshot.data() || {};
    const steps = registrationData.steps || {};
    state = deriveInstructorLessonRegistrationState({ mode, steps });
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, {
      status: "done",
      currentStep: "complete",
      claimToken: null,
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      nextRunAt: null,
      mode,
      studiomateMemberId: memberId,
      ticketId,
      externalEffectStarted: false,
      effectType: null,
      effectStartedAt: null,
      lastError: null,
      completedAt: now,
      updatedAt: now,
    }, { merge: true });
    transaction.update(registrationRef, {
      status: state.status,
      nextAction: state.nextAction,
      steps,
      ...(state.status === "action_required" ? {} : { lastError: null }),
      ...(state.status === "completed" ? { completedAt: now } : {}),
      updatedAt: now,
    });
  });
  return {
    status: state.status,
    detail: state.status === "completed"
      ? "회원·수강권·안내 검증 완료 · 반배정·예약은 운영자 수동 처리"
      : `수강권 발급 완료 · ${state.nextAction}`,
  };
}

async function setElementDate(locator, value) {
  const display = displayDate(value);
  await locator.click();
  await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await locator.fill(display).catch(async () => {
    await locator.evaluate((element, nextValue) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(element, nextValue);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, display);
  });
  await locator.press("Enter").catch(() => {});
}

async function loadCandidates(limit) {
  if (config.jobId) {
    const snapshot = await db.collection("studiomateInstructorLessonJobs").doc(config.jobId).get();
    return snapshot.exists ? [{ ref: snapshot.ref, data: snapshot.data() }] : [];
  }
  const snapshots = await Promise.all(
    ["pending", "retry"].map((status) =>
      db.collection("studiomateInstructorLessonJobs").where("status", "==", status).get()),
  );
  const now = Date.now();
  return snapshots.flatMap((snapshot) => snapshot.docs)
    .map((doc) => ({ ref: doc.ref, data: doc.data() }))
    .filter(({ data }) => !data.nextRunAt || timestampMillis(data.nextRunAt) <= now)
    .sort((a, b) => timestampMillis(a.data.createdAt) - timestampMillis(b.data.createdAt))
    .slice(0, limit);
}

async function claimJob(ref) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !["pending", "retry"].includes(String(snapshot.data()?.status || ""))) return null;
    const data = snapshot.data();
    if (data.nextRunAt && timestampMillis(data.nextRunAt) > Date.now()) return null;
    if (data.externalEffectStarted || data.effectStartedAt) {
      const message = "외부 작업 실행 흔적이 있어 자동 재시도를 차단했습니다.";
      const stateStep = registrationStepName(data.currentStep);
      transaction.set(ref, {
        status: "review_required",
        lastError: message,
        nextRunAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.update(registration(ref.id), {
        status: "action_required",
        nextAction: "외부 작업 결과 운영자 확인",
        lastError: message,
        [`steps.${stateStep}`]: stepValue(
          "review_required",
          stepLabel(stateStep),
          message,
        ),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ...data, blocked: true };
    }
    const attempts = Number(data.attempts || 0) + 1;
    const claimToken = randomUUID();
    transaction.set(ref, {
      status: "processing",
      attempts,
      claimToken,
      claimedBy: `${os.hostname()}:${process.pid}`,
      claimedAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
      nextRunAt: null,
      updatedAt: FieldValue.serverTimestamp(),
      lastError: null,
    }, { merge: true });
    transaction.set(registration(ref.id), {
      status: "processing",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ...data, attempts, claimToken };
  });
}

async function startExternalEffect(ref, claimToken, stepName, effectType, extraJobValues = {}) {
  const now = FieldValue.serverTimestamp();
  await commitClaimedState(ref, claimToken, {
    status: "processing",
    currentStep: stepName,
    externalEffectStarted: true,
    effectType,
    effectStartedAt: now,
    ...extraJobValues,
    updatedAt: now,
  }, {
    status: "processing",
    nextAction: `${effectType} 결과 확인 중`,
    [`steps.${stepName}`]: stepValue("processing", stepLabel(stepName), "외부 작업 실행 중"),
    updatedAt: now,
  });
}

async function completeStep(ref, claimToken, stepName, values = {}) {
  const now = FieldValue.serverTimestamp();
  const evidence = {};
  if (values.studiomateMemberId) evidence.studiomateMemberId = values.studiomateMemberId;
  if (values.ticketId) evidence.ticketId = values.ticketId;
  await commitClaimedState(ref, claimToken, {
    status: "processing",
    currentStep: values.nextStep || stepName,
    externalEffectStarted: false,
    effectType: null,
    effectStartedAt: null,
    ...(values.mode ? { mode: values.mode } : {}),
    ...(typeof values.memberCreatedByRegistration === "boolean"
      ? { memberCreatedByRegistration: values.memberCreatedByRegistration }
      : {}),
    ...(typeof values.newMemberSimulation === "boolean"
      ? { newMemberSimulation: values.newMemberSimulation }
      : {}),
    ...(values.studiomateMemberId ? { studiomateMemberId: values.studiomateMemberId } : {}),
    ...(values.ticketId ? { ticketId: values.ticketId } : {}),
    updatedAt: now,
  }, {
    status: "processing",
    ...(values.mode ? { mode: values.mode } : {}),
    nextAction: nextStepLabel(values.nextStep),
    [`steps.${stepName}`]: stepValue("verified", stepLabel(stepName), values.detail || "검증 완료"),
    ...Object.fromEntries(Object.entries(evidence).map(([key, value]) => [`evidence.${key}`, value])),
    ...(typeof values.memberCreatedByRegistration === "boolean"
      ? { "evidence.memberCreatedByRegistration": values.memberCreatedByRegistration }
      : {}),
    ...(typeof values.newMemberSimulation === "boolean"
      ? { "evidence.newMemberSimulation": values.newMemberSimulation }
      : {}),
    updatedAt: now,
  });
}

async function commitClaimedState(ref, claimToken, jobPatch, registrationPatch) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data() || {};
    if (!snapshot.exists || current.status !== "processing" || current.claimToken !== claimToken) {
      throw new Error("강사레슨 작업 임대가 변경되어 외부 작업 결과 반영을 중단했습니다.");
    }
    transaction.set(ref, jobPatch, { merge: true });
    if (registrationPatch) transaction.update(registration(ref.id), registrationPatch);
  });
}

async function markFailure(ref, job, message, status) {
  const currentStep = registrationStepName(job.currentStep);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data() || {};
    if (!snapshot.exists) return;
    if (job.claimToken && current.claimToken && current.claimToken !== job.claimToken) return;
    transaction.set(ref, {
      status,
      claimToken: null,
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lastError: message.slice(0, 1200),
      nextRunAt: status === "retry" ? Timestamp.fromMillis(Date.now() + 5 * 60 * 1000) : null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(registration(ref.id), {
      status: status === "review_required" ? "action_required" : status,
      nextAction: status === "review_required" ? "운영자 확인" : "자동 재시도 대기",
      lastError: message.slice(0, 500),
      [`steps.${currentStep}`]: stepValue(status, stepLabel(currentStep), message.slice(0, 240)),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function recoverStaleJobs() {
  const snapshot = await db.collection("studiomateInstructorLessonJobs").where("status", "==", "processing").limit(20).get();
  const now = Date.now();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (timestampMillis(data.leaseExpiresAt) > now) continue;
    const status = staleExternalActionStatus(data);
    await markFailure(doc.ref, data, "작업자 중단 후 임대시간이 만료되었습니다.", status);
  }
}

async function persistSummary() {
  await writeFile(config.lastResultPath, `${JSON.stringify(summary, null, 2)}\n`);
  await appendFile(config.runLogPath, `${JSON.stringify(summary)}\n`);
  await recordAutomationStatus(db, {
    automationId: "instructor-lesson-registration-queue",
    title: "강사레슨 등록 자동화",
    ownerArea: "instructor-lessons",
    status: summary.ok ? "healthy" : summary.reviewRequired ? "warning" : "failed",
    lastRunAt: summary.finishedAt || new Date().toISOString(),
    lastResult: `처리 ${summary.processed}건 · 완료 ${summary.completed}건 · 대기 ${summary.waiting}건`,
    warnings: summary.jobs.filter((job) => job.error).map((job) => `${job.jobId}: ${job.error}`),
  }).catch(() => {});
  console.log(JSON.stringify(summary, null, 2));
}

function registration(id) {
  return db.collection("instructorLessonRegistrations").doc(id);
}

function stepValue(status, label, detail) {
  return { status, label, detail, updatedAt: FieldValue.serverTimestamp() };
}

function stepLabel(stepName) {
  return {
    member: "회원·등급 확인",
    ticket: "강사레슨 (2T) 발급",
  }[stepName] || stepName;
}

function registrationStepName(stepName) {
  return String(stepName || "member");
}

function nextStepLabel(stepName) {
  return {
    ticket: "강사레슨 (2T) 수강권 확인",
    followup: "가입서 후속 처리 준비",
  }[stepName] || "처리 중";
}

function memberNameFromSearchText(text) {
  return normalizeInstructorLessonName(String(text || "").split(/\n/)[0]);
}

function memberPhoneFromText(text) {
  return String(text || "").match(/01\d[\s-]*\d{3,4}[\s-]*\d{4}/)?.[0] || "";
}

function memberRowsFromPayload(payload) {
  const candidates = [
    payload,
    payload?.data,
    payload?.members,
    payload?.items,
    payload?.content,
    payload?.results,
    payload?.rows,
    payload?.list,
    payload?.data?.members,
    payload?.data?.items,
    payload?.data?.content,
    payload?.data?.results,
    payload?.data?.rows,
    payload?.data?.list,
  ];
  const rows = candidates.find((value) => Array.isArray(value));
  if (!rows) return null;
  return rows.map((row) => ({
    id: row?.id || row?.memberId || row?.userId || row?.user?.id || "",
    name: row?.name || row?.memberName || row?.userName || row?.user?.name || "",
    phone: row?.phone || row?.phoneNumber || row?.mobile || row?.mobilePhone || row?.contact || row?.user?.phone || "",
  }));
}

function ticketDates(value) {
  return [...String(value || "").matchAll(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/g)]
    .map((match) => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
}

async function selectPaymentMethod(dialog, value) {
  const label = paymentMethodLabel(value);
  if (!label) throw new Error("StudioMate 결제수단 값이 없습니다.");
  const paymentPanel = dialog.locator(".payment-form__element.right").first();
  await paymentPanel.waitFor({ state: "visible", timeout: 20_000 });
  const action = paymentPanel.getByText(label, { exact: true });
  if ((await action.count()) !== 1) throw new Error(`StudioMate ${label} 결제수단 입력을 정확히 찾지 못했습니다.`);
  await action.click();
}

function displayDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return `${year}. ${month}. ${day}.`;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const seconds = Number(value.seconds ?? value._seconds);
  return Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(value)) || 0;
}

function valueArg(name) {
  const argv = process.argv.slice(2);
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}

function expandHome(value) {
  return value?.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}
