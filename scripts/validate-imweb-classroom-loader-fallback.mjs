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
const expectedVersion = "2026-07-28c";
const expectedAssetUrl =
  "https://archivepilates.com/assets/imweb-my-classroom-20260723a.js?v=20260728c";

if (!loaderHtml.includes(`data-archive-pilates-my-classroom-v2="${expectedVersion}"`)) {
  throw new Error("My Classroom loader marker is stale.");
}

if (!source.includes(expectedAssetUrl)) {
  throw new Error("My Classroom loader asset URL is stale.");
}

const attributes = new Map();
const appendedScripts = [];
const documentElement = {
  appendChild(node) {
    appendedScripts.push(node);
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

vm.runInNewContext(source, {
  document,
  location: { pathname: "/48" },
  URL,
});

if (appendedScripts.length !== 1) {
  throw new Error(`My Classroom loader appended ${appendedScripts.length} scripts.`);
}

const assetScript = appendedScripts[0];
if (assetScript.src !== expectedAssetUrl) {
  throw new Error(`Unexpected My Classroom asset URL: ${assetScript.src}`);
}

if (attributes.has("data-ap-classroom")) {
  throw new Error("Loader must not preempt the inline fallback with data-ap-classroom.");
}

assetScript.onerror();
if (attributes.get("data-ap-classroom-v2-asset-error") !== expectedVersion) {
  throw new Error("Loader does not mark external asset failures.");
}
if (attributes.has("data-ap-classroom")) {
  throw new Error("Asset failure must leave the inline fallback available.");
}

assetScript.onload();
if (attributes.get("data-ap-classroom-v2-asset-loaded") !== expectedVersion) {
  throw new Error("Loader does not mark successful external asset loading.");
}

console.log("Validated My Classroom loader fallback behavior.");
