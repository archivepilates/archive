import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readerPath = "scripts/lib/studiomate-holding-reader.mjs";
const require = createRequire(new URL("../../firebase/kangsain-functions/functions/package.json", import.meta.url));
const ts = require("typescript");
const names = ["extractHoldingHistoryDom", "extractRegisteredHoldsDom"];
// Fixed pre-fix revision: a moving HEAD would silently lose the negative control.
const originalRevision = "354223f384c40f20b440f7b1d5760be311346437";
const childEnv = { PATH: process.env.PATH, TSX_DISABLE_CACHE: "1" };
const currentSource = readFileSync(new URL(`../../${readerPath}`, import.meta.url), "utf8");
const originalSource = execFileSync("git", ["show", `${originalRevision}:${readerPath}`], {
  cwd: root, env: childEnv, encoding: "utf8", timeout: 10_000,
});

function transformedCallbacks(source, keepNames) {
  const tree = ts.createSourceFile(readerPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = names.map(name => {
    const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, `Missing production callback: ${name}`);
    return node.getText(tree);
  });
  const { code } = transformSync(declarations.join("\n"), {
    loader: "js", format: "cjs", target: "es2022", keepNames, minifyWhitespace: true,
  });
  const module = { exports: {} };
  runInNewContext(code, { module }, { timeout: 1000 });
  return Object.fromEntries(names.map(name => [name, module.exports[name].toString()]));
}

function runtimeCallbacks() {
  // Import only the pure reader, never the worker/launcher that initializes DB or browser state.
  const script = `const reader = require(${JSON.stringify(`./${readerPath}`)});
    console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(name => [name, reader[name].toString()]))));`;
  return JSON.parse(execFileSync(process.execPath, [
    "firebase/kangsain-functions/functions/node_modules/tsx/dist/cli.mjs", "--eval", script,
  ], { cwd: root, env: childEnv, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 }));
}

function element(text = "", selectors = {}, properties = {}) {
  return {
    textContent: text, innerText: text,
    getClientRects() { return properties.hidden ? [] : [{}]; },
    querySelectorAll(selector) {
      assert.ok(Object.hasOwn(selectors, selector), `Unmodeled synthetic DOM selector: ${selector}`);
      return selectors[selector];
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    ...properties,
  };
}

const historyRows = [
  { at: "2026. 1. 1. 09:00", staff: "Synthetic operator", type: "발급", changes: [
    { field: "이용시작일", before: "내역없음", after: "2026. 1. 1." },
    { field: "이용종료일", before: "내역없음", after: "2026. 12. 31." },
  ] },
  { at: "2026. 10. 1. 10:00", staff: "Synthetic operator", type: "수강권정지", changes: [
    { field: "정지시작일", before: "내역없음", after: "2026. 10. 7." },
    { field: "정지종료일", before: "내역없음", after: "2026. 10. 31." },
  ] },
  { at: "2026. 10. 2. 11:00", staff: "Synthetic operator", type: "수강권정지수정", changes: [
    { field: "정지종료일", before: "2026. 10. 31.", after: "2026. 10. 16." },
  ] },
];

function historyDocument({ active = "변경이력", headers = ["변경일시", "스태프", "종류", "내용"],
  dialogs = 1, tables = 1, columns = 4, spans = 2, pagination = false, rows = historyRows } = {}) {
  const renderedRows = rows.map(row => element("", { td: [
    ...[row.at, row.staff, row.type].map(text => element(` ${text} `)),
    element("", { "li.content": row.changes.map(change => element("", {
      label: [element(` ${change.field} `)],
      span: [element(` ${change.before} `), element(` ${change.after} `)].slice(0, spans),
    })) }),
  ].slice(0, columns) }));
  const dialog = element("", {
    ".ticket-edit-modal__tabs .active": [element(active)],
    "table.el-table__body": [
      ...Array.from({ length: tables }, () => element("", { "tbody tr": renderedRows })),
      element("", {}, { hidden: true }),
    ],
    "table.el-table__header th": headers.map(text => element(text)),
    ".el-pagination": [element("", {}, { hidden: !pagination })],
    h3: [element(" Synthetic pass ")],
  });
  return element("", { '[role="dialog"]': [
    ...Array.from({ length: dialogs }, () => dialog), element("", {}, { hidden: true }),
  ] });
}

function holdsDocument({ active = "정지기간정보", dialogs = 1, lists = 1,
  rows = ["2026. 10. 7. ~ 2026. 10. 16. (10일 정지)"], start = "2026. 10. 7.",
  end = "2026. 10. 16.", disabled = true, readOnly = false, starts = 1, ends = 1, pagination = false } = {}) {
  const dialog = element("", {
    ".ticket-edit-modal__tabs .active": [element(active)],
    ".holding-detail__holding-list": [
      ...Array.from({ length: lists }, () => element("", {}, { children: rows.map(text => element(text)) })),
      element("", {}, { hidden: true }),
    ],
    '.holding-detail__form__element.start_date input[placeholder="정지 시작일"]': [
      ...Array.from({ length: starts }, () => element("", {}, { value: ` ${start} `, disabled, readOnly })),
      element("", {}, { hidden: true }),
    ],
    '.holding-detail__form__element.end_date input[placeholder="정지 종료일"]': [
      ...Array.from({ length: ends }, () => element("", {}, { value: ` ${end} `, disabled: false, readOnly: false })),
      element("", {}, { hidden: true }),
    ],
    ".el-pagination": [element("", {}, { hidden: !pagination })],
  });
  return element("", { '[role="dialog"]': [
    ...Array.from({ length: dialogs }, () => dialog), element("", {}, { hidden: true }),
  ] });
}

function evaluate(serialized, document) {
  assert.equal(typeof serialized, "string");
  // Only the serialized callback crosses realms, as in page.evaluate. No __name/Node globals.
  return JSON.parse(runInNewContext(`JSON.stringify((${serialized})())`, { document }, {
    timeout: 1000, contextCodeGeneration: { strings: false, wasm: false },
  }));
}

for (const [mode, callbacks] of [
  ["runtime tsx CLI .mjs import", runtimeCallbacks()],
  ["esbuild keepNames:true", transformedCallbacks(currentSource, true)],
]) {
  const history = options => evaluate(callbacks.extractHoldingHistoryDom, historyDocument(options));
  const holds = options => evaluate(callbacks.extractRegisteredHoldsDom, holdsDocument(options));

  test(`${mode}: full history preserves every row, change field, before/after and order`, () => {
    assert.deepEqual(history(), { history: historyRows, paginationPresent: false, ticketName: "Synthetic pass" });
    assert.deepEqual(history({ rows: [] }).history, []);
    assert.equal(history({ pagination: true }).paginationPresent, true);
  });

  for (const [label, options, error] of [
    ["no visible dialog", { dialogs: 0 }, "single_ticket_dialog_required"],
    ["multiple visible dialogs", { dialogs: 2 }, "single_ticket_dialog_required"],
    ["wrong tab", { active: "정지기간정보" }, "ticket_history_layout_changed"],
    ["changed headers", { headers: ["내용", "종류", "스태프", "변경일시"] }, "ticket_history_layout_changed"],
    ["missing history table", { tables: 0 }, "ticket_history_layout_changed"],
    ["multiple history tables", { tables: 2 }, "ticket_history_layout_changed"],
    ["missing column", { columns: 3 }, "history_column_mismatch"],
    ["missing before/after span", { spans: 1 }, "history_change_layout_changed"],
  ]) {
    test(`${mode}: history rejects ${label}`, () => {
      assert.throws(() => history(options), { name: "Error", message: error });
    });
  }

  test(`${mode}: holds preserve ranges/current controls and visible pagination`, () => {
    assert.deepEqual(holds(), {
      activeHolds: [{ start: "2026. 10. 7.", end: "2026. 10. 16." }],
      currentHold: { start: "2026. 10. 7.", end: "2026. 10. 16." },
      currentControlState: { disabled: true, readOnly: false }, paginationPresent: false,
    });
    assert.equal(holds({ pagination: true }).paginationPresent, true);
    assert.deepEqual(holds({ rows: [], start: "", end: "", disabled: false }), {
      activeHolds: [], currentHold: null,
      currentControlState: { disabled: false, readOnly: false }, paginationPresent: false,
    });
    assert.deepEqual(holds({ disabled: false, readOnly: true }).currentControlState,
      { disabled: false, readOnly: true });
  });

  test(`${mode}: displayed days are inclusive across leap-day and year boundaries`, () => {
    const result = holds({ rows: [
      "2024. 2. 28. ~ 2024. 3. 1. (3일 정지)",
      "2026. 12. 31. ~ 2027. 1. 1. (2일 정지)",
      "2026. 10. 7. ~ 2026. 10. 7. (1일 정지)",
    ], start: "", end: "" });
    assert.deepEqual(result.activeHolds, [
      { start: "2024. 2. 28.", end: "2024. 3. 1." },
      { start: "2026. 12. 31.", end: "2027. 1. 1." },
      { start: "2026. 10. 7.", end: "2026. 10. 7." },
    ]);
  });

  for (const [label, options, error] of [
    ["no visible dialog", { dialogs: 0 }, "single_ticket_dialog_required"],
    ["multiple visible dialogs", { dialogs: 2 }, "single_ticket_dialog_required"],
    ["wrong tab", { active: "변경이력" }, "hold_tab_not_ready"],
    ["missing complete list", { lists: 0 }, "complete_hold_list_required"],
    ["multiple complete lists", { lists: 2 }, "complete_hold_list_required"],
    ["partial row dates", { rows: ["2026. 10. 7. (10일 정지)"] }, "hold_row_layout_changed"],
    ["missing day label", { rows: ["2026. 10. 7. ~ 2026. 10. 16."] }, "hold_row_layout_changed"],
    ["wrong displayed duration", { rows: ["2026. 10. 7. ~ 2026. 10. 16. (25일 정지)"] }, "hold_displayed_days_mismatch"],
    ["exclusive rather than inclusive duration", { rows: ["2026. 10. 7. ~ 2026. 10. 16. (9일 정지)"] }, "hold_displayed_days_mismatch"],
    ["missing start control", { starts: 0 }, "single_current_hold_controls_required"],
    ["duplicate start controls", { starts: 2 }, "single_current_hold_controls_required"],
    ["missing end control", { ends: 0 }, "single_current_hold_controls_required"],
    ["duplicate end controls", { ends: 2 }, "single_current_hold_controls_required"],
    ["start without end", { end: "" }, "incomplete_current_hold_controls"],
    ["end without start", { start: "" }, "incomplete_current_hold_controls"],
    ["uncommitted editable dates", { disabled: false }, "uncommitted_current_hold_controls"],
  ]) {
    test(`${mode}: holds reject ${label}`, () => {
      assert.throws(() => holds(options), { name: "Error", message: error });
    });
  }
}

for (const name of names) {
  test(`negative control: original ${name} works without keepNames but fails serialized keepNames output`, () => {
    const document = name === "extractHoldingHistoryDom" ? historyDocument() : holdsDocument();
    const native = transformedCallbacks(originalSource, false)[name];
    const transformed = transformedCallbacks(originalSource, true)[name];
    const expected = name === "extractHoldingHistoryDom"
      ? { history: historyRows, paginationPresent: false, ticketName: "Synthetic pass" }
      : {
        activeHolds: [{ start: "2026. 10. 7.", end: "2026. 10. 16." }],
        currentHold: { start: "2026. 10. 7.", end: "2026. 10. 16." },
        currentControlState: { disabled: true, readOnly: false }, paginationPresent: false,
      };
    assert.deepEqual(evaluate(native, document), expected);
    assert.match(transformed, /\b__name\(/);
    assert.throws(() => evaluate(transformed, document), { name: "ReferenceError", message: "__name is not defined" });
  });
}
