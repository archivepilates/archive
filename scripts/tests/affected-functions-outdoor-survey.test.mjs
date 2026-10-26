import assert from "node:assert/strict";
import test from "node:test";
import { codebasesForFile, detectAffectedFromCli } from "../lib/affected-functions.mjs";

const sourceRoot = "firebase/kangsain-functions/functions/src/";
const helper = `${sourceRoot}privateSurvey/groupSurveyBookingPolicy.ts`;
const expected = ["functions-alimtalk", "functions-private-chart", "functions-sync"];

test("exact outdoor group policy path affects its three consumers, including Windows paths", () => {
  assert.deepEqual(codebasesForFile(helper), expected);
  assert.deepEqual(codebasesForFile(helper.replaceAll("/", "\\")), expected);
});

test("outdoor policy exception does not widen neighboring or lookalike paths", () => {
  const cases = [
    [`${sourceRoot}privateSurvey/privateSurveyResponse.ts`, ["functions-private-chart"]],
    [`${sourceRoot}privateSurvey/groupSurveyBookingPolicyExtra.ts`, ["functions-private-chart"]],
    ["other/privateSurvey/groupSurveyBookingPolicy.ts", ["functions-private-chart"]],
    [`${sourceRoot}alimtalk/recipientExclusion.ts`, ["functions-alimtalk"]],
    [`${sourceRoot}alimtalk/rebuildAlimtalkCandidates.ts`, ["functions-alimtalk", "functions-sync"]],
    ["docs/privateSurvey/groupSurveyBookingPolicy.ts", []],
    ["scripts/tests/outdoor-group-survey.test.mjs", []],
    ["scripts/tests/affected-functions-outdoor-survey.test.mjs", []],
  ];
  for (const [file, codebases] of cases) assert.deepEqual(codebasesForFile(file), codebases, file);
});

test("explicit helper selection uses only the three-codebase filter without Git discovery", () => {
  const result = detectAffectedFromCli(["--base", "synthetic-base", "--head", "synthetic-head", "--files", helper]);
  assert.deepEqual(result.changedFiles, [helper]);
  assert.deepEqual(result.codebases, expected);
  assert.equal(result.deployOnly, expected.map((name) => `functions:${name}`).join(","));
  assert.equal(result.allCodebasesAffected, false);
});

test("combined source changes dedupe the same three consumers and exclude test files", () => {
  const result = detectAffectedFromCli(["--base", "synthetic-base", "--head", "synthetic-head", "--files", [
    helper, `${sourceRoot}alimtalk/recipientExclusion.ts`, `${sourceRoot}alimtalk/rebuildAlimtalkCandidates.ts`,
    `${sourceRoot}privateSurvey/privateSurveyResponse.ts`, "scripts/tests/outdoor-group-survey.test.mjs",
  ].join(",")]);
  assert.deepEqual(result.codebases, expected);
  assert.equal(result.allCodebasesAffected, false);
});
