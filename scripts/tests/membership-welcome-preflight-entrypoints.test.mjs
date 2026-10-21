import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { planWelcomeStateReconciliation } from "../lib/membership-welcome-state-reconciliation.mjs";

const functionsRoot = new URL("../../firebase/kangsain-functions/functions/", import.meta.url);
const require = createRequire(new URL("package.json", functionsRoot));
const ts = require("typescript");
const parse = (path) => {
  const url = new URL(path, functionsRoot);
  const tree = ts.createSourceFile(url.pathname, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true);
  assert.equal(tree.parseDiagnostics.length, 0, `invalid source: ${path}`);
  return tree;
};
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

// Extract declarations only: importing these modules would initialize Firebase.
const queue = parse("src/memberSignup/membershipWelcomeQueue.ts");
const errorClass = queue.statements.find((node) =>
  ts.isClassDeclaration(node) && node.name?.text === "MembershipWelcomePreflightError");
assert.ok(errorClass, "the real preflight error class must exist");
const errorExports = {};
runInNewContext(compile(errorClass.getText(queue)), { exports: errorExports });
const { MembershipWelcomePreflightError } = errorExports;
const processor = parse("src/alimtalk/processAlimtalkQueue.ts");

function extractFirstIf(name) {
  const fn = processor.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn?.body, `${name} must exist`);
  const catches = [];
  const visit = (node) => {
    if (node !== fn && ts.isFunctionLike(node)) return;
    if (ts.isCatchClause(node)) {
      const first = node.block.statements[0];
      if (first && ts.isIfStatement(first) && ts.isBinaryExpression(first.expression) &&
        first.expression.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
        ts.isIdentifier(first.expression.right) && first.expression.right.text === "MembershipWelcomePreflightError") {
        assert.ok(node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name));
        assert.equal(first.expression.left.getText(processor), node.variableDeclaration.name.text);
        catches.push({ binding: node.variableDeclaration.name.text, branch: first.getText(processor) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  assert.equal(catches.length, 1, `${name} must have exactly one catch beginning with the typed guard`);
  return catches[0];
}

const entrypoints = [
  { name: "processAlimtalkQueue", bulk: true },
  { name: "processAlimtalkCandidate", bulk: false },
].map((entry) => {
  const { binding, branch } = extractFirstIf(entry.name);
  // The marker represents generic fallback, not the production fallback's writes.
  // A real loop preserves the bulk branch's continue and exposes any fallthrough.
  const body = entry.bulk
    ? `let deferred = 0, failed = 0;
       for (const claimed of candidates) {
         try { throw inputError; } catch (${binding}) {
           ${branch}
           fallback(${binding}, claimed);
         }
       }
       return { deferred, failed };`
    : `const claimed = candidates[0];
       try { throw inputError; } catch (${binding}) {
         ${branch}
         return fallback(${binding}, claimed);
       }`;
  return { ...entry, code: compile(`(async function(inputError, candidates) { "use strict"; ${body} })`) };
});

function harness(entry, helperOutcome, patches = [{}]) {
  const candidates = patches.map((patch, index) => Object.freeze({
    candidateId: `synthetic-welcome-${index}`,
    status: "processing",
    attempts: 0,
    maxAttempts: 1,
    payload: Object.freeze({ sourceContractId: "a".repeat(64) }),
    ...patch,
  }));
  const before = structuredClone(candidates);
  const calls = { helper: [], settled: 0, fallback: [], errors: [] };
  const db = new Proxy({}, { get() { assert.fail("entrypoint must not access Firebase directly"); } });
  const nowTimestamp = () => assert.fail("only the deferral helper may create timestamps");
  const execute = runInNewContext(entry.code, {
    MembershipWelcomePreflightError,
    db,
    nowTimestamp,
    deferMembershipWelcomePreflight: async (deps, claimed, error) => {
      assert.equal(deps.db, db);
      assert.equal(deps.timestamp, nowTimestamp);
      assert.ok(candidates.includes(claimed));
      calls.helper.push({ claimed, error });
      await Promise.resolve();
      calls.settled += 1;
      if (helperOutcome instanceof Error) throw helperOutcome;
      return helperOutcome;
    },
    logger: { error: (...args) => calls.errors.push(structuredClone(args)) },
    fallback: (error, claimed) => {
      calls.fallback.push({ error, claimed });
      return { route: "generic_fallback" };
    },
  });
  return {
    candidates,
    calls,
    run: (error) => execute(error, candidates),
    unchanged: () => assert.deepEqual(candidates, before, "candidate attempt/state must remain untouched"),
  };
}

for (const entry of entrypoints) {
  test(`${entry.name}: helper true records deferral without generic fallback`, async () => {
    const h = harness(entry, true);
    const error = new MembershipWelcomePreflightError("history_time_limit");
    const result = structuredClone(await h.run(error));
    assert.deepEqual(result, entry.bulk
      ? { deferred: 1, failed: 0 }
      : { processed: true, status: "deferred", lastError: error.message });
    assert.equal(h.calls.helper.length, 1);
    assert.equal(h.calls.helper[0].error, error);
    assert.equal(h.calls.settled, 1, "the async helper must be awaited");
    assert.deepEqual(h.calls.fallback, []);
    assert.deepEqual(h.calls.errors, []);
    h.unchanged();
  });

  test(`${entry.name}: helper false reports conflict without attempt fallback`, async () => {
    const h = harness(entry, false);
    const error = new MembershipWelcomePreflightError("membership_candidate_source_mismatch");
    const result = structuredClone(await h.run(error));
    assert.deepEqual(result, entry.bulk
      ? { deferred: 0, failed: 1 }
      : { processed: true, status: "failed", lastError: "membership_welcome_preflight_state_conflict" });
    assert.equal(h.calls.helper.length, 1);
    assert.equal(h.calls.helper[0].error, error);
    assert.equal(h.calls.settled, 1);
    assert.deepEqual(h.calls.fallback, []);
    assert.equal(h.calls.errors.length, 1);
    assert.match(h.calls.errors[0][0], /preflight state conflict/i);
    assert.deepEqual(h.calls.errors[0][1], { candidateId: h.candidates[0].candidateId });
    h.unchanged();
  });

  test(`${entry.name}: helper throw propagates unchanged without generic fallback`, async () => {
    const failure = new Error("synthetic_deferral_transaction_failure");
    const h = harness(entry, failure);
    await assert.rejects(h.run(new MembershipWelcomePreflightError("history_time_limit")), (error) => error === failure);
    assert.equal(h.calls.helper.length, 1);
    assert.equal(h.calls.settled, 1);
    assert.deepEqual(h.calls.fallback, []);
    assert.deepEqual(h.calls.errors, []);
    h.unchanged();
  });

  for (const scenario of ["plain preflight error", "post-transport uncertainty", "name-only typed impostor"]) {
    test(`${entry.name}: ${scenario} does not enter typed deferral`, async () => {
      const h = harness(entry, new Error("typed helper must not run"), [{
        ...(scenario === "post-transport uncertainty" ? {
          attempts: 1,
          providerAttemptedAt: "2026-10-21T10:00:00.000Z",
        } : {}),
      }]);
      const error = new Error(scenario === "post-transport uncertainty" ? "synthetic_provider_timeout" : "history_time_limit");
      if (scenario === "name-only typed impostor") error.name = "MembershipWelcomePreflightError";
      const result = structuredClone(await h.run(error));
      assert.deepEqual(result, entry.bulk ? { deferred: 0, failed: 0 } : { route: "generic_fallback" });
      assert.deepEqual(h.calls.helper, []);
      assert.equal(h.calls.fallback.length, 1);
      assert.equal(h.calls.fallback[0].error, error);
      assert.equal(h.calls.fallback[0].claimed, h.candidates[0]);
      assert.deepEqual(h.calls.errors, []);
      h.unchanged();
    });
  }

  test(`${entry.name}: refused legacy failed attempts-one state is never reset or requeued`, async () => {
    const h = harness(entry, false, [{ status: "failed", attempts: 1 }]);
    const result = structuredClone(await h.run(new MembershipWelcomePreflightError("history_time_limit")));
    assert.deepEqual(result, entry.bulk
      ? { deferred: 0, failed: 1 }
      : { processed: true, status: "failed", lastError: "membership_welcome_preflight_state_conflict" });
    assert.equal(h.calls.helper.length, 1);
    assert.deepEqual(h.calls.fallback, []);
    assert.equal(h.calls.errors.length, 1);
    h.unchanged();
  });
}

for (const recorded of [true, false]) {
  test(`bulk helper ${recorded}: continue advances to the next candidate without falling through`, async () => {
    const entry = entrypoints.find((entry) => entry.bulk);
    const h = harness(entry, recorded, [{}, {}]);
    const result = structuredClone(await h.run(new MembershipWelcomePreflightError("history_time_limit")));
    assert.deepEqual(result, recorded ? { deferred: 2, failed: 0 } : { deferred: 0, failed: 2 });
    assert.equal(h.calls.helper.length, 2);
    assert.equal(h.calls.settled, 2);
    assert.equal(h.calls.helper[0].claimed, h.candidates[0]);
    assert.equal(h.calls.helper[1].claimed, h.candidates[1]);
    assert.deepEqual(h.calls.fallback, []);
    assert.equal(h.calls.errors.length, recorded ? 0 : 2);
    h.unchanged();
  });
}

const cliUrl = new URL("../reconcile-membership-welcome-state.mjs", import.meta.url);
const cliTree = ts.createSourceFile(cliUrl.pathname, readFileSync(cliUrl, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(cliTree.parseDiagnostics.length, 0);
const cliMain = cliTree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "main");
assert.ok(cliMain, "the actual reconciliation CLI main must exist");
// Replace only import.meta so the real main can run in a VM with offline dependencies.
const transformedMain = ts.transform(cliMain, [(context) => {
  const visit = (node) => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
    ? ts.factory.createIdentifier("cliImportMeta")
    : ts.visitEachChild(node, visit, context);
  return (node) => ts.visitNode(node, visit);
}]);
const cliMainCode = compile(`${ts.createPrinter().printNode(ts.EmitHint.Unspecified, transformedMain.transformed[0], cliTree)}\nmain;`);
transformedMain.dispose();

test("reconciliation CLI source guard permits only source update and lane audit create", () => {
  const writes = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ["update", "create", "set", "delete", "add", "bulkWriter", "batch"].includes(node.expression.name.text)) {
      writes.push({ receiver: node.expression.expression.getText(cliTree),
        method: node.expression.name.text, target: node.arguments[0]?.getText(cliTree) });
    }
    ts.forEachChild(node, visit);
  };
  visit(cliTree);
  assert.deepEqual(writes, [
    { receiver: "tx", method: "update", target: "sourceRef" },
    { receiver: "tx", method: "create", target: "auditRef" },
  ]);
});

function reconciliationHarness() {
  const contractId = "a".repeat(64), memberId = "123", phone = "01000000001";
  const candidateId = `membership_welcome_${createHash("sha256").update(JSON.stringify(["5330", "new_member_welcome", phone])).digest("hex")}`;
  const paths = {
    source: `studiomateMembershipContracts/${contractId}`,
    candidate: `alimtalkCandidates/${candidateId}`,
    send: `alimtalkSends/${candidateId}`,
    claim: `membershipWelcomeClaims/${candidateId}`,
    aliasClaim: `membershipWelcomeClaims/member_${"b".repeat(64)}`,
    audit: `workLanes/welcome-predispatch-recovery/reports/source-state-${contractId}`,
  };
  const candidate = { candidateId, studioId: "5330", memberId, memberName: "SYNTHETIC", memberPhone: phone,
    type: "membership_welcome", templateCode: "KA01TP260914091233543JoFDsn7KfCr", status: "failed",
    attempts: 1, maxAttempts: 1, providerAttemptedAt: "synthetic-original-attempt",
    lastError: "history_time_limit", payload: { sourceContractId: contractId } };
  const rows = new Map([
    [paths.source, { contractId, studioId: "5330", source: "studiomate_native_contract", bindingVerified: true,
      status: "signed", memberName: "SYNTHETIC", welcomeStatus: "queued", welcomeCandidateId: candidateId,
      binding: { memberId, memberPhone: phone }, completion: { memberId, memberPhone: phone },
      welcomeReason: "original-state", updatedAt: "original-timestamp" }],
    [paths.candidate, candidate],
    [paths.send, { ...structuredClone(candidate), solapiMessageId: "synthetic-original-evidence" }],
    [paths.claim, { status: "unknown", attemptedAt: "synthetic-original-attempt" }],
    [paths.aliasClaim, { status: "attempting", attemptedAt: "synthetic-original-attempt" }],
  ]);
  const calls = { writes: [], output: [], reads: [], credentialReads: 0, initialized: 0, terminated: 0 };
  const at = "synthetic-reconciliation-timestamp";
  const snapshot = (ref) => {
    calls.reads.push(ref.path);
    return { exists: rows.has(ref.path), data: () => structuredClone(rows.get(ref.path)) };
  };
  const db = {
    doc: (path) => {
      assert.ok(Object.values(paths).includes(path), `unexpected document access: ${path}`);
      return { path };
    },
    runTransaction: async (body) => {
      const staged = [];
      const result = await body({
        get: async (ref) => snapshot(ref),
        getAll: async (...refs) => refs.map(snapshot),
        update: (ref, patch) => {
          assert.equal(ref.path, paths.source, "candidate/send/claim updates are forbidden");
          assert.deepEqual(Object.keys(patch).sort(), ["updatedAt", "welcomeReason", "welcomeStatus"]);
          staged.push({ kind: "update", path: ref.path, data: structuredClone(patch) });
        },
        create: (ref, value) => {
          assert.equal(ref.path, paths.audit, "only the exact lane audit may be created");
          assert.equal(rows.has(ref.path), false);
          staged.push({ kind: "create", path: ref.path, data: structuredClone(value) });
        },
      });
      for (const write of staged) rows.set(write.path, write.kind === "update"
        ? { ...rows.get(write.path), ...write.data } : write.data);
      calls.writes.push(...staged);
      return result;
    },
    terminate: async () => { calls.terminated += 1; },
  };
  const credentialIdentity = { project_id: "archive-pilates", client_email: "archive-codex-operator@archive-pilates.iam.gserviceaccount.com" };
  const admin = {
    initializeApp: (options) => {
      assert.equal(options.projectId, credentialIdentity.project_id);
      calls.initialized += 1;
    },
    credential: { cert: (key) => { assert.deepEqual(structuredClone(key), credentialIdentity); return "offline-stub"; } },
    firestore: Object.assign(() => db, { Timestamp: { now: () => at } }),
  };
  const cliProcess = { argv: [], env: {} };
  const main = runInNewContext(cliMainCode, {
    cliImportMeta: { url: cliUrl.href }, URL,
    process: cliProcess,
    // No credential file is opened; public identity fields suffice for the stub.
    readFile: async () => { calls.credentialReads += 1; return JSON.stringify(credentialIdentity); },
    createRequire: () => (name) => { assert.equal(name, "firebase-admin"); return admin; },
    planWelcomeStateReconciliation,
    console: { log: (value) => calls.output.push(JSON.parse(value)) },
    fetch: () => assert.fail("transport is forbidden"),
  });
  const run = async (args = ["--contract-id", contractId, "--member-id", memberId]) => {
    cliProcess.argv = ["node", "offline-cli", ...args];
    await main();
    return calls.output.at(-1);
  };
  return { paths, rows, calls, at, contractId, memberId, run };
}

test("reconciliation CLI defaults to a write-free dry run", async () => {
  const h = reconciliationHarness(), before = structuredClone(h.rows);
  const result = await h.run();
  assert.equal(result.applied, false);
  assert.deepEqual(result.patch, { welcomeStatus: "review", welcomeReason: "history_time_limit" });
  assert.equal(result.sendsAttempted, 0);
  assert.deepEqual(h.calls.writes, []);
  assert.deepEqual(h.rows, before);
  assert.equal(h.calls.terminated, 1);
});

test("reconciliation CLI exact apply changes only source display state plus one audit", async () => {
  const h = reconciliationHarness(), before = structuredClone(h.rows);
  const result = await h.run(["--contract-id", h.contractId, "--member-id", h.memberId, "--apply"]);
  assert.equal(result.applied, true);
  assert.equal(result.sendsAttempted, 0);
  assert.deepEqual(h.calls.writes.map(({ kind, path }) => ({ kind, path })), [
    { kind: "update", path: h.paths.source }, { kind: "create", path: h.paths.audit },
  ]);
  assert.deepEqual(h.rows.get(h.paths.source), { ...before.get(h.paths.source),
    welcomeStatus: "review", welcomeReason: "history_time_limit", updatedAt: h.at });
  for (const path of [h.paths.candidate, h.paths.send, h.paths.claim, h.paths.aliasClaim])
    assert.deepEqual(h.rows.get(path), before.get(path), `outbound record must remain unchanged: ${path}`);
  assert.equal(h.rows.size, before.size + 1);
  assert.equal(h.rows.get(h.paths.audit).evidencePreserved, true);
  assert.equal(h.rows.get(h.paths.audit).sendsAttempted, 0);
  assert.equal(h.calls.terminated, 1);
});

test("reconciliation CLI repeat apply is a write-free no-op", async () => {
  const h = reconciliationHarness();
  const args = ["--contract-id", h.contractId, "--member-id", h.memberId, "--apply"];
  await h.run(args);
  const before = structuredClone(h.rows);
  const result = await h.run(args);
  assert.equal(result.applied, false);
  assert.equal(h.calls.writes.length, 2);
  assert.deepEqual(h.rows, before);
  assert.equal(h.calls.terminated, 2);
});

for (const conflict of ["member", "source_reference", "send_outcome", "audit_exists"]) {
  test(`reconciliation CLI ${conflict} conflict performs no writes`, async () => {
    const h = reconciliationHarness();
    if (conflict === "source_reference") h.rows.get(h.paths.source).welcomeCandidateId = "invalid";
    if (conflict === "send_outcome") h.rows.get(h.paths.send).status = "done";
    if (conflict === "audit_exists") h.rows.set(h.paths.audit, { action: "existing-audit" });
    const before = structuredClone(h.rows);
    const result = await h.run(["--contract-id", h.contractId, "--member-id", conflict === "member" ? "456" : h.memberId, "--apply"]);
    assert.equal(result.applied, false);
    assert.deepEqual(h.calls.writes, []);
    assert.deepEqual(h.rows, before);
    assert.equal(h.calls.terminated, 1);
  });
}

for (const args of [[], ["--apply"], ["--contract-id", "all", "--member-id", "123"],
  ["--contract-id", "a".repeat(64), "--member-id", "123", "--all"],
  ["--contract-id", "a".repeat(64), "--member-id", "123", "--apply", "--apply"]]) {
  test(`reconciliation CLI rejects non-exact/invalid arguments before initialization: ${JSON.stringify(args)}`, async () => {
    const h = reconciliationHarness(), before = structuredClone(h.rows);
    await assert.rejects(h.run(args), /Exact identity required|Invalid exact reconciliation arguments/);
    assert.equal(h.calls.credentialReads, 0);
    assert.equal(h.calls.initialized, 0);
    assert.deepEqual(h.calls.reads, []);
    assert.deepEqual(h.calls.writes, []);
    assert.deepEqual(h.rows, before);
  });
}
