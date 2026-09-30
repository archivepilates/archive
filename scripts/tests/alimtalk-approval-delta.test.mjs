import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import test from "node:test";

const root = new URL(
  "../../firebase/kangsain-functions/functions/",
  import.meta.url,
);
let ts;
try {
  ts = createRequire(new URL("package.json", root))("typescript");
} catch {
  ts = createRequire(
    resolve(
      process.env.ALIMTALK_TEST_RUNTIME ||
        "/Users/archivepilates/dev/archive-in-runtime",
      "firebase/kangsain-functions/functions/package.json",
    ),
  )("typescript");
}
const code = new Map();
const clone = (value) =>
  Array.isArray(value)
    ? Array.from(value, clone)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [key, clone(entry)]),
        )
      : value;
const DATE = "2026-09-30";
const ROOT_ID = `5330_${DATE}`;
const approvalPath = (id = ROOT_ID) => `alimtalkSendApprovals/${id}`;
const candidatePath = (id) => `alimtalkCandidates/${id}`;

function candidate(id = "1", patch = {}) {
  return {
    candidateId: `candidate-${id}`,
    studioId: "5330",
    memberId: `member-${id}`,
    memberName: `Synthetic ${id}`,
    memberPhone: `010${String(id).padStart(8, "0")}`,
    type: "ticket_expiring",
    status: "candidate",
    templateCode: "SYNTHETIC_TEMPLATE",
    title: "Synthetic",
    reason: "Synthetic",
    sourceDate: DATE,
    payload: { ticketName: "Synthetic ticket", expiresAt: "2026-10-10" },
    attempts: 0,
    maxAttempts: 2,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}
const ten = () =>
  Array.from({ length: 10 }, (_, i) => candidate(String(i + 1)));

// Optimistic transactions intentionally interleave. A conflicting read replays the
// whole callback, and aborted writes never escape. No Firebase SDK is loaded.
function syntheticDb() {
  const values = new Map();
  const versions = new Map();
  const writes = [];
  let conflicts = 0;
  let beforeCommit;
  const seed = (key, value) => {
    if (value === undefined) values.delete(key);
    else values.set(key, clone(value));
    versions.set(key, (versions.get(key) || 0) + 1);
  };
  const snap = (key) => ({
    id: key.split("/").at(-1),
    exists: values.has(key),
    data: () => clone(values.get(key)),
  });
  const write = (kind, ref, value, options) => {
    if (kind === "create")
      assert.ok(!values.has(ref.path), `create conflict: ${ref.path}`);
    if (kind === "update")
      assert.ok(values.has(ref.path), `update missing: ${ref.path}`);
    seed(
      ref.path,
      options?.merge || kind === "update"
        ? { ...values.get(ref.path), ...clone(value) }
        : value,
    );
    writes.push({ kind, path: ref.path, value: clone(value) });
  };
  const ref = (path) => ({
    path,
    get: async () => snap(path),
    update: async (value) => write("update", { path }, value),
    set: async (value, options) => write("set", { path }, value, options),
  });
  const collection = (name, filters = []) => ({
    doc: (id) => ref(`${name}/${id}`),
    where: (key, op, value) => {
      assert.equal(op, "==");
      return collection(name, [...filters, [key, value]]);
    },
    get: async () => ({
      docs: [...values]
        .filter(
          ([key, value]) =>
            key.startsWith(`${name}/`) &&
            filters.every(([field, expected]) => value[field] === expected),
        )
        .map(([key]) => snap(key)),
    }),
  });
  const db = {
    collection,
    doc: ref,
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const reads = new Map();
        const staged = [];
        const result = await callback({
          get: async (ref) => {
            assert.equal(
              staged.length,
              0,
              "Firestore reads must precede writes",
            );
            reads.set(ref.path, versions.get(ref.path) || 0);
            return snap(ref.path);
          },
          create: (ref, value) => staged.push(["create", ref, value]),
          update: (ref, value) => staged.push(["update", ref, value]),
          set: (ref, value, options) =>
            staged.push(["set", ref, value, options]),
        });
        if (beforeCommit) {
          const hook = beforeCommit;
          beforeCommit = undefined;
          hook(staged);
        }
        if (
          [...reads].some(
            ([key, version]) => (versions.get(key) || 0) !== version,
          )
        ) {
          conflicts++;
          continue;
        }
        staged.forEach((args) => write(...args));
        return result;
      }
      throw new Error("Synthetic transaction retries exhausted");
    },
  };
  return {
    db,
    seed,
    get: (key) => clone(values.get(key)),
    writes,
    all: () => [...values].map(([key, value]) => [key, clone(value)]),
    get conflicts() {
      return conflicts;
    },
    onCommit: (hook) => {
      beforeCommit = hook;
    },
  };
}

function harness(options = {}) {
  const store = syntheticDb();
  const mails = [];
  let processCalls = 0;
  let rebuilt = [];
  let stamp = 0;
  const exports = new Map();
  const guards = {
    autoSendabilityIssue: options.autoIssue || (async () => ""),
    privateSurveySendabilityIssue: options.privateIssue || (async () => ""),
    renewalCandidateSendabilityIssue: options.renewalIssue || (async () => ""),
    longAbsenceCandidateSendabilityIssue:
      options.longAbsenceIssue || (async () => ""),
  };
  const stubs = {
    "node:crypto": { createHash, randomBytes },
    "firebase-functions": { logger: { info() {} } },
    "../config/constants": { DEFAULT_STUDIO_ID: "5330", REGION: "synthetic" },
    "../config/firebase": { db: store.db },
    "../firestore/refs": {
      refs: {
        alimtalkCandidate: (id) =>
          store.db.collection("alimtalkCandidates").doc(id),
        alimtalkCandidates: () => store.db.collection("alimtalkCandidates"),
      },
    },
    "../utils/date": {
      todayKst: () => DATE,
      nowTimestamp: () => ({ value: ++stamp, toMillis: () => Date.now() }),
    },
    "../google/driveDocsMailer": {
      sendAlimtalkLogEmail: async (input) => {
        if (options.emailFailure?.())
          throw new Error("Synthetic email failure");
        mails.push(clone(input));
      },
    },
    "./eligibility": guards,
    "./privateSurveySendGuard": guards,
    "./renewalSendGuard": guards,
    "./longAbsenceSendGuard": guards,
    "./processAlimtalkQueue": {
      processAlimtalkQueue: async () => {
        processCalls++;
        return { processed: 0, sent: 0, failed: 0, deferred: 0 };
      },
    },
    "./rebuildAlimtalkCandidates": {
      rebuildAlimtalkCandidatesForRange: async () => ({
        candidateIds: rebuilt.map((item) => item.candidateId),
        candidates: rebuilt.length,
      }),
    },
    "./dailyCandidateSelection": {
      selectDailyAlimtalkCandidates: (selected) => ({
        selected,
        suppressed: [],
      }),
    },
    "./instructorLessonSampleApproval": {
      splitInstructorLessonCandidates: (other) => ({
        other,
        instructorLesson: [],
      }),
      prepareInstructorLessonSampleApprovals: async () => ({}),
    },
  };
  function load(name) {
    if (exports.has(name)) return exports.get(name);
    if (!code.has(name)) {
      code.set(
        name,
        ts.transpileModule(
          readFileSync(new URL(`src/alimtalk/${name}.ts`, root), "utf8"),
          {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2022,
            },
          },
        ).outputText,
      );
    }
    const module = {};
    exports.set(name, module);
    vm.runInNewContext(
      code.get(name),
      {
        exports: module,
        process: { env: {} },
        Date,
        Set,
        Map,
        require: (id) => {
          if (id in stubs) return stubs[id];
          if (
            [
              "./approvalPolicy",
              "./approvalStore",
              "./approvalGate",
              "./testRecipients",
            ].includes(id)
          )
            return load(id.slice(2));
          throw new Error(`Forbidden unstubbed import: ${id}`);
        },
      },
      { timeout: 1000 },
    );
    return module;
  }
  const policy = load("approvalPolicy");
  const gate = load("approvalGate");
  const binding = load("approvalStore");
  const queue = load("queueDailyAlimtalk");
  // Compile the actual exported claim body, with a closed dependency list. This
  // exercises main's integration without loading any sender/provider module.
  const processorSource = readFileSync(
    new URL("src/alimtalk/processAlimtalkQueue.ts", root),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "process.ts",
    processorSource,
    ts.ScriptTarget.Latest,
    true,
  );
  const claimDeclaration = tree.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "claimCandidate",
  );
  assert.ok(claimDeclaration, "claimCandidate must exist");
  const staleDeclaration = tree.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "isStaleProcessing",
  );
  const staleThresholdDeclaration = tree.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => declaration.name.getText(tree) === "PROCESSING_STALE_MS",
      ),
  );
  assert.ok(staleDeclaration, "isStaleProcessing must exist");
  assert.ok(staleThresholdDeclaration, "PROCESSING_STALE_MS must exist");
  const claimSource = [staleThresholdDeclaration, staleDeclaration, claimDeclaration]
    .map((node) => node.getText(tree))
    .join("\n");
  const claimCode = ts.transpileModule(claimSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const claimExports = {};
  vm.runInNewContext(
    claimCode,
    {
      exports: claimExports,
      db: store.db,
      refs: stubs["../firestore/refs"].refs,
      alimtalkApprovalClaimIssue: binding.alimtalkApprovalClaimIssue,
      nowTimestamp: stubs["../utils/date"].nowTimestamp,
      Date,
      isMembershipWelcomeCandidate: (item) =>
        item.type === "membership_welcome",
      MEMBERSHIP_AUTOMATION_SETTINGS: "syntheticSettings/membership",
      MEMBERSHIP_CONTRACT_COLLECTION: "syntheticContracts",
      membershipAutomationEnabled: (settings) => settings?.enabled === true,
      membershipWelcomeClaimIssue: () => "",
      membershipWelcomeReadbackIssue: (source) =>
        source?.verified === true ? "" : "synthetic source not verified",
    },
    { timeout: 1000 },
  );
  return {
    store,
    mails,
    policy,
    gate,
    binding,
    queue,
    claim: claimExports.claimCandidate,
    get processCalls() {
      return processCalls;
    },
    seedCandidates(items) {
      items.forEach((item) =>
        store.seed(candidatePath(item.candidateId), item),
      );
    },
    rebuild(items) {
      rebuilt = items;
      this.seedCandidates(items);
    },
    require: (candidates, approvalScope = "daily") =>
      gate.requireApprovalForLargeAlimtalkBatch({
        studioId: "5330",
        today: DATE,
        candidates,
        approvalScope,
      }),
    approve(id = ROOT_ID) {
      store.seed(approvalPath(id), {
        ...store.get(approvalPath(id)),
        status: "approved",
      });
    },
    issue: (candidate, today = DATE) =>
      store.db.runTransaction((tx) =>
        binding.alimtalkApprovalClaimIssue(tx, candidate, today),
      ),
    bind: (candidate, today = DATE) => ({
      ...candidate,
      ...binding.approvalCandidateBinding(candidate, today),
    }),
    async handler(method, id = ROOT_ID, token) {
      if (!token) {
        const url = mails
          .find((mail) => mail.body.includes(`id=${encodeURIComponent(id)}&`))
          ?.body.split("\n")
          .at(-1);
        token = new URL(url).searchParams.get("token");
      }
      const response = {
        statusCode: 0,
        body: "",
        status(code) {
          this.statusCode = code;
          return this;
        },
        send(body) {
          this.body = body;
          return this;
        },
      };
      await gate.approveAlimtalkBatchHandler(
        { method, query: { id, token } },
        response,
      );
      return response;
    },
  };
}

test("threshold is 10 only before a gate exists", async () => {
  const h = harness();
  assert.equal((await h.require(ten().slice(0, 9))).required, false);
  assert.equal(h.store.writes.length, 0);
  const result = await h.require(ten());
  assert.equal(result.required, true);
  assert.equal(result.approved, false);
  assert.equal(h.store.get(approvalPath()).candidateCount, 10);
  assert.equal(h.mails.length, 1);
  assert.equal((await h.require([candidate("1")])).approved, false);
});

test("pending snapshots never expand; even one addition gets a separate approval", async () => {
  const h = harness();
  await h.require(ten());
  const original = h.store.get(approvalPath());
  const result = await h.require([...ten(), candidate("11")]);
  const after = h.store.get(approvalPath());
  assert.deepEqual(after.targets, original.targets);
  assert.deepEqual(after.candidateIds, original.candidateIds);
  assert.deepEqual(after.candidateLines, original.candidateLines);
  assert.equal(after.tokenHash, original.tokenHash);
  assert.equal(after.candidateCount, 10);
  assert.equal(after.deltaApprovalIds.length, 1);
  assert.equal(
    h.store.get(approvalPath(after.deltaApprovalIds[0])).candidateCount,
    1,
  );
  assert.equal(result.pendingCandidateIds.length, 11);
});

test("approved targets remain allowed while additions and changed payloads wait", async () => {
  const h = harness();
  await h.require(ten());
  h.approve();
  const old = h.store.get(approvalPath());
  const changed = candidate("2", { payload: { ticketName: "changed" } });
  const result = await h.require([candidate("1"), candidate("11"), changed]);
  assert.deepEqual(clone(result.allowedCandidateIds), ["candidate-1"]);
  assert.equal(result.approved, false);
  assert.equal(h.store.get(approvalPath()).status, "approved");
  assert.deepEqual(h.store.get(approvalPath()).targets, old.targets);
  assert.equal(await h.issue(h.bind(candidate("1"))), "");
  assert.equal(await h.issue(h.bind(changed)), "approval_snapshot_not_approved");
  const delta = result.pendingApprovalIds[0];
  h.approve(delta);
  assert.equal(await h.issue(h.bind(changed)), "");
});

test("same-ID normalized content retains approval but regenerated IDs require review", async () => {
  const h = harness();
  await h.require(ten());
  h.approve();
  const normalized = candidate("1", {
    memberPhone: "+82 10-0000-0001",
    payload: { expiresAt: "2026-10-10", ticketName: "Synthetic ticket" },
    updatedAt: 999,
    reviewedByUid: "operator",
    status: "reviewed",
    reason: "changed",
    title: "changed",
  });
  const result = await h.require([normalized]);
  assert.equal(result.approved, true);
  assert.deepEqual(clone(result.allowedCandidateIds), ["candidate-1"]);
  const regenerated = { ...normalized, candidateId: "new-id" };
  const review = await h.require([regenerated]);
  assert.equal(review.approved, false);
  assert.deepEqual(clone(review.allowedCandidateIds), []);
  assert.deepEqual(clone(review.pendingCandidateIds), ["new-id"]);
  assert.equal(
    await h.issue({
      ...regenerated,
      ...h.binding.approvalCandidateBinding(regenerated, DATE),
    }),
    "approval_snapshot_not_approved",
  );
  assert.equal(h.store.get(approvalPath()).deltaApprovalIds, undefined);
});

test("recipient, template, source action/date and every payload field remain bound", () => {
  const { policy } = harness();
  const base = candidate();
  for (const patch of [
    { memberId: "other" },
    { memberName: "Other" },
    { memberPhone: "01099999999" },
    { templateCode: "OTHER" },
    { type: "remaining_low" },
    { sourceDate: "2026-10-01" },
    { sourceActionKey: "changed-event" },
    { studioId: "other" },
    { payload: { ...base.payload, unknownFutureVariable: "new-content" } },
  ]) {
    assert.notEqual(
      policy.alimtalkApprovalSnapshotKey(base),
      policy.alimtalkApprovalSnapshotKey({ ...base, ...patch }),
    );
  }
});

test("overlapping concurrent requests isolate additions exactly once after transaction retry", async () => {
  const h = harness();
  await h.require(ten());
  h.approve();
  await Promise.all([
    h.require([candidate("1"), candidate("11"), candidate("12")]),
    h.require([candidate("1"), candidate("12"), candidate("13")]),
  ]);
  const ids = h.store.get(approvalPath()).deltaApprovalIds;
  const targets = ids.flatMap((id) => h.store.get(approvalPath(id)).targets);
  assert.equal(targets.length, 3);
  assert.equal(new Set(targets.map((target) => target.snapshotKey)).size, 3);
  assert.ok(h.store.conflicts > 0);
  assert.equal(await h.issue(h.bind(candidate("1"))), "");
  assert.equal(
    await h.issue(h.bind(candidate("12"))),
    "approval_snapshot_not_approved",
  );
});

test("concurrent first gates and duplicate requests never rewrite snapshots or email twice", async () => {
  const h = harness();
  await Promise.all([
    h.require(ten()),
    h.require([...ten(), candidate("11")]),
    h.require(ten()),
  ]);
  const docs = h.store
    .all()
    .filter(([path]) => path.startsWith("alimtalkSendApprovals/"));
  const targets = docs.flatMap(([, doc]) => doc.targets);
  assert.equal(targets.length, 11);
  assert.equal(new Set(targets.map((target) => target.snapshotKey)).size, 11);
  assert.equal(h.mails.length, docs.length);
});

test("excluded and cancelled targets cannot be revived by regenerated IDs or a delta", async () => {
  for (const status of ["excluded", "cancelled"]) {
    const h = harness();
    await h.require(ten());
    h.approve();
    const root = h.store.get(approvalPath());
    root.targets[0].status = status;
    h.store.seed(approvalPath(), root);
    const regenerated = candidate("1", { candidateId: "regenerated" });
    const result = await h.require([regenerated]);
    assert.equal(result.allowedCandidateIds.length, 0);
    assert.equal(h.store.get(approvalPath()).deltaApprovalIds, undefined);
    assert.equal(await h.issue(h.bind(regenerated)), "approval_snapshot_not_approved");
    assert.equal(await h.issue(h.bind(candidate("1"))), "approval_snapshot_not_approved");
  }
});

test("legacy ID-only approval is not silently upgraded from mutable candidate records", async () => {
  const h = harness();
  h.store.seed(approvalPath(), {
    approvalId: ROOT_ID,
    studioId: "5330",
    sourceDate: DATE,
    candidateIds: ["candidate-1"],
    candidateCount: 1,
    status: "approved",
    tokenHash: "old",
  });
  assert.equal(await h.issue(candidate("1")), "approval_legacy_binding_required");
  assert.equal(await h.issue(h.bind(candidate("1"))), "approval_snapshot_not_approved");
  const result = await h.require([candidate("1")]);
  assert.equal(result.approved, false);
  assert.equal(h.store.get(approvalPath()).snapshotVersion, undefined);
  assert.equal(result.pendingApprovalIds.length, 1);
  h.approve(result.pendingApprovalIds[0]);
  assert.equal(await h.issue(h.bind(candidate("1"))), "");
  assert.equal(await h.issue(candidate("1")), "approval_legacy_binding_required");
});

test("GET is read-only; POST confirms only the requested snapshot", async () => {
  const h = harness();
  h.seedCandidates([...ten(), candidate("11")]);
  await h.require(ten());
  const delta = (await h.require([candidate("11")])).pendingApprovalIds[0];
  const before = h.store.writes.length;
  const preview = await h.handler("GET");
  assert.equal(preview.statusCode, 200);
  assert.match(preview.body, /method="post"/);
  assert.equal(h.store.writes.length, before);
  assert.equal(h.processCalls, 0);
  assert.equal((await h.handler("POST")).statusCode, 200);
  assert.equal(h.store.get(approvalPath()).status, "approved");
  assert.equal(h.store.get(approvalPath(delta)).status, "pending");
  assert.equal(h.store.get(candidatePath("candidate-1")).status, "queued");
  assert.equal(h.store.get(candidatePath("candidate-11")).status, "candidate");
});

test("approval callback queues only original eligible IDs, not regenerated, removed, skipped or changed candidates", async () => {
  const h = harness({
    autoIssue: async (item) =>
      item.memberId === "member-3" ? "excluded member" : "",
    privateIssue: async (item) =>
      item.memberId === "member-4" ? "cancelled source" : "",
    renewalIssue: async (item) =>
      item.memberId === "member-5" ? "removed ticket" : "",
  });
  await h.require(ten());
  h.seedCandidates([
    candidate("1", { candidateId: "regenerated" }),
    candidate("2", { status: "skipped" }),
    candidate("3"),
    candidate("4"),
    candidate("5"),
    candidate("6", { payload: { changed: "yes" } }),
    candidate("8"),
  ]);
  assert.equal((await h.handler("POST")).statusCode, 200);
  const queued = h.store
    .all()
    .filter(
      ([path, doc]) =>
        path.startsWith("alimtalkCandidates/") && doc.status === "queued",
    );
  assert.deepEqual(
    queued.map(([path]) => path),
    [candidatePath("candidate-8")],
  );
  assert.equal(h.store.get(candidatePath("regenerated")).status, "candidate");
  assert.equal(h.store.get(candidatePath("candidate-7")), undefined);
});

test("regression: repeated approval POSTs cannot queue alternate IDs or double-claim the original snapshot", async () => {
  const h = harness();
  await h.require(ten());
  h.seedCandidates([
    candidate("1"),
    candidate("1", { candidateId: "regenerated" }),
  ]);
  assert.equal((await h.handler("POST")).statusCode, 200);
  assert.equal((await h.handler("POST")).statusCode, 200);
  const original = h.store.get(candidatePath("candidate-1"));
  const alternate = h.store.get(candidatePath("regenerated"));
  assert.equal(original.status, "queued");
  assert.equal(alternate.status, "candidate");
  const claims = await Promise.all([
    h.claim(original),
    h.claim(original),
    h.claim(alternate),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean).candidateId, original.candidateId);
  assert.equal(claims.find(Boolean).status, "processing");
  assert.ok(h.store.conflicts > 0);

  // An independently queued alternate must also fail at the actual claim boundary.
  const bypass = {
    ...alternate,
    status: "queued",
    ...h.binding.approvalCandidateBinding(alternate, DATE),
  };
  h.seedCandidates([bypass]);
  assert.equal(await h.claim(bypass), null);
  assert.equal(h.store.get(candidatePath(bypass.candidateId)).status, "reviewed");
});

test("regression: skipping an original target cannot resurrect it through a regenerated ID", async () => {
  const h = harness();
  await h.require(ten());
  h.approve();
  const frozenTargets = h.store.get(approvalPath()).targets;
  h.seedCandidates([
    candidate("1", { status: "skipped", reasonCode: "operator_cancelled" }),
    candidate("1", { candidateId: "regenerated" }),
  ]);
  assert.equal((await h.handler("POST")).statusCode, 200);
  assert.equal(h.store.get(candidatePath("candidate-1")).status, "skipped");
  const regenerated = h.store.get(candidatePath("regenerated"));
  assert.equal(regenerated.status, "candidate");
  assert.equal(await h.claim(regenerated), null);
  const review = await h.require([regenerated]);
  assert.equal(review.approved, false);
  assert.deepEqual(clone(review.allowedCandidateIds), []);
  assert.deepEqual(clone(review.pendingCandidateIds), ["regenerated"]);
  assert.deepEqual(h.store.get(approvalPath()).targets, frozenTargets);
});

test("regression: legacy unbound queued candidates require review regardless of the batch date or status", async () => {
  for (const status of ["pending", "approved", "missing"]) {
    const h = harness();
    const oldId = "5330_2026-09-29";
    const item = candidate("old", {
      type: "new_member",
      sourceDate: "2026-09-28",
      status: "queued",
      queuedBy: "operator",
    });
    if (status !== "missing") {
      h.store.seed(approvalPath(oldId), {
        approvalId: oldId,
        studioId: "5330",
        sourceDate: "2026-09-29",
        status,
        candidateIds: [item.candidateId],
        candidateCount: 1,
        tokenHash: "legacy",
      });
    }
    h.seedCandidates([item]);
    const issue = await h.issue(item);
    assert.equal(issue, "approval_legacy_binding_required", `unbound legacy ${status} batch must fail closed`);
    assert.equal(await h.claim(item), null);
    const saved = h.store.get(candidatePath(item.candidateId));
    assert.equal(saved.status, "reviewed");
    assert.equal(saved.reasonCode, issue);
    assert.equal(saved.attempts, 0);
    assert.equal(h.processCalls, 0);
    assert.equal(h.mails.length, 0);
  }
});

test("daily queue keeps old approved targets flowing while its one new target waits", async () => {
  const h = harness();
  await h.require(ten());
  h.approve();
  h.rebuild([candidate("1"), candidate("11")]);
  const result = await h.queue.queueDailyAlimtalkCandidates({ today: DATE });
  assert.equal(result.queued, 1);
  assert.equal(result.blocked, 1);
  assert.equal(
    h.store.get(candidatePath("candidate-1")).approvalGateId,
    ROOT_ID,
  );
  assert.equal(h.store.get(candidatePath("candidate-11")).status, "candidate");
});

test("reservation-open approvals are isolated from daily and have the same delta rule", async () => {
  const h = harness();
  const items = ten().map((item) => ({ ...item, type: "reservation_open" }));
  const result = await h.require(items, "reservation_open");
  h.approve(result.approvalId);
  const extra = candidate("11", { type: "reservation_open" });
  h.rebuild([items[0], extra]);
  const queued = await h.queue.queueReservationOpenAlimtalkCandidates({
    today: DATE,
  });
  assert.equal(queued.queued, 1);
  assert.equal(queued.blocked, 1);
  assert.equal(h.store.get(approvalPath()), undefined);
  assert.equal(await h.issue(h.bind(extra)), "approval_snapshot_not_approved");
});

test("claims re-read the root: an ungated small batch loses permission when a concurrent gate appears", async () => {
  const h = harness();
  const small = candidate("99");
  assert.equal((await h.require([small])).approved, true);
  await h.require(ten());
  assert.equal(
    await h.issue({
      ...small,
      ...h.binding.approvalCandidateBinding(small, DATE),
      approvalGateMode: "below_threshold",
    }),
    "approval_snapshot_not_approved",
  );
});

test("claim binding rejects content mutation but preserves an old approved target on a later day", async () => {
  const h = harness();
  await h.require(ten());
  h.approve();
  const approved = {
    ...candidate("1"),
    ...h.binding.approvalCandidateBinding(candidate("1"), DATE),
  };
  assert.equal(await h.issue(approved, "2026-10-01"), "");
  assert.equal(
    await h.issue({ ...approved, payload: { changed: "yes" } }),
    "approval_snapshot_changed",
  );
  assert.equal(
    await h.issue({ ...approved, approvalGateId: "other-studio_2026-09-30" }),
    "approval_binding_invalid",
  );
});

test("candidate cancellation during queue transaction prevents a stale eligible record being queued", async () => {
  const h = harness();
  await h.require(ten());
  h.approve();
  h.rebuild([candidate("1")]);
  // Install the conflict when eligibility is next checked, after approval selection.
  const nested = h.binding.alimtalkApprovalClaimIssue;
  h.binding.alimtalkApprovalClaimIssue = async (...args) => {
    const issue = await nested(...args);
    h.store.onCommit(() =>
      h.store.seed(
        candidatePath("candidate-1"),
        candidate("1", { status: "skipped" }),
      ),
    );
    return issue;
  };
  const result = await h.queue.queueDailyAlimtalkCandidates({ today: DATE });
  assert.equal(result.queued, 0);
  assert.equal(h.store.get(candidatePath("candidate-1")).status, "skipped");
});

test("ticket-fact template hold stays reviewed with its dedicated reason, never queued", async () => {
  const issue = "수강권 사실 안내 템플릿 검토 대기: synthetic";
  const h = harness({ autoIssue: async () => issue });
  h.rebuild([candidate("1")]);
  const result = await h.queue.queueDailyAlimtalkCandidates({ today: DATE });
  const saved = h.store.get(candidatePath("candidate-1"));
  assert.equal(result.queued, 0);
  assert.equal(saved.status, "reviewed");
  assert.equal(saved.reasonCode, "ticket_fact_template_review");
  assert.equal(saved.lastError, issue);
  assert.equal(h.mails.length, 0);
});

test("failed synthetic notification can retry without changing the frozen snapshot", async () => {
  let fail = true;
  const h = harness({ emailFailure: () => fail });
  await assert.rejects(h.require(ten()), /Synthetic email failure/);
  const snapshot = h.store.get(approvalPath()).targets;
  fail = false;
  await h.require([candidate("1")]);
  assert.deepEqual(h.store.get(approvalPath()).targets, snapshot);
  assert.equal(h.mails.length, 1);
  assert.match(h.mails[0].body, /10건/);
});

test("unrelated independent approval flows are not blocked by the daily batch gate", async () => {
  const h = harness();
  await h.require(ten());
  for (const type of [
    "private_lesson_report",
    "inbody_report",
    "recommended_meal_survey",
    "recommended_meal_report",
    "membership_welcome",
    "instructor_lesson_confirmation",
    "instructor_lesson_material",
    "pricing_info",
  ]) {
    const independent = candidate("99", {
      type,
      status: "queued",
      queuedBy: "operator",
    });
    assert.equal(await h.issue(independent), "", type);
    assert.equal(
      await h.issue({
        ...independent,
        ...h.binding.approvalCandidateBinding(independent, DATE),
      }),
      "approval_snapshot_not_approved",
      `explicit binding remains enforced: ${type}`,
    );
  }
  assert.equal(
    await h.issue(candidate("99", { queuedBy: "operator" })),
    "approval_legacy_binding_required",
  );
  assert.equal(
    await h.issue(
      candidate("99", {
        type: "private_lesson_report",
        approvalSnapshotKey: "orphan",
      }),
    ),
    "approval_binding_invalid",
  );
});

test("actual claimCandidate rejects pending additions and claims approved targets with transactional stubs", async () => {
  const h = harness();
  await h.require(ten());
  h.approve();
  await h.require([candidate("11")]);
  const approved = candidate("1", {
    status: "queued",
    queuedBy: "operator",
    ...h.binding.approvalCandidateBinding(candidate("1"), DATE),
  });
  const pending = candidate("11", {
    status: "queued",
    queuedBy: "operator",
    ...h.binding.approvalCandidateBinding(candidate("11"), DATE),
  });
  const report = candidate("report", {
    type: "private_lesson_report",
    status: "queued",
  });
  h.seedCandidates([approved, pending, report]);
  assert.equal(await h.claim(pending), null);
  assert.equal(
    h.store.get(candidatePath(pending.candidateId)).status,
    "reviewed",
  );
  assert.equal(
    h.store.get(candidatePath(pending.candidateId)).reasonCode,
    "approval_snapshot_not_approved",
  );
  assert.equal((await h.claim(approved)).status, "processing");
  assert.equal((await h.claim(report)).status, "processing");
  assert.equal(h.processCalls, 0);
});

test("actual claim preserves independent membership, pricing, report and instructor paths", async () => {
  const h = harness();
  await h.require(ten());
  const contractId = "a".repeat(64);
  h.store.seed("syntheticSettings/membership", { enabled: true });
  h.store.seed(`syntheticContracts/${contractId}`, { verified: true });
  for (const type of [
    "membership_welcome",
    "pricing_info",
    "private_lesson_report",
    "instructor_lesson_confirmation",
    "instructor_lesson_material",
    "recommended_meal_report",
  ]) {
    const item = candidate(type, {
      type,
      status: "queued",
      queuedBy: "operator",
      payload: { sourceContractId: contractId },
    });
    h.seedCandidates([item]);
    assert.equal((await h.claim(item)).status, "processing", type);
  }
  assert.equal(h.processCalls, 0);
});

test("actual bound claim retries against a newly created gate and cannot sneak through threshold bypass", async () => {
  const h = harness();
  const small = candidate("99", {
    status: "queued",
    queuedBy: "operator",
    ...h.binding.approvalCandidateBinding(candidate("99"), DATE),
    approvalGateMode: "below_threshold",
  });
  assert.equal(await h.issue(small), "");
  h.seedCandidates([small]);
  const other = harness();
  await other.require(ten());
  h.store.onCommit(() =>
    h.store.seed(approvalPath(), other.store.get(approvalPath())),
  );
  assert.equal(await h.claim(small), null);
  assert.equal(
    h.store.get(candidatePath(small.candidateId)).status,
    "reviewed",
  );
  assert.ok(h.store.conflicts > 0);
});

test("approval callback limits queries to frozen source dates, including recent new members", async () => {
  const h = harness();
  const older = candidate("older", {
    type: "new_member",
    sourceDate: "2026-09-28",
  });
  await h.require([...ten(), older]);
  h.seedCandidates([older, candidate("history", { sourceDate: "2025-01-01" })]);
  await h.handler("POST");
  assert.equal(h.store.get(candidatePath(older.candidateId)).status, "queued");
  assert.equal(
    h.store.get(candidatePath("candidate-history")).status,
    "candidate",
  );
  assert.deepEqual(h.store.get(approvalPath()).candidateSourceDates, [
    DATE,
    "2026-09-28",
  ]);
});

test("only a complete below-threshold binding permits a missing root; fresh small queues remain claimable", async () => {
  const h = harness();
  h.rebuild([candidate("1")]);
  assert.equal(
    (await h.queue.queueDailyAlimtalkCandidates({ today: DATE })).queued,
    1,
  );
  const queued = h.store.get(candidatePath("candidate-1"));
  assert.equal(queued.approvalGateId, ROOT_ID);
  assert.equal(queued.approvalSnapshotKey, h.policy.alimtalkApprovalSnapshotKey(queued));
  assert.equal(queued.approvalGateMode, "below_threshold");
  assert.equal(h.store.get(approvalPath()), undefined);
  assert.equal((await h.claim(queued)).status, "processing");
  assert.equal(
    await h.issue({ ...queued, payload: { changed: "yes" } }),
    "approval_snapshot_changed",
  );
  assert.equal(
    await h.issue(candidate("1", { approvalGateMode: "below_threshold" })),
    "approval_legacy_binding_required",
  );
  assert.equal(
    await h.issue({ ...queued, approvalSnapshotKey: undefined }),
    "approval_binding_invalid",
  );
  const bound = {
    ...candidate("1"),
    ...h.binding.approvalCandidateBinding(candidate("1"), DATE),
  };
  assert.equal(await h.issue(bound), "approval_snapshot_not_approved");
  const independent = candidate("report", { type: "private_lesson_report" });
  assert.equal(
    await h.issue({
      ...independent,
      ...h.binding.approvalCandidateBinding(independent, DATE),
    }),
    "approval_snapshot_not_approved",
  );
});
