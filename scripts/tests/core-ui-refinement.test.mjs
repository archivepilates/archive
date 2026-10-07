import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const baseline = (file) => git("show", `origin/main:${file}`);
const current = (file) => fs.readFileSync(path.join(root, file), "utf8");
const appFile = "core/assets/app.js";
const originalApp = baseline(appFile);
const htmlFiles = git("ls-tree", "-r", "--name-only", "origin/main", "core").trim().split("\n").filter((file) => file.endsWith(".html"));
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

// These checked-in documents use explicit tags. Ignore raw-text bodies so JS/PDF
// templates inside sequence/studio.html never become fictitious HTML contracts.
function contracts(html, runtime = "") {
  const result = { ids: [], fields: [], actions: [], scripts: [], styles: [] };
  const stack = [];
  const tags = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-z][^>]*>/gi;
  for (const match of html.matchAll(tags)) {
    const token = match[0];
    if (token.startsWith("<!--")) continue;
    const tag = token.match(/^<\/?([\w-]+)/)[1].toLowerCase();
    if (token.startsWith("</")) {
      const index = stack.findLastIndex((item) => item.tag === tag);
      if (index >= 0) stack.length = index;
      continue;
    }
    const opening = token.match(/^<[^>]*>/)[0];
    const attrs = Object.fromEntries([...opening.slice(tag.length + 1, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
      .map((attribute) => [attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? ""]));
    const form = attrs.form || stack.findLast((item) => item.tag === "form")?.attrs.id || "";
    const referenced = attrs.id && (runtime.includes(attrs.id) || new RegExp(`(?:aria-[\\w-]+|for|href)=["'][^"']*\\b${attrs.id}\\b`).test(html));
    const decorative = tag === "p" && !referenced && !attrs.role && !Object.keys(attrs).some((key) => key.startsWith("data-"));
    if (attrs.id && !decorative) result.ids.push(attrs.id);
    if (["input", "select", "textarea", "button", "output"].includes(tag) && attrs.name) {
      result.fields.push(JSON.stringify([form, tag, attrs.id || "", attrs.name, attrs.type || ""]));
    }
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith("data-") || (tag === "form" && ["action", "method"].includes(key))) {
        result.actions.push(JSON.stringify([tag, attrs.id || attrs.name || "", form, tag === "a" ? attrs.href : "", key, value]));
      }
    }
    if (tag === "script") result.scripts.push(JSON.stringify([attrs.src || "", attrs.type || "", attrs.src ? "" : token.slice(opening.length).replace(/<\/script\s*>$/i, "").trim()]));
    if (tag === "link" && attrs.rel === "stylesheet") result.styles.push(attrs.href);
    if (!["script", "style"].includes(tag) && !voidTags.has(tag) && !opening.endsWith("/>")) stack.push({ tag, attrs });
  }
  return result;
}

function retains(actual, expected, label) {
  const counts = new Map();
  for (const value of actual) counts.set(value, (counts.get(value) || 0) + 1);
  for (const value of expected) {
    assert.ok(counts.get(value) > 0, `${label}: removed or rebound ${value}`);
    counts.set(value, counts.get(value) - 1);
  }
}

test("contract scanner ignores inline template markup and permits unreferenced prose removal", () => {
  const scanned = contracts('<form id="f"><input name="phone" data-action="lookup"></form><p id="decoration">Copy</p><script>const html = `<input id="fake">`;</script>');
  assert.deepEqual(scanned.ids, ["f"]);
  assert.deepEqual(scanned.fields, [JSON.stringify(["f", "input", "", "phone", ""])]);
  assert.throws(() => retains([], scanned.fields, "field"), /removed or rebound/);
});

for (const file of htmlFiles) {
  test(`${file}: preserves operational IDs, named fields, action attributes and scripts`, () => {
    const before = contracts(baseline(file), originalApp);
    const after = contracts(current(file), current(appFile));
    for (const kind of ["ids", "fields", "actions"]) retains(after[kind], before[kind], `${file}/${kind}`);
    assert.equal(new Set(after.ids).size, after.ids.length, `${file}: duplicate operational ID`);
    assert.deepEqual(after.scripts, before.scripts, `${file}: runtime scripts are not visual-only changes`);
    if (/class=["'][^"']*\bshell\b/.test(baseline(file))) {
      assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(file), (after.styles.at(-1) || "").split("?")[0])), "core/assets/interface.css", `${file}: shared interface stylesheet must load last`);
    }
  });
}

test("UI feature changes do not include Firebase, permissions, packages or deployment config", () => {
  const changed = [...git("diff", "--name-only", "origin/main", "--").split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean);
  const allowed = /^(?:core\/(?:.+\.(?:html|css)|assets\/(?:app|ui-icons)\.js|assets\/alimtalk-catalog\.json)|scripts\/(?:tests\/(?:core-ui-refinement|core-operator-workflow)\.test\.mjs|verify-core-ui-refinement\.mjs|preview-core-ui\.mjs)|docs\/(?:tasks|reports)\/[^/]+\.(?:md|html)|artifacts\/qa\/.*)$/;
  assert.deepEqual(changed.filter((file) => !allowed.test(file)), [], "non-UI change requires separate review");
});

test("generated catalog changes only app fingerprint and app source line metadata", () => {
  const file = "core/assets/alimtalk-catalog.json";
  const before = JSON.parse(baseline(file));
  const after = JSON.parse(current(file));
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(after.policyFingerprint, hash(JSON.stringify(after.sourceFingerprints)), "catalog fingerprint matches its sources");
  assert.equal(after.sourceFingerprints.find((item) => item.path === appFile)?.sha256, hash(current(appFile)), "catalog app hash is current");
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key === "policyFingerprint" || (key === "sha256" && value.path === appFile)) return [key, "app-ui-fingerprint"];
      if (key === "line" && value.path === appFile && value.symbol === "ALIMTALK_TEMPLATE_LABELS_BY_CODE") return [key, "app-source-line"];
      return [key, normalize(item)];
    }));
  };
  assert.deepEqual(normalize(after), normalize(before), "catalog rules, templates, flags and non-app sources must not change");
  const expectedLine = current(appFile).split("\n").findIndex((line) => line.startsWith("const ALIMTALK_TEMPLATE_LABELS_BY_CODE =")) + 1;
  for (const row of after.rows) for (const source of row.sources || []) {
    if (source.path === appFile && source.symbol === "ALIMTALK_TEMPLATE_LABELS_BY_CODE") assert.equal(source.line, expectedLine);
  }
});

test("reviewed VM harness adaptation preserves existing regression assertions", () => {
  const file = "scripts/tests/core-operator-workflow.test.mjs";
  const normalizeHarness = (source) => source.split("function app() {")[1]?.replace("${testSource}", "${source.slice(0, end)}");
  const before = normalizeHarness(baseline(file));
  const after = normalizeHarness(current(file));
  assert.ok(before, "baseline regression fixture recognized");
  assert.equal(after, before, "only harness setup and its VM source binding may change");
});

test("icons are vendored locally without runtime network loading", () => {
  assert.match(current(appFile), /import\s*\{\s*uiIcon\s*\}\s*from\s*["']\.\/ui-icons\.js["']/);
  const icons = current("core/assets/ui-icons.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(icons, /\b(?:fetch|XMLHttpRequest|WebSocket|import)\b/);
  for (const name of ["menu", "search", "refresh-cw"]) assert.ok(icons.includes(`"${name}"`), `${name}: icon contract`);
});

test("Firebase/auth/read/write runtime contracts remain baseline-identical", () => {
  const source = current(appFile);
  const functions = (text) => new Map([...text.matchAll(/^(?:async )?function (\w+)\([^]*?^\}/gm)].map((match) => [match[1], match[0]]));
  const before = functions(originalApp);
  const after = functions(source);
  const runtimeBody = (name, body) => name === "refresh"
    ? body?.split("delete document.body.dataset.sourceHealth;")[1]?.split("} finally {")[0]
    : body;
  const sensitive = /\b(?:httpsCallable|setDoc|updateDoc|deleteDoc|getDoc|getDocs|onAuthStateChanged|signInWithEmailAndPassword|isPermissionDenied)\b|KANGSAIN_FIREBASE_CONFIG|permission-denied/;
  for (const [name, body] of before) {
    if (name === "ensureLoginGate" || !sensitive.test(body)) continue;
    assert.ok(runtimeBody(name, body), `${name}: baseline runtime must be recognized`);
    assert.equal(runtimeBody(name, after.get(name)), runtimeBody(name, body), `${name}: non-visual runtime change`);
  }
  for (const [name, body] of after) {
    if (name !== "ensureLoginGate" && sensitive.test(body)) assert.ok(before.has(name), `${name}: new runtime access needs review`);
  }
  const loginHandler = (text) => text.match(/qs\("coreLoginForm"\)\?\.addEventListener\("submit",[^]*?\n  \}\);/)?.[0];
  assert.ok(loginHandler(originalApp), "baseline login handler must be recognized");
  assert.equal(loginHandler(source), loginHandler(originalApp), "login markup may change, auth handler may not");
  for (const constant of ["FIREBASE_APP_VERSION", "CORE_RUNTIME_CONTRACT_VERSION", "WORK_LANE_ID", "STUDIO_ID"]) {
    const expression = new RegExp(`^const ${constant} = .+;$`, "m");
    assert.equal(source.match(expression)?.[0], originalApp.match(expression)?.[0], constant);
  }
  assert.match(after.get("refresh"), /refreshButton\.setAttribute\("aria-busy", "true"\)/);
  assert.match(after.get("refresh"), /refreshButton\.removeAttribute\("aria-busy"\)/);
});
