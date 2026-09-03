#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const inputPath = path.resolve(process.argv[2] || "");
const outputDir = path.resolve(process.argv[3] || "");
const loaderPath = path.resolve("scripts/imweb/imweb-my-classroom-loader.html");
const unitCode = "u2026051698c99ea234719";

if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: prepare-my-classroom-loader.mjs SCRIPT_LIST_JSON OUTPUT_DIR");
}

const response = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const rows = response?.data?.list || response?.data || [];
const loader = fs.readFileSync(loaderPath, "utf8").trim();
const loaderPattern =
  /<script\b[^>]*\bdata-archive-pilates-my-classroom-v2=(?:"[^"]*"|'[^']*')[^>]*>[\s\S]*?<\/script>\s*/g;

const header = scriptAt(rows, "header");
const body = scriptAt(rows, "body");
const footer = scriptAt(rows, "footer");

assert(matches(header, loaderPattern) === 1, "Expected one existing header classroom loader.");
const bodyLoaderCount = matches(body, loaderPattern);
assert(bodyLoaderCount <= 1, "Expected at most one duplicate body classroom asset tag.");
assert(matches(footer, loaderPattern) === 0, "Unexpected footer classroom loader.");

const preparedHeader = header.replace(loaderPattern, `${loader}\n`);
const preparedBody = body.replace(loaderPattern, "");

assert(matches(preparedHeader, loaderPattern) === 1, "Prepared header loader count is not one.");
assert(matches(preparedBody, loaderPattern) === 0, "Prepared body still has a v2 loader tag.");
assert(
  count(preparedBody, 'data-archive-pilates-my-classroom="2026-07-21b"') === 1,
  "Prepared body lost or duplicated the inline fallback.",
);
assert(
  count(preparedHeader, 'data-archive-pilates-my-classroom-v2="2026-09-04d"') === 1,
  "Prepared header does not contain the current loader version.",
);
assert(
  count(preparedHeader, "imweb-my-classroom-20260723a.js?v=20260904c") === 1,
  "Prepared header does not contain the current asset URL.",
);

fs.mkdirSync(outputDir, { recursive: true });
writePayload("header", preparedHeader);
writePayload("body", preparedBody);

console.log(
  JSON.stringify(
    {
      bodyLengthAfter: preparedBody.length,
      bodyLengthBefore: body.length,
      headerLengthAfter: preparedHeader.length,
      headerLengthBefore: header.length,
      loaderVersion: "2026-09-04d",
      outputDir,
      removedBodyLoaderCount: bodyLoaderCount,
    },
    null,
    2,
  ),
);

function scriptAt(items, position) {
  const item = items.find((row) => row.position === position);
  if (!item) throw new Error(`Missing Imweb ${position} script.`);
  return String(item.scriptContent || item.content || "");
}

function matches(value, pattern) {
  return Array.from(value.matchAll(pattern)).length;
}

function count(value, marker) {
  return value.split(marker).length - 1;
}

function writePayload(position, scriptContent) {
  const filePath = path.join(outputDir, `${position}-update.json`);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ unitCode, position, scriptContent })}\n`,
    "utf8",
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
