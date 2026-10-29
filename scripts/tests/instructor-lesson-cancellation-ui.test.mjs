import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../core/assets/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../../core/instructor-lessons/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../core/assets/interface.css", import.meta.url), "utf8");
const functions = new Map([...source.matchAll(/^(?:async )?function (\w+)\([^]*?^\}/gm)].map((match) => [match[1], match[0]]));
const names = [
  "qs", "setText", "escapeHtml", "instructorLessonStatusLabel", "instructorLessonStatusTone",
  "instructorLessonStepStatusLabel", "instructorLessonRegistrationMatchesFilter",
  "instructorLessonScheduleSourceLabel", "instructorLessonScheduleDateLabel", "instructorLessonMethodTitle", "renderInstructorLessonRoster",
  "instructorLessonCancellationKey", "instructorLessonCancellationStatusLabel", "canCancelInstructorLesson",
  "findInstructorLessonCancellationTarget", "setInstructorLessonCancellationMessage",
  "handleInstructorLessonCancellationOpen", "closeInstructorLessonCancellation", "handleInstructorLessonCancellationClose",
  "refreshInstructorLessonCancellationDashboard", "handleInstructorLessonCancellationSubmit",
  "loadInstructorLessonRegistrationDashboard", "instructorLessonConfirmationAction", "handleInstructorLessonConfirmation",
];
for (const name of names) assert.ok(functions.has(name), `${name} remains available`);
const constants = source.slice(source.indexOf("const INSTRUCTOR_LESSON_STEP_KEYS"), source.indexOf("function instructorLessonStatusLabel"));
const date = "2026-11-28";
const member = { memberKey: "key-a", memberId: "member-a", memberName: "합성 회원", registrationId: "reg-a", canCancel: true };
const dashboard = (rows = [{ ...member }]) => ({ items: [], schedule: { items: [{ date, roster: rows, countSource: "tickets" }] } });

// Exercise only the UI functions with synthetic DOM/callables, without loading Firebase or a browser.
function app(options = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", innerHTML: "", value: "", disabled: false, open: false, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() { this.focused = true; },
      reset() { element("instructorLessonCancellationReason").value = ""; },
      reportValidity() { return true; },
      showModal() { this.open = true; },
      close() { this.open = false; },
    });
    return elements.get(id);
  };
  const context = {
    state: { instructorLessonRegistrationDashboard: options.initial || dashboard() },
    document: { documentElement: { dataset: { coreAccess: options.role || "manager" } }, getElementById: element, querySelectorAll: () => [] },
    readUnavailable: () => Boolean(options.unavailable),
    setReadState() {},
    coreHref: (path) => `/core/${path}`,
    renders: 0,
    renderInstructorLessonRegistrationDashboard() {
      context.renders += 1;
      context.api.renderInstructorLessonRoster(context.state.instructorLessonRegistrationDashboard?.schedule?.items?.[0]);
    },
    calls: [],
    initFirebase: async () => ({
      functionsClient: {},
      httpsCallable: (_client, name) => async (payload) => {
        context.calls.push({ name, payload });
        if (name === "getInstructorLessonRegistrationDashboard") {
          const count = context.calls.filter((call) => call.name === name).length;
          return { data: options.read ? await options.read(count, context) : dashboard() };
        }
        return { data: options.queue ? await options.queue(payload, context) : { ok: true, jobId: "job-a", status: "pending", duplicate: false } };
      },
    }),
  };
  vm.runInNewContext(`${constants}
    let selectedInstructorLessonDate = "${date}";
    let instructorLessonCancellationTarget = null;
    let instructorLessonCancellationBusy = false;
    const instructorLessonCancellationReceipts = new Map();
    ${names.map((name) => functions.get(name)).join("\n")}
    globalThis.api = { ${names.join(",")},
      target: () => instructorLessonCancellationTarget,
      busy: () => instructorLessonCancellationBusy,
      selectedDate: () => selectedInstructorLessonDate,
      selectDate: (date) => { selectedInstructorLessonDate = date; },
      receipts: instructorLessonCancellationReceipts,
      filter: (filter) => { instructorLessonRegistrationFilter = filter; },
    };
    let instructorLessonRegistrationFilter = "active";`, context);
  const open = (row = member, lessonDate = date) => {
    const button = { disabled: false, dataset: { instructorCancelKey: row.memberKey, instructorCancelDate: lessonDate } };
    context.api.handleInstructorLessonCancellationOpen({ target: { closest: () => button } });
  };
  const submit = (reason = "일정 변경") => {
    element("instructorLessonCancellationReason").value = reason;
    return context.api.handleInstructorLessonCancellationSubmit({ preventDefault() {}, currentTarget: element("instructorLessonCancellationForm") });
  };
  return { ...context, context, element, open, submit, api: context.api, writes: () => context.calls.filter((call) => call.name === "operatorQueueInstructorLessonCancellation") };
}

test("only explicit canCancel=true for a manager exposes a 44px cancellation action", () => {
  for (const canCancel of [false, undefined, "true", 1]) {
    const a = app();
    a.api.renderInstructorLessonRoster(dashboard([{ ...member, canCancel }]).schedule.items[0]);
    assert.doesNotMatch(a.element("instructorLessonScheduleDetail").innerHTML, /data-instructor-cancel-key/);
  }
  for (const role of ["instructor", "teacher", "viewer", "unknown"]) {
    const a = app({ role });
    a.api.renderInstructorLessonRoster(dashboard().schedule.items[0]);
    a.open();
    assert.equal(a.api.target(), null);
    assert.doesNotMatch(a.element("instructorLessonScheduleDetail").innerHTML, /data-instructor-cancel-key/);
  }
  const a = app();
  a.api.renderInstructorLessonRoster(dashboard().schedule.items[0]);
  assert.match(a.element("instructorLessonScheduleDetail").innerHTML, /data-instructor-cancel-key="key-a"/);
  assert.match(css, /\.instructor-lesson-cancel-button \{ min-height: 44px/);
  assert.match(css, /\.instructor-lesson-roster-row \{ display: flex; flex-wrap: wrap/);
});

test("per-row states are accessible and names and backend errors are escaped", () => {
  for (const [status, label] of [["pending", "취소 처리중"], ["queued", "취소 처리중"], ["processing", "취소 처리중"], ["review_required", "취소 확인필요"], ["completed", "취소 완료"]]) {
    const row = { ...member, memberName: '<img src=x onerror="alert(1)">', cancellation: { status, lastError: "<script>unsafe</script>" } };
    const a = app();
    a.api.renderInstructorLessonRoster(dashboard([row]).schedule.items[0]);
    const content = a.element("instructorLessonScheduleDetail").innerHTML;
    assert.match(content, /role="status"/);
    assert.ok(content.includes(label));
    assert.match(content, /&lt;img/);
    assert.match(content, /&lt;script&gt;/);
    assert.doesNotMatch(content, /<img|<script|data-instructor-cancel-key/);
    if (status !== "completed") assert.doesNotMatch(content, /취소 완료/);
  }
});

test("native dialog identifies the member/date, scope, refund boundary and required reason", () => {
  assert.match(html, /<dialog[^>]+aria-labelledby="instructorLessonCancellationTitle"[^>]+aria-describedby=/);
  assert.match(html, /수강권 및 해당일 수업 예약 취소/);
  assert.match(html, /결제 환불은 별도/);
  assert.match(html, /실제 결제 환불은 진행되지 않습니다/);
  assert.match(html, /<textarea[^>]+minlength="2"[^>]+maxlength="200"[^>]+required/);
  assert.match(html, /id="instructorLessonCancellationError"[^>]+role="alert"/);
  const row = { ...member, memberName: "<synthetic member>" };
  const a = app({ initial: dashboard([row]) });
  a.open(row);
  assert.equal(a.element("instructorLessonCancellationMember").textContent, row.memberName);
  assert.match(a.element("instructorLessonCancellationDate").textContent, /2026-11-28/);
  assert.equal(a.element("instructorLessonCancellationDialog").open, true);
});

test("trimmed reason must have 2..200 characters before any callable runs", async () => {
  for (const reason of ["", "   ", " 한 ", "x".repeat(201)]) {
    const a = app();
    a.open();
    await a.submit(reason);
    assert.equal(a.calls.length, 0);
    assert.equal(a.element("instructorLessonCancellationReason").attributes["aria-invalid"], "true");
    assert.match(a.element("instructorLessonCancellationError").textContent, /2~200/);
  }
  for (const reason of [" 변경 ", "x".repeat(200)]) {
    const a = app(); a.open(); await a.submit(reason);
    assert.equal(a.writes()[0].payload.reason, reason.trim());
  }
});

test("independent selected target survives date changes and is relooked up before queue", async () => {
  const a = app();
  a.open();
  assert.equal(Object.isFrozen(a.api.target()), true);
  a.api.selectDate("2026-11-29");
  await a.submit();
  assert.deepEqual(a.calls.map((call) => call.name), ["getInstructorLessonRegistrationDashboard", "operatorQueueInstructorLessonCancellation", "getInstructorLessonRegistrationDashboard"]);
  assert.deepEqual(JSON.parse(JSON.stringify(a.writes()[0].payload)), {
    memberId: "member-a", lessonDate: date, registrationId: "reg-a", reason: "일정 변경", confirmed: true,
  });
  assert.equal(a.api.selectedDate(), "2026-11-29");
  assert.match(a.element("instructorLessonCancellationStatus").textContent, /취소 처리중/);
  assert.doesNotMatch(a.element("instructorLessonCancellationStatus").textContent, /완료/);
});

test("registrationId is omitted, not guessed, when the roster has none", async () => {
  const row = { ...member }; delete row.registrationId;
  const a = app({ initial: dashboard([row]), read: () => dashboard([row]) });
  a.open(row); await a.submit();
  assert.equal(a.writes().length, 1);
  assert.equal(Object.hasOwn(a.writes()[0].payload, "registrationId"), false);
});

test("stale, missing, duplicated or changed identities and revoked permission cannot enqueue", async () => {
  for (const rows of [[], [{ ...member, canCancel: false }], [{ ...member, memberId: "other" }], [{ ...member, registrationId: "other" }], [{ ...member, memberName: "other" }], [member, member], [{ ...member, cancellation: { status: "pending" } }]]) {
    const a = app({ read: () => dashboard(rows) });
    a.open(); await a.submit();
    assert.equal(a.writes().length, 0);
    assert.match(a.element("instructorLessonCancellationError").textContent, /변경/);
    assert.equal(a.element("instructorLessonCancellationSubmit").disabled, true);
  }
  const a = app({ read: (_count, context) => {
    context.document.documentElement.dataset.coreAccess = "instructor";
    return dashboard();
  } });
  a.open(); await a.submit(); assert.equal(a.writes().length, 0);
});

test("double submit and close are blocked for the whole async preflight/write", async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const a = app({ read: async () => { await wait; return dashboard(); } });
  a.open();
  const first = a.submit();
  assert.equal(a.api.busy(), true);
  assert.equal(a.element("instructorLessonCancellationClose").disabled, true);
  a.api.closeInstructorLessonCancellation();
  assert.equal(a.element("instructorLessonCancellationDialog").open, true);
  await a.submit();
  release(); await first;
  assert.equal(a.writes().length, 1);
  await a.submit();
  assert.equal(a.writes().length, 1);
  assert.equal(a.api.busy(), false);
  assert.equal(a.element("instructorLessonCancellationClose").disabled, false);
  assert.equal(a.element("instructorLessonCancellationDialog").attributes["aria-busy"], "false");
  assert.match(source, /addEventListener\("cancel", \(event\) => \{\s*if \(instructorLessonCancellationBusy\) event.preventDefault\(\)/);
});

test("preflight read failure performs no write and explains that nothing was requested", async () => {
  const a = app({ read: () => { throw new Error("offline"); } });
  a.open(); await a.submit();
  assert.equal(a.writes().length, 0);
  assert.match(a.element("instructorLessonCancellationError").textContent, /요청하지 않았습니다/);
});

test("ambiguous write responses lock the target and advise refresh instead of retry", async () => {
  for (const queue of [() => { throw new Error("deadline-exceeded"); }, () => ({}), () => ({ ok: false }), () => ({ ok: true, jobId: "job-a" })]) {
    const a = app({ queue });
    a.open(); await a.submit(); await a.submit();
    assert.equal(a.writes().length, 1);
    assert.match(a.element("instructorLessonCancellationError").textContent, /재요청하지 말고 새로고침/);
    assert.doesNotMatch(a.element("instructorLessonCancellationError").textContent, /완료/);
    assert.match(a.element("instructorLessonScheduleDetail").innerHTML, /취소 접수 확인필요/);
    a.api.closeInstructorLessonCancellation(); a.api.handleInstructorLessonCancellationClose(); a.open();
    assert.equal(a.api.target(), null);
  }
});

test("queue success followed by failed refresh stays locked without claiming completion", async () => {
  const a = app({ read: (count) => { if (count === 2) throw new Error("offline"); return dashboard(); } });
  a.open(); await a.submit();
  assert.equal(a.writes().length, 1);
  assert.match(a.element("instructorLessonCancellationError").textContent, /접수됐지만.*재요청하지 말고 새로고침/);
  assert.doesNotMatch(a.element("instructorLessonScheduleDetail").innerHTML, /data-instructor-cancel-key|취소 완료/);
});

test("duplicate requests and canonical refreshed review/completion states are displayed", async () => {
  const a = app({ queue: () => ({ ok: true, jobId: "job-a", status: "processing", duplicate: true }) });
  a.open(); await a.submit();
  assert.match(a.element("instructorLessonCancellationStatus").textContent, /기존 취소 요청.*취소 처리중/);
  for (const [status, label] of [["review_required", "취소 확인필요"], ["completed", "취소 완료"]]) {
    const b = app({ read: (count) => dashboard(count === 1 ? [member] : [{ ...member, canCancel: false, cancellation: { jobId: "job-a", status } }]) });
    b.open(); await b.submit();
    assert.equal(b.api.selectedDate(), date);
    assert.equal(b.element("instructorLessonCancellationStatus").textContent, label);
    assert.ok(b.element("instructorLessonScheduleDetail").innerHTML.includes(label));
  }
});

test("registration cancellation labels/filter buckets block rendering and invocation of 안내 재처리", async () => {
  const a = app();
  for (const [status, label, filter] of [["cancellation_pending", "취소 처리중", "active"], ["cancellation_review", "취소 확인필요", "review"], ["cancelled", "취소 완료", "all"]]) {
    const item = { registrationId: "reg-a", status, steps: { member: { status: "verified" }, ticket: { status: "verified" }, confirmation: { status: "failed" } } };
    assert.equal(a.api.instructorLessonStatusLabel(status), label);
    a.api.filter(filter);
    assert.equal(a.api.instructorLessonRegistrationMatchesFilter(item), true);
    assert.equal(a.api.instructorLessonConfirmationAction(item), "");
    a.context.state.instructorLessonRegistrationDashboard.items = [item];
    await a.api.handleInstructorLessonConfirmation({ target: { closest: () => ({ dataset: { confirmInstructorLesson: "reg-a" }, disabled: false }) } });
    assert.equal(a.calls.length, 0);
  }
});
