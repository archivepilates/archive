import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Snapshot once, with no Git status/baseline assertions that race the main editor.
const sources = ["assets/interface.css", "assets/styles.css", "private/private.css"].map((file) => ({
  file, css: fs.readFileSync(new URL(`../../core/${file}`, import.meta.url), "utf8"),
}));
const interfaceRules = rules(sources[0].css);
const allRules = sources.flatMap(({ file, css }) => rules(css).map((rule) => ({ ...rule, file })));
const tokens = Object.assign({}, ...interfaceRules.filter((rule) => rule.selector === ":root").map((rule) => rule.declarations));
const verifier = fs.readFileSync(new URL("../verify-core-crm-motion.mjs", import.meta.url), "utf8");
const normal = (rule) => rule.context.some((context) => /prefers-reduced-motion\s*:\s*no-preference/.test(context));
const reduced = (rule) => rule.context.some((context) => /prefers-reduced-motion\s*:\s*reduce\b/.test(context));
const keyframe = (rule) => rule.context.some((context) => /^@(?:-webkit-)?keyframes\b/.test(context));
const resolve = (value) => value.replace(/var\((--[\w-]+)\)/g, (_, token) => {
  assert.ok(tokens[token], `unresolved motion token ${token}`);
  return tokens[token];
});
const time = (value) => {
  assert.match(value, /^-?\d*\.?\d+(ms|s)$/i, `literal time expected: ${value}`);
  return parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
};

// Small structural scanner for authored CSS: preserve media/keyframe ancestry,
// and split only outside strings/functions (cubic-bezier commas are not lists).
function split(value, delimiter) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\") { index += 1; continue; }
    if (quote) { if (char === quote) quote = undefined; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (!depth && char === delimiter) { parts.push(value.slice(start, index).trim()); start = index + 1; }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function rules(source, context = []) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const result = [];
  let start = 0;
  let open = -1;
  let depth = 0;
  let quote;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === "\\") { index += 1; continue; }
    if (quote) { if (char === quote) quote = undefined; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (!depth && char === ";") { start = index + 1; continue; }
    if (char === "{") { if (!depth) open = index; depth += 1; }
    if (char !== "}") continue;
    depth -= 1;
    assert.ok(depth >= 0, "balanced CSS braces");
    if (depth) continue;
    const selector = css.slice(start, open).trim();
    const body = css.slice(open + 1, index);
    if (/^@(?:media|supports|layer|container|(?:-webkit-)?keyframes)\b/.test(selector)) result.push(...rules(body, [...context, selector]));
    else {
      const declarations = {};
      for (const entry of split(body, ";")) {
        const colon = entry.indexOf(":");
        assert.ok(colon > 0, `CSS declaration expected: ${entry}`);
        declarations[entry.slice(0, colon).trim()] = entry.slice(colon + 1).trim().replace(/\s*!important\s*$/, "");
      }
      result.push({ selector, context, declarations });
    }
    start = index + 1;
  }
  assert.equal(depth, 0, "balanced CSS blocks");
  assert.equal(css.slice(start).trim(), "", "unsupported trailing CSS");
  return result;
}

function animationParts(rule) {
  const value = resolve(rule.declarations.animation || "");
  return split(value, ",").map((animation) => ({
    value: animation,
    times: [...animation.matchAll(/(?:^|\s)(-?\d*\.?\d+(?:ms|s))(?=\s|$)/g)].map((match) => time(match[1])),
    terms: split(animation.replace(/\s+/g, " "), " "),
  }));
}

function bounded(rule) {
  for (const part of animationParts(rule)) {
    if (part.value === "none") continue;
    const busy = rule.selector === '.refresh-button[aria-busy="true"] .ui-icon' && /^core-refresh\s/.test(part.value);
    if (busy) {
      assert.match(part.value, /\binfinite\b/, "existing busy spinner stays identifiable");
      continue;
    }
    assert.doesNotMatch(part.value, /\binfinite\b/, `${rule.selector}: no decorative infinite animation`);
    assert.ok(part.times[0] > 0 && part.times[0] <= 200, `${rule.selector}: finite entrance within 200ms`);
    assert.equal(part.times[1] || 0, 0, `${rule.selector}: no animation delay`);
    for (const term of part.terms.filter((term) => /^\d*\.?\d+$/.test(term))) assert.equal(Number(term), 1, `${rule.selector}: entrance plays once`);
  }
  for (const [property, value] of Object.entries(rule.declarations)) {
    if (/^(?:animation|transition)-delay$/.test(property)) for (const item of split(resolve(value), ",")) assert.equal(time(item), 0, `${rule.selector}: no delay`);
    if (property === "animation-iteration-count" && rule.selector !== '.refresh-button[aria-busy="true"] .ui-icon') for (const count of split(value, ",")) assert.equal(Number(count), 1, "only busy refresh may loop");
    if (property === "animation-duration" && rule.selector !== '.refresh-button[aria-busy="true"] .ui-icon') for (const duration of split(resolve(value), ",")) assert.ok(time(duration) >= 0 && time(duration) <= 200, "bounded animation duration");
    if (property === "transition-property") assert.ok(!split(value, ",").includes("all"), `${rule.selector}: no transition: all`);
    if (property === "transition") for (const transition of split(resolve(value), ",")) {
      if (transition === "none") continue;
      const property = transition.split(/\s+/)[0];
      assert.match(property, /^(?:--)?[a-z][a-z-]*$/, `${rule.selector}: transition must name a property`);
      assert.doesNotMatch(property, /^(?:all|ease(?:-in(?:-out)?|-out)?|linear|step-start|step-end|normal|allow-discrete)$/, `${rule.selector}: no explicit or implicit transition: all`);
      const times = [...transition.matchAll(/(?:^|\s)(-?\d*\.?\d+(?:ms|s))(?=\s|$)/g)].map((match) => time(match[1]));
      assert.equal(times[1] || 0, 0, `${rule.selector}: no transition delay`);
    }
  }
}

function entrance(selector, name, token) {
  const candidates = interfaceRules.filter((rule) => split(rule.selector, ",").includes(selector) && normal(rule) && rule.declarations.animation);
  assert.ok(candidates.length, `${selector}: entrance inside no-preference media`);
  for (const rule of candidates) {
    assert.match(rule.declarations.animation, new RegExp(`^${name}\\s`));
    assert.ok(rule.declarations.animation.includes(`var(${token})`), `${selector}: shared duration token`);
    assert.ok(rule.declarations.animation.includes("var(--motion-ease)"), `${selector}: shared easing token`);
    bounded(rule);
  }
}

test("CSS scanner keeps nested media, keyframes and comma-containing easing intact", () => {
  const parsed = rules('@media (prefers-reduced-motion: no-preference) { .x { animation: enter 180ms cubic-bezier(0.2, 0, 0, 1); } @keyframes enter { from { opacity: 0; } to { opacity: 1; } } }');
  assert.equal(parsed.length, 3);
  assert.equal(split(parsed[0].declarations.animation, ",").length, 1);
  assert.ok(normal(parsed[0]));
  assert.ok(keyframe(parsed[1]));
  assert.equal(rules('.x { content: "} ; {"; }')[0].declarations.content, '"} ; {"');
  assert.throws(() => rules(".x { opacity: 0;"), /balanced CSS/);
});

test("shared motion tokens are positive, bounded and use a reusable easing", () => {
  for (const token of ["--motion-fast", "--motion-enter"]) {
    assert.ok(tokens[token], `${token}: required motion token`);
    assert.ok(time(tokens[token]) > 0 && time(tokens[token]) <= 200, `${token}: <=200ms`);
  }
  assert.ok(time(tokens["--motion-fast"]) <= time(tokens["--motion-enter"]));
  assert.match(tokens["--motion-ease"] || "", /^(?:ease(?:-in(?:-out)?|-out)?|linear|cubic-bezier\([\d\s.,-]+\))$/);
});

test("CRM main, command palette and action disclosures have scoped bounded entrances", () => {
  entrance(".main:not(.sequence-main)", "core-content-enter", "--motion-enter");
  entrance(".command-palette:not([hidden]) .command-palette-card", "core-dialog-enter", "--motion-enter");
  entrance(".action-disclosure[open] > .disclosure-body", "core-content-enter", "--motion-fast");
  for (const rule of interfaceRules.filter((rule) => !keyframe(rule) && rule.declarations.animation && rule.declarations.animation !== "none")) {
    if (/\.main\b/.test(rule.selector)) assert.ok(rule.selector.includes(":not(.sequence-main)"), "CRM entrance excludes sequence editor");
    if (/\.disclosure-body\b/.test(rule.selector)) assert.ok(rule.selector.includes(".action-disclosure[open] > .disclosure-body"), "native open action disclosure only");
    if (!rule.selector.includes("aria-busy")) assert.ok(normal(rule), `${rule.selector}: decorative entrances require no-preference`);
  }
});

test("entrance keyframes animate compositor properties only", () => {
  for (const name of ["core-content-enter", "core-dialog-enter"]) {
    const frames = interfaceRules.filter((rule) => rule.context.includes(`@keyframes ${name}`));
    assert.ok(frames.length >= 2, `${name}: complete keyframes`);
    for (const frame of frames) assert.deepEqual(Object.keys(frame.declarations).filter((property) => !["opacity", "transform"].includes(property)), [], `${name}: no layout/filter motion`);
    assert.equal(frames.find((frame) => /^(?:to|100%)$/.test(frame.selector))?.declarations.opacity, "1", `${name}: final content fully visible`);
  }
});

test("no transition-all, delayed motion or decorative infinite animations in loaded CSS", () => {
  for (const rule of allRules) bounded(rule);
});

test("motion guard rejects regressions instead of accepting missing/implicit contracts", () => {
  for (const css of [
    ".x { transition: all 150ms ease; }", ".x { transition: 150ms ease; }", ".x { transition: ease 150ms; }",
    ".x { animation: enter 180ms ease 20ms; }", ".x { animation: enter 180ms ease infinite; }",
    ".x { animation: enter 201ms ease; }", ".x { animation-delay: 1s; }",
    ".x { transition: opacity 150ms ease 10ms; }", ".x { animation-iteration-count: infinite; }",
    ".x { animation: enter 180ms ease -20ms; }", ".x { animation: enter 180ms ease 2; }",
    ".x { animation-duration: 201ms; }", ".x { animation-iteration-count: 3; }",
  ]) assert.throws(() => bounded(rules(css)[0]), css);
  assert.doesNotThrow(() => bounded(rules('.refresh-button[aria-busy="true"] .ui-icon { animation: core-refresh 1s linear infinite; }')[0]));
  assert.doesNotThrow(() => bounded(rules(".x { animation: enter 180ms cubic-bezier(0.2, 0, 0, 1); transition: opacity 150ms ease; }")[0]));
});

test("hover/press transform rules explicitly target buttons, not links or record cards", () => {
  const feedback = interfaceRules.filter((rule) => !keyframe(rule) && /:(?:hover|active)\b/.test(rule.selector) && rule.declarations.transform && rule.declarations.transform !== "none");
  assert.ok(feedback.length, "button feedback contract exists");
  for (const rule of feedback) {
    assert.ok(normal(rule), "button feedback obeys motion preference");
    // Class-only .primary-action also matches the StudioMate registration anchor.
    for (const selector of split(rule.selector, ",")) assert.match(split(selector, " ").at(-1), /^button(?=[.#:[\s]|$)/, `${selector}: transform must be button-qualified`);
  }
});

test("reduced motion explicitly disables shell, command palette and login motion", () => {
  const disabled = interfaceRules.filter((rule) => reduced(rule) && rule.declarations.animation === "none" && rule.declarations.transition === "none");
  const selectors = disabled.flatMap((rule) => split(rule.selector, ","));
  for (const selector of [".shell", ".shell *", ".shell *::before", ".shell *::after", ".command-palette", ".command-palette *", ".login-gate", ".login-gate *"]) assert.ok(selectors.includes(selector), `${selector}: explicit reduced-motion coverage`);
  assert.ok(interfaceRules.some((rule) => reduced(rule) && rule.selector === '.refresh-button[aria-busy="true"] .ui-icon' && rule.declarations.animation === "none"), "busy refresh disabled in reduced motion");
});

test("verification sidecar is local-only, bounded and excludes sequence editor internals", () => {
  assert.ok(verifier.includes('const output = "/tmp/archive-core-crm-motion";'));
  assert.ok(verifier.includes('window.KANGSAIN_FIREBASE_CONFIG = {};'));
  assert.ok(verifier.includes('url.origin !== origin || request.method() !== "GET"'));
  assert.ok(verifier.includes('server.listen(0, "127.0.0.1"'));
  assert.ok(verifier.includes("animation.finished"));
  assert.ok(verifier.includes('serviceWorkers: "block"'));
  assert.match(verifier, /finally\s*\{\s*await context\.close\(\)/);
  assert.ok(verifier.includes("await browser.close()"));
  assert.ok(verifier.includes("server.closeAllConnections()"));
  assert.doesNotMatch(verifier, /waitForTimeout|storageState|launchPersistentContext|signInWith|httpsCallable|setDoc\(|updateDoc\(|deleteDoc\(|process\.env\./);
  assert.doesNotMatch(verifier.match(/const routes = \[[^\]]+\]/)?.[0] || "", /sequence/);
  assert.match(verifier, /const widths = \[320, 390, 768, 1440\]/);
  assert.match(verifier, /const motions = \["no-preference", "reduce"\]/);
});
