#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "artifacts/core-operator-workflow");
const fixedTime = "2026-09-05T12:00:00+09:00";
const viewports = [
  { width: 320, height: 860 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
];
const sourceFiles = {
  "/": "core/index.html",
  "/private/": "core/private/index.html",
  "/staff/": "core/staff/index.html",
  "/instructor-lessons/": "core/instructor-lessons/index.html",
  "/assets/app.js": "core/assets/app.js",
  "/assets/styles.css": "core/assets/styles.css",
  "/firebase-config.js": "core/firebase-config.js",
};
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
};
const report = {
  scope:
    "Local synthetic-data browser QA only. Not authenticated/live/source reconciliation or delivery proof.",
  fixedTime,
  sources: [],
  scenarios: [],
  checks: [],
  screenshots: [],
  failures: [],
  deniedRequests: [],
  cleanup: { contextsClosed: 0, browserClosed: false, serverClosed: false },
};
const snapshots = new Map();
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (name, error) => {
  report.failures.push({ name, error: String(error?.stack || error) });
  console.error(`${name}: ${String(error?.message || error)}`);
};

// Only the intercepted local response is transformed. No production file or auth code is changed.
function instrumentApp(source) {
  const boot =
    'if (document.querySelector("[data-firestore-dashboard]")) refresh();';
  assert.equal(
    source.split(boot).length - 1,
    1,
    "Expected exactly one final auto-refresh statement",
  );
  assert.ok(
    source.trimEnd().endsWith(boot),
    "Auto-refresh must remain the final statement",
  );
  return (
    source.slice(0, source.lastIndexOf(boot)) +
    `
Object.defineProperty(window, "__coreOperatorQA", { value: {
  state, setReadState, renderRenewalPipeline, renderHomeSummary, renderHomeDecisions,
  renderPrivate, renderStaffHr, staffCompositeScore, scoreBand, formatMetricNumber,
  formatMetricRate, coreHref, commandPaletteEntries,
  renderInstructorLessonRegistrationDashboard, renderInstructorLessonSchedule,
  resetViews() { renewalView = "today"; renewalVisibleLimit = 20; privateScope = "today"; },
} });
`
  );
}

function renewalFixtures() {
  const cases = [];
  const profiles = [];
  const add = (
    id,
    name,
    extra = {},
    phone = `0109000${String(cases.length + 1).padStart(4, "0")}`,
  ) => {
    const privateTicket = extra.kind === "private";
    const ticket = {
      userTicketId: `ticket-${id}`,
      name: privateTicket ? "프라이빗 30회" : "그룹 30회",
      classType: privateTicket ? "P" : "G",
      remainingCount: 2,
      expiresAt: "2026-12-20",
    };
    const item = {
      id: `case-${id}`,
      memberId: id,
      memberName: name,
      phone,
      ticketIdentity: `user:${ticket.userTicketId}`,
      ticketName: ticket.name,
      kind: "group",
      priority: "urgent",
      active: true,
      workflowStatus: "open",
      reason: "잔여 2회",
      ...extra,
    };
    cases.push(item);
    profiles.push({ id, memberId: id, name, phone, activeTickets: [ticket] });
  };
  for (let i = 1; i <= 22; i++)
    add(`today-${i}`, `QA 오늘회원${String(i).padStart(2, "0")}`);
  add(
    "duplicate-private",
    "QA 오늘회원01",
    { kind: "private" },
    profiles[0].phone,
  );
  add("planned-contact", "QA 연락완료회원", { workflowStatus: "contacted" });
  add("planned-snooze", "QA 재확인회원", {
    workflowStatus: "snoozed",
    nextActionAt: "2026-09-12T09:00:00+09:00",
  });
  add("return", "QA 복귀회원", { priority: "waiting" });
  add("resolved", "QA 재등록완료회원", { workflowStatus: "resolved" });
  add("excluded", "QA 제외회원", { workflowStatus: "excluded" });
  return { cases, profiles };
}

function privateFixtures() {
  const make = (id, day, stage, extra = {}) => ({
    sessionId: id,
    memberId: id,
    memberName: `QA ${id}`,
    staffName: "QA 담당강사",
    bookingId: `booking-${id}`,
    lessonStartAt: `${day}T09:00:00+09:00`,
    sessionNumber: 3,
    roundVerified: true,
    workflowStage: stage,
    reportStatus: "draft",
    deliveryStatus: "pending",
    postStatus: "pending",
    ...extra,
  });
  return [
    make("today-record", "2026-09-05", "recording", {
      nextAction: "수업 전 계획 작성",
    }),
    make("today-pre", "2026-09-05", "preparation", {
      lessonStartAt: "2026-09-05T18:00:00+09:00",
      nextAction: "수업 전 계획 작성",
    }),
    make("today-review", "2026-09-05", "report_review", {
      postStatus: "submitted",
    }),
    make("today-published", "2026-09-05", "delivered", {
      reportStatus: "published",
      postStatus: "submitted",
    }),
    make("today-verify", "2026-09-05", "needs_review", {
      roundVerified: false,
    }),
    make("today-processing", "2026-09-05", "report_review", {
      reportStatus: "processing",
      postStatus: "submitted",
    }),
    make("today-sent", "2026-09-05", "delivered", {
      deliveryStatus: "sent",
      sentRevision: "qa-sent",
      postStatus: "submitted",
    }),
    make("today-cancelled", "2026-09-05", "cancelled"),
    make("overdue-record", "2026-09-04", "recording"),
    make("overdue-review", "2026-09-03", "report_review", {
      postStatus: "submitted",
    }),
    make("overdue-boundary", "2026-08-29", "recording", {
      lessonStartAt: "2026-08-29T00:00:00+09:00",
    }),
    make("excluded-sent", "2026-09-04", "delivered", {
      deliveryStatus: "sent",
    }),
    make("excluded-cancelled", "2026-09-04", "cancelled"),
    make("excluded-old", "2026-08-28", "recording"),
    make("excluded-future", "2026-09-06", "recording"),
  ];
}

async function seed(page, kind) {
  await page.evaluate(
    ({ kind, renewal, sessions }) => {
      const qa = window.__coreOperatorQA;
      Object.assign(qa.state, {
        members: [
          {
            memberId: "qa-search",
            name: "QA 검색회원",
            phone: "00000000000",
            currentTicketsSummary: [],
          },
        ],
        memberDirectoryLoadStatus: "success",
        readStates: {},
        readTruncated: {},
        readWarnings: [],
        renewalCases: renewal.cases,
        renewalMembers: renewal.profiles,
        privateSessions: sessions,
        privateRecords: [],
        privateRequests: [],
        staffItems: [
          {
            id: "qa-staff",
            staffId: "qa-staff",
            name: "QA 자료없음강사",
            active: true,
            role: "instructor",
          },
        ],
        businessSnapshot: {
          instructorStats: [
            {
              name: "QA 자료없음강사",
              month: "2026-09",
              reservationRate: null,
              attendanceRate: "",
              averageGroupMembers: null,
              groupLessonCount: null,
            },
          ],
        },
      });
      for (const label of [
        "renewalCases",
        "renewalMemberProfiles",
        "privateLessonSessions",
        "privateLessonChartRecords",
        "staffs",
      ])
        qa.setReadState(label, "success");
      qa.resetViews();
      if (kind === "home") {
        qa.renderHomeSummary();
        qa.renderHomeDecisions();
      }
      if (kind === "private")
        qa.renderPrivate([], [], [], [], [], qa.state.privateSessions);
      if (kind === "staff") qa.renderStaffHr();
    },
    { kind, renewal: renewalFixtures(), sessions: privateFixtures() },
  );
}

async function dom(page, expression) {
  return page.evaluate(expression);
}

async function check(name, action) {
  await action();
  report.checks.push(name);
}

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.evaluate(() => {
    const visible = (el) =>
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      el.getBoundingClientRect().height > 0;
    const viewport = document.documentElement.clientWidth;
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    );
    const text = [
      ...document.querySelectorAll(
        ".workflow-tabs button, .renewal-member-row summary, .renewal-case-detail p, .stage-card p, .stage-card .pill, .staff-detail-kpi, .command-palette-results a",
      ),
    ].filter(visible);
    const textOverflow = text
      .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
      .map((el) => ({
        tag: el.tagName,
        text: el.textContent.trim().slice(0, 90),
        width: el.clientWidth,
        scroll: el.scrollWidth,
      }));
    const controls = [
      ...document.querySelectorAll(
        ".mobile-nav-toggle, .nav a, .nav-more-button, .workflow-tabs button, .renewal-member-row summary, .renewal-actions button, .renewal-actions select, [data-renewal-more], .command-search-button, [data-command-close], .command-palette-results a, .staff-card-button, [data-instructor-schedule-date]",
      ),
    ].filter(visible);
    const shortTargets = controls
      .filter(
        (el) =>
          el.getBoundingClientRect().height < 43.5 ||
          el.getBoundingClientRect().width < 43.5,
      )
      .map((el) => ({
        text: el.textContent.trim().slice(0, 60),
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      }));
    const outside = [
      ...document.querySelectorAll(
        ".renewal-member-row, .stage-card, .staff-composite-card, .workflow-tabs, .command-palette-card",
      ),
    ]
      .filter(visible)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.left < -1 || rect.right > viewport + 1;
      })
      .map((el) => el.className);
    const connection = document.getElementById("connectionDetail");
    const statusRect = connection?.getBoundingClientRect();
    const statusFontSize = connection
      ? Number.parseFloat(getComputedStyle(connection).fontSize)
      : 0;
    const headerStatus =
      connection && visible(connection)
        ? {
            text: connection.textContent,
            width: statusRect.width,
            height: statusRect.height,
            fontSize: statusFontSize,
          }
        : null;
    // A narrow column can wrap every character without triggering scrollWidth overflow.
    const crampedHeaderStatus = Boolean(
      headerStatus &&
      headerStatus.width < statusFontSize * 4 &&
      headerStatus.height > statusFontSize * 4,
    );
    return {
      viewport,
      documentWidth,
      textOverflow,
      shortTargets,
      outside,
      headerStatus,
      crampedHeaderStatus,
    };
  });
  const file = `${name}.png`;
  await page.screenshot({
    path: path.join(output, file),
    fullPage: true,
    animations: "disabled",
  });
  report.screenshots.push({ name, file, geometry });
  if (
    geometry.documentWidth > geometry.viewport + 1 ||
    geometry.textOverflow.length ||
    geometry.shortTargets.length ||
    geometry.outside.length ||
    geometry.crampedHeaderStatus
  )
    fail(name, JSON.stringify(geometry));
}

async function navigation(page, name, width) {
  const menu = page.getByRole("button", { name: "메뉴", exact: true });
  if (width <= 768) {
    await check(`${name}: mobile menu and keyboard focus`, async () => {
      assert.equal(await menu.getAttribute("class"), "mobile-nav-toggle");
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      assert.equal(
        await page.getByRole("link", { name: "홈", exact: true }).count(),
        0,
      );
      await menu.focus();
      assert.equal(
        await menu.evaluate((el) => document.activeElement === el),
        true,
      );
      const focus = await menu.evaluate((el) => ({
        outline: getComputedStyle(el).outlineStyle,
        width: getComputedStyle(el).outlineWidth,
        shadow: getComputedStyle(el).boxShadow,
      }));
      assert.ok(
        (focus.outline !== "none" && focus.width !== "0px") ||
          focus.shadow !== "none",
        "Menu keyboard focus must be visible",
      );
      await menu.press("Enter");
      assert.equal(await menu.getAttribute("aria-expanded"), "true");
      await capture(page, `${name}-menu-open`);
      await menu.press("Enter");
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
    });
  } else {
    await check(`${name}: desktop navigation`, async () => {
      assert.equal(await menu.isVisible(), false);
      assert.ok(await page.getByRole("navigation").isVisible());
    });
  }
}

async function home(page, name, width) {
  await navigation(page, name, width);
  await page.getByRole("link", { name: /^재등록 관리 오늘 확인/ }).click();
  const tabs = page.getByRole("tablist", { name: "재등록 업무 구분" });
  await tabs.waitFor({ state: "visible" });
  await check(`${name}: renewal counts and initial page`, async () => {
    assert.deepEqual(
      await dom(page, () =>
        [
          "renewalUrgentCount",
          "renewalSoonCount",
          "renewalWaitingCount",
          "renewalPipelineCount",
        ].map((id) => document.getElementById(id).textContent),
      ),
      ["22명", "2명", "1명", "25명"],
    );
    assert.deepEqual(
      await tabs
        .getByRole("tab")
        .evaluateAll((els) => els.map((el) => el.dataset.renewalView)),
      ["today", "planned", "return", "history"],
    );
    assert.equal(
      await dom(
        page,
        () => document.querySelectorAll(".renewal-member-row").length,
      ),
      20,
    );
  });
  await check(`${name}: grouped detail reveal`, async () => {
    assert.equal(
      await page.getByRole("link", { name: "회원 상세", exact: true }).count(),
      0,
    );
    await page
      .getByRole("tabpanel")
      .getByRole("group")
      .filter({ hasText: "QA 오늘회원01" })
      .click({ position: { x: 16, y: 16 } });
    assert.equal(
      await page.getByRole("link", { name: "회원 상세", exact: true }).count(),
      1,
    );
    assert.equal(
      await page
        .getByLabel("QA 오늘회원01 그룹 30회 상담 상태", { exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await page
        .getByLabel("QA 오늘회원01 프라이빗 30회 상담 상태", { exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await page.getByRole("button", { name: "저장", exact: true }).count(),
      2,
    );
  });
  await capture(page, `${name}-today-detail`);
  await check(`${name}: load more preserves complete groups`, async () => {
    await page
      .getByRole("button", { name: "20명 더 보기 (20/22)", exact: true })
      .click();
    assert.equal(
      await dom(
        page,
        () => document.querySelectorAll(".renewal-member-row").length,
      ),
      22,
    );
    assert.equal(
      await page.getByRole("button", { name: /20명 더 보기/ }).count(),
      0,
    );
  });
  await capture(page, `${name}-load-more`);
  for (const [view, label, names] of [
    ["planned", "예정", ["QA 연락완료회원", "QA 재확인회원"]],
    ["return", "복귀 대기", ["QA 복귀회원"]],
    ["history", "처리 이력", ["QA 재등록완료회원", "QA 제외회원"]],
  ]) {
    await check(`${name}: ${view} classification`, async () => {
      await tabs.getByRole("tab", { name: label, exact: true }).click();
      assert.equal(
        await tabs
          .getByRole("tab", { name: label, exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.deepEqual(
        await dom(page, () =>
          [
            ...document.querySelectorAll(".renewal-member-row summary strong"),
          ].map((el) => el.textContent),
        ),
        names,
      );
      if (view === "history") {
        await page
          .getByRole("tabpanel")
          .getByRole("group")
          .filter({ hasText: "QA 재등록완료회원" })
          .click({ position: { x: 16, y: 16 } });
        assert.equal(
          await page.getByRole("button", { name: "저장", exact: true }).count(),
          0,
        );
      }
    });
    await capture(page, `${name}-${view}`);
  }
  await tabs.getByRole("tab", { name: "오늘 연락", exact: true }).click();
  assert.equal(
    await dom(
      page,
      () => document.querySelectorAll(".renewal-member-row").length,
    ),
    20,
  );
  await check(`${name}: missing member source is read-only`, async () => {
    await page.evaluate(() => {
      const qa = window.__coreOperatorQA;
      qa.state.renewalMembers = [];
      qa.renderRenewalPipeline();
    });
    await page
      .getByRole("tabpanel")
      .getByRole("group")
      .filter({ hasText: "QA 오늘회원01" })
      .click({ position: { x: 16, y: 16 } });
    assert.equal(
      await page.getByRole("button", { name: "저장", exact: true }).count(),
      0,
    );
    assert.match(
      await page.getByRole("tabpanel").innerText(),
      /회원 원본 확인이 필요/,
    );
  });
  await capture(page, `${name}-readonly`);
  for (const source of ["renewalCases", "renewalMemberProfiles"]) {
    await check(
      `${name}: ${source} read failure is not all-clear`,
      async () => {
        await seed(page, "home");
        await page.evaluate((source) => {
          const qa = window.__coreOperatorQA;
          qa.setReadState(source, "unavailable");
          qa.renderHomeSummary();
          qa.renderHomeDecisions();
        }, source);
        assert.match(
          await page.getByRole("tabpanel").innerText(),
          /불러오지 못/,
        );
        assert.equal(
          await dom(
            page,
            () => document.getElementById("renewalPipelineCount").textContent,
          ),
          "확인 필요",
        );
        assert.equal(
          await page.getByRole("button", { name: "저장", exact: true }).count(),
          0,
        );
        assert.doesNotMatch(
          await dom(
            page,
            () => document.getElementById("commandQueueStatus").textContent,
          ),
          /오늘 처리할 일 없음/,
        );
      },
    );
  }
  await capture(page, `${name}-read-failure`);
}

async function privatePage(page, name, width) {
  await navigation(page, name, width);
  const tabs = page.getByRole("tablist", { name: "프라이빗 업무 범위" });
  assert.equal(await tabs.getAttribute("id"), "privateScopeTabs");
  for (const [scope, label, counts, names, stages] of [
    [
      "today",
      "오늘",
      ["5건", "2건", "2건", "1건"],
      [
        "today-record",
        "today-pre",
        "today-review",
        "today-published",
        "today-verify",
        "today-processing",
        "today-sent",
      ],
      ["2건", "2건", "2건", "1건"],
    ],
    [
      "overdue",
      "미처리",
      ["3건", "2건", "1건", "0건"],
      ["overdue-record", "overdue-review", "overdue-boundary"],
      ["2건", "0건", "1건", "0건"],
    ],
  ]) {
    await check(
      `${name}: ${scope} counts, boundaries and no pre-plan copy`,
      async () => {
        await tabs.getByRole("tab", { name: label, exact: true }).click();
        assert.equal(
          await tabs
            .getByRole("tab", { name: label, exact: true })
            .getAttribute("aria-selected"),
          "true",
        );
        const actual = await dom(page, () => ({
          counts: [
            "privatePendingCount",
            "privatePreStageCount",
            "privatePostStageCount",
            "privateCompleteStageCount",
          ].map((id) => document.getElementById(id).textContent),
          names: [
            ...document.querySelectorAll("#privateProgressList .stage-card a"),
          ]
            .map((el) => el.textContent.split(" ")[1])
            .sort(),
          stages: [
            ...document.querySelectorAll(".stage-column-header > span"),
          ].map((el) => el.textContent),
        }));
        assert.deepEqual(actual.counts, counts);
        assert.deepEqual(actual.names, [...names].sort());
        assert.deepEqual(actual.stages, stages);
        assert.doesNotMatch(
          await page.getByRole("main").innerText(),
          /수업 전 계획|사전 계획|사전계획/,
        );
      },
    );
    await capture(page, `${name}-${scope}`);
  }
  await check(
    `${name}: shared command search resolves from /private/ to root`,
    async () => {
      await page
        .getByRole("button", { name: "회원 또는 업무 검색", exact: true })
        .click();
      const input = page.getByRole("searchbox", {
        name: "회원 또는 업무 검색",
        exact: true,
      });
      await input.fill("QA 검색회원");
      const member = page.getByRole("link", { name: /^QA 검색회원 회원/ });
      assert.equal(
        await member.getAttribute("href"),
        "../members/detail/?id=qa-search",
      );
      assert.equal(
        await member.evaluate((el) => new URL(el.href).pathname),
        "/members/detail/",
      );
      await capture(page, `${name}-member-search`);
      await input.fill("재등록");
      const renewal = page.getByRole("link", { name: /^재등록 관리/ });
      assert.equal(await renewal.getAttribute("href"), "../#renewalPipeline");
      const entries = await dom(page, () =>
        window.__coreOperatorQA
          .commandPaletteEntries()
          .filter((item) => !/^https?:/.test(item.href))
          .map((item) => ({
            href: item.href,
            resolved: new URL(item.href, location.href).pathname,
          })),
      );
      assert.ok(entries.length > 5);
      assert.ok(
        entries.every(
          (entry) =>
            entry.href.startsWith("../") &&
            !entry.resolved.startsWith("/private/members"),
        ),
        JSON.stringify(entries),
      );
      await input.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(
        await page
          .getByRole("button", { name: "회원 또는 업무 검색", exact: true })
          .evaluate((el) => document.activeElement === el),
        true,
      );
    },
  );
  await check(`${name}: failed session read remains explicit`, async () => {
    await page.evaluate(() => {
      const qa = window.__coreOperatorQA;
      qa.setReadState("privateLessonSessions", "unavailable");
      qa.renderPrivate([], [], [], [], [], qa.state.privateSessions);
    });
    assert.equal(
      await dom(
        page,
        () => document.getElementById("privatePendingCount").textContent,
      ),
      "확인 필요",
    );
    assert.match(
      await page.getByRole("main").innerText(),
      /진행 정보를 불러오지 못/,
    );
    assert.equal(
      await dom(page, () => document.querySelectorAll(".stage-card").length),
      0,
    );
  });
  await capture(page, `${name}-read-failure`);
}

async function staff(page, name) {
  await check(`${name}: missing metrics are not poor performance`, async () => {
    await page
      .getByRole("button", {
        name: "QA 자료없음강사 세부 지표 보기",
        exact: true,
      })
      .click();
    const actual = await dom(page, () => {
      const qa = window.__coreOperatorQA;
      return {
        text: document.getElementById("staffDetailCard").innerText,
        score: qa.staffCompositeScore({ employmentState: "current" }, [], null),
        missing: [qa.formatMetricNumber(null), qa.formatMetricRate("")],
        zero: qa.scoreBand(0).label,
        values: [...document.querySelectorAll(".staff-detail-kpi strong")].map(
          (el) => el.textContent,
        ),
      };
    });
    assert.equal(actual.score.score, null);
    assert.equal(actual.score.coverage, 0);
    assert.equal(actual.score.band.label, "평가 전");
    assert.deepEqual(actual.missing, ["자료 없음", "자료 없음"]);
    assert.equal(actual.zero, "개선필요");
    assert.match(actual.text, /산출 대기/);
    assert.match(actual.text, /자료 없음/);
    assert.doesNotMatch(actual.text, /개선필요/);
    assert.ok(
      actual.values.every((value) => !/^0(?:점|명|개|%)$/.test(value)),
      JSON.stringify(actual.values),
    );
  });
  await capture(page, `${name}-missing-metrics`);
}

async function instructorLessons(page, name) {
  await page.evaluate(() => {
    const qa = window.__coreOperatorQA;
    const roster = Array.from({ length: 10 }, (_, i) => ({
      memberId: `roster-${i + 1}`,
      memberName: `QA 수강회원${String(i + 1).padStart(2, "0")}`,
      ...(i < 9 ? { registrationId: `registration-${i + 1}` } : {}),
    }));
    qa.state.instructorLessonRegistrationDashboard = {
      items: roster.slice(0, 9).map((member) => ({
        ...member,
        lessonDate: "2026-09-19",
        status: "waiting_signature",
        updatedAt: "2026-09-05T09:00:00+09:00",
        steps: {
          eformsign: { status: "waiting_external" },
          confirmation: { status: "sent" },
        },
      })),
      counts: { waiting_signature: 9 },
      schedule: {
        items: [
          {
            date: "2026-09-19",
            occupiedCount: 10,
            capacity: 10,
            remainingSeats: 0,
            countSource: "tickets",
            roster,
          },
        ],
      },
    };
    qa.setReadState("instructorLessonRegistrations", "success");
    qa.renderInstructorLessonRegistrationDashboard();
  });
  const button = page.getByRole("button", {
    name: "수강 명단 보기",
    exact: true,
  });
  const detail = page.getByRole("region", {
    name: "선택한 일정 상세",
    exact: true,
    includeHidden: true,
  });
  await check(
    `${name}: schedule click shows 10 ticket holders, not 9 registrations`,
    async () => {
      assert.equal(
        await button.getAttribute("data-instructor-schedule-date"),
        "2026-09-19",
      );
      assert.equal(
        await dom(
          page,
          () =>
            document.querySelectorAll(".instructor-registration-item").length,
        ),
        9,
      );
      assert.equal(await detail.innerText(), "");
      await button.click();
      assert.equal(await button.getAttribute("aria-expanded"), "true");
      assert.equal(await detail.getByRole("link").count(), 10);
      assert.match(await detail.getByRole("heading").innerText(), /10명/);
      assert.equal(
        await detail
          .getByRole("link", { name: "QA 수강회원10", exact: true })
          .getAttribute("href"),
        "../members/detail/?id=roster-10",
      );
      assert.match(await detail.innerText(), /가입서·안내 기록 연결 전/);
    },
  );
  await capture(page, `${name}-roster-ten`);
  await check(`${name}: schedule detail collapses and reopens`, async () => {
    await button.click();
    assert.equal(await button.getAttribute("aria-expanded"), "false");
    assert.equal(await detail.innerText(), "");
    await button.click();
    assert.equal(await detail.getByRole("link").count(), 10);
  });
  await check(
    `${name}: old API without roster is explicit, never a nine-member fallback`,
    async () => {
      await page.evaluate(() => {
        const qa = window.__coreOperatorQA;
        delete qa.state.instructorLessonRegistrationDashboard.schedule.items[0]
          .roster;
        qa.renderInstructorLessonSchedule();
      });
      assert.match(await detail.innerText(), /명단 연결 확인이 필요/);
      assert.match(
        await detail.innerText(),
        /접수 건수와 수강권 보유 인원은 다를 수/,
      );
      assert.equal(await detail.getByRole("link").count(), 0);
      assert.equal(
        await dom(
          page,
          () =>
            document.querySelectorAll(".instructor-registration-item").length,
        ),
        9,
      );
    },
  );
  await capture(page, `${name}-roster-missing`);
}

async function scenario(browser, origin, viewport, kind, run) {
  const name = `${viewport.width}-${kind}`;
  const startFailures = report.failures.length;
  const context = await browser.newContext({
    viewport,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [] },
  });
  let page;
  const errors = [];
  const attempts = [];
  try {
    await context.routeWebSocket("**/*", (socket) => {
      attempts.push({ type: "websocket", url: socket.url() });
      socket.close();
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.origin !== origin ||
        request.method() !== "GET" ||
        ["fetch", "xhr", "eventsource"].includes(request.resourceType()) ||
        !snapshots.has(url.pathname)
      ) {
        attempts.push({
          type: request.resourceType(),
          method: request.method(),
          url: request.url(),
        });
        return route.abort("blockedbyclient");
      }
      if (url.pathname === "/assets/app.js")
        return route.fulfill({
          contentType: "text/javascript",
          body: instrumentApp(snapshots.get(url.pathname).toString()),
        });
      return route.continue();
    });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.clock.setFixedTime(new Date(fixedTime));
    await page.goto(`${origin}${kind === "home" ? "/" : `/${kind}/`}`, {
      waitUntil: "load",
    });
    await page.waitForFunction(() => Boolean(window.__coreOperatorQA));
    await seed(page, kind);
    await run(page, name, viewport.width);
  } catch (error) {
    fail(name, error);
    if (page && !page.isClosed()) {
      await page
        .screenshot({
          path: path.join(output, `${name}-failure.png`),
          fullPage: true,
        })
        .catch(() => {});
      await fs.writeFile(
        path.join(output, `${name}-failure.txt`),
        await page
          .getByRole("main")
          .ariaSnapshot()
          .catch(() => "No accessible main snapshot"),
      );
    }
  } finally {
    if (attempts.length) {
      report.deniedRequests.push(
        ...attempts.map((attempt) => ({ scenario: name, ...attempt })),
      );
      fail(`${name}: network guard`, JSON.stringify(attempts));
    }
    if (errors.length) fail(`${name}: browser errors`, JSON.stringify(errors));
    try {
      await context.tracing.stop(
        report.failures.length > startFailures
          ? { path: path.join(output, `${name}-trace.zip`) }
          : {},
      );
    } finally {
      await context.close();
      report.cleanup.contextsClosed++;
    }
    report.scenarios.push({
      name,
      status: report.failures.length === startFailures ? "passed" : "failed",
    });
  }
}

function reportHtml() {
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCHIVE CORE local workflow QA</title><style>*{box-sizing:border-box}body{font:16px/1.5 system-ui;margin:0;color:#202020;background:#fff}main{max-width:76rem;margin:auto;padding:24px}h1{font-size:26px}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{border-top:1px solid #ddd;padding:16px 0}a{color:#125e74}li{margin:8px 0}</style><main><h1>ARCHIVE CORE local workflow QA</h1><p>${escape(report.scope)}</p><p>${report.checks.length} checks passed; ${report.failures.length} failures. Fixed time: ${escape(fixedTime)}.</p><section><h2>Scenarios</h2><ul>${report.scenarios.map((item) => `<li>${escape(item.name)}: ${item.status}</li>`).join("")}</ul></section><section><h2>Failures</h2>${report.failures.length ? report.failures.map((item) => `<h3>${escape(item.name)}</h3><pre>${escape(item.error)}</pre>`).join("") : "<p>None.</p>"}</section><section><h2>Screen evidence</h2><ul>${report.screenshots.map((item) => `<li><a href="${item.file}">${escape(item.name)}</a></li>`).join("")}</ul></section><section><h2>Source hashes and cleanup</h2><pre>${escape(JSON.stringify({ sources: report.sources, cleanup: report.cleanup, deniedRequests: report.deniedRequests }, null, 2))}</pre></section><p><a href="report.json">Machine-readable evidence</a></p></main></html>`;
}

let server;
let browser;
try {
  await fs.mkdir(output, { recursive: true });
  for (const [url, file] of Object.entries(sourceFiles)) {
    const bytes = await fs.readFile(path.join(root, file));
    snapshots.set(url, bytes);
    report.sources.push({ file, sha256: sha(bytes) });
  }
  instrumentApp(snapshots.get("/assets/app.js").toString());
  for (const url of [
    "/icons/favicon-32.png",
    "/icons/archive-pilates-icon-192.png",
    "/icons/apple-touch-icon.png",
    "/favicon.png",
    "/site.webmanifest",
  ]) {
    snapshots.set(
      url,
      await fs
        .readFile(path.join(root, "core", url))
        .catch(() => Buffer.alloc(0)),
    );
  }
  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const bytes = snapshots.get(url.pathname);
    if (request.method !== "GET" || !bytes) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(bytes.length ? 200 : 204, {
      "Content-Type":
        mime[path.extname(sourceFiles[url.pathname] || url.pathname)] ||
        "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(bytes);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const viewport of viewports) {
    for (const [kind, run] of [
      ["home", home],
      ["private", privatePage],
      ["staff", staff],
      ["instructor-lessons", instructorLessons],
    ]) {
      await scenario(browser, origin, viewport, kind, run);
      console.log(
        `${viewport.width}-${kind}: ${report.scenarios.at(-1).status}`,
      );
    }
  }
  for (const entry of report.sources) {
    const current = sha(await fs.readFile(path.join(root, entry.file)));
    if (current !== entry.sha256)
      fail(
        "Source changed during QA",
        `${entry.file}: rerun after concurrent UI edits finish`,
      );
  }
} catch (error) {
  fail("QA setup/run", error);
} finally {
  try {
    if (browser) {
      await browser.close();
      report.cleanup.browserClosed = !browser.isConnected();
    } else report.cleanup.browserClosed = true;
  } finally {
    if (server?.listening)
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    report.cleanup.serverClosed = !server?.listening;
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      path.join(output, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await fs.writeFile(path.join(output, "report.html"), reportHtml());
  }
}
console.log(
  `${report.checks.length} checks passed; ${report.failures.length} failures. Evidence: ${output}`,
);
process.exitCode = report.failures.length ? 1 : 0;
