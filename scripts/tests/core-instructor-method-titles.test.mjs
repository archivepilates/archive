import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { chromium } from "playwright";

const root = new URL("../../", import.meta.url);
const output = new URL("artifacts/instructor-method-titles/", root);
let source = await fs.readFile(new URL("core/assets/app.js", root), "utf8");
if (!source.includes("function instructorLessonMethodTitle(")) {
  await new Promise(resolve => setTimeout(resolve, 1500));
  source = await fs.readFile(new URL("core/assets/app.js", root), "utf8");
}
const functions = new Map([...source.matchAll(/^(?:async )?function (\w+)\([^]*?^\}/gm)]
  .map(match => [match[1], match[0]]));
const names = [
  "qs", "setText", "escapeHtml", "toNumber", "compactDateTime",
  "instructorLessonMethodTitle", "instructorLessonScheduleDateLabel", "instructorLessonScheduleTimeLabel",
  "instructorLessonScheduleSourceLabel", "instructorLessonSchedulePresentation", "instructorLessonStatusLabel", "instructorLessonStatusTone",
  "instructorLessonModeLabel", "instructorLessonPaymentLabel", "instructorLessonStepClass",
  "instructorLessonStepStatusLabel", "instructorLessonRegistrationMatchesFilter",
  "instructorLessonConfirmationAction", "instructorLessonCancellationKey",
  "instructorLessonCancellationStatusLabel", "canCancelInstructorLesson",
  "renderInstructorLessonSchedule", "renderInstructorLessonRoster", "renderInstructorLessonRegistrationDashboard",
];
for (const name of names) assert.ok(functions.has(name), `${name} must exist in actual app.js`);
const start = source.indexOf("const INSTRUCTOR_LESSON_STEP_KEYS");
const end = source.indexOf("function instructorLessonStatusLabel", start);
assert.ok(start >= 0 && end > start, "extract the actual instructor constants");
const constants = source.slice(start, end);
const titles = new Map([
  ["2026-11-21", "ARCHIVE METHOD #9 외부피드백2"],
  ["2026-11-28", "ARCHIVE METHOD #10 전신 통합 움직임"],
  ["2026-11-29", "ARCHIVE METHOD #10 전신 통합 움직임"],
]);

// All identities/counts are deliberately synthetic, never a production roster or auth session.
function fixture() {
  const items = [...titles.keys(), "2026-12-06"].map((lessonDate, index) => ({
    registrationId: `synthetic-registration-${index}`,
    memberName: `합성 테스트 강사 ${index + 1}`,
    lessonDate, phoneLast4: "0000", status: index === 3 ? "waiting_signature" : "confirmation_pending",
    mode: "returning_member", ticketName: "합성 테스트 수강권", paymentMethod: "card",
    updatedAt: "2026-10-01T03:00:00Z", nextAction: "합성 테스트 상태",
    steps: { member: { status: "verified" }, ticket: { status: "verified" }, confirmation: { status: "failed" } },
  }));
  return {
    items,
    counts: { confirmation_pending: 3, waiting_signature: 1, review_required: 2, completed: 5 },
    schedule: { items: items.map((item, index) => ({
      date: item.lessonDate, occupiedCount: [2, 3, 1, 0][index], capacity: 10,
      remainingSeats: [8, 7, 9, 10][index], countSource: "tickets",
      roster: [{ memberKey: `synthetic-key-${index}`, memberId: `synthetic-member-${index}`,
        memberName: item.memberName, registrationId: item.registrationId, canCancel: true }],
    })) },
  };
}

function app(data = fixture(), { selectedDate = "2026-11-28", unavailable = false, role = "manager" } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "" });
    return elements.get(id);
  };
  const context = {
    state: { instructorLessonRegistrationDashboard: structuredClone(data) },
    document: { getElementById: element, querySelectorAll: () => [],
      documentElement: { dataset: { coreAccess: role } } },
    readUnavailable: () => unavailable,
    coreHref: path => `/core/${path}`,
  };
  vm.runInNewContext(`${constants}
    let selectedInstructorLessonDate = ${JSON.stringify(selectedDate)};
    let instructorLessonRegistrationFilter = "all";
    let instructorLessonCancellationBusy = false;
    const instructorLessonCancellationReceipts = new Map();
    ${names.map(name => functions.get(name)).join("\n")}
    globalThis.api = { ${names.join(",")},
      select: date => { selectedInstructorLessonDate = date; },
      filter: value => { instructorLessonRegistrationFilter = value; } };
  `, context, { timeout: 2000 });
  return { api: context.api, element, data: context.state.instructorLessonRegistrationDashboard };
}

test("pure method-title helper maps the three exact November dates without mutating input", () => {
  const { api } = app();
  for (const [date, expected] of titles) {
    assert.equal(api.instructorLessonMethodTitle(date), expected);
    assert.equal(api.instructorLessonMethodTitle(date), expected, "deterministic across calls");
    const value = Object.freeze({ toString: () => date });
    assert.equal(api.instructorLessonMethodTitle(value), expected);
  }
});

test("unknown, malformed and absent dates return an empty string, never an inherited property", () => {
  const { api } = app();
  for (const value of [undefined, null, "", false, 0, "2026-11-20", "2026-11-22", "2026-11-27",
    "2026-11-30", "2026-12-06", "2025-11-28", "11/28", "not-a-date", "__proto__", "toString"]) {
    assert.equal(api.instructorLessonMethodTitle(value), "", `unknown input: ${String(value)}`);
  }
});

test("schedule uses actual title paragraphs after card heads and preserves seat counts and date controls", () => {
  const a = app();
  const before = JSON.stringify(a.data);
  a.api.renderInstructorLessonSchedule();
  const html = a.element("instructorLessonScheduleList").innerHTML;
  const cards = [...html.matchAll(/<article class="instructor-seat-item is-(?:team|standard)">([\s\S]*?)<\/article>/g)].map(m => m[1]);
  assert.equal(cards.length, 4);
  cards.forEach((card, index) => {
    const item = a.data.schedule.items[index];
    assert.match(card, new RegExp(`data-instructor-schedule-date="${item.date}"`));
    assert.match(card, /aria-controls="instructorLessonScheduleDetail"/);
    assert.ok(card.includes(`aria-expanded="${item.date === "2026-11-28"}"`));
    for (const [label, value] of [["예약·접수", item.occupiedCount], ["정원", item.capacity], ["남은 좌석", item.remainingSeats]]) {
      assert.ok(card.includes(`<small>${label}</small><strong>${value}</strong>`));
    }
    if (titles.has(item.date)) {
      assert.ok(card.includes(`<p class="instructor-seat-method">${titles.get(item.date)}</p>`));
      const headEnd = card.indexOf("</div>", card.indexOf('class="pill')) + "</div>".length;
      assert.ok(card.slice(headEnd).trimStart().startsWith('<p class="instructor-seat-method">'));
    } else assert.doesNotMatch(card, /instructor-seat-method|ARCHIVE METHOD/);
  });
  assert.equal(a.element("instructorLessonScheduleSummary").textContent, "4개 일정 · 잔여 34석");
  assert.equal(JSON.stringify(a.data), before, "rendering must not mutate identities/counts");
});

test("each selected roster retains date, member links, cancellation IDs and buttons alongside its method", () => {
  const a = app();
  for (const item of a.data.schedule.items) {
    a.api.select(item.date);
    a.api.renderInstructorLessonSchedule();
    const html = a.element("instructorLessonScheduleDetail").innerHTML;
    assert.ok(html.startsWith(`<h3>${item.date === "2026-11-21" ? "팀레슨 · " : ""}${a.api.instructorLessonScheduleDateLabel(item.date)} · 1명</h3>`));
    assert.ok(html.includes(`data-instructor-cancel-date="${item.date}"`));
    assert.ok(html.includes(`data-instructor-cancel-key="${item.roster[0].memberKey}"`));
    assert.ok(html.includes(`/core/members/detail/?id=${item.roster[0].memberId}`));
    assert.match(html, /aria-describedby="instructorLessonCancellationRowStatus-0"/);
    assert.match(html, /id="instructorLessonCancellationRowStatus-0"[^>]+role="status"/);
    if (titles.has(item.date)) assert.ok(html.includes(`<p class="instructor-roster-method">${titles.get(item.date)}</p>`));
    else assert.doesNotMatch(html, /instructor-roster-method|ARCHIVE METHOD/);
  }
  a.api.renderInstructorLessonRoster(null);
  assert.equal(a.element("instructorLessonScheduleDetail").innerHTML, "");
});

test("recent registrations retain counters, registration IDs and filter behavior with method titles", () => {
  const a = app();
  a.api.renderInstructorLessonRegistrationDashboard();
  const html = a.element("instructorLessonRegistrationList").innerHTML;
  const cards = [...html.matchAll(/<article class="instructor-registration-item">([\s\S]*?)<\/article>/g)].map(m => m[1]);
  assert.equal(cards.length, 4);
  cards.forEach((card, index) => {
    const item = a.data.items[index];
    assert.ok(card.includes(item.lessonDate));
    assert.ok(card.includes(item.memberName));
    assert.ok(card.includes(`data-confirm-instructor-lesson="${item.registrationId}"`));
    if (titles.has(item.lessonDate)) assert.ok(card.includes(`<span class="instructor-registration-method">${titles.get(item.lessonDate)}</span>`));
    else assert.doesNotMatch(card, /instructor-registration-method|ARCHIVE METHOD/);
  });
  for (const [id, expected] of [["Active", "4건"], ["Signature", "1건"], ["Review", "2건"], ["Completed", "5건"]]) {
    assert.equal(a.element(`instructorLesson${id}Count`).textContent, expected);
  }
  a.api.filter("completed");
  a.api.renderInstructorLessonRegistrationDashboard();
  assert.doesNotMatch(a.element("instructorLessonRegistrationList").innerHTML, /instructor-registration-method/);
});

test("missing source and hostile synthetic text cannot fabricate method readiness or executable markup", () => {
  const a = app(fixture(), { unavailable: true });
  a.api.renderInstructorLessonRegistrationDashboard();
  assert.equal(a.element("instructorLessonActiveCount").textContent, "확인 필요");
  assert.doesNotMatch(a.element("instructorLessonScheduleList").innerHTML, /ARCHIVE METHOD/);
  assert.equal(a.element("instructorLessonScheduleDetail").innerHTML, "");
  const data = fixture();
  data.items[0].memberName = '<img src=x onerror="alert(1)">';
  data.items[0].lessonDate = "<script>synthetic</script>";
  data.schedule.items[0].roster[0].memberName = data.items[0].memberName;
  const b = app(data, { selectedDate: "2026-11-21" });
  b.api.renderInstructorLessonRegistrationDashboard();
  for (const id of ["instructorLessonRegistrationList", "instructorLessonScheduleDetail"]) {
    assert.match(b.element(id).innerHTML, /&lt;img/);
    assert.doesNotMatch(b.element(id).innerHTML, /<img|<script/);
  }
  assert.doesNotMatch(b.element("instructorLessonRegistrationList").innerHTML.split("</article>")[0], /instructor-registration-method/);
});

function syntheticHtml(a) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Synthetic only - instructor method titles</title></head><body>
    <main class="main instructor-lessons-page"><h1>합성 테스트 · 강사레슨</h1>
      <section class="instructor-seat-overview"><div class="instructor-seat-overview-head">
        <h2>일정별 예약현황</h2><strong>${a.element("instructorLessonScheduleSummary").textContent}</strong></div>
        <div id="instructorLessonScheduleList" class="instructor-seat-list">${a.element("instructorLessonScheduleList").innerHTML}</div>
        <div id="instructorLessonScheduleDetail" class="instructor-schedule-detail">${a.element("instructorLessonScheduleDetail").innerHTML}</div>
      </section><section class="panel instructor-registration-history"><h2>합성 최근 등록</h2>
        <div id="instructorLessonRegistrationList" class="instructor-registration-list">${a.element("instructorLessonRegistrationList").innerHTML}</div>
      </section></main></body></html>`;
}

test("offline actual-renderer HTML and real CORE CSS fit 320/390/768/1440 without clipped text or small buttons", { timeout: 90000 }, async t => {
  const css = await fs.readFile(new URL("core/assets/styles.css", root), "utf8")
    + "\n" + await fs.readFile(new URL("core/assets/interface.css", root), "utf8");
  const a = app();
  a.api.renderInstructorLessonRegistrationDashboard();
  await fs.mkdir(output, { recursive: true });
  const attempts = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ offline: true, serviceWorkers: "block",
      storageState: { cookies: [], origins: [] }, reducedMotion: "reduce" });
    try {
      await context.route("**/*", route => { attempts.push(route.request().url()); return route.abort(); });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const width of [320, 390, 768, 1440]) {
        await t.test(`${width}px synthetic layout`, async () => {
          await page.setViewportSize({ width, height: 1000 });
          await page.setContent(syntheticHtml(a));
          await page.addStyleTag({ content: css });
          assert.equal(await page.locator("script").count(), 0, "no Firebase, auth or production app bootstrap");
          assert.equal(await page.locator(".instructor-seat-method").count(), 3);
          assert.equal(await page.locator(".instructor-seat-item-head + p.instructor-seat-method").count(), 3);
          assert.equal(await page.locator(".instructor-registration-method").count(), 3);
          assert.equal(await page.locator(".instructor-roster-method").textContent(), titles.get("2026-11-28"));
          assert.equal(await page.locator("[data-instructor-cancel-key]").count(), 1);
          assert.equal(await page.locator("[data-instructor-schedule-date]").count(), 4);
          const report = await page.evaluate(() => {
            const issues = [];
            const epsilon = 1;
            const main = document.querySelector("main");
            const textRects = [];
            const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
            let text;
            while ((text = walker.nextNode())) {
              if (!text.textContent.trim()) continue;
              const parent = text.parentElement;
              const style = getComputedStyle(parent);
              const label = text.textContent.trim().slice(0, 60);
              const range = document.createRange();
              range.selectNodeContents(text);
              const rects = [...range.getClientRects()].filter(r => r.width && r.height);
              if (!rects.length || style.visibility !== "visible" || Number(style.opacity) === 0) issues.push(`hidden: ${label}`);
              for (const r of rects) {
                textRects.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, label });
                if (r.left < -epsilon || r.right > innerWidth + epsilon) issues.push(`outside viewport: ${label}`);
                for (let node = parent; node && node !== document.body; node = node.parentElement) {
                  const s = getComputedStyle(node), b = node.getBoundingClientRect();
                  if (/(hidden|clip|auto|scroll)/.test(s.overflowX)
                    && (r.left < b.left + node.clientLeft - epsilon || r.right > b.left + node.clientLeft + node.clientWidth + epsilon)) issues.push(`clipped x: ${label}`);
                  if (/(hidden|clip|auto|scroll)/.test(s.overflowY)
                    && (r.top < b.top + node.clientTop - epsilon || r.bottom > b.top + node.clientTop + node.clientHeight + epsilon)) issues.push(`clipped y: ${label}`);
                }
              }
            }
            for (let i = 0; i < textRects.length; i++) {
              for (let j = i + 1; j < textRects.length; j++) {
                const a = textRects[i], b = textRects[j];
                if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > epsilon
                  && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > epsilon) issues.push(`overlap: ${a.label} / ${b.label}`);
              }
            }
            for (const node of main.querySelectorAll("*")) {
              if (node.clientWidth && node.scrollWidth > node.clientWidth + epsilon) issues.push(`element overflow: ${node.className}`);
            }
            const buttons = [...main.querySelectorAll("button")].map(node => {
              const b = node.getBoundingClientRect();
              return { label: node.textContent.trim(), width: b.width, height: b.height };
            });
            return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
              textLines: textRects.length, rules: document.styleSheets[0].cssRules.length, issues, buttons };
          });
          await page.screenshot({ path: new URL(`${width}.png`, output).pathname, fullPage: true });
          assert.ok(report.rules > 100, "actual CORE styles are loaded");
          assert.ok(report.textLines > 50, "nonblank actual rendered content");
          assert.ok(report.scrollWidth <= width, JSON.stringify(report));
          assert.deepEqual(report.issues, [], "no overflowing, hidden, clipped or overlapping text");
          assert.equal(report.buttons.length, 9);
          for (const button of report.buttons) assert.ok(button.height >= 44 && button.width >= 44, JSON.stringify(button));
          t.diagnostic(`${width}px: ${report.textLines} text lines, ${report.buttons.length} buttons >=44px; ${width}.png`);
        });
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(attempts, [], "no network requests, production endpoints or credentials");
    } finally {
      await context.close();
    }
    assert.equal(browser.contexts().length, 0);
  } finally {
    await browser?.close();
    if (browser) assert.equal(browser.isConnected(), false, "task-owned browser closed");
  }
  t.diagnostic(`Synthetic/offline only; no server started; browser closed. Screenshots: ${output.pathname}`);
});
