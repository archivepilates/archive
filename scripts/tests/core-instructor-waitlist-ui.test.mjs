import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import { chromium } from "playwright";

const root = new URL("../../", import.meta.url);
const output = new URL("artifacts/core-instructor-waitlist-ui/", root);
const files = ["core/assets/app.js", "core/instructor-lessons/index.html", "core/assets/styles.css", "core/assets/interface.css"];
const sources = await Promise.all(files.map(file => fs.readFile(new URL(file, root), "utf8")));
const [source, html, styles, interfaceStyles] = sources;
const functions = new Map([...source.matchAll(/^(?:async )?function (\w+)\([^]*?^\}/gm)].map(match => [match[1], match[0]]));
const names = [
  "qs", "setText", "escapeHtml", "toNumber", "normalizePhone", "compactDateTime",
  "instructorLessonMethodTitle", "instructorLessonScheduleDateLabel", "instructorLessonScheduleTimeLabel",
  "instructorLessonScheduleSourceLabel", "instructorLessonSchedulePresentation", "instructorLessonStatusLabel", "instructorLessonStatusTone",
  "instructorLessonModeLabel", "instructorLessonPaymentLabel", "instructorLessonStepClass",
  "instructorLessonStepStatusLabel", "instructorLessonRegistrationMatchesFilter", "instructorLessonConfirmationAction",
  "instructorLessonCancellationKey", "instructorLessonCancellationStatusLabel", "canCancelInstructorLesson",
  "renderInstructorLessonSchedule", "renderInstructorLessonRoster", "renderInstructorLessonRegistrationDashboard",
  "setInstructorLessonRegistrationStatus", "loadInstructorLessonRegistrationDashboard",
  "handleInstructorLessonCourseKindChange", "handleInstructorLessonRegistrationSubmit",
  "handleInstructorLessonRegistrationFilter", "handleInstructorLessonConfirmation",
];
for (const name of names) assert.ok(functions.has(name), `${name} extracted from app.js`);
const constants = source.slice(source.indexOf("const INSTRUCTOR_LESSON_STEP_KEYS"), source.indexOf("function instructorLessonStatusLabel"));
const extracted = `${constants}\n${names.map(name => functions.get(name)).join("\n")}`;
const date = "2026-11-28", emptyDate = "2026-11-29";
const hostile = '<img src=x onerror="globalThis.__injected=true"> & 합성';
const waitlistedAt = "2026-10-30T03:00:00.000Z";

function fixture() {
  const paid = ["queued", "completed"].map((status, index) => ({ registrationId: `synthetic-paid-${index}`,
    memberName: `합성 확정 ${index + 1}`, lessonDate: date, status, phoneLast4: "0001", paymentMethod: "card",
    updatedAt: waitlistedAt, steps: {} }));
  const waitlist = [1, 2].map(position => ({ registrationId: `synthetic-wait-${position}`, position,
    memberName: position === 1 ? "합성 대기 1" : hostile, memberPhone: position === 1 ? "01000000002" : hostile,
    phoneLast4: "0002", waitlistedAt }));
  const items = [...paid, { registrationId: "synthetic-team", courseKind: "team", intakeOnly: true,
    memberName: "합성 팀", phoneLast4: "0003", lessonDate: date, status: "action_required", steps: {} },
    ...waitlist.map(member => ({ ...member, lessonDate: date, courseKind: "waitlist", waitlistOnly: true,
      mode: "waitlist", paymentMethod: "none", status: "waitlisted",
      steps: { member: { status: "verified" }, ticket: { status: "verified" }, confirmation: { status: "failed" } } }))];
  return { items, counts: { queued: 1, completed: 1, action_required: 1, waitlisted: 2 }, schedule: { items: [
    { date, occupiedCount: 2, capacity: 2, remainingSeats: 0, countSource: "tickets", waitlistCount: 2,
      waitlist: [...waitlist].reverse(), roster: paid.map((item, index) => ({ registrationId: item.registrationId,
        memberKey: `synthetic-key-${index}`, memberId: `synthetic-member-${index}`, memberName: item.memberName, canCancel: true })) },
    { date: emptyDate, occupiedCount: 0, capacity: 10, remainingSeats: 10, countSource: "none", roster: [], waitlistCount: 0, waitlist: [] },
  ] } };
}

function bootstrap(data = fixture()) {
  return `
    const state = { instructorLessonRegistrationDashboard: ${JSON.stringify(data)} };
    let selectedInstructorLessonDate = ${JSON.stringify(date)}, instructorLessonRegistrationFilter = "waitlisted";
    let instructorLessonCancellationBusy = false;
    const instructorLessonCancellationReceipts = new Map();
    let unavailable = false, response = { waitlistOnly: true, status: "waitlisted" }, transportError = false, refreshError = false;
    let releaseCreate, holdCreate = false;
    const calls = [], forbidden = [];
    const readUnavailable = () => unavailable, setReadState = (_, status) => { unavailable = status === "unavailable"; };
    const isPermissionDenied = () => false, showLoginGate = () => { throw new Error("No auth in synthetic QA"); };
    const coreHref = path => "/core/" + path;
    const initFirebase = async () => ({ functionsClient: {}, httpsCallable: (_, name) => async payload => {
      calls.push({ name, payload });
      if (name === "getInstructorLessonRegistrationDashboard") {
        if (refreshError) throw new Error("synthetic read lost");
        return { data: state.instructorLessonRegistrationDashboard };
      }
      if (name !== "operatorCreateInstructorLessonRegistration") { forbidden.push(name); throw new Error("Forbidden callable: " + name); }
      if (holdCreate) await new Promise(resolve => { releaseCreate = resolve; });
      if (transportError) throw new Error("synthetic response lost");
      return { data: payload.courseKind === "team" ? { intakeOnly: true, status: "action_required" }
        : payload.courseKind === "waitlist" ? response : { status: "queued" } };
    } });
    ${extracted}
    globalThis.qa = { state, calls, forbidden, render: renderInstructorLessonRegistrationDashboard,
      mode: handleInstructorLessonCourseKindChange, submit: handleInstructorLessonRegistrationSubmit,
      confirmationAction: instructorLessonConfirmationAction, confirm: handleInstructorLessonConfirmation,
      canCancel: canCancelInstructorLesson, roster: renderInstructorLessonRoster,
      filter: value => { instructorLessonRegistrationFilter = value; renderInstructorLessonRegistrationDashboard(); },
      configure: options => { response = options.response ?? response; transportError = !!options.transportError; refreshError = !!options.refreshError; },
      hold: () => { holdCreate = true; }, release: () => { holdCreate = false; releaseCreate(); } };
  `;
}

function app() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "", value: "", checked: false,
      disabled: false, required: false, hidden: false, focus() {}, reportValidity: () => true });
    return elements.get(id);
  };
  const context = { document: { getElementById: element, querySelectorAll: () => [], documentElement: { dataset: { coreAccess: "manager" } } } };
  vm.runInNewContext(bootstrap(), context, { timeout: 2000 });
  for (const [id, value] of Object.entries({ CourseKind: "waitlist", MemberName: " Synthetic instructor ",
    MemberPhone: "010-0000-0002", Date: date, PaymentMethod: "card", Time: "14:30", Topic: "Synthetic topic", PaymentAmount: "80000" })) {
    element(`instructorLesson${id}`).value = value;
  }
  element("instructorLessonPaymentConfirmed").checked = true;
  element("instructorLessonSeatConfirmed").checked = true;
  context.qa.mode();
  return { ...context.qa, element, document: context.document,
    submit: () => context.qa.submit({ preventDefault() {}, currentTarget: element("instructorLessonRegistrationForm") }) };
}

const creates = a => a.calls.filter(call => call.name === "operatorCreateInstructorLessonRegistration");
const status = a => a.element("instructorLessonRegistrationStatus").textContent;

test("mode toggles preserve identity/team values but require fresh paid checks", () => {
  const a = app();
  for (const mode of ["team", "waitlist", "standard", "waitlist", "team"]) {
    a.element("instructorLessonCourseKind").value = mode; a.mode();
    for (const id of ["PaymentMethod", "PaymentConfirmed", "SeatConfirmed"]) {
      assert.equal(a.element(`instructorLesson${id}`).disabled, mode === "waitlist");
      assert.equal(a.element(`instructorLesson${id}`).required, mode !== "waitlist");
    }
    for (const id of ["Time", "Topic", "PaymentAmount"]) {
      assert.equal(a.element(`instructorLesson${id}`).disabled, mode !== "team");
      assert.equal(a.element(`instructorLesson${id}`).required, mode === "team");
    }
    assert.equal(a.element("instructorLessonMemberName").value, " Synthetic instructor ");
    assert.equal(a.element("instructorLessonMemberPhone").value, "010-0000-0002");
    assert.equal(a.element("instructorLessonDate").value, date);
    assert.equal(a.element("instructorLessonPaymentMethod").value, "card");
    assert.equal(a.element("instructorLessonPaymentConfirmed").checked, false);
    assert.equal(a.element("instructorLessonSeatConfirmed").checked, false);
    assert.equal(a.element("instructorLessonTopic").value, "Synthetic topic");
    assert.equal(a.element("instructorLessonTime").value, "14:30");
    assert.equal(a.element("instructorLessonPaymentAmount").value, "80000");
  }
  assert.equal(a.calls.length, 0);
});

test("waitlist submits only the agreed payload; same phone/date can later be submitted as paid", async () => {
  const a = app();
  await a.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(creates(a)[0].payload)), { memberName: "Synthetic instructor", memberPhone: "01000000002",
    lessonDate: date, courseKind: "waitlist", paymentMethod: "none", paymentConfirmed: false, seatConfirmed: false });
  assert.equal(status(a), "수강대기를 등록했습니다.");
  assert.match(a.element("instructorLessonRegistrationList").innerHTML, /instructor-waitlist-registration/);
  a.element("instructorLessonMemberName").value = "Synthetic instructor";
  a.element("instructorLessonMemberPhone").value = "01000000002";
  await a.submit();
  assert.equal(creates(a).length, 1, "no replay of accepted waitlist");
  a.element("instructorLessonCourseKind").value = "standard"; a.mode();
  a.element("instructorLessonPaymentConfirmed").checked = true;
  a.element("instructorLessonSeatConfirmed").checked = true;
  await a.submit();
  assert.equal(creates(a).length, 2);
  assert.deepEqual(Object.keys(creates(a)[1].payload).sort(), ["lessonDate", "memberName", "memberPhone", "paymentConfirmed", "paymentMethod", "seatConfirmed"]);
  assert.equal(creates(a)[1].payload.paymentMethod, "card");
  assert.equal(creates(a)[1].payload.paymentConfirmed, true);
  assert.equal(creates(a)[1].payload.seatConfirmed, true);
  assert.equal(status(a), "등록했습니다. StudioMate 자동 처리를 시작합니다.");
  assert.equal(a.forbidden.length, 0);
});

test("waitlisted items are separate from progress/review counts, actions and paid roster", async () => {
  const a = app(); a.render();
  assert.equal(a.element("instructorLessonActiveCount").textContent, "1건");
  assert.equal(a.element("instructorLessonReviewCount").textContent, "1건");
  assert.equal(a.element("instructorLessonCompletedCount").textContent, "1건");
  assert.equal(a.element("instructorLessonSignatureCount").textContent, "0건");
  for (const filter of ["active", "review", "completed"]) {
    a.filter(filter);
    assert.doesNotMatch(a.element("instructorLessonRegistrationList").innerHTML, /instructor-waitlist-registration/);
  }
  a.filter("waitlisted");
  assert.equal((a.element("instructorLessonRegistrationList").innerHTML.match(/<article/g) || []).length, 2);
  assert.doesNotMatch(a.element("instructorLessonRegistrationList").innerHTML, /data-confirm|data-instructor-cancel|registration-progress|강사레슨 \(2T\)/);
  a.filter("all");
  assert.equal((a.element("instructorLessonRegistrationList").innerHTML.match(/<article/g) || []).length, 5);
  for (const waiter of a.state.instructorLessonRegistrationDashboard.items.filter(item => item.waitlistOnly)) {
    assert.equal(a.confirmationAction(waiter), "");
    assert.equal(a.canCancel(date, { ...waiter, memberId: "synthetic", memberKey: "synthetic", canCancel: true }), false);
    await a.confirm({ target: { closest: () => ({ dataset: { confirmInstructorLesson: waiter.registrationId } }) } });
  }
  assert.equal(a.calls.length, 0, "no sends or other unintended writes");
  const schedule = a.state.instructorLessonRegistrationDashboard.schedule.items[0];
  a.roster({ ...schedule, roster: [...schedule.roster, { ...schedule.waitlist[0] }] });
  assert.equal((a.element("instructorLessonScheduleDetail").innerHTML.match(/class="status-row instructor-lesson-roster-row"/g) || []).length, 2);
  a.document.documentElement.dataset.coreAccess = "staff"; a.roster(schedule);
  assert.doesNotMatch(a.element("instructorLessonScheduleDetail").innerHTML, /01000000002/);
  assert.match(a.element("instructorLessonScheduleDetail").innerHTML, /\*\*\*-\*\*\*\*-0002/);
  a.roster({ ...schedule, roster: undefined });
  assert.match(a.element("instructorLessonScheduleDetail").innerHTML, /명단 연결 확인/);
  assert.match(a.element("instructorLessonScheduleDetail").innerHTML, /수강대기/);
});

test("invalid phone is rejected without any callable", async () => {
  const a = app(); a.element("instructorLessonMemberPhone").value = "not-a-phone";
  await a.submit(); assert.equal(a.calls.length, 0); assert.match(status(a), /11자리/);
});

for (const scenario of ["duplicate", "duplicate-paid", "missing-receipt", "contradictory-receipt", "transport", "refresh"]) {
  test(`${scenario}: exact receipt messaging, input retention, and no repeated write`, async () => {
    const a = app();
    a.configure(scenario === "duplicate" ? { response: { duplicate: true, waitlistOnly: true, status: "waitlisted" } }
      : scenario === "duplicate-paid" ? { response: { duplicate: true, status: "queued" } }
      : scenario === "missing-receipt" ? { response: {} }
      : scenario === "contradictory-receipt" ? { response: { waitlistOnly: true, status: "queued" } }
      : scenario === "transport" ? { transportError: true } : { refreshError: true });
    await a.submit();
    assert.equal(creates(a).length, 1);
    if (scenario === "duplicate") assert.equal(status(a), "기존 수강대기를 확인했습니다.");
    else if (scenario === "refresh") assert.match(status(a), /수강대기 등록 확인.*새로고침에 실패/);
    else assert.match(status(a), /확인.*중복 등록하지 말고/);
    if (scenario !== "refresh") assert.equal(a.element("instructorLessonMemberPhone").value, "010-0000-0002");
    assert.doesNotMatch(status(a), /자동 처리|발송했습니다/);
    a.element("instructorLessonMemberPhone").value = "01000000002";
    await a.submit(); assert.equal(creates(a).length, 1);
    assert.equal(a.forbidden.length, 0);
  });
}

function layout() {
  const main = document.querySelector("main"), issues = [], rects = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let text;
  while ((text = walker.nextNode())) {
    if (!text.textContent.trim() || !text.parentElement.checkVisibility()) continue;
    const range = document.createRange(); range.selectNodeContents(text);
    const label = text.textContent.trim().slice(0, 55);
    for (const r of [...range.getClientRects()].filter(r => r.width && r.height)) {
      rects.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, label });
      if (r.left < -1 || r.right > innerWidth + 1) issues.push(`outside viewport: ${label}`);
      for (let node = text.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node), b = node.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (r.left < b.left + node.clientLeft - 1 || r.right > b.left + node.clientLeft + node.clientWidth + 1)) issues.push(`clipped x: ${label}`);
        if (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (r.top < b.top + node.clientTop - 1 || r.bottom > b.top + node.clientTop + node.clientHeight + 1)) issues.push(`clipped y: ${label}`);
      }
    }
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push(`overlap: ${a.label} / ${b.label}`);
  }
  for (const node of main.querySelectorAll("*")) {
    if (node.checkVisibility() && node.clientWidth && node.scrollWidth > node.clientWidth + 1 && !node.matches("input,textarea")) issues.push(`element overflow: ${node.id || node.className}`);
  }
  const controls = [...main.querySelectorAll("button,input,select")].filter(node => node.checkVisibility()).map(node => {
    const r = (node.type === "checkbox" ? node.closest("label") : node).getBoundingClientRect();
    if (r.left < -1 || r.right > innerWidth + 1) issues.push(`control outside viewport: ${node.id}`);
    return { id: node.id || node.textContent.trim(), width: r.width, height: r.height };
  });
  return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, issues, controls, textLines: rects.length };
}

test("offline browser: fitting waitlist form, counts, roster, filters and submission at four widths", { timeout: 90000 }, async t => {
  await fs.mkdir(output, { recursive: true });
  const report = { syntheticOnly: true, scenarios: [], network: [], errors: [], forbidden: [], cleanup: {} };
  const cleanHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<link\b[^>]*>/g, "");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 768, 1440]) {
      await t.test(`${width}px layout, modes, payload, busy and duplicate response`, async () => {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width <= 390, isMobile: width <= 390,
          offline: true, serviceWorkers: "block", reducedMotion: "reduce", locale: "ko-KR", timezoneId: "Asia/Seoul", storageState: { cookies: [], origins: [] } });
        try {
          await context.route("**/*", route => { report.network.push(route.request().url()); return route.abort(); });
          await context.routeWebSocket("**/*", socket => { report.network.push(socket.url()); socket.close(); });
          const page = await context.newPage();
          page.on("pageerror", error => report.errors.push(error.message));
          await page.setContent(cleanHtml);
          await page.addStyleTag({ content: `${styles}\n${interfaceStyles}` });
          await page.addScriptTag({ content: `${bootstrap()}
            document.documentElement.dataset.coreAccess = "manager";
            qs("coreAccessLoading").remove();
            document.querySelectorAll("details").forEach(node => { node.open = true; });
            qs("instructorLessonCourseKind").addEventListener("change", handleInstructorLessonCourseKindChange);
            qs("instructorLessonRegistrationForm").addEventListener("submit", handleInstructorLessonRegistrationSubmit);
            qs("instructorLessonRegistrationFilters").addEventListener("click", handleInstructorLessonRegistrationFilter);
            qs("instructorLessonScheduleList").addEventListener("click", event => {
              const button = event.target.closest("[data-instructor-schedule-date]");
              if (button) { selectedInstructorLessonDate = selectedInstructorLessonDate === button.dataset.instructorScheduleDate ? "" : button.dataset.instructorScheduleDate; renderInstructorLessonSchedule(); }
            });
            handleInstructorLessonCourseKindChange(); renderInstructorLessonRegistrationDashboard();` });
          const mode = page.locator("#instructorLessonCourseKind");
          await page.locator("#instructorLessonMemberName").fill("합성 입력 강사");
          await page.locator("#instructorLessonMemberPhone").fill("01000000002");
          await page.locator("#instructorLessonDate").fill(date);
          await page.locator("#instructorLessonPaymentMethod").selectOption("card");
          await page.locator("#instructorLessonPaymentConfirmed").check();
          await page.locator("#instructorLessonSeatConfirmed").check();
          let waitingSelected = false;
          for (const value of ["team", "waitlist", "standard", "team", "waitlist"]) {
            await mode.selectOption(value);
            if (value === "waitlist") waitingSelected = true;
            for (const id of ["PaymentMethod", "PaymentConfirmed", "SeatConfirmed"]) {
              assert.equal(await page.locator(`#instructorLesson${id}`).isDisabled(), value === "waitlist");
              assert.equal(await page.locator(`#instructorLesson${id}`).evaluate(node => node.required), value !== "waitlist");
            }
            for (const id of ["Time", "Topic", "PaymentAmount"]) {
              assert.equal(await page.locator(`#instructorLesson${id}`).isDisabled(), value !== "team");
              assert.equal(await page.locator(`#instructorLesson${id}`).evaluate(node => node.required), value === "team");
            }
            assert.equal(await page.locator("#instructorLessonMemberName").inputValue(), "합성 입력 강사");
            assert.equal(await page.locator("#instructorLessonMemberPhone").inputValue(), "01000000002");
            assert.equal(await page.locator("#instructorLessonPaymentMethod").inputValue(), "card");
            assert.equal(await page.locator("#instructorLessonPaymentConfirmed").isChecked(), !waitingSelected);
            assert.equal(await page.locator("#instructorLessonPaymentConfirmed").isVisible(), value !== "waitlist");
            assert.equal(await page.locator("#instructorLessonPaymentMethod").isVisible(), value !== "waitlist");
          }
          assert.equal(await page.locator("#instructorLessonRegistrationForm").evaluate(node => node.checkValidity()), true);
          assert.equal(await page.locator("#instructorLessonRegularFlow").isVisible(), false);
          assert.equal(await page.locator("#instructorLessonTeamFlow").isVisible(), false);
          assert.equal(await page.locator("#instructorLessonWaitlistFlow").isVisible(), true);
          assert.equal(await page.locator(".instructor-seat-waitlist-count").first().innerText(), "대기 2명");
          assert.equal(await page.locator(".instructor-seat-waitlist-count").nth(1).innerText(), "대기 0명");
          assert.match(await page.locator(".instructor-seat-progress").first().getAttribute("aria-label"), /2명 접수, 정원 2명/);
          assert.match(await page.locator("#instructorLessonScheduleSummary").innerText(), /잔여 10석/);
          assert.equal(await page.locator(".instructor-lesson-roster-row").count(), 2);
          assert.equal(await page.locator(".instructor-waitlist-row").count(), 2);
          assert.match(await page.locator(".instructor-waitlist-row").first().innerText(), /1번.*합성 대기 1.*01000000002.*접수/s);
          assert.equal(await page.locator(".instructor-waitlist-row strong").nth(1).textContent(), hostile);
          assert.equal(await page.locator(".instructor-waitlist button,.instructor-waitlist-registration button").count(), 0);
          assert.equal(await page.locator("#instructorLessonScheduleDetail img,#instructorLessonRegistrationList img").count(), 0);
          assert.equal(await page.evaluate(() => globalThis.__injected), undefined);
          for (const filter of ["active", "review", "completed", "all", "waitlisted"]) {
            await page.locator(`[data-instructor-registration-filter="${filter}"]`).click();
            assert.equal(await page.locator(".instructor-registration-item").count(), filter === "all" ? 5 : filter === "waitlisted" ? 2 : 1);
            assert.equal(await page.locator(`[data-instructor-registration-filter="${filter}"]`).getAttribute("aria-pressed"), "true");
          }
          await page.keyboard.press("Tab"); await mode.focus();
          assert.equal(await mode.evaluate(node => node.matches(":focus-visible") && getComputedStyle(node).outlineStyle !== "none"), true);
          const result = { width, layout: await page.evaluate(layout), screenshot: new URL(`waitlist-${width}.png`, output).pathname };
          report.scenarios.push(result);
          await page.screenshot({ path: result.screenshot, fullPage: true });
          assert.ok(result.layout.textLines > 50, "nonblank screen");
          assert.ok(result.layout.scrollWidth <= width);
          assert.deepEqual(result.layout.issues, []);
          for (const control of result.layout.controls) assert.ok(control.width >= 44 && control.height >= 44, JSON.stringify(control));
          const emptyCard = page.locator(`[data-instructor-schedule-date="${emptyDate}"]`);
          if (width <= 390) await emptyCard.tap(); else await emptyCard.click();
          assert.equal(await page.locator(".instructor-waitlist-row").count(), 0);
          assert.equal(await page.locator(".instructor-waitlist-empty").innerText(), "대기자 없음");
          assert.equal(await page.evaluate(() => qa.calls.length), 0, "read-only controls make no callable requests");
          await page.evaluate(() => { qa.configure({ response: { duplicate: true, waitlistOnly: true, status: "waitlisted" } }); qa.hold(); });
          await page.locator("#instructorLessonRegistrationSubmit").click();
          await page.waitForFunction(() => qa.calls.length === 1);
          assert.equal(await mode.isDisabled(), true);
          await page.evaluate(() => qa.submit({ preventDefault() {}, currentTarget: document.querySelector("#instructorLessonRegistrationForm") }));
          assert.equal(await page.evaluate(() => qa.calls.length), 1);
          await page.evaluate(() => qa.release());
          await page.waitForFunction(() => !document.querySelector("#instructorLessonRegistrationSubmit").disabled);
          assert.equal(await page.locator("#instructorLessonRegistrationStatus").innerText(), "기존 수강대기를 확인했습니다.");
          assert.deepEqual(await page.evaluate(() => qa.calls[0].payload), { memberName: "합성 입력 강사", memberPhone: "01000000002",
            lessonDate: date, courseKind: "waitlist", paymentMethod: "none", paymentConfirmed: false, seatConfirmed: false });
          await page.locator("#instructorLessonRegistrationSubmit").click();
          assert.equal(await page.evaluate(() => qa.calls.filter(call => call.name === "operatorCreateInstructorLessonRegistration").length), 1);
          assert.equal(await page.locator('[data-instructor-registration-filter="waitlisted"]').getAttribute("aria-pressed"), "true");
          report.forbidden.push(...await page.evaluate(() => qa.forbidden));
          result.passed = true;
        } finally { await context.close(); assert.equal(context.pages().length, 0); }
      });
    }
    assert.deepEqual(report.network, [], "zero external requests, real writes, Firebase or auth");
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.forbidden, []);
  } finally {
    await browser.close();
    report.cleanup = { browserClosed: !browser.isConnected(), contextsRemaining: browser.contexts().length };
    report.sources = await Promise.all(files.map(async (file, index) => ({ file,
      sha256: createHash("sha256").update(sources[index]).digest("hex"), unchanged: await fs.readFile(new URL(file, root), "utf8") === sources[index] })));
    await fs.writeFile(new URL("report.json", output), JSON.stringify(report, null, 2));
    assert.deepEqual(report.cleanup, { browserClosed: true, contextsRemaining: 0 });
    assert.ok(report.sources.every(file => file.unchanged), "screenshots must use one source revision");
    t.diagnostic(`Synthetic only. Evidence: ${output.pathname}`);
  }
});
