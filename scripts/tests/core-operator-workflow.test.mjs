import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../core/assets/app.js", import.meta.url), "utf8");
const end = source.lastIndexOf("\nenhanceNav();");
assert.ok(end > 0);

function app() {
  const elements = new Map();
  const document = {
    body: { dataset: {} },
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const context = { document, URL, console, Date, Intl };
  vm.runInNewContext(`${source.slice(0, end)}\nglobalThis.api = {
    state, setReadState, renderHomeSummary, renderHomeDecisions, renderRenewalPipeline,
    renewalCaseRows, activeRenewalMemberRows, groupRenewalRows, getCommunicationActions,
    pendingAlimtalkCandidates, failedAlimtalkCandidates, failedAlimtalkSends, isCurrentCommunicationFailure, communicationProblemSummary, currentPrivateSessionRows,
    privateSessionAction, renderPrivateSessionCard, staffCompositeScore, scoreBand,
    formatMetricNumber, formatMetricRate, parkingJobNeedsAttention, parkingJobStatusLabel,
    renderPrivate, coreHref, commandPaletteEntries
  };`, context);
  const element = (id) => {
    const value = { textContent: "", innerHTML: "", className: "" };
    elements.set(id, value);
    return value;
  };
  return { ...context.api, element, document };
}

const reference = new Date("2026-09-05T12:00:00+09:00");
const ticket = (id, remainingCount = 2) => ({ userTicketId: id, name: "그룹 30회", classType: "G", remainingCount, expiresAt: "2026-12-20" });
const renewal = (id, extra = {}) => ({ id, memberId: "m1", memberName: "테스트", ticketIdentity: "user:old", ticketName: "그룹 30회", kind: "group", priority: "urgent", active: true, ...extra });

test("fresh canonical tickets override an already-loaded member directory", () => {
  const a = app();
  a.state.members = [{ memberId: "m1", name: "테스트", currentTicketsSummary: [ticket("old")] }];
  a.state.renewalMembers = [{ id: "m1", name: "테스트", activeTickets: [ticket("new", 30)] }];
  a.state.renewalCases = [renewal("case1")];
  const rows = a.renewalCaseRows(reference);
  assert.equal(rows[0].view, "history");
  assert.equal(rows[0].recovered, true);
  assert.equal(a.activeRenewalMemberRows().length, 0);
});

test("same member is one row while individual case identities are retained", () => {
  const a = app();
  const rows = a.groupRenewalRows([
    { memberId: "m1", phone: "01011112222", view: "planned", renewalCaseId: "group" },
    { memberId: "m2", phone: "01011112222", view: "today", renewalCaseId: "private" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cases.length, 2);
  assert.equal(rows[0].view, "today");
});

test("a profile without ticket source fields cannot confirm a cached renewal outcome", () => {
  const a = app();
  a.state.members = [{ memberId: "m1", currentTicketsSummary: [ticket("new", 30)] }];
  a.state.renewalMembers = [{ id: "m1", name: "테스트" }];
  a.state.renewalCases = [renewal("case1")];
  const [row] = a.renewalCaseRows(reference);
  assert.equal(row.sourceVerified, false);
  assert.equal(row.recovered, false);
  assert.equal(row.view, "today");
});

test("completed, excluded, snoozed and contacted cases do not inflate today count", () => {
  const a = app();
  a.state.renewalCases = [
    renewal("open"), renewal("done", { workflowStatus: "resolved" }),
    renewal("excluded", { workflowStatus: "excluded" }),
    renewal("later", { workflowStatus: "snoozed", nextActionAt: "2026-09-12" }),
    renewal("contact", { workflowStatus: "contacted" }),
    renewal("elapsed", { workflowStatus: "snoozed", nextActionAt: "2026-09-01" }),
  ];
  assert.deepEqual(Array.from(a.renewalCaseRows(reference), (row) => row.view), ["today", "history", "history", "planned", "planned", "today"]);
});

test("past next-booking dates are not rendered as future appointments", () => {
  const a = app();
  a.state.renewalCases = [renewal("old", { nextBookingDate: "2026-08-03" }), renewal("new", { nextBookingDate: "2026-09-06" })];
  assert.deepEqual(Array.from(a.renewalCaseRows(reference), (row) => row.nextBookingDate), ["", "2026-09-06"]);
});

test("failed reads never render an all-clear or zero renewal count", () => {
  const a = app();
  const summary = a.element("commandQueueStatus");
  const list = a.element("homeDecisionList");
  const renewals = a.element("renewalPipelineList");
  const count = a.element("renewalPipelineCount");
  a.setReadState("renewalCases", "unavailable");
  a.renderHomeSummary(); a.renderHomeDecisions();
  assert.match(summary.textContent, /확인 필요/);
  assert.match(list.innerHTML, /확인하지 못/);
  assert.match(renewals.innerHTML, /불러오지 못/);
  assert.equal(count.textContent, "확인 필요");
});

test("an older pending message is counted independently of recent twelve history", async () => {
  const a = app();
  a.state.alimtalkCandidates = Array.from({ length: 12 }, (_, i) => ({ id: `recent${i}`, status: "sent" }));
  const calls = [];
  const runtime = {
    collection: (_, name) => name,
    where: (...args) => args,
    limit: (n) => n,
    query: (...args) => args,
    getDocs: async (query) => {
      calls.push(query);
      return { docs: [{ id: "older", data: () => ({ status: "review", studioId: "5330" }) }] };
    },
  };
  a.state.communicationActions.alimtalkCandidates = await a.getCommunicationActions({}, runtime, "alimtalkCandidates");
  assert.equal(a.pendingAlimtalkCandidates().length, 1);
  assert.equal(a.pendingAlimtalkCandidates()[0].id, "older");
  assert.equal(calls[0][1][0], "status");
  assert.ok(calls[0][1][2].includes("review"));
});

test("bounded action queries flag incomplete totals at the cap", async () => {
  const a = app();
  const runtime = { collection: () => ({}), where: () => ({}), limit: () => ({}), query: () => ({}), getDocs: async () => ({ docs: Array.from({ length: 3 }, (_, i) => ({ id: `${i}`, data: () => ({ status: "failed" }) })) }) };
  await a.getCommunicationActions({}, runtime, "alimtalkCandidates", 2);
  assert.equal(a.state.readTruncated["actions:alimtalkCandidates"], true);
});

test("candidate failure fields are queried even when primary status is sent", async () => {
  const a = app();
  const calls = [];
  const runtime = {
    collection: (_, name) => name, where: (...args) => args, limit: (n) => n, query: (...args) => args,
    getDocs: async (query) => {
      calls.push(query);
      return { docs: query[1][0] === "deliveryStatus" ? [{ id: "provider-failure", data: () => ({ status: "sent", deliveryStatus: "failed" }) }] : [] };
    },
  };
  a.state.communicationActions.alimtalkCandidates = await a.getCommunicationActions({}, runtime, "alimtalkCandidates");
  assert.equal(a.failedAlimtalkCandidates().length, 1);
  assert.ok(calls.some((query) => query[1][0] === "deliveryStatus"));
  assert.ok(calls.filter((query) => query[1][0] !== "status").every((query) => !query[1][2].includes("pending")));
});

test("an offline query snapshot cannot report current unresolved actions", async () => {
  const a = app();
  const runtime = { collection: () => ({}), where: () => ({}), limit: () => ({}), query: () => ({}), getDocs: async () => ({ metadata: { fromCache: true }, docs: [] }) };
  await assert.rejects(a.getCommunicationActions({}, runtime, "alimtalkCandidates"), /최신 업무 상태/);
});

test("resolved message failures stay out of unresolved counts", () => {
  const a = app();
  a.state.communicationActions.alimtalkSends = [{ id: "failed", status: "failed" }, { id: "done", status: "failed", actionStatus: "resolved" }];
  assert.equal(a.failedAlimtalkSends().length, 1);
});

test("provider delivery failure is not hidden by an earlier sent status", () => {
  const a = app();
  a.state.communicationActions.alimtalkSends = [
    { id: "delivery", status: "sent", deliveryStatus: "failed", candidateId: "candidate" },
    { id: "resolved", status: "sent", deliveryStatus: "failed", actionStatus: "resolved" },
  ];
  a.state.communicationActions.alimtalkCandidates = [{ id: "candidate", status: "failed" }];
  assert.equal(a.failedAlimtalkSends().length, 1);
  const summary = a.communicationProblemSummary();
  assert.equal(summary.failedSends.length + summary.failedCandidates.length, 1);
});

test("explicit terminal resolutions stay hidden despite a retained provider failure", () => {
  const a = app();
  a.state.communicationActions.alimtalkSends = [
    ...["closed", "ignored", "resolved", "done", "completed", "skipped", "excluded"].map((status) => ({ id: status, status, deliveryStatus: "failed" })),
    { id: "unresolved", status: "sent", sendStatus: "failed" },
  ];
  const rows = a.failedAlimtalkSends();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "unresolved");
});

test("communication failures use an inclusive rolling seven-day boundary", () => {
  const a = app();
  const cutoff = reference.getTime() - 7 * 24 * 60 * 60 * 1000;
  for (const [offset, expected] of [[-1, false], [0, true], [1, true]]) {
    assert.equal(a.isCurrentCommunicationFailure({ status: "failed", failedAt: new Date(cutoff + offset).toISOString() }, reference), expected, `cutoff offset ${offset}ms`);
  }
});

test("every communication activity timestamp can establish the most recent failure activity", () => {
  const a = app();
  const fields = ["failedAt", "lastAttemptAt", "deliveryUpdatedAt", "updatedAt", "sentAt", "createdAt"];
  const old = Object.fromEntries(fields.map((field) => [field, "2026-08-01T00:00:00Z"]));
  assert.equal(a.isCurrentCommunicationFailure({ status: "failed", ...old }, reference), false);
  for (const field of fields) {
    assert.equal(a.isCurrentCommunicationFailure({ status: "failed", ...old, [field]: "2026-09-04T00:00:00Z" }, reference), true, field);
    assert.equal(a.isCurrentCommunicationFailure({ status: "failed", [field]: old[field] }, reference), false, `${field} alone is historical`);
  }
});

test("undated or unusably dated communication failures remain actionable", () => {
  const a = app();
  for (const dates of [{}, { failedAt: null, updatedAt: "" }, { failedAt: "invalid-date", createdAt: "invalid-date" }]) {
    assert.equal(a.isCurrentCommunicationFailure({ status: "failed", ...dates }, reference), true);
  }
});

test("only explicit true test flags exclude communication failures", () => {
  const a = app();
  for (const field of ["isTest", "testMode", "syntheticTest"]) {
    assert.equal(a.isCurrentCommunicationFailure({ status: "failed", [field]: true, scheduledAt: "2026-09-06" }, reference), false, field);
    for (const value of [false, "true", 1, null]) {
      assert.equal(a.isCurrentCommunicationFailure({ status: "failed", [field]: value }, reference), true, `${field}=${value}`);
    }
  }
});

test("test-prefixed communication identities are excluded even for upcoming work", () => {
  const a = app();
  for (const prefix of ["test_", "e2e_", "private_survey_staff_psr-test-", "private_survey_psr-test-"]) {
    for (const field of ["id", "candidateId", "requestId"]) {
      assert.equal(a.isCurrentCommunicationFailure({ status: "failed", [field]: `${prefix}123`, lessonDate: "2026-09-06" }, reference), false, `${field}: ${prefix}`);
    }
    assert.equal(a.isCurrentCommunicationFailure({ status: "failed", id: `live_${prefix}123` }, reference), true, `non-prefix ${prefix}`);
  }
});

test("current-day and future schedules retain old failures while past schedules do not", () => {
  const a = app();
  for (const field of ["scheduledAt", "scheduledFor", "lessonDate", "lectureDate"]) {
    for (const [date, expected] of [["2026-09-04", false], ["2026-09-05", true], ["2026-09-06", true]]) {
      assert.equal(a.isCurrentCommunicationFailure({ status: "failed", failedAt: "2026-08-01", [field]: date }, reference), expected, `${field}: ${date}`);
    }
  }
});

test("archived failed sends remain unresolved history and are excluded by default", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: reference.getTime() });
  const a = app();
  const items = [
    { id: "current-failure", status: "failed", failedAt: "2026-09-04" },
    { id: "historical-failure", status: "failed", failedAt: "2026-08-01" },
    { id: "historical-delivery-failure", status: "sent", deliveryStatus: "failed", updatedAt: "2026-08-01" },
    { id: "undated-failure", status: "failed" },
    { id: "resolved-failure", status: "failed", failedAt: "2026-08-01", actionStatus: "resolved" },
    { id: "successful-send", status: "sent", sentAt: "2026-09-04" },
  ];
  const before = structuredClone(items);
  assert.deepEqual(Array.from(a.failedAlimtalkSends(items), (row) => row.id), ["current-failure", "undated-failure"]);
  const history = a.failedAlimtalkSends(items, true);
  assert.deepEqual(Array.from(history, (row) => row.id), ["current-failure", "historical-failure", "historical-delivery-failure", "undated-failure"]);
  assert.equal(history.find((row) => row.id === "historical-failure").status, "failed");
  assert.equal(history.find((row) => row.id === "historical-delivery-failure").deliveryStatus, "failed");
  assert.deepEqual(items, before);
});

test("menu search resolves to the CORE root from a nested detail page", () => {
  const a = app();
  a.document.querySelector = () => ({ getAttribute: () => "../../" });
  const item = a.commandPaletteEntries().find((row) => row.title === "재등록 관리");
  assert.equal(item.href, "../../#renewalPipeline");
  assert.equal(a.commandPaletteEntries().find((row) => row.title === "프라이빗 진행").href, "../../private/");
});

test("published-only legacy session is not delivered, and verified is explicit", () => {
  const a = app();
  const row = { sessionId: "s", memberName: "테스트", memberId: "m", workflowStage: "delivered", reportStatus: "published", deliveryStatus: "pending", postStatus: "submitted", lessonStartAt: "2026-09-05T20:00:00+09:00" };
  const [current] = a.currentPrivateSessionRows([row], reference);
  assert.equal(current.workflowStage, "report_review");
  assert.match(a.renderPrivateSessionCard(current), /회차 확인 필요/);
  assert.doesNotMatch(a.privateSessionAction({ ...row, workflowStage: "recording", nextAction: "수업 전 계획 작성" }), /수업 전 계획/);
  assert.equal(a.currentPrivateSessionRows([{ ...row, deliveryStatus: "sent" }], reference)[0].workflowStage, "delivered");
});

test("private projection read failure does not silently fall back to an empty legacy board", () => {
  const a = app();
  const list = a.element("privateProgressList");
  const count = a.element("privatePendingCount");
  a.setReadState("privateLessonSessions", "unavailable");
  a.renderPrivate([], [], []);
  assert.equal(count.textContent, "확인 필요");
  assert.match(list.innerHTML, /불러오지 못/);
});

test("missing scores are not zero or poor performance", () => {
  const a = app();
  assert.equal(a.scoreBand(null).label, "평가 전");
  assert.equal(a.scoreBand(0).label, "개선필요");
  assert.equal(a.formatMetricNumber(null), "자료 없음");
  assert.equal(a.formatMetricRate(""), "자료 없음");
  const result = a.staffCompositeScore({ employmentState: "current" }, [], null);
  assert.equal(result.activeCount, 0);
  assert.equal(result.coverage, 0);
  assert.equal(result.score, null);
});

test("no-entry history is distinct from unresolved actual parking failure", () => {
  const a = app();
  assert.equal(a.parkingJobNeedsAttention({ status: "manual_review", reason: "no_entry" }), false);
  assert.equal(a.parkingJobStatusLabel({ status: "manual_review", reason: "no_entry" }), "입차 미확인");
  assert.equal(a.parkingJobNeedsAttention({ status: "failed", reason: "provider_error" }), true);
  assert.equal(a.parkingJobNeedsAttention({ status: "failed", resolvedAt: "2026-09-01" }), false);
});
