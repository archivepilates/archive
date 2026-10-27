import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { codebasesForFile, detectAffectedFromCli } from "../lib/affected-functions.mjs";

const sourceRoot = "firebase/kangsain-functions/functions/src/";
const policy = `${sourceRoot}memberSignup/membershipContractPolicy.ts`;
const readback = `${sourceRoot}memberSignup/membershipWelcomeReadback.ts`;
const policyConsumers = ["functions-alimtalk", "functions-app", "functions-private-chart", "functions-sync"];
const readbackConsumers = ["functions-alimtalk"];
const helpers = [[policy, policyConsumers], [readback, readbackConsumers]];

function select(files) {
  return detectAffectedFromCli([
    "--base", "synthetic-base", "--head", "synthetic-head", "--files", files.join(","),
  ]);
}

for (const [helper, expected] of helpers) {
  test(`exact ${helper} maps only its consumers, including Windows paths`, () => {
    assert.deepEqual(codebasesForFile(helper), expected);
    assert.deepEqual(codebasesForFile(helper.replaceAll("/", "\\")), expected);
  });

  test(`explicit ${helper} selection uses its precise filter without Git discovery`, () => {
    for (const file of [helper, helper.replaceAll("/", "\\")]) {
      const result = select([file]);
      assert.equal(result.base, "synthetic-base");
      assert.equal(result.head, "synthetic-head");
      assert.deepEqual(result.changedFiles, [file]);
      assert.deepEqual(result.codebases, expected);
      assert.deepEqual(result.reasons, [{ file, codebases: expected }]);
      assert.equal(result.deployOnly, expected.map((name) => `functions:${name}`).join(","));
      assert.equal(result.allCodebasesAffected, false);
    }
  });
}

test("outdoor membership exceptions match the actual five-codebase exported dependency graphs", async () => {
  const root = new URL("../../", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("firebase/codebase-boundaries.json", root), "utf8"));
  assert.deepEqual(Object.keys(manifest.targetCodebases).sort(), [...policyConsumers, "functions-social"].sort());
  const consumers = new Map(helpers.map(([helper]) => [helper, []]));
  for (const [codebase, config] of Object.entries(manifest.targetCodebases)) {
    const compiled = await build({
      absWorkingDir: fileURLToPath(root), entryPoints: [config.sourceEntrypoint],
      bundle: true, write: false, platform: "node", packages: "external", metafile: true, logLevel: "silent",
    });
    for (const [helper] of helpers) {
      if (Object.hasOwn(compiled.metafile.inputs, helper)) consumers.get(helper).push(codebase);
    }
  }
  for (const [helper, expected] of helpers) {
    assert.deepEqual(consumers.get(helper).sort(), expected, helper);
    assert.deepEqual(codebasesForFile(helper), consumers.get(helper), helper);
  }
});

test("outdoor membership exceptions leave nearby and lookalike paths unchanged", () => {
  const cases = [
    [`${sourceRoot}memberSignup/memberSignupContract.ts`, ["functions-private-chart"]],
    [`${sourceRoot}memberSignup/onsiteWelcomeRequest.ts`, ["functions-private-chart"]],
    [`${sourceRoot}memberSignup/membershipWelcomeQueue.ts`, ["functions-private-chart"]],
    [`${sourceRoot}memberSignup/membershipWelcomeHistory.ts`, ["functions-alimtalk"]],
    [`${sourceRoot}alimtalk/processAlimtalkQueue.ts`, ["functions-alimtalk"]],
    ["scripts/tests/affected-functions-outdoor-membership.test.mjs", []],
  ];
  for (const [helper] of helpers) {
    const name = helper.slice(helper.lastIndexOf("/") + 1);
    cases.push(
      [helper.replace(".ts", "Extra.ts"), ["functions-private-chart"]],
      [`${helper}.bak`, ["functions-private-chart"]],
      [helper.replace(".ts", ".test.ts"), ["functions-private-chart"]],
      [`other/memberSignup/${name}`, ["functions-private-chart"]],
      [`${sourceRoot}memberSignup/nested/${name}`, ["functions-private-chart"]],
      [`docs/memberSignup/${name}`, []],
      [`artifacts/memberSignup/${name}`, []],
    );
  }
  for (const [file, expected] of cases) {
    assert.deepEqual(codebasesForFile(file), expected, file);
    assert.deepEqual(codebasesForFile(file.replaceAll("/", "\\")), expected, file);
  }
});

test("combined membership selections dedupe consumers without widening to social or test files", () => {
  const files = [
    policy, readback.replaceAll("/", "\\"), policy,
    `${sourceRoot}alimtalk/processAlimtalkQueue.ts`,
    `${sourceRoot}memberSignup/memberSignupContract.ts`,
    `${sourceRoot}privateSurvey/groupSurveyBookingPolicy.ts`,
    "scripts/tests/affected-functions-outdoor-membership.test.mjs",
    "scripts/tests/affected-functions-outdoor-survey.test.mjs",
  ];
  const result = select(files);
  assert.deepEqual(result.changedFiles, files);
  assert.deepEqual(result.codebases, policyConsumers);
  assert.equal(result.deployOnly, policyConsumers.map((name) => `functions:${name}`).join(","));
  assert.equal(result.allCodebasesAffected, false);
  assert.deepEqual(result.reasons, files.map((file) => ({ file, codebases: codebasesForFile(file) })));
  assert.deepEqual(result.reasons.slice(-2).map(({ codebases }) => codebases), [[], []]);
});

test("readback combines with the existing private-chart default without other codebases", () => {
  const result = select([readback, `${sourceRoot}memberSignup/memberSignupContract.ts`]);
  const expected = ["functions-alimtalk", "functions-private-chart"];
  assert.deepEqual(result.codebases, expected);
  assert.equal(result.deployOnly, expected.map((name) => `functions:${name}`).join(","));
  assert.equal(result.allCodebasesAffected, false);
});
