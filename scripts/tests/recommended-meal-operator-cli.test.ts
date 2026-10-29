import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const functionsRoot = new URL("firebase/kangsain-functions/functions/", root);
const ts = createRequire(new URL("package.json", functionsRoot))("typescript");
const cliSource = readFileSync(new URL("scripts/save-recommended-meal-operator-draft.ts", root), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;
const cliCode = compile(cliSource);
const programCode = compile(readFileSync(new URL("src/mealPlan/recommendedMealProgram.ts", functionsRoot), "utf8"))
  + "\nexports.testNormalize = normalizePublicContent;";
const hashCode = compile(readFileSync(new URL("src/utils/hash.ts", functionsRoot), "utf8"));
const ID = "meal-synthetic-cli-20261029-000000";
const MEMBER = "synthetic-native-member";
const NOW = Date.parse("2026-10-29T03:00:00.000Z");
const INPUT = "/synthetic-private/input.json";
const AUDIT = "/synthetic-private/audit/operator-draft-apply.json";
const PLAN = "/synthetic-private/audit/operator-draft-plan.json";
const collections = ["recommendedMealProgramRequests", "recommendedMealProgramResponses", "recommendedMealProgramDrafts", "recommendedMealProgramReports"];
const [REQUEST, RESPONSE, DRAFT, REPORT] = collections.map(name => `${name}/${ID}`);
const digest = (value: any) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
class Stamp {
  constructor(readonly ms: number) {}
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
}
function clone(value: any): any {
  if (value instanceof Stamp) return new Stamp(value.ms);
  if (Array.isArray(value)) return Array.from(value, clone);
  return value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
}
function evaluate(code: string, dependencies: Record<string, any>, globals: Record<string, any> = {}): any {
  const exports = {};
  vm.runInNewContext(code, { exports, Error, Buffer, URL,
    require: (id: string) => {
      assert.ok(Object.hasOwn(dependencies, id), `Forbidden import: ${id}`);
      return dependencies[id];
    }, ...globals,
  }, { timeout: 1000 });
  return exports;
}

function fixture({ reused = false, loseAcknowledgement = false } = {}) {
  const files = new Map<string, string>();
  const values = new Map<string, any>();
  const fsWrites: any[] = [];
  const dbWrites: any[] = [];
  const calls: any[] = [];
  const imports: string[] = [];
  const network: string[] = [];
  const originalContent = {
    title: "Synthetic plan", summary: "Synthetic summary", goal: "Synthetic goal", metricsSummary: "Synthetic metrics",
    principles: ["Synthetic principle"], days: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, label: `Day ${i + 1}`,
      breakfast: "Synthetic breakfast", lunch: "Synthetic lunch", dinner: "Synthetic dinner", snack: "Synthetic snack", timingTip: "Synthetic timing" })),
    hydration: "Synthetic water", exerciseNutrition: "Synthetic exercise", weekendStrategy: "Synthetic weekend", caution: "Synthetic caution",
  };
  // Deliberately different object ordering at both levels, with exactly the same values.
  const input = Object.fromEntries(Object.entries(originalContent).reverse());
  input.days = originalContent.days.map(row => Object.fromEntries(Object.entries(row).reverse()));
  files.set(INPUT, JSON.stringify(input));
  values.set(REQUEST, { requestId: ID, memberId: MEMBER, memberName: "Synthetic member", studioId: "5330", status: "submitted", candidateId: `${ID}-invite` });
  values.set(RESPONSE, { requestId: ID, memberId: MEMBER, studioId: "5330", answers: { schemaVersion: "meal-choice-v2", primaryGoal: "Synthetic choice" },
    reviewReasons: [], submittedAt: new Stamp(NOW - 1000) });
  values.set(REPORT, { reportId: ID, publicationStatus: "draft", approvalStatus: "draft" });
  const responseBefore = clone(values.get(RESPONSE));
  const doc = (refPath: string): any => ({ path: refPath,
    get: async () => ({ exists: values.has(refPath), data: () => clone(values.get(refPath)) }),
    collection: (name: string) => ({ doc: (id: string) => doc(`${refPath}/${name}/${id}`) }),
    set: () => { throw new Error("Nontransactional production write forbidden"); },
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`),
      where: (field: string, op: string, _value: string) => {
        assert.ok(collections.includes(name)); assert.equal(field, "memberName"); assert.equal(op, "==");
        return { limit: (count: number) => { assert.equal(count, 20); return { get: async () => ({ docs: [] }) }; } };
      },
    }),
    async runTransaction(callback: any) {
      const pending: any[] = [];
      const result = await callback({
        get: async (ref: any) => { assert.equal(pending.length, 0); return ref.get(); },
        set: (ref: any, value: any, options: any = {}) => {
          assert.ok([REQUEST, DRAFT, REPORT].includes(ref.path) || ref.path.startsWith(`${DRAFT}/revisions/`),
            `Response, candidate, send or unrelated write forbidden: ${ref.path}`);
          pending.push({ path: ref.path, value: clone(value), options });
        },
      });
      for (const write of pending) {
        values.set(write.path, write.options.merge ? { ...values.get(write.path), ...write.value } : write.value);
        dbWrites.push(write);
      }
      return result;
    },
  };
  const hash = evaluate(hashCode, { "node:crypto": { createHash } });
  class AppError extends Error { constructor(readonly code: string, message: string) { super(message); } }
  const program = evaluate(programCode, {
    "node:crypto": { createHash }, "firebase-admin/firestore": { Timestamp: Stamp }, "../config/firebase": { db },
    "../config/constants": { DEFAULT_STUDIO_ID: "5330" }, "../utils/date": { nowTimestamp: () => new Stamp(NOW) },
    "../utils/errors": { AppError, errorMessage: (error: any) => error.message }, "../utils/hash": hash,
    "./recommendedMealSurvey": { RECOMMENDED_MEAL_REQUEST_COLLECTION: collections[0], RECOMMENDED_MEAL_RESPONSE_COLLECTION: collections[1] },
  });
  const normalized = clone(program.testNormalize(input, input));
  const old = { requestId: ID, studioId: "5330", memberId: MEMBER, memberName: "Synthetic member",
    publicContent: reused ? normalized : { ...normalized, summary: "Previous synthetic draft" },
    revision: reused ? hash.stableHash({ sourceHash: program.mealResponseSourceHash(responseBefore), content: normalized }) : "a".repeat(64),
    sourceResponseHash: program.mealResponseSourceHash(responseBefore), provider: "operator_assisted", model: "codex-chat",
    reviewAcknowledgedAt: null, createdAt: new Stamp(NOW - 2000), status: "operator_edited", reviewReasons: [],
  };
  values.set(DRAFT, clone(old));
  const args = [`--request-id=${ID}`, `--member-id=${MEMBER}`, `--response-hash=${digest(responseBefore)}`,
    `--revision=${old.revision}`, `--input=${INPUT}`, "--audit-dir=/synthetic-private/audit"];
  const fsMock = {
    readFileSync: (file: string, encoding: string) => {
      assert.equal(encoding, "utf8"); assert.ok(files.has(file), `Synthetic file missing: ${file}`); return files.get(file);
    },
    mkdirSync: (dir: string, options: any) => { assert.equal(dir, "/synthetic-private/audit"); assert.equal(options.mode, 0o700); },
    writeFileSync: (file: string, contents: string, options: any) => {
      assert.ok([PLAN, AUDIT].includes(file)); assert.equal(options.mode, 0o600);
      fsWrites.push({ file, options: { ...options }, evidence: JSON.parse(contents) });
      if (options.flag === "wx" && files.has(file)) throw Object.assign(new Error("Synthetic exclusive claim exists"), { code: "EEXIST" });
      if (file === AUDIT && !files.has(file)) assert.equal(options.flag, "wx", "Apply intent must be exclusive before invoking the handler");
      files.set(file, contents);
    },
    existsSync: () => { throw new Error("A check-then-write replay guard is forbidden"); },
  };
  const backendImport = "../firebase/kangsain-functions/functions/src/mealPlan/recommendedMealProgram";
  const dependencies = {
    "node:fs": fsMock, "node:path": path, "node:crypto": { createHash },
    "../firebase/kangsain-functions/functions/src/utils/hash": hash,
    "../firebase/kangsain-functions/functions/src/config/firebase": { db },
    [backendImport]: {
      cleanRequestId: program.cleanRequestId, mealResponseSourceHash: program.mealResponseSourceHash,
      saveRecommendedMealProgramDraftHandler: async (request: any, actor: any) => {
        const evidence = JSON.parse(files.get(AUDIT)!);
        assert.ok(evidence.applyIntentAt); assert.equal(evidence.handlerReturned, undefined);
        assert.equal(request.data.authoringMode, "codex_operator"); assert.equal(request.data.reviewAcknowledged, false);
        assert.equal(actor.uid, "service:archive-codex-operator"); calls.push({ data: clone(request.data) });
        const result = await program.saveRecommendedMealProgramDraftHandler(request, actor);
        if (loseAcknowledgement) throw new Error("Synthetic unknown result after committed save");
        return result;
      },
    },
  };
  async function run(apply = false) {
    const output: string[] = [], errors: string[] = [];
    const processMock = { argv: ["synthetic-node", "synthetic-cli", ...args, ...(apply ? ["--apply"] : [])], exitCode: 0,
      env: { GOOGLE_CLOUD_PROJECT: "archive-pilates",
        GOOGLE_APPLICATION_CREDENTIALS: "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json" } };
    const completion = vm.runInNewContext(cliCode, {
      exports: {}, Error, process: processMock, console: { log: (line: string) => output.push(line), error: (line: string) => errors.push(line) },
      fetch: () => { network.push("fetch"); throw new Error("Network forbidden"); },
      require: (id: string) => {
        imports.push(id); assert.ok(Object.hasOwn(dependencies, id), `Forbidden CLI import: ${id}`);
        return dependencies[id as keyof typeof dependencies];
      },
    }, { timeout: 1000 });
    await completion;
    assert.deepEqual(values.get(RESPONSE), responseBefore); assert.deepEqual(network, []);
    return { exitCode: processMock.exitCode, output: output.map(line => JSON.parse(line)), errors };
  }
  return { run, files, values, old, input, normalized, fsWrites, dbWrites, calls, imports, responseBefore };
}

test("plan mode never invokes a backend write and creates private evidence only", async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.exitCode, 0); assert.equal(result.output[0].mode, "plan");
  assert.equal(f.calls.length, 0); assert.equal(f.dbWrites.length, 0); assert.equal(f.files.has(AUDIT), false);
  assert.deepEqual(f.fsWrites.map(row => row.file), [PLAN]);
});

test("property order differences in valid content pass actual normalized backend readback", async () => {
  const f = fixture(); assert.notEqual(digest(f.input), digest(f.normalized));
  await f.run(); const result = await f.run(true);
  assert.equal(result.exitCode, 0); assert.equal(result.output[0].verified, true);
  assert.equal(result.output[0].published, false); assert.equal(result.output[0].sent, false);
  assert.equal(f.calls.length, 1); assert.equal(f.dbWrites.length, 4);
  const history = f.values.get(`${DRAFT}/revisions/${f.old.revision}`);
  for (const [key, value] of Object.entries(f.old)) assert.deepEqual(history[key], value);
  assert.equal(JSON.parse(f.files.get(AUDIT)!).previousDraftArchived, true);
});

test("exclusive intent exists before backend invocation and successful applies cannot be replayed", async () => {
  const f = fixture(); await f.run(); assert.equal((await f.run(true)).exitCode, 0);
  const firstIntent = f.fsWrites.find(row => row.file === AUDIT);
  assert.equal(firstIntent.options.flag, "wx");
  const evidence = f.files.get(AUDIT); const writes = f.dbWrites.length;
  assert.equal((await f.run(true)).exitCode, 1);
  assert.equal(f.calls.length, 1); assert.equal(f.dbWrites.length, writes); assert.equal(f.files.get(AUDIT), evidence);
});

test("preexisting ambiguous intent is never overwritten or dispatched again", async () => {
  const f = fixture(); await f.run(); const intent = JSON.stringify({ applyIntentAt: "synthetic-unknown", unknown: true });
  f.files.set(AUDIT, intent); const result = await f.run(true);
  assert.equal(result.exitCode, 1); assert.equal(f.files.get(AUDIT), intent);
  assert.equal(f.calls.length, 0); assert.equal(f.dbWrites.length, 0);
  assert.equal(f.fsWrites.at(-1).options.flag, "wx");
});

test("two simultaneous applies have at most one exclusive claimant and backend invocation", async () => {
  const f = fixture(); await f.run(); const results = await Promise.all([f.run(true), f.run(true)]);
  assert.deepEqual(results.map(row => row.exitCode).sort(), [0, 1]);
  assert.equal(f.calls.length, 1); assert.equal(f.dbWrites.length, 4);
  assert.equal(JSON.parse(f.files.get(AUDIT)!).verified, true);
});

test("reused unchanged draft is accepted without manufacturing a revision history document", async () => {
  const f = fixture({ reused: true }); const before = clone([...f.values]);
  await f.run(); const result = await f.run(true);
  assert.equal(result.exitCode, 0); assert.equal(result.output[0].verified, true);
  assert.deepEqual([...f.values], before); assert.equal(f.dbWrites.length, 0);
  assert.equal(f.values.has(`${DRAFT}/revisions/${f.old.revision}`), false);
  assert.equal(JSON.parse(f.files.get(AUDIT)!).previousDraftArchived, true);
});

test("lost acknowledgement retains the intent, preserves response and stops a second backend call", async () => {
  const f = fixture({ loseAcknowledgement: true }); await f.run();
  assert.equal((await f.run(true)).exitCode, 1); assert.equal(f.calls.length, 1);
  const intent = f.files.get(AUDIT)!; assert.ok(JSON.parse(intent).applyIntentAt);
  assert.equal(JSON.parse(intent).handlerReturned, undefined);
  assert.equal((await f.run(true)).exitCode, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.files.get(AUDIT), intent); assert.deepEqual(f.values.get(RESPONSE), f.responseBefore);
});

test("CLI imports only read/hash helpers and the draft-save entrypoint, never send, publish or model APIs", async () => {
  const tree = ts.createSourceFile("cli.ts", cliSource, ts.ScriptTarget.ES2022, true);
  const backendImport = tree.statements.find((node: any) => ts.isImportDeclaration(node)
    && node.moduleSpecifier.text.endsWith("/mealPlan/recommendedMealProgram"));
  assert.deepEqual(backendImport.importClause.namedBindings.elements.map((item: any) => item.name.text).sort(),
    ["cleanRequestId", "mealResponseSourceHash", "saveRecommendedMealProgramDraftHandler"].sort());
  const f = fixture(); await f.run(); assert.equal((await f.run(true)).exitCode, 0);
  assert.ok(f.imports.every(id => !/secrets|firebase-admin|solapi|ReportAlimtalk|generativelanguage/i.test(id)));
  assert.ok(f.dbWrites.every(row => row.path !== RESPONSE && !/alimtalkCandidates|alimtalkSends/.test(row.path)));
  assert.equal(f.values.get(REPORT).publicationStatus, "draft"); assert.equal(f.values.get(REPORT).approvalStatus, "draft");
});
