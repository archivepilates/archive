import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("../../firebase/kangsain-functions/functions/node_modules/typescript");
const sourceUrl = new URL("../../firebase/kangsain-functions/functions/src/privateSurvey/privateSurveyResponse.ts", import.meta.url);
const source = ts.createSourceFile("privateSurveyResponse.ts", readFileSync(sourceUrl, "utf8"), ts.ScriptTarget.Latest, true);
const checkpointSource = readFileSync(new URL("../../firebase/kangsain-functions/functions/src/privateSurvey/sheetSyncCheckpoint.ts", import.meta.url), "utf8");
const names = [
  "syncPrivateSurveyResponsesFromSheet", "readSurveySheet", "ensureHeaderMap", "ensureSheetHeaders",
  "answersFromRow", "firstFilled", "updateSheetOutput", "writeSheetValues", "cell", "columnName",
];
const headerDeclaration = source.statements.find((statement) => ts.isVariableStatement(statement) &&
  statement.declarationList.declarations.some((declaration) => declaration.name.getText(source) === "OUTPUT_HEADERS"));
assert.ok(headerDeclaration);
// Compile the real orchestration and helpers without loading production clients or secrets.
const code = ts.transpileModule([
  checkpointSource,
  headerDeclaration.getText(source),
  ...names.map((name) => {
    const declaration = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(declaration, name);
    return declaration.getText(source);
  }),
  "exports.outputHeaders = OUTPUT_HEADERS;",
].join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const inputHeaders = ["타임스탬프", "1. 성함을 입력해주세요", "2. 연락처를 입력해주세요"];
const submission = ["2026-09-27 10:00:00", "Test Member", "01000000000"];
const now = 100_000_000;

function fixture({ rows, metadataError = false, checkpointReadError = false, checkpointWriteError = false,
  concurrentEdit = false, checkpoint, revision = 12 } = {}) {
  const state = { rows: rows ? structuredClone(rows) : null, revision, checkpoint: checkpoint ? { ...checkpoint } : undefined,
    metadataReads: 0, scans: 0, headerWrites: 0, outputWrites: 0, checkpointWrites: 0, intakes: new Map(), warnings: [] };
  const context = {
    exports: {}, encodeURIComponent, Date: class extends Date { static now() { return now; } },
    PRIVATE_SURVEY_SPREADSHEET_ID: "fixture", PRIVATE_SURVEY_SHEET_NAME: "fixture",
    stableHash: () => "fixture", normalizePhone: (value) => value.replace(/\D/g, ""),
    normalizePayload: (payload) => payload, responseIdFor: () => "fixture-response",
    accessTokenFor: () => "fixture-token", detailUrlFor: () => "https://example.invalid/survey",
    nowTimestamp: () => now, kstNowText: () => "fixture-time",
    logger: { info() {}, warn(message) { state.warnings.push(message); } },
    db: { collection(name) {
      assert.ok(["syncStates", "privateSurveyIntakes"].includes(name), name);
      return { doc(id) {
        if (name === "privateSurveyIntakes") return { async set(data) { state.intakes.set(id, data); } };
        return {
          async get() {
            if (checkpointReadError) throw new Error("checkpoint read unavailable");
            return { data: () => state.checkpoint };
          },
          async set(data) {
            state.checkpointWrites++;
            if (checkpointWriteError) throw new Error("checkpoint write unavailable");
            state.checkpoint = { ...data };
          },
        };
      } };
    } },
    DelegatedGoogleClient: class {
      async request(url, init = {}) {
        if (url.startsWith("https://www.googleapis.com/drive/v3/files/")) {
          state.metadataReads++;
          if (metadataError) throw new Error("Drive metadata unavailable");
          return { version: String(state.revision) };
        }
        assert.ok(url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/"));
        if (init.method === "PUT") {
          const { range, values } = JSON.parse(init.body);
          const match = range.match(/!([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
          assert.ok(match, range);
          const row = Number(match[2]) - 1;
          const column = [...match[1]].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
          assert.equal(match[2], match[4]);
          state.rows[row] ||= [];
          values[0].forEach((value, index) => { state.rows[row][column + index] = value; });
          state[row === 0 ? "headerWrites" : "outputWrites"]++;
          state.revision++;
          return {};
        }
        assert.equal(init.method, undefined);
        state.scans++;
        const values = structuredClone(state.rows);
        if (concurrentEdit && state.scans === 1) {
          state.rows.push([...submission]);
          state.revision++;
        }
        return { values };
      }
    },
  };
  vm.runInNewContext(code, context);
  const outputHeaders = Array.from(context.exports.outputHeaders);
  state.rows ||= [[...inputHeaders, ...outputHeaders]];
  return { state, outputHeaders, run: async () => {
    const result = await context.exports.syncPrivateSurveyResponsesFromSheet();
    return { processed: result.processed, skipped: result.skipped };
  } };
}

test("unchanged two-run scan writes no headers and reuses a fresh checkpoint", async () => {
  const { state, run } = fixture();
  assert.deepEqual(await run(), { processed: 0, skipped: 0 });
  assert.deepEqual(state.checkpoint, { version: "12", checkedAtMillis: now });
  assert.deepEqual(await run(), { processed: 0, skipped: 0 });
  assert.equal(state.metadataReads, 2);
  assert.equal(state.scans, 1);
  assert.equal(state.headerWrites, 0);
  assert.equal(state.checkpointWrites, 1);
});

test("missing headers are written once, preserve existing columns, then settle to a checkpoint", async () => {
  const { state, run, outputHeaders } = fixture({ rows: [[...inputHeaders, "설문ID", "operator notes"]] });
  await run();
  assert.deepEqual(state.rows[0], [...inputHeaders, "설문ID", "operator notes", ...outputHeaders.slice(1)]);
  assert.equal(state.headerWrites, 1);
  assert.equal(state.checkpoint.version, "12");
  assert.equal(state.revision, 13);
  await run();
  await run();
  assert.equal(state.scans, 2);
  assert.equal(state.headerWrites, 1);
  assert.equal(state.checkpoint.version, "13");
});

test("metadata failure falls back to ingestion and does not advance an old checkpoint", async () => {
  const { state, run } = fixture({ metadataError: true, checkpoint: { version: "11", checkedAtMillis: now - 1 } });
  state.rows.push([...submission]);
  assert.deepEqual(await run(), { processed: 1, skipped: 0 });
  assert.equal(state.intakes.size, 1);
  assert.equal(state.outputWrites, 1);
  assert.equal(state.checkpointWrites, 0);
  assert.equal(state.checkpoint.version, "11");
  assert.equal(state.warnings.length, 1);
});

test("checkpoint read failure falls back to a full scan", async () => {
  const { state, run } = fixture({ checkpointReadError: true });
  assert.deepEqual(await run(), { processed: 0, skipped: 0 });
  assert.equal(state.scans, 1);
  assert.equal(state.warnings.length, 1);
});

test("checkpoint write failure warns without failing ingestion or replaying its output", async () => {
  const { state, run } = fixture({ checkpointWriteError: true });
  state.rows.push([...submission]);
  assert.deepEqual(await run(), { processed: 1, skipped: 0 });
  assert.equal(state.intakes.size, 1);
  assert.equal(state.checkpoint, undefined);
  assert.match(state.warnings[0], /checkpoint persistence unavailable/);
  assert.deepEqual(await run(), { processed: 0, skipped: 1 });
  assert.equal(state.scans, 2);
  assert.equal(state.outputWrites, 1);
  assert.equal(state.checkpointWrites, 2);
});

test("output revision forces the next scan without re-enqueueing the processed response", async () => {
  const { state, run } = fixture();
  state.rows.push([...submission]);
  assert.deepEqual(await run(), { processed: 1, skipped: 0 });
  assert.equal(state.revision, 13);
  assert.equal(state.checkpoint.version, "12");
  assert.deepEqual(await run(), { processed: 0, skipped: 1 });
  await run();
  assert.equal(state.scans, 2);
  assert.equal(state.outputWrites, 1);
  assert.equal(state.checkpoint.version, "13");
});

test("concurrent edit after the sheet read cannot be hidden by the saved checkpoint", async () => {
  const { state, run } = fixture({ concurrentEdit: true });
  assert.deepEqual(await run(), { processed: 0, skipped: 0 });
  assert.equal(state.checkpoint.version, "12");
  assert.equal(state.revision, 13);
  assert.deepEqual(await run(), { processed: 1, skipped: 0 });
  assert.equal(state.scans, 2);
  assert.equal(state.intakes.size, 1);
  assert.equal(state.checkpoint.version, "13");
  assert.equal(state.revision, 14);
});

test("expired and future checkpoints cannot skip an unchanged sheet", async () => {
  for (const checkedAtMillis of [now - 86_400_000, now + 1]) {
    const { state, run } = fixture({ checkpoint: { version: "12", checkedAtMillis } });
    await run();
    assert.equal(state.scans, 1);
    assert.equal(state.headerWrites, 0);
    assert.equal(state.checkpoint.checkedAtMillis, now);
  }
});

test("invalid responses do not advance the checkpoint", async () => {
  const { state, run } = fixture();
  state.rows.push([submission[0], "", ""]);
  assert.deepEqual(await run(), { processed: 0, skipped: 1 });
  assert.equal(state.outputWrites, 1);
  assert.equal(state.checkpointWrites, 0);
});
