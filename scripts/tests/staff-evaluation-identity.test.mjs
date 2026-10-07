import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const appSource = fs.readFileSync(new URL("../../core/assets/app.js", import.meta.url), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in core/assets/app.js`);
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function evaluateRows(state) {
  const context = vm.createContext({
    state,
    normalizePhone: (value) => String(value || "").replace(/\D/g, ""),
    timestampMs: (value) => Number(value || 0),
    toNumber: (value) => Number(value || 0),
  });
  vm.runInContext(
    [
      "staffEvaluationIdentityPhone",
      "promotedStaffEvaluationKey",
      "staffEmploymentState",
      "staffEvaluationRows",
    ]
      .map(extractFunction)
      .join("\n"),
    context,
  );
  return vm.runInContext("staffEvaluationRows()", context);
}

test("promotes an applicant quiz into the unique current staff card by exact phone", () => {
  const rows = evaluateRows({
    staffItems: [
      {
        staffId: "current_1",
        name: "정유리",
        role: "instructor",
        active: true,
        phone: "010-1234-5678",
      },
    ],
    staffHrCards: [
      {
        id: "applicant_1",
        staffId: "applicant_1",
        staffName: "정유리",
        staffRole: "applicant",
        applicantEvaluation: true,
        applicantPhone: "01012345678",
        latestQuiz: { submissionId: "submission_1", scorePercent: 76, submittedAt: 2, status: "passed" },
        quizSummary: { attempts: 1, bestScorePercent: 76 },
      },
    ],
    staffEvaluationSubmissions: [
      {
        submissionId: "submission_1",
        staffId: "applicant_1",
        staffName: "정유리",
        staffRole: "applicant",
        applicantEvaluation: true,
        applicantPhone: "01012345678",
        scorePercent: 76,
        submittedAt: 2,
        status: "passed",
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].staffId, "current_1");
  assert.equal(rows[0].employmentState, "current");
  assert.equal(rows[0].latestScore, 76);
  assert.equal(rows[0].attempts, 1);
});

test("does not promote when the phone belongs to more than one current staff record", () => {
  const rows = evaluateRows({
    staffItems: [
      { staffId: "current_1", name: "강사1", role: "instructor", active: true, phone: "01012345678" },
      { staffId: "current_2", name: "강사2", role: "instructor", active: true, phone: "01012345678" },
    ],
    staffHrCards: [
      {
        id: "applicant_1",
        staffId: "applicant_1",
        staffName: "지원자",
        staffRole: "applicant",
        applicantEvaluation: true,
        applicantPhone: "01012345678",
        latestQuiz: { submissionId: "submission_1", scorePercent: 70, submittedAt: 1 },
      },
    ],
    staffEvaluationSubmissions: [],
  });

  assert.equal(rows.length, 3);
  assert.equal(rows.filter((row) => row.employmentState === "current").length, 2);
  assert.equal(rows.filter((row) => row.employmentState === "applicant").length, 1);
});

test("employment status takes precedence without changing auth-coupled staff fields", () => {
  const state = {
    staffItems: [
      { staffId: "inactive", role: "instructor", active: true, uid: "existing-login", employmentStatus: "inactive" },
      {
        staffId: "current", role: "instructor", active: false, uid: "disabled-login", employmentStatus: "current",
        employmentSource: "studiomate_staff_tab_browser_scan", employmentSyncedAt: 1234,
      },
    ],
  };
  const original = structuredClone(state);
  const rows = evaluateRows(state);
  assert.equal(rows[0].employmentState, "inactive");
  assert.equal(rows[0].staffActive, true);
  assert.equal(rows[1].employmentState, "current");
  assert.equal(rows[1].staffActive, false);
  assert.equal(rows[1].employmentSyncSource, "studiomate_staff_tab_browser_scan");
  assert.equal(rows[1].employmentSyncedAt, 1234);
  assert.deepEqual(state, original);
});

test("legacy employment requires literal active true, including with unrecognized status", () => {
  for (const employmentStatus of [undefined, null, "unknown", "CURRENT"]) {
    for (const active of [true, false, undefined, null, 0, 1, "false", "true"]) {
      const [row] = evaluateRows({ staffItems: [{ staffId: "legacy", role: "instructor", active, employmentStatus }] });
      assert.equal(row.employmentState, active === true ? "current" : "inactive", JSON.stringify({ active, employmentStatus }));
    }
  }
});

test("employment status preserves teaching-role and applicant classification", () => {
  const rows = evaluateRows({
    staffItems: [
      { staffId: "owner", role: "owner", employmentStatus: "current" },
      { staffId: "manager", role: "manager", employmentStatus: "current" },
      { staffId: "viewer", role: "viewer", employmentStatus: "current" },
      { staffId: "applicant", role: "applicant", employmentStatus: "current" },
      { staffId: "flagged", role: "instructor", applicantEvaluation: true, employmentStatus: "current" },
    ],
  });
  assert.deepEqual(Array.from(rows, (row) => row.employmentState), ["current", "operator", "operator", "applicant", "applicant"]);
});

function applicantRecords() {
  return {
    staffHrCards: [{
      staffId: "applicant", staffName: "Applicant", staffRole: "applicant", applicantEvaluation: true,
      applicantPhone: "01012345678", latestQuiz: { submissionId: "quiz", scorePercent: 80, submittedAt: 2 },
    }],
    staffEvaluationSubmissions: [{
      staffId: "applicant", staffName: "Applicant", staffRole: "applicant", applicantEvaluation: true,
      applicantPhone: "01012345678", submissionId: "quiz", scorePercent: 80, submittedAt: 2,
    }],
  };
}

test("inactive duplicate phone does not block promotion to the unique current staff", () => {
  const rows = evaluateRows({
    staffItems: [
      { staffId: "old", role: "instructor", active: true, employmentStatus: "inactive", phone: "01012345678" },
      { staffId: "current", role: "instructor", active: false, employmentStatus: "current", phone: "01012345678" },
    ],
    ...applicantRecords(),
  });
  assert.equal(rows.length, 2);
  const current = rows.find((row) => row.staffId === "current");
  const inactive = rows.find((row) => row.staffId === "old");
  assert.equal(current.employmentState, "current");
  assert.equal(current.latestScore, 80);
  assert.equal(current.attempts, 1);
  assert.equal(inactive.employmentState, "inactive");
  assert.equal(inactive.latestScore, null);
});

test("inactive-only phone does not absorb applicant history", () => {
  const rows = evaluateRows({
    staffItems: [{ staffId: "old", role: "instructor", active: true, employmentStatus: "inactive", phone: "01012345678" }],
    ...applicantRecords(),
  });
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.staffId === "old").employmentState, "inactive");
  assert.equal(rows.find((row) => row.staffId === "old").latestScore, null);
  assert.equal(rows.find((row) => row.staffId === "applicant").employmentState, "applicant");
  assert.equal(rows.find((row) => row.staffId === "applicant").latestScore, 80);
});

test("record-only history stays nonworking and same-name different-phone applicants stay separate", () => {
  const records = applicantRecords();
  records.staffHrCards.push({ staffId: "history", staffName: "Former", staffRole: "instructor" });
  const rows = evaluateRows({
    staffItems: [{ staffId: "current", name: "Applicant", role: "instructor", employmentStatus: "current", phone: "01099990000" }],
    ...records,
  });
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.staffId === "current").latestScore, null);
  assert.equal(rows.find((row) => row.staffId === "applicant").employmentState, "applicant");
  assert.equal(rows.find((row) => row.staffId === "history").employmentState, "inactive");
});

test("employment freshness distinguishes scanned, legacy, and history records", () => {
  const context = vm.createContext({ formatDate: (value) => "formatted-" + value });
  vm.runInContext(extractFunction("staffEmploymentBasis"), context);
  const basis = (row) => {
    context.row = row;
    return vm.runInContext("staffEmploymentBasis(row)", context);
  };
  assert.equal(basis({ employmentSource: "hrCard" }), "기록 보존 기준");
  assert.equal(basis({ employmentSource: "staffs", active: true }), "기존 active 기준 · 근무 명단 동기화 대기");
  const scanned = { employmentSource: "staffs", employmentStatus: "inactive", employmentSyncSource: "studiomate_staff_tab_browser_scan" };
  assert.equal(basis(scanned), "StudioMate 근무 명단 · 확인 시각 없음");
  assert.equal(basis({ ...scanned, employmentSyncedAt: 1234 }), "StudioMate 근무 명단 · 확인 formatted-1234");
  assert.equal(basis({ ...scanned, employmentSyncSource: "other" }), "근무 상태 기록 · 확인 시각 없음");
});
