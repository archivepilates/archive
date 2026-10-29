import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import { chromium } from "playwright";

const root = new URL("../../", import.meta.url);
const output = new URL("artifacts/team-instructor-intake-qa/", root);
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
for (const name of names) assert.ok(functions.has(name), `${name} is extracted from actual app.js`);
const constants = source.slice(source.indexOf("const INSTRUCTOR_LESSON_STEP_KEYS"), source.indexOf("function instructorLessonStatusLabel"));
const extracted = `${constants}\n${names.map(name => functions.get(name)).join("\n")}`;
const date = "2026-11-28";
const topic = '합성 팀레슨 <img src=x onerror="globalThis.__topicExecuted=true"> & 움직임';

function fixture() {
  const items = Array.from({ length: 6 }, (_, index) => ({
    registrationId: `synthetic-team-${index}`, memberName: `합성 강사 ${index + 1}`, phoneLast4: "0000",
    courseKind: "team", intakeOnly: true, lessonDate: date, lessonTime: "14:30", lessonTopic: topic,
    paymentAmount: 80000, paymentMethod: "wiretransfer", status: "action_required", updatedAt: "2026-10-29T03:00:00Z",
    // Even stale verified steps must not expose a Team confirmation action.
    steps: { member: { status: "verified" }, ticket: { status: "verified" }, confirmation: { status: "failed" } },
  }));
  return { items, counts: { action_required: 6 }, schedule: { items: [{
    date, courseKind: "team", lessonTime: "14:30", lessonTopic: topic, metadataSource: "registration",
    startAt: `${date}T14:30:00+09:00`, endAt: null, sessionCount: 0,
    occupiedCount: 6, registrationCount: 6, capacity: 10, remainingSeats: 4, overbookedCount: 0,
    capacitySource: "default", countSource: "registrations", confirmedPendingRegistrationCount: 6,
    roster: items.map((item, index) => ({ registrationId: item.registrationId, memberKey: `synthetic-key-${index}`,
      memberId: `synthetic-member-${index}`, memberName: item.memberName, canCancel: true })),
  }] } };
}

function bootstrap(data) {
  return `
    const state = { instructorLessonRegistrationDashboard: ${JSON.stringify(data)} };
    let selectedInstructorLessonDate = ${JSON.stringify(date)}, instructorLessonRegistrationFilter = "review";
    let instructorLessonCancellationBusy = false;
    const instructorLessonCancellationReceipts = new Map();
    const readUnavailable = () => false, setReadState = () => {}, isPermissionDenied = () => false;
    const showLoginGate = () => { throw new Error("No auth in synthetic QA"); };
    const coreHref = path => "/core/" + path;
    const calls = [];
    let holdCreate = false, releaseCreate;
    const initFirebase = async () => ({ functionsClient: {}, httpsCallable: (_, name) => async payload => {
      calls.push({ name, payload });
      if (name === "getInstructorLessonRegistrationDashboard") return { data: state.instructorLessonRegistrationDashboard };
      if (name !== "operatorCreateInstructorLessonRegistration") throw new Error("Forbidden synthetic callable: " + name);
      if (holdCreate) await new Promise(resolve => { releaseCreate = resolve; });
      return { data: payload.courseKind === "team" ? { intakeOnly: true, status: "action_required" } : { status: "queued" } };
    } });
    ${extracted}
    globalThis.qa = { state, calls, render: renderInstructorLessonRegistrationDashboard,
      mode: handleInstructorLessonCourseKindChange, submit: handleInstructorLessonRegistrationSubmit,
      method: instructorLessonMethodTitle, confirm: handleInstructorLessonConfirmation,
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
  vm.runInNewContext(bootstrap(fixture()), context, { timeout: 2000 });
  element("instructorLessonMemberName").value = "Synthetic instructor";
  element("instructorLessonMemberPhone").value = "01000000001";
  element("instructorLessonDate").value = date;
  element("instructorLessonPaymentMethod").value = "wiretransfer";
  element("instructorLessonPaymentConfirmed").checked = true;
  element("instructorLessonSeatConfirmed").checked = true;
  element("instructorLessonTime").value = "14:30";
  element("instructorLessonTopic").value = " Synthetic topic ";
  element("instructorLessonPaymentAmount").value = "80000";
  return { ...context.qa, element, submit: () => context.qa.submit({ preventDefault() {}, currentTarget: element("instructorLessonRegistrationForm") }) };
}

test("extracted helper preserves legacy coercion, server topics, conflict review and date fallback", () => {
  const a = app();
  for (const value of [date, Object.freeze({ toString: () => date }), { date }, { lessonDate: date }]) {
    assert.equal(a.method(value), "ARCHIVE METHOD #10 전신 통합 움직임");
  }
  assert.equal(a.method({ date, lessonTopic: topic }), topic);
  assert.equal(a.method({ date, lessonTopic: topic, metadataSource: "conflict" }), "");
});

test("standard payload and result remain unchanged; Team fields are typed and intake-only", async () => {
  const a = app();
  a.element("instructorLessonCourseKind").value = "standard";
  a.mode();
  assert.equal(a.element("instructorLessonTime").disabled, true);
  await a.submit();
  assert.deepEqual(Object.keys(a.calls[0].payload).sort(), ["lessonDate", "memberName", "memberPhone", "paymentConfirmed", "paymentMethod", "seatConfirmed"]);
  assert.equal(a.element("instructorLessonRegistrationStatus").textContent, "등록했습니다. StudioMate 자동 처리를 시작합니다.");
  const b = app();
  b.element("instructorLessonCourseKind").value = "team";
  b.mode();
  assert.equal(b.element("instructorLessonTime").required, true);
  await b.submit();
  assert.equal(b.calls[0].payload.paymentAmount, 80000);
  assert.equal(b.calls[0].payload.lessonTopic, "Synthetic topic");
  assert.equal(b.element("instructorLessonRegistrationStatus").textContent, "팀레슨 접수 완료 · 수강권/가입서/안내 확인 대기");
  assert.equal(b.calls.filter(call => call.name === "operatorCreateInstructorLessonRegistration").length, 1);
  await b.confirm({ target: { closest: () => ({ dataset: { confirmInstructorLesson: "synthetic-team-0" } }) } });
  assert.equal(b.calls.length, 2, "Team confirmation is blocked before a callable");
});

test("Team submit validates time/topic and integer amounts in 1..10,000,000", async () => {
  for (const [id, value] of [["Time", "24:00"], ["Time", "9:00"], ["Topic", "   "], ["Topic", "x".repeat(101)],
    ["PaymentAmount", "0"], ["PaymentAmount", "-1"], ["PaymentAmount", "1.5"], ["PaymentAmount", "8e4"],
    ["PaymentAmount", "10000001"], ["PaymentAmount", "9007199254740992"]]) {
    const a = app(); a.element("instructorLessonCourseKind").value = "team";
    a.element(`instructorLesson${id}`).value = value;
    await a.submit();
    assert.equal(a.calls.length, 0, `${id}=${value} must be rejected before a callable`);
  }
  for (const amount of [1, 10000000]) {
    const a = app(); a.element("instructorLessonCourseKind").value = "team";
    a.element("instructorLessonPaymentAmount").value = String(amount);
    await a.submit(); assert.equal(a.calls[0].payload.paymentAmount, amount);
  }
});

function layout() {
  const main = document.querySelector("main"), issues = [], textRects = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let text;
  while ((text = walker.nextNode())) {
    if (!text.textContent.trim() || !text.parentElement.checkVisibility()) continue;
    const range = document.createRange(); range.selectNodeContents(text);
    const label = text.textContent.trim().slice(0, 55);
    for (const r of [...range.getClientRects()].filter(r => r.width && r.height)) {
      textRects.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, label });
      if (r.left < -1 || r.right > innerWidth + 1) issues.push(`outside viewport: ${label}`);
      for (let node = text.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node), b = node.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX)
          && (r.left < b.left + node.clientLeft - 1 || r.right > b.left + node.clientLeft + node.clientWidth + 1)) issues.push(`clipped x: ${label}`);
        if (/(hidden|clip|auto|scroll)/.test(style.overflowY)
          && (r.top < b.top + node.clientTop - 1 || r.bottom > b.top + node.clientTop + node.clientHeight + 1)) issues.push(`clipped y: ${label}`);
      }
    }
  }
  for (let i = 0; i < textRects.length; i++) for (let j = i + 1; j < textRects.length; j++) {
    const a = textRects[i], b = textRects[j];
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push(`overlap: ${a.label} / ${b.label}`);
  }
  const nativeScrollingInputs = [];
  for (const node of main.querySelectorAll("*")) {
    if (!node.checkVisibility() || !node.clientWidth || node.scrollWidth <= node.clientWidth + 1) continue;
    // Native single-line inputs scroll their value without overflowing the layout.
    if (node.matches("input,textarea")) nativeScrollingInputs.push(node.id);
    else issues.push(`element overflow: ${node.id || node.className}`);
  }
  const controls = [...main.querySelectorAll("button,input,select")].filter(node => node.checkVisibility()).map(node => {
    const r = (node.type === "checkbox" ? node.closest("label") : node).getBoundingClientRect();
    if (r.left < -1 || r.right > innerWidth + 1) issues.push(`control outside viewport: ${node.id}`);
    return { id: node.id || node.textContent.trim(), width: r.width, height: r.height };
  });
  return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, issues, controls, nativeScrollingInputs, textLines: textRects.length };
}

test("offline actual HTML/renderers/CSS: Team and standard at 320/390/768/1440", { timeout: 90000 }, async t => {
  await fs.mkdir(output, { recursive: true });
  const report = { syntheticOnly: true, scenarios: [], requests: [], errors: [], sources: [], cleanup: {} };
  const cleanHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<link\b[^>]*>/g, "");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width <= 390,
        isMobile: width <= 390, offline: true, serviceWorkers: "block", reducedMotion: "reduce",
        locale: "ko-KR", timezoneId: "Asia/Seoul", storageState: { cookies: [], origins: [] } });
      try {
        await context.route("**/*", route => { report.requests.push(route.request().url()); return route.abort(); });
        await context.routeWebSocket("**/*", socket => { report.requests.push(socket.url()); socket.close(); });
        const page = await context.newPage();
        page.on("pageerror", error => report.errors.push(error.message));
        await page.setContent(cleanHtml);
        await page.addStyleTag({ content: `${styles}\n${interfaceStyles}` });
        await page.addScriptTag({ content: `${bootstrap(fixture())}
          document.documentElement.dataset.coreAccess = "manager";
          qs("coreAccessLoading").remove();
          document.querySelectorAll("details").forEach(node => { node.open = true; });
          qs("instructorLessonCourseKind").addEventListener("change", handleInstructorLessonCourseKindChange);
          qs("instructorLessonRegistrationForm").addEventListener("submit", handleInstructorLessonRegistrationSubmit);
          qs("instructorLessonRegistrationFilters").addEventListener("click", handleInstructorLessonRegistrationFilter);
          qs("instructorLessonScheduleList").addEventListener("click", event => {
            const button = event.target.closest("[data-instructor-schedule-date]");
            if (button) { selectedInstructorLessonDate = selectedInstructorLessonDate ? "" : ${JSON.stringify(date)}; renderInstructorLessonSchedule(); }
          });
          handleInstructorLessonCourseKindChange(); renderInstructorLessonRegistrationDashboard();` });
        const mode = page.locator("#instructorLessonCourseKind");
        assert.equal(await mode.inputValue(), "standard");
        assert.equal(await page.locator("#instructorLessonPaymentAmount").inputValue(), "80000");
        assert.equal(await page.locator("#instructorLessonTopic").getAttribute("maxlength"), "100");
        for (const scenario of ["standard", "team", "conflict"]) {
          await t.test(`${width}px ${scenario}`, async () => {
            const result = { width, scenario };
            report.scenarios.push(result);
            try {
              await mode.selectOption(scenario === "standard" ? "standard" : "team");
              assert.equal(await page.locator(".instructor-lesson-roster-row").count(), 6);
              assert.equal(await page.locator(".instructor-registration-item").count(), 6);
              assert.equal(await page.locator("[data-confirm-instructor-lesson],[data-instructor-cancel-key]").count(), 0);
              assert.equal(await page.locator("#instructorLessonScheduleSummary").textContent(), "1개 일정 · 정원 확인 전");
              const card = page.locator(".instructor-seat-item");
              assert.match(await card.innerText(), /접수 인원\s*6/);
              assert.doesNotMatch(await card.innerText(), /잔여|남은 좌석|마감/);
              assert.equal(await card.locator(".instructor-seat-progress").count(), 0);
              for (const id of ["instructorLessonScheduleList", "instructorLessonScheduleDetail", "instructorLessonRegistrationList"]) {
                assert.equal(await page.locator(`#${id} img,#${id} script`).count(), 0);
              }
              assert.equal(await page.evaluate(() => globalThis.__topicExecuted), undefined);
              assert.equal(await page.locator(".instructor-seat-method").textContent(), topic);
              assert.equal(await page.locator(".instructor-roster-method").textContent(), topic);
              assert.equal(await page.locator(".instructor-registration-method").first().textContent(), topic);
              const isTeam = scenario !== "standard";
              assert.equal(await page.locator("#instructorLessonTeamFields").isVisible(), isTeam);
              assert.equal(await page.locator("#instructorLessonRegularFlow").isVisible(), !isTeam);
              assert.equal(await page.locator("#instructorLessonTeamFlow").isVisible(), isTeam);
              for (const id of ["instructorLessonTime", "instructorLessonTopic", "instructorLessonPaymentAmount"]) {
                assert.equal(await page.locator(`#${id}`).isDisabled(), !isTeam);
                assert.equal(await page.locator(`#${id}`).evaluate(node => node.required), isTeam);
              }
              if (isTeam) {
                for (const id of ["instructorLessonTime", "instructorLessonTopic", "instructorLessonPaymentAmount"]) {
                  await page.locator(`#${id}`).fill("");
                  assert.equal(await page.locator(`#${id}`).evaluate(node => node.validity.valueMissing), true);
                }
                assert.equal(await page.locator("#instructorLessonPaymentAmount").getAttribute("max"), "10000000");
                await page.locator("#instructorLessonPaymentAmount").fill("10000001");
                assert.equal(await page.locator("#instructorLessonPaymentAmount").evaluate(node => node.validity.rangeOverflow), true);
                await page.locator("#instructorLessonPaymentAmount").fill("90000");
                await page.locator("#instructorLessonTime").fill("14:30");
                await page.locator("#instructorLessonTopic").fill(topic);
              }
              if (scenario === "conflict") {
                await page.evaluate(() => {
                  qa.state.instructorLessonRegistrationDashboard.schedule.items[0].metadataSource = "conflict";
                  qa.render();
                });
                assert.match(await card.innerText(), /접수 정보 확인필요/);
                assert.doesNotMatch(await card.innerText(), /14:30|ARCHIVE METHOD|<img/);
                assert.match(await page.locator("#instructorLessonScheduleDetail").innerText(), /접수 정보 확인필요/);
              }
              await page.keyboard.press("Tab");
              await mode.focus();
              result.focus = await mode.evaluate(node => ({ active: document.activeElement === node,
                focusVisible: node.matches(":focus-visible"), outline: getComputedStyle(node).outlineStyle,
                outlineWidth: getComputedStyle(node).outlineWidth }));
              assert.equal(result.focus.active, true);
              assert.equal(result.focus.focusVisible, true);
              assert.notEqual(result.focus.outline, "none");
              result.layout = await page.evaluate(layout);
              const button = page.locator("[data-instructor-schedule-date]");
              const beforeHover = await button.boundingBox();
              await button.hover();
              const afterHover = await button.boundingBox();
              assert.equal(afterHover.width, beforeHover.width);
              assert.equal(afterHover.height, beforeHover.height);
              result.hoverStable = true;
              await page.screenshot({ path: new URL(`${scenario}-${width}.png`, output).pathname, fullPage: true });
              assert.ok(result.layout.textLines > 50, "nonblank content");
              assert.ok(result.layout.scrollWidth <= width, JSON.stringify(result.layout));
              assert.deepEqual(result.layout.issues, [], "no overflowing, clipped or overlapping text");
              for (const control of result.layout.controls) assert.ok(control.height >= 44 && control.width >= 44, JSON.stringify(control));
              result.passed = true;
            } catch (error) { result.error = error.message; throw error; }
          });
        }
        await t.test(`${width}px Team submit busy/double-submit/result and schedule toggle`, async () => {
          const result = { width, scenario: "submit-and-toggle" };
          report.scenarios.push(result);
          await page.locator("#instructorLessonMemberName").fill("Synthetic instructor");
          await page.locator("#instructorLessonMemberPhone").fill("01000000001");
          await page.locator("#instructorLessonDate").fill(date);
          await page.locator("#instructorLessonPaymentMethod").selectOption("wiretransfer");
          await page.locator("#instructorLessonPaymentConfirmed").check();
          await page.locator("#instructorLessonSeatConfirmed").check();
          await page.evaluate(() => qa.hold());
          await page.locator("#instructorLessonRegistrationSubmit").click();
          await page.waitForFunction(() => qa.calls.length === 1);
          assert.equal(await mode.isDisabled(), true);
          assert.equal(await page.locator("#instructorLessonRegistrationSubmit").isDisabled(), true);
          await page.evaluate(() => qa.submit({ preventDefault() {}, currentTarget: document.querySelector("form") }));
          assert.equal(await page.evaluate(() => qa.calls.length), 1);
          await page.evaluate(() => qa.release());
          await page.waitForFunction(() => !document.getElementById("instructorLessonRegistrationSubmit").disabled);
          assert.equal(await page.locator("#instructorLessonRegistrationStatus").textContent(), "팀레슨 접수 완료 · 수강권/가입서/안내 확인 대기");
          assert.equal(await page.evaluate(() => qa.calls[0].payload.paymentAmount), 90000);
          result.busyDisabled = true;
          result.doubleSubmitBlocked = true;
          result.intakeOnlyResult = true;
          const button = page.locator("[data-instructor-schedule-date]");
          if (width <= 390) await button.tap(); else await button.click();
          assert.equal(await button.getAttribute("aria-expanded"), "false");
          if (width <= 390) await button.tap(); else await button.click();
          assert.equal(await button.getAttribute("aria-expanded"), "true");
          assert.equal(await page.locator(".instructor-lesson-roster-row").count(), 6);
          result.touchToggle = width <= 390;
          result.passed = true;
        });
      } finally {
        await context.close();
        assert.equal(context.pages().length, 0);
      }
    }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.requests, [], "no network or auth attempted");
  } finally {
    await browser.close();
    report.cleanup = { browserClosed: !browser.isConnected(), contextsRemaining: browser.contexts().length };
    for (let index = 0; index < files.length; index++) {
      const current = await fs.readFile(new URL(files[index], root), "utf8");
      report.sources.push({ file: files[index], sha256: createHash("sha256").update(sources[index]).digest("hex"), unchanged: current === sources[index] });
    }
    await fs.writeFile(new URL("report.json", output), JSON.stringify(report, null, 2));
    assert.deepEqual(report.cleanup, { browserClosed: true, contextsRemaining: 0 });
    assert.ok(report.sources.every(file => file.unchanged), "QA evidence must not mix source revisions");
    t.diagnostic(`Synthetic only, browser closed, no network. Evidence: ${output.pathname}`);
  }
});
