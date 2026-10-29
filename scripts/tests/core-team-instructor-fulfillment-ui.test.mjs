import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { chromium } from "playwright";

const root = new URL("../../", import.meta.url);
const source = fs.readFileSync(new URL("core/assets/app.js", root), "utf8");
const functions = new Map([...source.matchAll(/^(?:async )?function (\w+)\([^]*?^\}/gm)].map(match => [match[1], match[0]]));
const names = ["qs", "setText", "escapeHtml", "toNumber", "compactDateTime",
  "instructorLessonMethodTitle", "instructorLessonScheduleDateLabel", "instructorLessonScheduleTimeLabel",
  "instructorLessonScheduleSourceLabel", "instructorLessonStatusLabel", "instructorLessonStatusTone",
  "instructorLessonModeLabel", "instructorLessonPaymentLabel", "instructorLessonStepClass",
  "instructorLessonStepStatusLabel", "instructorLessonRegistrationMatchesFilter", "instructorLessonConfirmationAction",
  "instructorLessonCancellationKey", "instructorLessonCancellationStatusLabel", "canCancelInstructorLesson",
  "renderInstructorLessonSchedule", "renderInstructorLessonRoster", "renderInstructorLessonRegistrationDashboard",
  "handleInstructorLessonConfirmation"];
for (const name of names) assert.ok(functions.has(name), `${name} extracted from actual UI`);
const constants = source.slice(source.indexOf("const INSTRUCTOR_LESSON_STEP_KEYS"), source.indexOf("function instructorLessonStatusLabel"));
const extracted = `${constants}\n${names.map(name => functions.get(name)).join("\n")}`;

function fixture(patch = {}) {
  const item = { registrationId: "synthetic-team", memberName: "Synthetic Instructor", phoneLast4: "0000",
    courseKind: "team", intakeOnly: true, teamFulfillmentStarted: true,
    ticketName: "Team 강사레슨", paymentAmount: 80000, paymentMethod: "wiretransfer",
    lessonDate: "2026-11-20", lessonTime: "14:00", lessonTopic: "ARCHIVE METHOD #1 직장인 증후군",
    status: "action_required", nextAction: "가입서 작성 확인", lastError: "",
    steps: { member: { status: "verified" }, ticket: { status: "verified" },
      eformsign: { status: "sent" }, memo: { status: "waiting_external" }, confirmation: { status: "failed" } },
    ...patch };
  return { items: [item], counts: { [item.status]: 1 }, schedule: { items: [{
    date: item.lessonDate, courseKind: item.courseKind, lessonTime: item.lessonTime, lessonTopic: item.lessonTopic,
    capacitySource: "default", occupiedCount: 1, capacity: 10, remainingSeats: 9, countSource: "registrations",
    roster: [{ memberKey: "synthetic-key", memberId: "synthetic-member", memberName: item.memberName,
      registrationId: item.registrationId, canCancel: true }],
  }] } };
}

function bootstrap(data) {
  return `
    const state = { instructorLessonRegistrationDashboard: ${JSON.stringify(data)} };
    let instructorLessonRegistrationFilter = "all", selectedInstructorLessonDate = "2026-11-20";
    let instructorLessonCancellationBusy = false;
    const instructorLessonCancellationReceipts = new Map();
    const readUnavailable = () => false, coreHref = path => "/core/" + path;
    const initFirebase = () => { throw new Error("Synthetic UI must never call Firebase"); };
    ${extracted}
    globalThis.qa = { state, render: renderInstructorLessonRegistrationDashboard,
      roster: renderInstructorLessonRoster, action: instructorLessonConfirmationAction,
      confirm: handleInstructorLessonConfirmation };
  `;
}

function app(data = fixture()) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "" });
    return elements.get(id);
  };
  const context = { document: { getElementById: element, querySelectorAll: () => [],
    documentElement: { dataset: { coreAccess: "manager" } } } };
  vm.runInNewContext(bootstrap(data), context, { timeout: 2000 });
  context.qa.render();
  return { qa: context.qa, element,
    card: () => element("instructorLessonRegistrationList").innerHTML,
    roster: () => element("instructorLessonScheduleDetail").innerHTML };
}

test("marked Team renders actual five steps and nextAction in card and roster", () => {
  const data = fixture(), before = JSON.stringify(data), a = app(data);
  assert.equal((a.card().match(/<li class=/g) || []).length, 5);
  assert.match(a.card(), /<small>회원<\/small><em>완료<\/em>/);
  assert.match(a.card(), /<small>수강권<\/small><em>완료<\/em>/);
  assert.match(a.card(), /<small>가입서<\/small><em>발송됨<\/em>/);
  assert.match(a.card(), /<small>메모<\/small><em>외부 확인 대기<\/em>/);
  assert.match(a.card(), /<small>안내<\/small><em>실패<\/em>/);
  assert.match(a.card(), /가입서 작성 확인/);
  assert.doesNotMatch(a.card(), /팀레슨 접수 완료 · 수강권\/가입서\/안내 확인 대기|수강권 확인 대기/);
  assert.match(a.roster(), /회원 완료 · 수강권 완료 · 가입서 발송됨 · 메모 외부 확인 대기 · 안내 실패/);
  assert.match(a.roster(), /다음 단계: 가입서 작성 확인/);
  assert.equal(JSON.stringify(data), before);
});

test("legacy Team intake without marker remains review-only even with stale verified steps", () => {
  const a = app(fixture({ teamFulfillmentStarted: undefined }));
  assert.match(a.card(), /팀레슨 접수 완료 · 수강권\/가입서\/안내 확인 대기/);
  assert.doesNotMatch(a.card(), /instructor-registration-progress/);
  assert.match(a.roster(), /팀레슨 접수 · 수강권\/가입서\/안내 확인 대기/);
  assert.doesNotMatch(a.roster(), /회원 완료/);
});

test("marker alone, invalid marker and absent steps never imply completion", () => {
  for (const marker of [true]) {
    const a = app(fixture({ teamFulfillmentStarted: marker, steps: {}, nextAction: "" }));
    assert.equal((a.card().match(/<em>대기<\/em>/g) || []).length, 5);
    assert.doesNotMatch(a.card(), /class="is-done"/);
    assert.match(a.card(), /다음 단계 확인필요/);
  }
  for (const marker of [false, null, "completed", "true", 1, {}, []]) {
    assert.doesNotMatch(app(fixture({ teamFulfillmentStarted: marker })).card(), /instructor-registration-progress/);
  }
  assert.doesNotMatch(app(fixture({ teamFulfillmentStarted: undefined, teamFulfillment: { source: "private" } })).card(), /instructor-registration-progress/);
});

test("unknown states remain explicit and nextAction is not hidden by lastError", () => {
  const a = app(fixture({ nextAction: "원본 문서 확인", lastError: "연결 확인필요",
    steps: { member: { status: "__proto__" }, ticket: { status: "queued" },
      eformsign: { status: "waiting_completion" }, memo: { status: "not_required" }, confirmation: { status: "processing" } } }));
  for (const text of ["상태 확인필요", "대기열", "작성 대기", "해당 없음", "처리중", "원본 문서 확인", "연결 확인필요"]) {
    assert.ok(a.card().includes(text)); assert.ok(a.roster().includes(text));
  }
});

test("Team guards block normal retry/cancellation and crafted confirmation clicks", async () => {
  for (const patch of [{}, { intakeOnly: false }, { courseKind: undefined }]) {
    const data = fixture(patch), a = app(data), item = data.items[0];
    assert.equal(a.qa.action(item), "");
    assert.doesNotMatch(a.card() + a.roster(), /data-confirm-instructor-lesson|data-instructor-cancel-key/);
    const button = { dataset: { confirmInstructorLesson: item.registrationId }, disabled: false };
    await a.qa.confirm({ target: { closest: () => button } });
    assert.equal(button.disabled, false);
  }
});

test("ordinary 2T progress and recovery action remain unchanged", () => {
  const a = app(fixture({ courseKind: undefined, intakeOnly: false, teamFulfillmentStarted: undefined,
    ticketName: "강사레슨 (2T)", mode: "returning_member" }));
  assert.equal((a.card().match(/<li class=/g) || []).length, 6);
  assert.match(a.card(), /data-confirm-instructor-lesson="synthetic-team"/);
  assert.match(a.card(), /재수강 강사회원/);
  assert.match(a.roster(), /가입서 대기 · 안내 확인필요/);
  assert.match(a.roster(), /data-instructor-cancel-key/);
});

test("all added Team display text is escaped and raw marker evidence is never rendered", () => {
  const raw = '<img src=x onerror="evil()">';
  const a = app(fixture({ nextAction: raw, lastError: raw, teamFulfillment: { privateEvidence: "DO_NOT_RENDER" },
    steps: { member: { status: "verified", label: raw, detail: raw } } }));
  assert.doesNotMatch(a.card() + a.roster(), /<img|onerror="evil|DO_NOT_RENDER/);
  assert.match(a.card(), /&lt;img/);
  assert.match(a.roster(), /&lt;img/);
});

test("offline responsive Team progress remains usable at 320, 390, 768 and 1440px", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const css = ["core/assets/styles.css", "core/assets/interface.css"]
      .map(path => fs.readFileSync(new URL(path, root), "utf8")).join("\n");
    for (const width of [320, 390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        await context.route("**/*", route => route.abort());
        const page = await context.newPage();
        await page.setContent(`<html data-core-access="manager"><head><style>${css}</style></head><body>
          <main style="padding:16px;max-width:1100px;margin:auto;min-width:0">
          <div id="instructorLessonScheduleList"></div><div id="instructorLessonScheduleDetail"></div>
          <div id="instructorLessonRegistrationList"></div></main></body></html>`);
        await page.addScriptTag({ content: bootstrap(fixture()) + "\nqa.render();" });
        assert.equal(await page.locator(".instructor-registration-progress li").count(), 5);
        assert.equal(await page.locator("[data-confirm-instructor-lesson],[data-instructor-cancel-key]").count(), 0);
        assert.equal(await page.locator(".instructor-registration-progress .is-done").count(), 2);
        assert.match(await page.locator("#instructorLessonScheduleDetail").innerText(), /다음 단계: 가입서 작성 확인/);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `overflow at ${width}`);
        const overflow = await page.locator(".instructor-registration-progress li").evaluateAll(nodes =>
          nodes.some(node => node.scrollWidth > node.clientWidth + 1));
        assert.equal(overflow, false, `step text overflow at ${width}`);
        const png = await page.screenshot();
        assert.ok(png.length > 1000, `nonblank screenshot at ${width}`);
      } finally { await context.close(); }
    }
  } finally {
    await browser.close();
    assert.equal(browser.isConnected(), false);
    assert.equal(browser.contexts().length, 0);
  }
});
