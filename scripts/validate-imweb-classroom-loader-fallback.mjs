import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const loaderPath = path.resolve("scripts/imweb/imweb-my-classroom-loader.html");
const loaderHtml = fs.readFileSync(loaderPath, "utf8");
const scriptMatch = loaderHtml.match(/^<script\b[^>]*>([\s\S]*)<\/script>\s*$/);

if (!scriptMatch) {
  throw new Error("My Classroom loader must contain exactly one script element.");
}

const source = scriptMatch[1];
const expectedLoaderVersion = "2026-09-01b";
const expectedAssetVersion = "2026-09-01a";
const recoveryKey = "ap_classroom_asset_skip_once";
const expectedAssetUrl =
  "https://archivepilates.com/assets/imweb-my-classroom-20260723a.js?v=20260901a";

if (!loaderHtml.includes(`data-archive-pilates-my-classroom-v2="${expectedLoaderVersion}"`)) {
  throw new Error("My Classroom loader marker is stale.");
}

if (!source.includes(expectedAssetUrl)) {
  throw new Error("My Classroom loader asset URL is stale.");
}

const normal = runLoader();
assert(normal.appendedScripts.length === 1, "Loader must append one external asset.");
assert(
  normal.appendedScripts[0].src === expectedAssetUrl,
  `Unexpected My Classroom asset URL: ${normal.appendedScripts[0].src}`,
);
assert(
  normal.attributes.get("data-ap-classroom") === expectedAssetVersion,
  "Loader must claim the current renderer before the inline fallback starts.",
);

normal.appendedScripts[0].onerror();
assert(
  normal.attributes.get("data-ap-classroom-v2-asset-error") === expectedLoaderVersion,
  "Loader does not mark external asset failures.",
);
assert(
  !normal.attributes.has("data-ap-classroom"),
  "Asset fetch recovery must release the inline fallback claim.",
);
assert(normal.reloads() === 1, "Asset fetch failure must trigger one recovery reload.");
assert(
  normal.session.get(recoveryKey) === "1",
  "Asset fetch failure must leave a one-time external-asset skip marker.",
);

const loaded = runLoader();
loaded.appendedScripts[0].onload();
assert(
  loaded.attributes.get("data-ap-classroom-v2-asset-loaded") === expectedLoaderVersion,
  "Loader does not mark successful external asset loading.",
);
loaded.attributes.set("data-ap-classroom-v2-complete", expectedAssetVersion);
loaded.watchdog();
assert(loaded.reloads() === 0, "Completed current renderer must not be reloaded.");

const stalled = runLoader();
stalled.watchdog();
assert(stalled.reloads() === 1, "Stalled current renderer must trigger one recovery reload.");
assert(
  stalled.session.get(recoveryKey) === "1",
  "Recovery reload must leave a one-time external-asset skip marker.",
);
assert(
  !stalled.attributes.has("data-ap-classroom"),
  "Recovery reload must release the inline fallback claim.",
);
assert(
  stalled.attributes.get("data-ap-classroom-v2-runtime-error") === expectedLoaderVersion,
  "Stalled current renderer must leave a runtime-error marker.",
);

const fallbackReload = runLoader({ [recoveryKey]: "1" });
assert(
  fallbackReload.appendedScripts.length === 0,
  "Recovery reload must skip the external asset once.",
);
assert(
  fallbackReload.session.get(recoveryKey) === undefined,
  "Recovery reload must consume the one-time skip marker.",
);
assert(
  fallbackReload.attributes.get("data-ap-classroom-v2-loader-fallback") ===
    expectedLoaderVersion,
  "Recovery reload must expose a fallback diagnostic marker.",
);
assert(
  !fallbackReload.attributes.has("data-ap-classroom"),
  "Recovery reload must leave the inline renderer available.",
);

const legacyWins = runLoader();
legacyWins.attributes.set("data-ap-classroom", "2026-07-21b");
legacyWins.watchdog();
assert(legacyWins.reloads() === 0, "An active inline fallback must not be reloaded.");
assert(
  legacyWins.attributes.get("data-ap-classroom-v2-fallback-active") === expectedLoaderVersion,
  "An active inline fallback must be recorded for diagnosis.",
);

console.log("Validated My Classroom loader fallback and runtime recovery behavior.");

function runLoader(initialSession = {}) {
  const attributes = new Map();
  const appendedScripts = [];
  const timers = [];
  const session = new Map(Object.entries(initialSession));
  let reloadCount = 0;

  const documentElement = {
    appendChild(node) {
      appendedScripts.push(node);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
  };
  const document = {
    createElement(tagName) {
      return {
        tagName,
        setAttribute(name, value) {
          this[name] = String(value);
        },
      };
    },
    documentElement,
    head: {
      appendChild(node) {
        appendedScripts.push(node);
      },
    },
    querySelector() {
      return null;
    },
  };
  const location = {
    pathname: "/48",
    reload() {
      reloadCount += 1;
    },
  };
  const sessionStorage = {
    getItem(key) {
      return session.get(key) ?? null;
    },
    removeItem(key) {
      session.delete(key);
    },
    setItem(key, value) {
      session.set(key, String(value));
    },
  };

  vm.runInNewContext(source, {
    document,
    location,
    sessionStorage,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
  });

  const watchdogTimer = timers.find(({ delay }) => delay === 12000);
  return {
    appendedScripts,
    attributes,
    reloads: () => reloadCount,
    session,
    watchdog() {
      if (!watchdogTimer) throw new Error("My Classroom runtime watchdog is missing.");
      watchdogTimer.callback();
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
