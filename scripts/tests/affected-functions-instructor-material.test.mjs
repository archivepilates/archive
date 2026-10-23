import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { codebasesForFile, detectAffectedFromCli } from "../lib/affected-functions.mjs";

const sourceRoot = "firebase/kangsain-functions/functions/src/";
const sharedModules = [
  `${sourceRoot}alimtalk/instructorLessonManagement.ts`,
  `${sourceRoot}alimtalk/rebuildAlimtalkCandidates.ts`,
];
const sampleApproval = `${sourceRoot}alimtalk/instructorLessonSampleApproval.ts`;

for (const file of sharedModules) {
  test(`${file} affects only Alimtalk and sync`, () => {
    assert.deepEqual(codebasesForFile(file), ["functions-alimtalk", "functions-sync"]);
    assert.deepEqual(codebasesForFile(file.replaceAll("/", "\\")), ["functions-alimtalk", "functions-sync"]);
  });
}

test("instructor material classifications match the exported dependency graph", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../firebase/codebase-boundaries.json", import.meta.url), "utf8"));
  const consumers = new Map([...sharedModules, sampleApproval].map((file) => [file, []]));
  for (const [codebase, config] of Object.entries(manifest.targetCodebases)) {
    const compiled = await build({
      absWorkingDir: fileURLToPath(new URL("../../", import.meta.url)),
      entryPoints: [config.sourceEntrypoint],
      bundle: true,
      write: false,
      platform: "node",
      packages: "external",
      metafile: true,
      logLevel: "silent",
    });
    for (const [file, codebases] of consumers) {
      if (Object.hasOwn(compiled.metafile.inputs, file)) codebases.push(codebase);
    }
  }
  for (const file of sharedModules) {
    assert.deepEqual(consumers.get(file), ["functions-alimtalk", "functions-sync"]);
    assert.deepEqual(codebasesForFile(file), consumers.get(file));
  }
  assert.deepEqual(consumers.get(sampleApproval), ["functions-alimtalk"]);
  assert.deepEqual(codebasesForFile(sampleApproval), consumers.get(sampleApproval));
});

test("neighboring paths and shared detector policy retain their classifications", () => {
  const cases = [
    [sampleApproval, ["functions-alimtalk"]],
    [`${sourceRoot}alimtalk/queueDailyAlimtalk.ts`, ["functions-alimtalk"]],
    [`${sourceRoot}alimtalk/processAlimtalkQueue.ts`, ["functions-alimtalk"]],
    [`${sourceRoot}alimtalk/instructorLessonManagement.test.ts`, ["functions-alimtalk"]],
    [`${sourceRoot}alimtalk/rebuildAlimtalkCandidatesExtra.ts`, ["functions-alimtalk"]],
    ["other/alimtalk/instructorLessonManagement.ts", ["functions-alimtalk"]],
    ["other/alimtalk/rebuildAlimtalkCandidates.ts", ["functions-alimtalk"]],
    [`${sourceRoot}sync/syncLecturesRange.ts`, ["functions-sync"]],
    [`${sourceRoot}instructorLessonRegistration/instructorLessonConfirmation.ts`, ["functions-alimtalk", "functions-app"]],
    ["docs/instructorLessonManagement.ts", []],
    ["scripts/tests/affected-functions-instructor-material.test.mjs", []],
    ["scripts/lib/affected-functions.mjs", [
      "functions-alimtalk", "functions-app", "functions-private-chart", "functions-social", "functions-sync",
    ]],
  ];
  for (const [file, expected] of cases) assert.deepEqual(codebasesForFile(file), expected, file);
});

test("explicit material file selection returns the two-codebase filter without Git discovery", () => {
  const result = detectAffectedFromCli([
    "--base", "explicit-base",
    "--head", "explicit-head",
    "--files", [...sharedModules, sampleApproval].join(","),
  ]);
  assert.deepEqual(result.codebases, ["functions-alimtalk", "functions-sync"]);
  assert.equal(result.deployOnly, "functions:functions-alimtalk,functions:functions-sync");
  assert.equal(result.allCodebasesAffected, false);
});
