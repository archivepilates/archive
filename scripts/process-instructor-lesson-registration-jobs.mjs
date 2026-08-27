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
  INSTRUCTOR_LESSON_EXPECTED_SESSIONS,
  INSTRUCTOR_LESSON_TICKET_NAME,
  deriveInstructorLessonRegistrationState,
  exactMemberCandidates,
  inspectInstructorLessonSessionCards,
  isInstructorMemberGrade,
  normalizeInstructorLessonName,
  normalizeInstructorLessonPhone,
  paymentMethodLabel,
  selectExactInstructorLessonTicket,
  staleExternalActionStatus,
  validateCanonicalInstructorLessonBookings,
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

const verificationJobs = candidates.filter(({ data }) => data.currentStep === "bookings_verify");
for (const candidate of verificationJobs) {
  await runCandidate(candidate, null);
}

const browserJobs = candidates.filter(({ data }) => data.currentStep !== "bookings_verify");
let releaseBrowserLock = null;
let context = null;
try {
  if (browserJobs.length) {
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
    for (const candidate of browserJobs) await runCandidate(candidate, page);
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
    if (claimed.currentStep === "bookings_verify") {
      const verified = await verifyCanonicalBookings(candidate.ref, claimed);
      item.status = verified.status;
      item.detail = verified.detail;
      if (verified.status === "completed") summary.completed += 1;
      else summary.waiting += 1;
    } else {
      if (!page) throw new Error("StudioMate 브라우저가 준비되지 않았습니다.");
      const processed = await processStudioMateRegistration(page, candidate.ref, claimed);
      item.status = processed.status;
      item.detail = processed.detail;
      summary.waiting += 1;
    }
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
      if (!isInstructorMemberGrade(detail.gradeText)) {
        throw new Error("기존 StudioMate 회원이 강사회원 등급이 아닙니다. 운영자가 회원등급을 확인하세요.");
      }
      memberId = detail.memberId;
      mode = job.memberCreatedByRegistration === true ? "new_member" : "returning_member";
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
      memberCreatedByRegistration: mode === "new_member",
      detail: mode === "new_member" ? "강사회원 신규 생성 검증 완료" : "기존 강사회원 정확매칭 완료",
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
    nextStep: "bookings",
  });
  await preparePostTicketSteps(ref, job.claimToken, {
    ...job,
    mode,
    studiomateMemberId: memberId,
    ticketId,
  });

  const bookingPreflight = await canonicalBookingState({ ...job, studiomateMemberId: memberId });
  if (bookingPreflight.ok) {
    await commitClaimedState(ref, job.claimToken, {
      status: "pending",
      currentStep: "bookings_verify",
      mode,
      studiomateMemberId: memberId,
      ticketId,
      externalEffectStarted: false,
      canonicalVerificationAttempts: 0,
      nextRunAt: Timestamp.fromMillis(Date.now() + 60_000),
      updatedAt: FieldValue.serverTimestamp(),
    }, {
      status: "processing",
      mode,
      nextAction: "기존 예약 원천 최종 확인",
      "steps.bookings": stepValue("waiting_external", "두 세션 예약", "기존 canonical 예약 두 건 확인 · 재예약 생략"),
      "evidence.studiomateMemberId": memberId,
      "evidence.ticketId": ticketId,
      "evidence.bookingIds": bookingPreflight.bookingIds,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { status: "waiting_canonical_booking", detail: "기존 예약 2건 확인 · 재예약 없이 원천 검증 대기" };
  }
  if (bookingPreflight.count > 0) {
    throw new Error(`예약 전 canonical 원천에 강사레슨 예약이 ${bookingPreflight.count}건 있습니다. 자동 추가 예약을 중단했습니다.`);
  }

  const bookingResult = await reserveInstructorLessonSessions(page, ref, {
    ...job,
    mode,
    studiomateMemberId: memberId,
    ticketId,
  });
  if (bookingResult.status === "waiting_class_assignment") {
    await waitForClassAssignment(ref, job.claimToken, { mode, memberId, ticketId });
    return { status: "waiting_class_assignment", detail: "수업 미생성 · 반배정 후 예약 자동 재개" };
  }
  await commitClaimedState(ref, job.claimToken, {
    status: "pending",
    currentStep: "bookings_verify",
    mode,
    studiomateMemberId: memberId,
    ticketId,
    bookingResponseIds: bookingResult.bookingIds,
    externalEffectStarted: false,
    effectType: null,
    effectStartedAt: null,
    canonicalVerificationAttempts: 0,
    nextRunAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
    updatedAt: FieldValue.serverTimestamp(),
  }, {
    status: "processing",
    mode,
    nextAction: "예약 원천 반영 확인",
    "steps.bookings": stepValue("waiting_external", "두 세션 예약", "StudioMate 응답 확인 · canonical 예약원천 반영 대기"),
    "evidence.studiomateMemberId": memberId,
    "evidence.ticketId": ticketId,
    "evidence.bookingResponseIds": bookingResult.bookingIds,
    "evidence.expectedSessions": bookingResult.cards.map(sessionEvidence),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { status: "waiting_canonical_booking", detail: "예약 2건 응답 확인 · 원천 동기화 대기" };
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
  const cards = page.locator(".member-basic__user-tickets").first().locator(".ticket-card");
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
  const cards = page.locator(".member-basic__user-tickets").first().locator(".ticket-card");
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
    { timeout: 60_000 },
  );
  await dialog.getByRole("button", { name: "완료", exact: true }).click();
  const response = await responsePromise;
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok()) throw new Error(`StudioMate 수강권 발급 실패: ${response.status()} ${JSON.stringify(payload).slice(0, 500)}`);
  await dialog.waitFor({ state: "hidden", timeout: 30_000 });
  await openMemberDetail(page, job.studiomateMemberId);
  const verified = await findActiveInstructorTicket(page, job.lessonDate);
  if (!verified) throw new Error("발급 후 StudioMate 상세에서 강사레슨 (2T) 수강권을 확인하지 못했습니다.");
  const ticketId = String(payload?.data?.[0]?.id || payload?.[0]?.id || verified.ticketId || "");
  return { ticketId };
}

async function reserveInstructorLessonSessions(page, ref, job) {
  await page.goto(
    new URL(`/users/${encodeURIComponent(job.studiomateMemberId)}/bulk_bookings`, config.baseUrl).toString(),
    { waitUntil: "networkidle", timeout: 60_000 },
  );
  await page.getByText("수업 일괄 예약하기", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  const ticketItems = page.locator(".select-ticket__item");
  const choices = [];
  for (let index = 0; index < await ticketItems.count(); index += 1) {
    const locator = ticketItems.nth(index);
    const text = await locator.innerText();
    choices.push({ locator, title: ticketChoiceTitle(text), text });
  }
  const selectedTicket = selectExactInstructorLessonTicket(choices);
  await selectedTicket.locator.click();

  const rangeInputs = page.locator(".el-range-input");
  await rangeInputs.first().waitFor({ state: "visible", timeout: 20_000 });
  const lessonListResponses = [];
  const responseListener = (response) => {
    if (
      response.request().method() === "GET"
      && response.url().includes("api.studiomate.kr")
      && /(lecture|booking|schedule)/i.test(response.url())
    ) {
      lessonListResponses.push({ ok: response.ok(), status: response.status(), url: response.url() });
    }
  };
  page.on("response", responseListener);
  let cards;
  try {
    await setElementDate(rangeInputs.nth(0), job.lessonDate);
    await setElementDate(rangeInputs.nth(1), job.lessonDate);
    await rangeInputs.nth(1).press("Enter");
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForFunction(() => !document.body.innerText.includes("수업 목록을 가져오는 중..."));
    cards = await readLectureCards(page);
  } finally {
    page.off("response", responseListener);
  }
  if (!cards.length) {
    const sourceColumnText = await page.locator(".lecture-list__list__column").first().innerText().catch(() => "");
    const hasEmptyState = /(수업|예약).{0,20}(없습니다|없어요|없음)|조회.{0,20}없습니다/.test(sourceColumnText);
    const hasSuccessfulSourceRead = lessonListResponses.some((response) => response.ok);
    if (!hasEmptyState && !hasSuccessfulSourceRead) {
      throw new Error("StudioMate 수업 목록 0건의 원천 응답 또는 빈 상태 화면을 확인하지 못했습니다.");
    }
  }
  const inspection = inspectInstructorLessonSessionCards(cards, job.lessonDate);
  if (inspection.status === "waiting_class_assignment") {
    return { status: "waiting_class_assignment", bookingIds: [], cards: [] };
  }
  const selectedCards = inspection.sessions;
  for (const card of selectedCards) {
    await page.locator(".lecture-list__list__column").first().locator(".lecture-item").nth(card.index).click();
  }
  const selectedCount = await page.locator(".lecture-list__list__column").nth(1).locator(".lecture-item").count();
  if (selectedCount !== INSTRUCTOR_LESSON_EXPECTED_SESSIONS) {
    throw new Error(`StudioMate 선택 수업이 ${selectedCount}건입니다. 예약을 중단했습니다.`);
  }

  await startExternalEffect(ref, job.claimToken, "bookings", "booking_create", {
    expectedSessions: selectedCards.map(sessionEvidence),
  });
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url() === "https://api.studiomate.kr/v2/staff/booking",
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "수업 예약 완료", exact: true }).click();
  const response = await responsePromise;
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok()) throw new Error(`StudioMate 예약 실패: ${response.status()} ${JSON.stringify(payload).slice(0, 700)}`);
  const success = Array.isArray(payload.success) ? payload.success : [];
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  if (success.length !== INSTRUCTOR_LESSON_EXPECTED_SESSIONS || errors.length) {
    throw new Error(`StudioMate 예약 결과가 성공 ${success.length}건·오류 ${errors.length}건입니다.`);
  }
  return { bookingIds: success.map((item) => String(item.id || "")).filter(Boolean), cards: selectedCards };
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
    const steps = {
      ...currentSteps,
      eformsign: newMember
        ? (eformStep.status && eformStep.status !== "pending"
          ? eformStep
          : stepValue("queued", "강사회원 가입서", "예약과 별개로 이폼싸인 브라우저 큐 등록"))
        : stepValue("not_required", "강사회원 가입서", "재수강 강사회원은 재발송하지 않음"),
      memo: newMember
        ? (memoStep.status && memoStep.status !== "pending"
          ? memoStep
          : stepValue("waiting_external", "가입서 완료 메모", "가입서 완료 뒤 자동 등록"))
        : stepValue("not_required", "가입서 완료 메모", "재수강 건"),
    };
    transaction.update(registrationRef, {
      mode: job.mode || currentJob.mode,
      steps,
      nextAction: "두 세션 예약 또는 반배정 대기 확인",
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

async function waitForClassAssignment(ref, claimToken, { mode, memberId, ticketId }) {
  const registrationRef = registration(ref.id);
  await db.runTransaction(async (transaction) => {
    const [jobSnapshot, registrationSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(registrationRef),
    ]);
    const currentJob = jobSnapshot.data() || {};
    if (!jobSnapshot.exists || currentJob.status !== "processing" || currentJob.claimToken !== claimToken) {
      throw new Error("반배정 대기 반영 전 작업 임대가 변경되었습니다.");
    }
    if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
    const registrationData = registrationSnapshot.data() || {};
    const steps = {
      ...(registrationData.steps || {}),
      bookings: stepValue("waiting_assignment", "두 세션 예약", "수업 미생성 · 반배정 뒤 자동 예약 재개"),
    };
    const state = deriveInstructorLessonRegistrationState({ mode, steps });
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, {
      status: "waiting_assignment",
      currentStep: "bookings_wait_assignment",
      attempts: 0,
      claimToken: null,
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      nextRunAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
      mode,
      studiomateMemberId: memberId,
      ticketId,
      externalEffectStarted: false,
      effectType: null,
      effectStartedAt: null,
      bookingEffectStartedAt: null,
      canonicalVerificationAttempts: 0,
      lastError: null,
      updatedAt: now,
    }, { merge: true });
    transaction.update(registrationRef, {
      status: state.status,
      nextAction: state.nextAction,
      steps,
      ...(state.status === "action_required" ? {} : { lastError: null }),
      updatedAt: now,
    });
  });
}

async function verifyCanonicalBookings(ref, job) {
  const attempts = Number(job.canonicalVerificationAttempts || 0) + 1;
  const verification = await canonicalBookingState(job);
  if (!verification.ok) {
    if (
      verification.duplicate
      || verification.count > INSTRUCTOR_LESSON_EXPECTED_SESSIONS
      || (verification.count === INSTRUCTOR_LESSON_EXPECTED_SESSIONS && !verification.expectedMatch)
    ) {
      throw new Error(`canonical 예약원천이 ${verification.count}건이거나 중복입니다. 자동 진행을 중단했습니다.`);
    }
    if (attempts < 16) {
      await commitClaimedState(ref, job.claimToken, {
        status: "pending",
        currentStep: "bookings_verify",
        canonicalVerificationAttempts: attempts,
        nextRunAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      }, null);
      return { status: "waiting_canonical_booking", detail: `예약원천 ${verification.count}/2건 · 재확인 대기` };
    }
    throw new Error(`예약 후 4시간 동안 canonical 예약원천이 ${verification.count}/2건입니다.`);
  }

  let registrationState = { status: "processing", nextAction: "두 세션 예약·원천 검증 중" };
  await db.runTransaction(async (transaction) => {
    const registrationRef = registration(ref.id);
    const [snapshot, registrationSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(registrationRef),
    ]);
    const current = snapshot.data() || {};
    if (!snapshot.exists || current.status !== "processing" || current.claimToken !== job.claimToken) {
      throw new Error("예약 검증 작업 임대가 변경되어 완료 반영을 중단했습니다.");
    }
    if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
    const registrationData = registrationSnapshot.data() || {};
    const now = FieldValue.serverTimestamp();
    const steps = {
      ...(registrationData.steps || {}),
      bookings: stepValue("verified", "두 세션 예약", "선택 수업과 canonical 예약원천이 정확히 2건 일치"),
      confirmation: stepValue("not_required", "예약 안내", "기존 강사레슨 D-1 안내 자동화가 canonical 예약원천을 사용"),
    };
    registrationState = deriveInstructorLessonRegistrationState({ mode: current.mode || job.mode, steps });
    transaction.set(ref, {
      status: "done",
      currentStep: "complete",
      bookingIds: verification.bookingIds,
      canonicalVerificationAttempts: attempts,
      completedAt: now,
      updatedAt: now,
      externalEffectStarted: false,
      lastError: null,
    }, { merge: true });
    transaction.update(registrationRef, {
      status: registrationState.status,
      nextAction: registrationState.nextAction,
      steps,
      "evidence.bookingIds": verification.bookingIds,
      updatedAt: now,
      ...(registrationState.status === "completed" ? { completedAt: now } : {}),
    });
  });
  return {
    status: registrationState.status,
    detail: registrationState.status === "completed"
      ? "예약 2건과 후속 처리 검증 완료"
      : `예약 2건 검증 · ${registrationState.nextAction}`,
  };
}

async function canonicalBookingState(job) {
  const snapshot = await db.collection("bookings")
    .where("studioId", "==", job.studioId)
    .where("lectureDate", "==", job.lessonDate)
    .get();
  const rows = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return validateCanonicalInstructorLessonBookings(rows, {
    phone: job.memberPhone,
    lessonDate: job.lessonDate,
    expectedSessions: job.expectedSessions || [],
    notBeforeMs: job.expectedSessions?.length ? timestampMillis(job.bookingEffectStartedAt) : 0,
  });
}

async function readLectureCards(page) {
  return page.locator(".lecture-list__list__column").first().locator(".lecture-item").evaluateAll((nodes) =>
    nodes.map((node, index) => ({
      index,
      date: normalizeCardDate(node.querySelector(".lecture-item__date")?.textContent || ""),
      time: String(node.querySelector(".lecture-item__time")?.textContent || "").trim().slice(0, 5),
      instructor: String(node.querySelector(".lecture-item__instructor")?.textContent || "").replace(/\s*강사\s*$/, "").trim(),
      title: String(node.querySelector(".lecture-item__title")?.textContent || "").trim(),
      full: node.classList.contains("full"),
      disabled: node.classList.contains("disabled"),
    })),
  );
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
    ["pending", "retry", "waiting_assignment"].map((status) =>
      db.collection("studiomateInstructorLessonJobs").where("status", "==", status).get()),
  );
  const now = Date.now();
  return snapshots.flatMap((snapshot) => snapshot.docs)
    .map((doc) => ({ ref: doc.ref, data: doc.data() }))
    .filter(({ data }) => !data.nextRunAt || timestampMillis(data.nextRunAt) <= now)
    .sort((a, b) => {
      const aWaiting = a.data.currentStep === "bookings_wait_assignment" ? 1 : 0;
      const bWaiting = b.data.currentStep === "bookings_wait_assignment" ? 1 : 0;
      return aWaiting - bWaiting || timestampMillis(a.data.createdAt) - timestampMillis(b.data.createdAt);
    })
    .slice(0, limit);
}

async function claimJob(ref) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !["pending", "retry", "waiting_assignment"].includes(String(snapshot.data()?.status || ""))) return null;
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
    ...(stepName === "bookings" ? { bookingEffectStartedAt: now } : {}),
    ...extraJobValues,
    updatedAt: now,
  }, {
    status: "processing",
    nextAction: `${effectType} 결과 확인 중`,
    [`steps.${stepName}`]: stepValue("processing", stepLabel(stepName), "외부 작업 실행 중"),
    ...(extraJobValues.expectedSessions ? { "evidence.expectedSessions": extraJobValues.expectedSessions } : {}),
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
    bookings: "두 세션 예약",
    bookings_verify: "예약 원천 확인",
  }[stepName] || stepName;
}

function registrationStepName(stepName) {
  const value = String(stepName || "member");
  return value.startsWith("bookings") ? "bookings" : value;
}

function nextStepLabel(stepName) {
  return {
    ticket: "강사레슨 (2T) 수강권 확인",
    bookings: "두 세션 예약",
    bookings_verify: "예약 원천 반영 확인",
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

function sessionEvidence(card) {
  return {
    date: String(card?.date || "").slice(0, 10),
    time: String(card?.time || "").slice(0, 5),
    instructor: normalizeInstructorLessonName(card?.instructor),
    title: normalizeInstructorLessonName(card?.title),
  };
}

function firstLine(value) {
  return normalizeInstructorLessonName(String(value || "").split(/\n/)[0]);
}

function ticketChoiceTitle(value) {
  return String(value || "").split(/\n/)
    .map((line) => normalizeInstructorLessonName(line))
    .find((line) => line === INSTRUCTOR_LESSON_TICKET_NAME) || firstLine(value);
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

function normalizeCardDate(value) {
  const match = String(value || "").match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
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
