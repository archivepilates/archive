import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../../firebase/kangsain-functions/functions/", import.meta.url);
const ts = createRequire(new URL("package.json", root))("typescript");
const source = (file) => readFileSync(new URL(`src/${file}.ts`, root), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const unavailable = () => { throw new Error("Unexpected unmocked dependency or secret read"); };
const secret = (name) => ({ name, value: unavailable });
const constants = { REGION: "test-region", TIMEZONE: "test-timezone" };

// Evaluate export options, never real Firebase modules, credentials, or handlers.
function evaluate(text, globals = {}) {
  const output = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, ...globals }, { timeout: 1000 });
  return exports;
}

const secrets = evaluate(source("config/secrets"), {
  require: (id) => {
    assert.equal(id, "firebase-functions/params");
    return { defineSecret: secret };
  },
});
const options = evaluate(source("runtime/functionOptions"), {
  require: (id) => {
    if (id === "../config/constants") return constants;
    assert.equal(id, "../config/secrets");
    return secrets;
  },
});
const captures = Object.fromEntries(
  ["onCall", "onRequest", "onSchedule", "onDocumentCreated", "onDocumentWritten"].map((kind) =>
    [kind, (options, handler) => ({ kind, options, handler })]),
);
const otherSecrets = {
  instagramAccessToken: secret("INSTAGRAM_ACCESS_TOKEN"),
  instagramUserId: secret("INSTAGRAM_USER_ID"),
  iparkingAccountPoolJson: secret("IPARKING_ACCOUNT_POOL_JSON"),
  iparkingLoginId: secret("IPARKING_LOGIN_ID"),
  iparkingLoginPassword: secret("IPARKING_LOGIN_PASSWORD"),
  iparkingSubLoginId: secret("IPARKING_SUB_LOGIN_ID"),
  iparkingSubLoginPassword: secret("IPARKING_SUB_LOGIN_PASSWORD"),
};
function exportModule(name) {
  return evaluate(source(`exports/${name}`), {
    require: (id) => {
      if (id === "../runtime/functionOptions") return options;
      if (id === "../config/secrets") return secrets;
      if (id === "../config/constants") return constants;
      if (id.startsWith("firebase-functions/v2/")) return captures;
      return new Proxy({}, { get: (_target, key) => otherSecrets[key] || unavailable });
    },
  });
}
const app = exportModule("app");
const privateChart = exportModule("privateChart");
const social = exportModule("social");
const D = secrets.googleDwdServiceAccountJson;
const H = secrets.privateSurveyWebhookSecret;
const N = secrets.notionToken;

function assertOptions(endpoint, kind, base, bindings, extra = {}) {
  assert.equal(endpoint.kind, kind);
  assert.deepEqual(plain(endpoint.options), plain({ ...base, ...extra, secrets: bindings }));
}

const secretlessApp = [
  "getInstructorHome", "loginStaffWithPin", "setupStaffPinWithTempCode",
  "submitBookingAttendance", "submitMemberMemo", "getMemberMemoHistory", "searchMembers",
  "lookupKioskCheckin", "submitKioskCheckin", "getKioskParkingJobStatus",
  "registerParkingVehicle", "getParkingDashboard", "removeParkingVehicle", "runParkingAutoApplyNow",
  "registerFcmToken", "getInstructorEvaluationQuiz", "adjustInstructorEvaluationEssayScore",
  "getVideoWatchDashboard", "getRecommendedMealProgramReview", "saveRecommendedMealProgramDraft",
  "adminIssueStaffTempCode", "getRefundMemberTickets", "previewRefund", "sendRefundAgreement",
  "queueRefundStudioMateSms", "getInstructorLessonRegistrationDashboard", "operatorCreateInstructorLessonRegistration",
];
for (const name of secretlessApp) {
  test(`${name} has no secret bindings and preserves callable options`, () => {
    assertOptions(app[name], "onCall", options.callableOptions, []);
  });
}

test("quiz submission and applicant HTTP export bind only delegated Google credentials", () => {
  assertOptions(app.submitInstructorEvaluationQuiz, "onCall", options.callableOptions, [D]);
  assertOptions(app.instructorApplicantEvaluationApi, "onRequest", options.publicRequestOptions, [D]);
});

test("uncertain and already scoped app bindings remain unchanged", () => {
  assert.deepEqual(plain(app.generateRecommendedMealProgramDraft.options), plain(options.recommendedMealCallableOptions));
  assertOptions(app.confirmInstructorLessonBookingAndQueueAlimtalk, "onCall", options.callableOptions,
    [...options.callableOptions.secrets, N]);
  assert.deepEqual(plain(app.processParkingDiscountJob.options.secrets), plain([
    D, otherSecrets.iparkingAccountPoolJson, otherSecrets.iparkingLoginId, otherSecrets.iparkingLoginPassword,
    otherSecrets.iparkingSubLoginId, otherSecrets.iparkingSubLoginPassword,
  ]));
  assertOptions(app.instructorLessonParkingPreRegistrationApi, "onRequest", options.publicRequestOptions, [H]);
  assertOptions(app.instructorObservationSurveyApi, "onRequest", options.publicRequestOptions, [N]);
  assertOptions(app.instructorLessonCalendarApi, "onRequest", options.publicRequestOptions, [N]);
});

for (const [name, base, bindings, schedule] of [
  ["scheduledSyncPrivateSurveyResponses", options.scheduleOptions, [D, H], "every 10 minutes"],
  ["scheduledSyncPrivateSurveyNotion", options.privateSurveyIntakeOptions, [N], "40 22 * * *"],
  ["scheduledSyncPrivateLessonNotionProjections", options.privateLessonChartScheduleOptions, [N], "20 22 * * *"],
]) {
  test(`${name} has scoped secrets without changing its schedule or resources`, () => {
    assertOptions(privateChart[name], "onSchedule", base, bindings, { schedule });
  });
}

for (const [suffix, document] of [
  ["Request", "privateLessonChartRequests/{requestId}"],
  ["Record", "privateLessonChartRecords/{recordId}"],
]) {
  test(`session ${suffix} projection has no secrets and retains its document trigger`, () => {
    assertOptions(privateChart[`syncPrivateLessonSessionFrom${suffix}`], "onDocumentWritten",
      options.privateSurveyIntakeOptions, [], { document });
  });
}

test("display-only webhook drops secrets while report view binds its HMAC dependency", () => {
  assertOptions(privateChart.notionPrivateLessonReportWebhook, "onRequest", options.privateLessonChartRequestOptions, []);
  assertOptions(privateChart.privateLessonReportView, "onRequest", options.publicRequestOptions, [H]);
});

test("other private-chart consumers retain their shared bindings", () => {
  for (const [name, base] of [
    ["ingestPrivateSurveyResponse", options.privateSurveyIngestOptions],
    ["privateLessonChartApi", options.privateLessonChartRequestOptions],
    ["scheduledProcessStaffSurveyAlimtalks", options.scheduleOptions],
    ["scheduledProcessMissingSurveySubmissionAlerts", options.scheduleOptions],
    ["scheduledCreatePrivateLessonChartRequests", options.privateSurveyIntakeOptions],
    ["scheduledSendTodayPrivateLessonChartAlimtalks", options.privateLessonChartScheduleOptions],
    ["scheduledReconcileCurrentMonthPrivateLessonCharts", options.privateLessonChartScheduleOptions],
    ["scheduledGeneratePrivateLessonChartReports", options.privateLessonChartScheduleOptions],
    ["scheduledPurgeDiscardedMemberSignupContracts", options.privateSurveyIntakeOptions],
    ["processPrivateSurveyIntake", options.privateSurveyIntakeOptions],
  ]) assert.deepEqual(plain(privateChart[name].options.secrets), plain(base.secrets), name);
});

test("only social save and hold lose Instagram bindings", () => {
  for (const name of ["saveInstagramContentDraft", "holdInstagramContent"]) {
    assertOptions(social[name], "onCall", social.getInstagramContentDashboard.options, []);
  }
  for (const name of ["getInstagramContentDashboard", "approveInstagramContent", "scheduledPublishInstagramContent", "scheduledSyncInstagramInsights"]) {
    assert.deepEqual(plain(social[name].options.secrets), plain([
      otherSecrets.instagramAccessToken, otherSecrets.instagramUserId,
    ]), name);
  }
});

// Extract real source declarations, as in private-notion-event-sync.test.ts.
function declaration(file, name) {
  const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.ES2022, true);
  const node = tree.statements.find((item) => item.name?.getText(tree) === name);
  assert.ok(node, `${file}:${name} must exist`);
  return { node, text: node.getText(tree) };
}
function assertCalls(file, name, expected) {
  const { node } = declaration(file, name);
  const calls = new Set();
  function visit(item) {
    if (ts.isCallExpression(item) || ts.isNewExpression(item)) calls.add(item.expression.getText());
    ts.forEachChild(item, visit);
  }
  visit(node);
  for (const call of expected) assert.ok(calls.has(call), `${file}:${name} must call ${call}`);
}
function declarations(file, names) {
  return names.map((name) => declaration(file, name).text).join("\n");
}
const quizFile = "staffEvaluation/instructorEvaluationQuiz";
const chartFile = "privateLessonChart/privateLessonChart";
const googleFile = "google/delegatedGoogleClient";

test("source contract proves applicant HTTP -> submit -> Sheets -> DWD secret", () => {
  assertCalls(quizFile, "instructorApplicantEvaluationApiHandler", ["submitApplicantEvaluation"]);
  assertCalls(quizFile, "submitApplicantEvaluation", ["syncEvaluationSubmissionToGoogleSheet"]);
  assertCalls(quizFile, "submitInstructorEvaluationQuizHandler", ["syncEvaluationSubmissionToGoogleSheet"]);
  assertCalls(quizFile, "syncEvaluationSubmissionToGoogleSheet", ["DelegatedGoogleClient", "appendSheetValues"]);
  assertCalls(quizFile, "appendSheetValues", ["client.request"]);
  assertCalls(googleFile, "DelegatedGoogleClient", ["this.getAccessToken", "googleDwdServiceAccountJson.value"]);
});

function response() {
  return {
    statusCode: 200, body: null,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

for (const bound of [true, false]) {
  test(`applicant submit reaches real delegated client with ${bound ? "bound" : "missing"} synthetic DWD`, async () => {
    const writes = [];
    const requests = [];
    let secretReads = 0;
    const hash = (text) => createHash("sha256").update(text).digest("hex");
    const now = { toMillis: () => 100_000 };
    function ref(path) {
      return {
        get: async () => ({ data: () => path.startsWith("staffApplicantEvaluationSessions/")
          ? { accessTokenHash: hash("test-session-token"), startedAt: now, applicantId: "test-applicant", applicantName: "Test", applicantPhone: "01000000000" }
          : {} }),
        set: async (value) => { writes.push(value); },
        collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
      };
    }
    const signer = { update() { return this; }, sign(key) { assert.equal(key, "synthetic-key"); return "synthetic-signature"; } };
    const code = declarations(googleFile, ["DelegatedGoogleClient", "base64url"]) + "\n" + declarations(quizFile, [
      "instructorApplicantEvaluationApiHandler", "submitApplicantEvaluation", "syncEvaluationSubmissionToGoogleSheet",
      "appendSheetValues", "markGoogleSheetSync",
    ]);
    const runtime = evaluate(code, {
      Buffer, URLSearchParams, createSign: () => signer, DELEGATED_USER: "test@example.invalid",
      googleDwdServiceAccountJson: { value: () => {
        secretReads++;
        if (!bound || !app.instructorApplicantEvaluationApi.options.secrets.some((item) => item.name === D.name)) {
          throw new Error("Missing synthetic DWD binding");
        }
        return JSON.stringify({ client_email: "test@example.invalid", private_key: "synthetic-key" });
      } },
      fetch: async (url, init) => {
        requests.push({ url, init });
        if (url === "https://oauth2.googleapis.com/token") return { ok: true, json: async () => ({ access_token: "synthetic-token" }) };
        assert.ok(url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/test-sheet/values/"));
        return { ok: true, text: async () => JSON.stringify({ updates: { updatedRange: "A1" } }) };
      },
      db: {
        collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
        runTransaction: async (fn) => fn({ set: (_ref, data) => writes.push(data) }),
      },
      AppError: Error, setCors: () => {}, cleanId: String, cleanAnswer: String, sha256: hash,
      cleanDisplayName: String, cleanPhone: String, stableHash: () => "a".repeat(64), nowTimestamp: () => now,
      normalizeAnswers: () => ({}), gradeAnswers: () => ({ passed: true, manualReviewQuestionIds: [], scorePercent: 100 }),
      DEFAULT_STUDIO_ID: "test-studio", QUIZ: { quizId: "test-quiz", version: 1, title: "Test", passScore: 80 },
      APPLICANT_TIME_LIMIT_SECONDS: 1200, APPLICANT_LATE_GRACE_SECONDS: 300,
      SHEETS_SCOPE: "test-scope", STAFF_EVALUATION_SPREADSHEET_ID: "test-sheet",
      STAFF_EVALUATION_RAW_SHEET_NAME: "raw", STAFF_EVALUATION_SUMMARY_SHEET_NAME: "summary",
      googleFormRawRow: () => ["raw"], googleFormSummaryRow: () => ["summary"],
    });
    const res = response();
    await runtime.instructorApplicantEvaluationApiHandler({ method: "POST", body: {
      action: "submit", sessionId: "test-session", sessionToken: "test-session-token", answers: {},
    } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(secretReads, 1);
    assert.equal(requests.length, bound ? 3 : 0);
    const syncWrites = writes.filter((item) => item.googleSheetSync);
    assert.equal(syncWrites.length, 3);
    assert.ok(syncWrites.every((item) => item.googleSheetSync.status === (bound ? "synced" : "failed")));
  });
}

test("report-view source contract retains the HMAC fallback", () => {
  assertCalls(chartFile, "privateLessonReportViewHandler", ["sha256"]);
  assertCalls(chartFile, "sha256", ["createHmac", "privateSurveyWebhookSecret.value"]);
});

test("report view accepts stored and HMAC tokens, rejects wrong tokens, and proves missing H failure", async () => {
  const rawToken = "synthetic-report-token";
  const signingKey = "synthetic-signing-key";
  const storedToken = createHmac("sha256", signingKey).update(rawToken).digest("hex");
  let secretReads = 0;
  let bound = true;
  const runtime = evaluate(declarations(chartFile, ["privateLessonReportViewHandler", "sha256"]), {
    createHmac,
    privateSurveyWebhookSecret: { value: () => {
      secretReads++;
      if (!bound || !privateChart.privateLessonReportView.options.secrets.some((item) => item.name === H.name)) {
        throw new Error("Missing synthetic HMAC binding");
      }
      return signingKey;
    } },
    refs: {
      privateLessonChartRecord: () => ({ get: async () => ({ data: () => ({ requestId: "test-request" }) }) }),
      privateLessonChartRequest: () => ({ get: async () => ({ data: () => ({ accessTokenHash: storedToken }) }) }),
    },
    isPrivateLessonReportGenerated: () => true,
    ensureLegacySentReportSnapshot: async (record) => record,
    privateLessonReportSnapshotForView: () => null,
    renderPrivateLessonReportPage: () => "synthetic-report",
    renderPrivateLessonReportMessagePage: (message) => message,
  });
  for (const [token, expected] of [[storedToken, 200], [rawToken, 200], ["wrong-token", 403]]) {
    const res = response();
    await runtime.privateLessonReportViewHandler({ query: { recordId: "test-record", token } }, res);
    assert.equal(res.statusCode, expected);
  }
  assert.equal(secretReads, 2, "stored-token equality must short-circuit the secret read");
  bound = false;
  await assert.rejects(runtime.privateLessonReportViewHandler({ query: { recordId: "test-record", token: rawToken } }, response()),
    /Missing synthetic HMAC binding/);
});
