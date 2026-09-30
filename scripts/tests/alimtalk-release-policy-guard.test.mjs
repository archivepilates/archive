import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const guardUrl = new URL("../validate-live-release-rollback-guards.mjs", import.meta.url);
const source = fs.readFileSync(guardUrl, "utf8")
  .replace(/^import .*;\n/gm, "")
  .replaceAll("import.meta.url", JSON.stringify(guardUrl.href));
const backend = "firebase/kangsain-functions/functions/src/";

// Virtual source mutations exercise the real validator without changing files,
// starting nested test processes, or touching production services.
function validate(overrides = {}, result = { status: 0 }) {
  const calls = [];
  const errors = [];
  const logs = [];
  let exitCode = 0;
  const exit = {};
  const context = {
    fs: {
      existsSync(file) {
        const relative = path.relative(repoRoot, file);
        return relative in overrides ? overrides[relative] !== null : fs.existsSync(file);
      },
      readFileSync(file, encoding) {
        const relative = path.relative(repoRoot, file);
        return relative in overrides ? overrides[relative] : fs.readFileSync(file, encoding);
      },
    },
    path,
    fileURLToPath,
    spawnSync(command, args, options) {
      calls.push({ command, args: Array.from(args), options });
      return result;
    },
    process: {
      execPath: process.execPath,
      env: { PATH: process.env.PATH, GOOGLE_APPLICATION_CREDENTIALS: "forbidden", NODE_OPTIONS: "forbidden" },
      exit(code) { exitCode = code; throw exit; },
    },
    console: { log: (value) => logs.push(value), error: (value) => errors.push(value) },
  };
  try { vm.runInNewContext(source, context, { timeout: 5000 }); }
  catch (error) { if (error !== exit) throw error; }
  return { calls, errors: errors.join("\n"), logs, exitCode };
}

function mutate(file, before, after) {
  const original = fs.readFileSync(path.join(repoRoot, file), "utf8");
  assert.ok(original.includes(before), `Mutation anchor missing: ${file}: ${before}`);
  return { [file]: original.replace(before, after) };
}

test("current policy passes markers and mandates offline semantic suites without inherited credentials", () => {
  const result = validate();
  assert.equal(result.exitCode, 0, result.errors);
  assert.equal(result.calls.length, 1);
  const call = result.calls[0];
  assert.equal(call.command, process.execPath);
  assert.deepEqual(call.args, [
    "--import", "./firebase/kangsain-functions/functions/node_modules/tsx/dist/loader.mjs",
    "--test",
    "scripts/tests/alimtalk-member-exclusion-release.test.ts",
    "scripts/tests/alimtalk-ticket-facts.test.ts",
    "scripts/tests/renewal-policy.test.ts",
    "scripts/tests/renewal-core-visibility.test.mjs",
    "scripts/tests/alimtalk-release-policy-guard.test.mjs",
  ]);
  assert.equal(call.options.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:1");
  assert.equal(call.options.env.GCLOUD_PROJECT, "demo-alimtalk-policy");
  assert.equal(call.options.env.TSX_DISABLE_CACHE, "1");
  assert.equal(call.options.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(call.options.env.NODE_OPTIONS, undefined);
  assert.equal(call.options.timeout, 60_000);
});

test("restoring blanket alternate-ticket exclusion in the send guard fails", () => {
  const file = `${backend}alimtalk/renewalSendGuard.ts`;
  for (const marker of ["hasSameKindAlternativeTicket", "hasSameKindActiveBackup", "hasOtherActiveTicket", "동일 유형 후속 수강권 보유"]) {
    const result = validate({ [file]: `${fs.readFileSync(path.join(repoRoot, file), "utf8")}\n// ${marker}` });
    assert.equal(result.exitCode, 1, marker);
    assert.ok(result.errors.includes(marker));
  }
});

test("removing fact-only policy or its live contract connection fails", () => {
  for (const [file, before, after] of [
    [`${backend}alimtalk/ticketNoticePolicy.ts`, "followupPurchaseExcludes: false", "followupPurchaseExcludes: true"],
    [`${backend}alimtalk/ticketNoticePolicy.ts`, "ticketFactContractFingerprint(state) !== expected", "false"],
    [`${backend}alimtalk/eligibility.ts`, "ticketFactTemplateIssue(candidate, readiness.state)", '""'],
  ]) {
    const result = validate(mutate(file, before, after));
    assert.equal(result.exitCode, 1, before);
    assert.ok(result.errors.includes(before));
  }
});

test("renewal management must retain both the backup filter and canonical alternative-ticket helper", () => {
  const file = `${backend}alimtalk/rebuildAlimtalkCandidates.ts`;
  for (const marker of [
    "!hasSameKindActiveBackup(currentOrUpcomingTickets, item.ticket, sourceDate)",
    "return hasSameKindAlternativeTicket(tickets, target, sourceDate);",
  ]) {
    const result = validate(mutate(file, marker, marker.startsWith("return") ? "return false;" : "true"));
    assert.equal(result.exitCode, 1, marker);
    assert.ok(result.errors.includes(marker));
  }
});

test("semantic failures, missing test runner and timeouts fail closed even when markers pass", () => {
  for (const failure of [
    { status: 1, stdout: "fact/CORE semantic regression" },
    { status: null, error: new Error("test runner missing") },
    { status: null, signal: "SIGTERM", error: new Error("test timeout") },
  ]) {
    const result = validate({}, failure);
    assert.equal(result.exitCode, 1);
    assert.match(result.errors, /Mandatory offline ticket-fact and renewal-management regression tests failed/);
  }
});

test("unrelated rollback groups still block release", () => {
  const result = validate({ "core/rules/index.html": null });
  assert.equal(result.exitCode, 1);
  assert.match(result.errors, /core-operating-rules/);
});
