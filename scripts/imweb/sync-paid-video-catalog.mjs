#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  CLASSROOM_REGION,
  SALES_REGION,
  loadPaidVideoCatalog,
  renderClassroomCatalog,
  renderVideoSalesCatalog,
  replaceGeneratedRegion,
} from "./lib/paid-video-catalog.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const WRITE = process.argv.includes("--write");
const targets = [
  {
    path: "official-home/assets/imweb-my-classroom-20260723a.js",
    region: CLASSROOM_REGION,
    render: renderClassroomCatalog,
  },
  {
    path: "official-home/assets/imweb-video-sales-20260730b.js",
    region: SALES_REGION,
    render: renderVideoSalesCatalog,
  },
];
const catalog = loadPaidVideoCatalog(ROOT);
const runtime = catalog.runtime;
const results = [];

for (const target of targets) {
  const absolutePath = path.join(ROOT, target.path);
  const before = fs.readFileSync(absolutePath, "utf8");
  const after = replaceGeneratedRegion(before, target.region, target.render(catalog));
  const changed = before !== after;
  if (WRITE && changed) fs.writeFileSync(absolutePath, after, "utf8");
  recordResult(target.path, changed);
}

syncTextFile(
  "official-home/assets/imweb-my-classroom-20260723a.js",
  (source) => replaceRequired(
    source,
    /var VERSION="[^"]+"/,
    `var VERSION="${runtime.classroomAssetVersion}"`,
    "classroom asset version",
  ),
);
syncTextFile("scripts/imweb/imweb-my-classroom-loader.html", (source) => {
  let next = replaceRequired(
    source,
    /data-archive-pilates-my-classroom-v2="[^"]+"/,
    `data-archive-pilates-my-classroom-v2="${runtime.classroomLoaderVersion}"`,
    "classroom loader marker",
  );
  next = replaceRequired(
    next,
    /var LOADER_VERSION="[^"]+"/,
    `var LOADER_VERSION="${runtime.classroomLoaderVersion}"`,
    "classroom loader version",
  );
  next = replaceRequired(
    next,
    /var ASSET_VERSION="[^"]+"/,
    `var ASSET_VERSION="${runtime.classroomAssetVersion}"`,
    "classroom loader asset version",
  );
  return replaceRequired(
    next,
    /(imweb-my-classroom-20260723a\.js\?v=)[A-Za-z0-9._-]+/,
    `$1${runtime.classroomAssetQuery}`,
    "classroom loader asset query",
  );
});
syncTextFile("official-home/assets/imweb-video-sales-20260730b.js", (source) =>
  replaceRequired(
    source,
    /var VERSION = "[^"]+"/,
    `var VERSION = "${runtime.videoSalesVersion}"`,
    "video-sales asset version",
  ),
);
syncTextFile("scripts/imweb/install-video-sales-growth.html", (source) => {
  let next = replaceRequired(
    source,
    /data-archive-pilates-video-sales-growth="[^"]+"/,
    `data-archive-pilates-video-sales-growth="${runtime.videoSalesVersion}"`,
    "video-sales loader marker",
  );
  return replaceRequired(
    next,
    /var VERSION = "[^"]+"/,
    `var VERSION = "${runtime.videoSalesVersion}"`,
    "video-sales loader version",
  );
});

const stale = results.filter((result) => result.changed);
if (!WRITE && stale.length) {
  throw new Error(
    `Paid-video generated sources are stale:\n${stale.map((item) => `- ${item.path}`).join("\n")}\nRun npm run sync:imweb-paid-video-catalog -- --write.`,
  );
}

console.log(
  JSON.stringify(
    {
      mode: WRITE ? "write" : "check",
      productCount: catalog.products.length,
      releaseCodes: catalog.products
        .filter((product) => product.verifyInRelease)
        .map((product) => product.code),
      results,
    },
    null,
    2,
  ),
);

function syncTextFile(relativePath, transform) {
  const absolutePath = path.join(ROOT, relativePath);
  const before = fs.readFileSync(absolutePath, "utf8");
  const after = transform(before);
  const changed = before !== after;
  if (WRITE && changed) fs.writeFileSync(absolutePath, after, "utf8");
  recordResult(relativePath, changed);
}

function recordResult(relativePath, changed) {
  const existing = results.find((result) => result.path === relativePath);
  if (existing) {
    existing.changed ||= changed;
    existing.written ||= WRITE && changed;
    return;
  }
  results.push({ path: relativePath, changed, written: WRITE && changed });
}

function replaceRequired(source, pattern, replacement, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)) || [];
  if (matches.length !== 1) throw new Error(`Expected one ${label}, found ${matches.length}`);
  return source.replace(pattern, replacement);
}
