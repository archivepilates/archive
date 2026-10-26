import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const ts = createRequire(new URL("../../firebase/kangsain-functions/functions/package.json", import.meta.url))("typescript");
const root = new URL("../../firebase/kangsain-functions/functions/src/", import.meta.url);
const forbidden = () => { throw new Error("Forbidden import or side effect in outdoor survey test"); };

function treeFor(file) {
  return ts.createSourceFile(file, readFileSync(new URL(file, root), "utf8"), ts.ScriptTarget.Latest, true);
}

function declaration(tree, name) {
  const node = tree.statements.find((item) =>
    ts.isFunctionDeclaration(item) ? item.name?.text === name :
      ts.isVariableStatement(item) && item.declarationList.declarations.some((value) => value.name.getText(tree) === name));
  assert.ok(node, `Missing actual declaration: ${tree.fileName}:${name}`);
  return node;
}

// Only actual pure declarations enter the VM; production modules are never imported.
function pure(file, names, bindings = {}) {
  const tree = treeFor(file);
  const nodes = names ? names.map((name) => declaration(tree, name)) : tree.statements.filter((node) => !ts.isImportDeclaration(node));
  const exports = {};
  const code = ts.transpileModule(nodes.map((node) => node.getText(tree)).join("\n") +
    (names ? `\nObject.assign(exports, { ${names.join(", ")} });` : ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ exports, db: new Proxy({}, { get: forbidden }), ...bindings,
    require: forbidden, fetch: forbidden, process: undefined, console: { log: forbidden, warn: forbidden, error: forbidden },
    setTimeout: forbidden, setInterval: forbidden,
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(code, context, { filename: file, timeout: 1000 });
  return exports;
}

const policy = pure("privateSurvey/groupSurveyBookingPolicy.ts", null);
const instructor = pure("alimtalk/instructorLessonBookingPolicy.ts", ["isInstructorLessonBooking"]);
const generation = pure("alimtalk/rebuildAlimtalkCandidates.ts", [
  "bookingTicketKind", "isGroupBooking", "isGroupAttendanceHistory", "isPrivateBookingTicket",
  "memberBookings", "firstUpcomingGroupBookingInReservationWindow", "hasAttendedGroupBookingOnOrBefore",
], { ...policy, ...instructor, reservationOpenEndDate: () => "2026-11-08" });
const products = pure("alimtalk/recipientExclusion.ts", ["automaticMemberProductIssue", "instructorLessonSource"], policy);
const active = pure("privateSurvey/privateSurveyResponse.ts", ["isSurveyBookingActive"], { ...policy, ...generation });

const reason = "야외수업 예약 일반 그룹 설문 제외";
const memberId = "synthetic-member";
const regular = {
  bookingId: "regular-booking", memberId, lessonType: "group", ticketName: "그룹 30회",
  ticketClassType: "G", appStatus: "reserved", lectureDate: "2026-11-03", attendanceStatus: "",
  lectureStartAt: { toMillis: () => 2000 },
};
const outdoor = { ...regular, bookingId: "outdoor-booking", ticketName: "야외수업 1회", lectureDate: "2026-11-02" };
const candidate = {
  candidateId: "old-queued-candidate", memberId, type: "group_survey", status: "queued",
  payload: { bookingId: outdoor.bookingId, ticketName: "그룹 30회" },
};
const profile = { memberId, activeTickets: [{ name: "야외수업", classType: "G" }, { name: "그룹 30회", classType: "G" }] };

test("policy exports the stable operator-facing exclusion reason", () => {
  assert.equal(policy.OUTDOOR_GROUP_SURVEY_EXCLUSION_REASON, reason);
});

test("booking policy has no runtime imports or profile-based selection", () => {
  const tree = treeFor("privateSurvey/groupSurveyBookingPolicy.ts");
  for (const node of tree.statements.filter(ts.isImportDeclaration)) {
    assert.equal(node.importClause?.isTypeOnly, true, "pure helper must not initialize runtime dependencies");
  }
  assert.doesNotMatch(tree.text, /activeTickets|memberProfile|member360|workLanes/);
});

for (const field of ["ticketName", "ticketClassType", "ticketType"]) {
  for (const value of ["야외수업", "가을 야 외 수업 1회", "OUTDOOR", " Outdoor Pilates ", "o u t\td\no\ro r", "Ｏｕｔｄｏｏｒ", "야\u00a0외", "야\u3000외", "야외".normalize("NFD")]) {
    test(`canonical ${field} recognizes normalized outdoor value ${JSON.stringify(value)}`, () => {
      const booking = { ...regular, [field]: value };
      assert.equal(policy.isOutdoorGroupSurveyBooking(booking), true);
      assert.equal(generation.isGroupBooking(booking), false);
      assert.equal(generation.isGroupAttendanceHistory(booking), false);
      assert.equal(products.automaticMemberProductIssue(candidate, profile, booking), reason);
    });
  }
}

test("missing and non-string canonical values do not accidentally match outdoor", () => {
  for (const source of [undefined, null, {}, { ticketName: null }, { ticketName: 0, ticketClassType: false, ticketType: 17 },
    { ticketName: {}, ticketClassType: [], ticketType: true }]) {
    assert.equal(policy.isOutdoorGroupSurveyBooking(source), false, JSON.stringify(source));
  }
});

test("only canonical booking fields count, never member holdings, display metadata, or queued payload", () => {
  const poisoned = { ...regular, name: "야외수업", lessonTitle: "OUTDOOR", memberName: "야외",
    activeTickets: profile.activeTickets, memberProfile: profile, payload: { ticketName: "야외수업" } };
  assert.equal(policy.isOutdoorGroupSurveyBooking(poisoned), false);
  assert.equal(generation.isGroupBooking(poisoned), true);
  assert.equal(products.automaticMemberProductIssue(candidate, profile, poisoned), "");
  assert.equal(products.automaticMemberProductIssue({ ...candidate, payload: { ticketName: "야외수업" } }, profile, regular), "");
  assert.equal(products.automaticMemberProductIssue(candidate, { memberId, activeTickets: profile.activeTickets.slice(0, 1) }, regular), "");
});

for (const ticketName of ["그룹 30회", "그룹 무료", "그룹 1회", "그룹 체험", "소그룹 체험", "무료", "1회", "체험", ""]) {
  test(`ordinary group product retains existing eligibility: ${JSON.stringify(ticketName)}`, () => {
    const booking = { ...regular, ticketName };
    assert.equal(policy.isOutdoorGroupSurveyBooking(booking), false);
    assert.equal(generation.isGroupBooking(booking), true);
    assert.equal(generation.isGroupAttendanceHistory(booking), true);
    assert.equal(products.automaticMemberProductIssue(candidate, profile, booking), "");
  });
}

test("fallback group classification preserves free, one-off and trial semantics", () => {
  for (const ticketName of ["그룹 무료", "그룹 1회", "체험", "소그룹", ""]) {
    assert.equal(generation.isGroupBooking({ ...regular, lessonType: "", ticketClassType: "", ticketName }), true);
  }
  for (const ticketName of ["무료", "1회"]) {
    assert.equal(generation.isGroupBooking({ ...regular, lessonType: "", ticketClassType: "", ticketName }), false);
  }
});

test("private and instructor controls remain distinct from outdoor exclusions", () => {
  for (const patch of [
    { lessonType: "private", ticketName: "개인 10회", ticketClassType: "P" },
    { lessonType: "semi_private", ticketName: "듀엣 10회", ticketClassType: "P" },
    { ticketName: "강사레슨 (2T)", ticketClassType: "I" },
    { ticketName: "그룹 30회", ticketClassType: "INSTRUCTOR" },
  ]) {
    const booking = { ...regular, ...patch };
    assert.equal(policy.isOutdoorGroupSurveyBooking(booking), false);
    assert.equal(generation.isGroupBooking(booking), false);
    assert.equal(generation.isGroupAttendanceHistory(booking), false);
    assert.notEqual(products.automaticMemberProductIssue(candidate, profile, booking), reason);
  }
  const privateBooking = { ...regular, lessonType: "private", ticketClassType: "P", ticketName: "개인 10회" };
  assert.equal(generation.isPrivateBookingTicket(privateBooking), true);
  assert.equal(generation.isPrivateBookingTicket({ ...privateBooking, ticketName: "OUTDOOR 개인 10회" }), true);
});

test("actual upcoming selector skips earliest outdoor reservation and selects next regular booking", () => {
  const index = new Map([[memberId, [outdoor, regular, { ...regular, memberId: "other", bookingId: "cancelled", appStatus: "cancelled" }]]]);
  assert.equal(generation.firstUpcomingGroupBookingInReservationWindow(memberId, "2026-11-01", index)?.bookingId, regular.bookingId);
  assert.equal(generation.firstUpcomingGroupBookingInReservationWindow(memberId, "2026-11-01", new Map([[memberId, [outdoor]]])), null);
});

test("outdoor attendance does not block first regular group survey; regular attendance still does", () => {
  const pastOutdoor = { ...outdoor, lectureDate: "2026-10-25", attendanceStatus: "attended" };
  const index = new Map([[memberId, [pastOutdoor, regular]]]);
  assert.equal(generation.hasAttendedGroupBookingOnOrBefore(memberId, "2026-11-01", index), false);
  assert.equal(generation.firstUpcomingGroupBookingInReservationWindow(memberId, "2026-11-01", index)?.bookingId, regular.bookingId);
  index.get(memberId).push({ ...regular, lectureDate: "2026-10-24", attendanceStatus: "attended" });
  assert.equal(generation.hasAttendedGroupBookingOnOrBefore(memberId, "2026-11-01", index), true);
});

test("old queued regular snapshot is blocked by matching canonical outdoor booking", () => {
  assert.equal(products.automaticMemberProductIssue(candidate, profile, outdoor), reason);
  assert.equal(products.automaticMemberProductIssue(candidate, undefined, outdoor), reason);
  assert.notEqual(products.automaticMemberProductIssue(candidate, profile, undefined), "");
  assert.notEqual(products.automaticMemberProductIssue(candidate, profile, { ...outdoor, memberId: "other" }), "");
  assert.equal(products.automaticMemberProductIssue(candidate, profile, regular), "");
  for (const type of ["private_survey", "instructor_lesson_material", "instructor_lesson_confirmation", "membership_welcome"]) {
    assert.equal(products.automaticMemberProductIssue({ ...candidate, type }, profile, outdoor), "");
  }
});

test("actual queued recipient reader reloads its canonical booking before product exclusion", async () => {
  const reads = [];
  const recipient = pure("alimtalk/recipientExclusion.ts", ["currentAutomaticMemberExclusionReason"], {
    ...products,
    isAutomaticMemberAlimtalkType: (type) => type === "group_survey",
    loadActiveStaffPhones: async () => new Set(),
    automaticMemberExclusionReason: () => "",
    refs: {
      memberProfile: (id) => ({ get: async () => { reads.push(["profile", id]); return { data: () => profile }; } }),
      booking: (id) => ({ get: async () => { reads.push(["booking", id]); return { data: () => outdoor }; } }),
    },
  });
  assert.equal(await recipient.currentAutomaticMemberExclusionReason(candidate), reason);
  assert.deepEqual(reads, [["profile", memberId], ["booking", outdoor.bookingId]]);
});

test("staff active-booking predicate rejects group outdoor but preserves regular and private flows", () => {
  assert.equal(active.isSurveyBookingActive({ surveyType: "group" }, outdoor), false);
  assert.equal(active.isSurveyBookingActive({ surveyType: "group" }, regular), true);
  assert.equal(active.isSurveyBookingActive({ surveyType: "group" }, { ...regular, appStatus: "cancelled" }), false);
  assert.equal(active.isSurveyBookingActive({ surveyType: "group" }, { ...regular, sourceStatus: "deleted" }), false);
  const privateBooking = { ...regular, lessonType: "private", ticketClassType: "P", ticketName: "개인 10회" };
  assert.equal(active.isSurveyBookingActive({ surveyType: "private" }, privateBooking), true);
});

function rejectedEffect(state, name) {
  return () => {
    state.effects.push(name);
    throw new Error(`Forbidden synthetic side effect: ${name}`);
  };
}

function eligibilityFixture(booking) {
  const state = { effects: [], reads: [], overrides: 0 };
  const canonical = pure("alimtalk/recipientExclusion.ts", ["currentOutdoorGroupSurveyExclusionReason"], {
    ...policy, refs: { booking: (id) => ({ get: async () => {
      state.reads.push(id);
      return { data: () => booking };
    } }) },
  });
  const api = pure("alimtalk/eligibility.ts", ["evaluateAutoSendability"], {
    ...canonical,
    isHoldingNoticeCandidate: () => false,
    hasExplicitAlimtalkTestOverride: () => { state.overrides++; return true; },
    isAlimtalkTestRecipient: () => true,
    ALIMTALK_MEMBER_EXCLUSION_REASONS: {},
    alimtalkTemplateTargetRule: () => ({ requiresApprovedTemplate: true }),
    currentAutomaticMemberExclusionReason: rejectedEffect(state, "member-exclusion-after-override"),
    ...Object.fromEntries([
      "privateSurveyTemplateContractIssue", "instructorLessonTemplateContractIssue", "recommendedMealTemplateContractIssue",
      "recommendedMealReportTemplateContractIssue", "instructorLessonConfirmationTemplateContractIssue", "reservationOpenTemplateContractIssue",
    ].map((name) => [name, () => ""])),
    alimtalkTemplateReadiness: rejectedEffect(state, "provider"),
  });
  return { state, run: (value = candidate, options = {}) => api.evaluateAutoSendability(value, "2026-11-01", options) };
}

for (const options of [{}, { readOnly: true }]) {
  test(`actual eligibility blocks outdoor before explicit override and forbidden provider: ${JSON.stringify(options)}`, async () => {
    const fixture = eligibilityFixture(outdoor);
    assert.equal(await fixture.run({ ...candidate, payload: { ...candidate.payload, testRecipientOverride: "approved" } }, options), reason);
    assert.deepEqual(fixture.state.reads, [outdoor.bookingId]);
    assert.equal(fixture.state.overrides, 0);
    assert.deepEqual(fixture.state.effects, []);
  });
}

test("regular eligibility control reaches explicit override and the forbidden provider sentinel", async () => {
  const fixture = eligibilityFixture(regular);
  await assert.rejects(fixture.run(), /Forbidden synthetic side effect: provider/);
  assert.ok(fixture.state.overrides > 0);
  assert.deepEqual(fixture.state.effects, ["provider"]);
});

function surveyFixture(names, { booking = outdoor, status = "pending", requestId = "synthetic-request" } = {}) {
  const state = { effects: [], reads: [], requestReads: [], emails: 0, errors: [], query: [] };
  const groupRequest = { requestId, bookingId: outdoor.bookingId, memberId, status,
    memberName: "Synthetic Member", staffName: "Synthetic Staff" };
  const matching = { status: "matched", bookingId: outdoor.bookingId, memberId };
  const doc = { responseId: requestId, surveyType: "group", matching };
  const response = {
    code: undefined, body: undefined,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send: rejectedEffect(state, "unexpected-response-send"),
  };
  const query = {
    where(...args) { state.query.push(["where", ...args]); return this; },
    limit(value) { state.query.push(["limit", value]); return this; },
    async get() { return { docs: [{ id: requestId, data: () => groupRequest }] }; },
  };
  const refs = {
    booking(id) {
      assert.equal(id, outdoor.bookingId, "replacement or unrelated booking must not be read");
      return {
        async get() { state.reads.push(["booking", id]); return { data: () => booking }; },
        set: rejectedEffect(state, "booking-write"),
      };
    },
    privateSurveyResponse(id) {
      assert.equal(id, requestId);
      return {
        async get() {
          state.reads.push(["response", id]);
          assert.equal(status, "submitted", "pending outdoor must return before response reads");
          return { data: () => ({ delivery: { detailUrl: "https://example.invalid/existing", alimtalkStatus: "pending" } }) };
        },
        set: rejectedEffect(state, "response-write"),
      };
    },
    memberMemos: rejectedEffect(state, "member-memo-write"),
  };
  const api = pure("privateSurvey/privateSurveyResponse.ts", ["groupSurveyOutdoorIssue", ...names], {
    ...policy, refs,
    db: { collection(name) {
      assert.equal(name, "groupSurveyRequests", "no memo job or other collection access");
      return query;
    } },
    setCors() {},
    readGroupSurveyRequest: async (id, token) => {
      state.requestReads.push([id, token]);
      assert.equal(id, requestId);
      assert.equal(token, "synthetic-token");
      return { groupRequest, accessToken: token };
    },
    normalizeGroupSurveySubmitPayload: (input) => input,
    detailUrlFor: () => "https://example.invalid/fallback",
    groupLessonTime: () => "synthetic-lesson-time",
    existingSurveySubmissionAlertIds: async (ids) => {
      assert.deepEqual(Array.from(ids), [`group_${requestId}`]);
      return new Set();
    },
    sendMissingSurveySubmissionEmailOnce: () => { state.emails++; return rejectedEffect(state, "email")(); },
    logger: { error: (message) => state.errors.push(message) },
    ...Object.fromEntries([
      "groupSurveyAnswers", "summarizeGroupSurveyAnswers", "groupSurveyMatch", "buildGroupSurveyDoc",
      "createSurveyResponseIfNew", "pendingStaffSurveyDelivery", "writePublicSurveyDoc", "groupSurveyMemoContent",
      "groupSurveyMissingSubmissionDueAt", "isSurveyBookingActive", "matchFromBooking", "nowTimestamp",
      "surveyMemoKind", "createDocumentIfMissing",
    ].map((name) => [name, rejectedEffect(state, name)])),
    surveyMemoContent: () => "synthetic memo content",
  });
  return { api, state, response, groupRequest, doc };
}

for (const [label, booking, expected] of [
  ["owned outdoor", outdoor, reason],
  ["foreign outdoor", { ...outdoor, memberId: "other" }, ""],
  ["owned regular", regular, ""],
  ["missing booking", null, ""],
]) {
  test(`actual request outdoor guard verifies canonical ownership: ${label}`, async () => {
    const fixture = surveyFixture([], { booking });
    assert.equal(await fixture.api.groupSurveyOutdoorIssue(fixture.groupRequest), expected);
    assert.deepEqual(fixture.state.reads, [["booking", outdoor.bookingId]]);
    assert.deepEqual(fixture.state.effects, []);
  });
}

test("actual request guard with no canonical booking id performs no read", async () => {
  const fixture = surveyFixture([]);
  assert.equal(await fixture.api.groupSurveyOutdoorIssue({ memberId, bookingId: "", ticketName: "야외수업" }), "");
  assert.deepEqual(fixture.state.reads, []);
});

for (const method of ["GET", "POST"]) {
  test(`actual ${method} pending outdoor handler returns 410 without writes or downstream side effects`, async () => {
    const fixture = surveyFixture(["submitGroupSurveyResponseHandler"]);
    const identity = { id: fixture.groupRequest.requestId, token: "synthetic-token" };
    await fixture.api.submitGroupSurveyResponseHandler({ method, query: identity,
      body: { requestId: identity.id, accessToken: identity.token } }, fixture.response);
    assert.equal(fixture.response.code, 410);
    assert.equal(fixture.response.body.ok, false);
    assert.equal(fixture.response.body.error, reason);
    assert.deepEqual(fixture.state.requestReads, [[identity.id, identity.token]]);
    assert.deepEqual(fixture.state.reads, [["booking", outdoor.bookingId]]);
    assert.deepEqual(fixture.state.effects, []);
    assert.deepEqual(fixture.state.errors, []);
  });
}

for (const method of ["GET", "POST"]) {
  test(`actual ${method} submitted outdoor handler preserves completed response without replay`, async () => {
    const fixture = surveyFixture(["submitGroupSurveyResponseHandler"], { status: "submitted" });
    await fixture.api.submitGroupSurveyResponseHandler({ method,
      query: { id: fixture.groupRequest.requestId, token: "synthetic-token" },
      body: { requestId: fixture.groupRequest.requestId, accessToken: "synthetic-token" } }, fixture.response);
    assert.equal(fixture.response.code, 200);
    assert.equal(fixture.response.body.ok, true);
    if (method === "POST") {
      assert.equal(fixture.response.body.duplicate, true);
      assert.equal(fixture.response.body.responseId, fixture.groupRequest.requestId);
      assert.equal(fixture.response.body.detailUrl, "https://example.invalid/existing");
      assert.equal(fixture.response.body.alimtalkStatus, "pending");
      assert.deepEqual(fixture.state.reads, [["response", fixture.groupRequest.requestId]]);
    } else {
      assert.equal(fixture.response.body.status, "submitted");
      assert.deepEqual(fixture.state.reads, []);
    }
    assert.deepEqual(fixture.state.effects, []);
    assert.deepEqual(fixture.state.errors, []);
  });
}

test("actual missing-alert loop counts outdoor request but produces zero emails or writes", async () => {
  const fixture = surveyFixture(["processMissingGroupSurveySubmissionAlerts"]);
  const result = await fixture.api.processMissingGroupSurveySubmissionAlerts();
  assert.deepEqual({ ...result }, { checked: 1, due: 0, emailed: 0 });
  assert.deepEqual(fixture.state.query, [["where", "status", "==", "pending"], ["limit", 500]]);
  assert.deepEqual(fixture.state.reads, [["booking", outdoor.bookingId]]);
  assert.equal(fixture.state.emails, 0);
  assert.deepEqual(fixture.state.effects, []);
});

test("actual staff refresh returns outdoor issue before replacement reads or writes", async () => {
  const booking = { ...outdoor, appStatus: "cancelled", supersededByBookingId: "forbidden-replacement" };
  Object.defineProperty(booking, "sessionOrder", { get: forbidden });
  const fixture = surveyFixture(["refreshSurveyBookingForStaffDelivery"], { booking });
  const result = await fixture.api.refreshSurveyBookingForStaffDelivery(fixture.doc);
  assert.equal(result.doc, fixture.doc);
  assert.equal(result.issue, reason);
  assert.deepEqual(fixture.state.reads, [["booking", outdoor.bookingId]]);
  assert.deepEqual(fixture.state.effects, []);
});

test("actual memo enqueue for matched outdoor group creates no memo, booking preview or StudioMate job", async () => {
  const fixture = surveyFixture(["enqueueSurveyMemoOutputs"]);
  await fixture.api.enqueueSurveyMemoOutputs(fixture.doc);
  await fixture.api.enqueueSurveyMemoOutputs(fixture.doc, "synthetic explicit content");
  assert.deepEqual(fixture.state.reads, [["booking", outdoor.bookingId], ["booking", outdoor.bookingId]]);
  assert.deepEqual(fixture.state.effects, []);
});

function descendants(node, predicate) {
  const result = [];
  function visit(item) {
    if (predicate(item)) result.push(item);
    ts.forEachChild(item, visit);
  }
  visit(node);
  return result;
}

function calls(node, name) {
  return descendants(node, (item) => ts.isCallExpression(item) && ts.isIdentifier(item.expression) && item.expression.text === name);
}

test("request exclusion resolves canonical refs.booking, never profile tickets", () => {
  const tree = treeFor("privateSurvey/privateSurveyResponse.ts");
  const guard = declaration(tree, "groupSurveyOutdoorIssue");
  const source = guard.getText(tree);
  assert.match(source, /refs\.booking\(/);
  assert.equal(calls(guard, "isOutdoorGroupSurveyBooking").length, 1);
  assert.doesNotMatch(source, /activeTickets|memberProfile|member360|workLanes/);
});

test("GET and unsubmitted POST guard before exposing or creating a group survey", () => {
  const tree = treeFor("privateSurvey/privateSurveyResponse.ts");
  const handler = declaration(tree, "submitGroupSurveyResponseHandler");
  const get = descendants(handler, (node) => ts.isIfStatement(node) && /request\.method\s*===\s*"GET"/.test(node.expression.getText(tree)))[0];
  assert.ok(get, "GET branch");
  assert.ok(calls(get.thenStatement, "groupSurveyOutdoorIssue").length > 0, "GET canonical outdoor guard");
  const guards = calls(handler, "groupSurveyOutdoorIssue").filter((node) => node.pos > get.end);
  const create = calls(handler, "createSurveyResponseIfNew")[0];
  const submitted = descendants(handler, (node) => ts.isIfStatement(node) && /groupRequest\.status\s*===\s*"submitted"/.test(node.expression.getText(tree)))[0];
  assert.ok(create && submitted, "existing submission and idempotency boundaries");
  assert.ok(guards.some((node) => node.pos > submitted.end && node.end < create.pos), "unsubmitted POST canonical guard precedes creation");
});

test("missing group submission alerts continue before matching or sending an outdoor request", () => {
  const tree = treeFor("privateSurvey/privateSurveyResponse.ts");
  const alerts = declaration(tree, "processMissingGroupSurveySubmissionAlerts");
  const guards = descendants(alerts, (node) => ts.isIfStatement(node) && calls(node.expression, "groupSurveyOutdoorIssue").length > 0);
  assert.ok(guards.some((node) => descendants(node.thenStatement, ts.isContinueStatement).length > 0), "outdoor condition continues the loop");
  const guard = guards[0];
  const match = calls(alerts, "groupSurveyMatch")[0];
  const send = calls(alerts, "sendMissingSurveySubmissionEmailOnce")[0];
  assert.ok(guard && match && send && guard.end < match.pos && guard.end < send.pos, "guard precedes matching and internal alert send");
});

test("staff refresh rejects canonical outdoor source before accepting or following replacement", () => {
  const tree = treeFor("privateSurvey/privateSurveyResponse.ts");
  const refresh = declaration(tree, "refreshSurveyBookingForStaffDelivery");
  const guards = descendants(refresh, (node) => ts.isIfStatement(node) && calls(node.expression, "isOutdoorGroupSurveyBooking").length > 0);
  assert.ok(guards.some((node) => descendants(node.thenStatement, ts.isReturnStatement).length > 0), "early outdoor return");
  const activeCall = calls(refresh, "isSurveyBookingActive")[0];
  assert.ok(activeCall && guards[0].end < activeCall.pos, "outdoor guard precedes normal active/replacement handling");
});
