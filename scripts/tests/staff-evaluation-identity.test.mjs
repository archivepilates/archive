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
