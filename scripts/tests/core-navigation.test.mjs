import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const file = new URL("../../core/assets/core-navigation.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");
const app = fs.readFileSync(new URL("../../core/assets/app.js", import.meta.url), "utf8");
const access = fs.readFileSync(new URL("../../core/assets/core-instructor-access.js", import.meta.url), "utf8");
const studio = fs.readFileSync(new URL("../../core/sequence/studio.html", import.meta.url), "utf8");

test("navigation module imports without DOM/auth side effects", () => {
  const bundle = buildSync({ entryPoints: [fileURLToPath(file)], bundle: true, format: "cjs", write: false,
    define: { "import.meta.url": JSON.stringify(file.href) } }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(bundle, { module, exports: module.exports, URL });
  assert.equal(typeof module.exports.finishCoreNavigation, "function");
  assert.equal(typeof module.exports.sharedNavigationRuntime, "function");
});

test("destination permissions are fetched, not granted by the shared runtime", () => {
  assert.match(app, /const shared = sharedNavigationRuntime\(\);/);
  assert.match(app, /const access = await prepareCoreAccess\(runtime, user\);/);
  assert.match(access, /httpsCallable\(runtime.functionsClient, "getCoreAccessSession"\)/);
  assert.match(source, /session\?\.role === host.session.role/);
  assert.match(source, /String\(session.staffId \|\| ""\) === String\(host.session.staffId \|\| ""\)/);
  assert.match(source, /session.mustChangePassword !== true/);
  assert.match(source, /frame !== pendingFrame && frame !== currentFrame/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|postMessage/);
});

test("save guard uses the production acknowledged save loop before departure", () => {
  assert.match(studio, /window.archiveSequenceNavigation=\{prepare:flushCurrent\};/);
  assert.match(studio, /async function flushCurrent\(\).*while\(cloudDirty\);return true;/);
  assert.ok(source.indexOf("await flushEditors(currentFrame?.contentDocument || document)") < source.indexOf("frame.src = url.href"));
  assert.ok(source.indexOf("if (!sameSession(api, childSession, childRuntime))") < source.indexOf("editor.removeAttribute(\"src\")"));
  assert.match(source, /node.inert = true;/);
  assert.match(source, /setTimeout\([\s\S]*?30000/);
});

test("save guard ignores provider frames but fails closed for an active editor", async () => {
  const bundle = buildSync({ stdin: { contents: source + '\nexport { flushEditors };', resolveDir: fileURLToPath(new URL("../../core/assets/", import.meta.url)) },
    format: "cjs", write: false, define: { "import.meta.url": JSON.stringify(file.href) } }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(bundle, { module, exports: module.exports, URL });
  const { flushEditors } = module.exports;
  let providerReads = 0;
  const provider = { get contentWindow() { providerReads++; throw Error("Cross-origin auth helper"); } };
  const editor = (child, loaded = true) => ({
    hasAttribute: name => name === "data-sequence-studio" || name === "src" && loaded,
    get contentWindow() { return child; },
  });
  const doc = frames => ({ querySelectorAll(selector) {
    assert.equal(selector, "[data-sequence-studio], [data-core-navigation-frame]");
    return frames.filter(frame => frame !== provider);
  } });
  assert.equal(await flushEditors(doc([provider])), true);
  assert.equal(providerReads, 0);
  assert.equal(await flushEditors(doc([provider, editor(null, false)])), true);
  assert.equal(await flushEditors(doc([editor({})])), false, "Unready active editor is not discarded");
  assert.equal(await flushEditors(doc([editor({ archiveSequenceNavigation: { prepare: async () => false } })])), false);
  assert.equal(await flushEditors(doc([editor({ archiveSequenceNavigation: { prepare: async () => { throw Error("Save failed"); } } })])), false);
  let release;
  let settled = false;
  const pending = flushEditors(doc([editor({ archiveSequenceNavigation: { prepare: () => new Promise(resolve => { release = resolve; }) } })]));
  pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, "Departure waits for the acknowledged save");
  release(true);
  assert.equal(await pending, true);
  const nested = { hasAttribute: name => name === "src", contentWindow: { document: doc([editor({ archiveSequenceNavigation: { prepare: async () => true } })]) } };
  assert.equal(await flushEditors(doc([nested])), true);
});

test("access isolation tears down content frames and tasks rather than preserving privileges", () => {
  assert.match(access, /function isolateOperatorContent\(\) \{\n  window.archiveCoreNavigation\?\.dispose\(\);/);
  assert.match(access, /function suspendAccess\(\) \{\n  window.archiveCoreNavigation\?\.dispose\(\);/);
  for (const marker of ["pendingFrame?.remove()", "currentFrame?.remove()", "clearTimeout(timer)", 'window.removeEventListener("popstate", pop)']) assert.ok(source.includes(marker));
});
