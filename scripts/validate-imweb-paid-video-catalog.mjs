#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  CLASSROOM_REGION,
  SALES_REGION,
  loadPaidVideoCatalog,
  releaseProducts,
  renderClassroomCatalog,
  renderVideoSalesCatalog,
  replaceGeneratedRegion,
} from "./imweb/lib/paid-video-catalog.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const catalogPath = path.join(ROOT, "config/imweb-paid-video-catalog.json");
const classroomPath = path.join(ROOT, "official-home/assets/imweb-my-classroom-20260723a.js");
const salesPath = path.join(ROOT, "official-home/assets/imweb-video-sales-20260730b.js");
const classroomLoaderPath = path.join(ROOT, "scripts/imweb/imweb-my-classroom-loader.html");
const salesLoaderPath = path.join(ROOT, "scripts/imweb/install-video-sales-growth.html");

const catalogSource = fs.readFileSync(catalogPath, "utf8");
const catalog = loadPaidVideoCatalog(ROOT);
const classroom = fs.readFileSync(classroomPath, "utf8");
const sales = fs.readFileSync(salesPath, "utf8");
const classroomLoader = fs.readFileSync(classroomLoaderPath, "utf8");
const salesLoader = fs.readFileSync(salesLoaderPath, "utf8");

assert(!catalogSource.includes("fullYouTubeId"), "Full paid-video ids must not be stored in the tracked catalog.");
assert(!catalogSource.includes("youtube.com/embed"), "The tracked catalog must not contain embed URLs.");
assert(
  replaceGeneratedRegion(classroom, CLASSROOM_REGION, renderClassroomCatalog(catalog)) === classroom,
  "My Classroom generated catalog is stale.",
);
assert(
  replaceGeneratedRegion(sales, SALES_REGION, renderVideoSalesCatalog(catalog)) === sales,
  "Video-sales generated catalog is stale.",
);

const runtime = catalog.runtime;
assert(
  classroom.includes(`VERSION="${runtime.classroomAssetVersion}"`),
  "My Classroom asset version does not match the catalog.",
);
assert(
  classroomLoader.includes(
    `data-archive-pilates-my-classroom-v2="${runtime.classroomLoaderVersion}"`,
  ),
  "My Classroom loader marker does not match the catalog.",
);
assert(
  classroomLoader.includes(`var LOADER_VERSION="${runtime.classroomLoaderVersion}"`),
  "My Classroom loader runtime version does not match the catalog.",
);
assert(
  classroomLoader.includes(`var ASSET_VERSION="${runtime.classroomAssetVersion}"`),
  "My Classroom loader asset version does not match the catalog.",
);
assert(
  classroomLoader.includes(`?v=${runtime.classroomAssetQuery}`),
  "My Classroom loader asset query does not match the catalog.",
);
assert(
  sales.includes(`var VERSION = "${runtime.videoSalesVersion}"`),
  "Video-sales asset version does not match the catalog.",
);
assert(
  salesLoader.includes(
    `data-archive-pilates-video-sales-growth="${runtime.videoSalesVersion}"`,
  ),
  "Video-sales loader marker does not match the catalog.",
);
assert(
  salesLoader.includes(`var VERSION = "${runtime.videoSalesVersion}"`),
  "Video-sales loader runtime version does not match the catalog.",
);

const currentRelease = releaseProducts(catalog);
assert(currentRelease.length > 0, "At least one current release product is required for live verification.");
for (const product of currentRelease) {
  assert(product.previewYouTubeId, `${product.code} has no preview id.`);
  assert(product.saleStatus === "sale", `${product.code} must be on sale before release verification.`);
  assert(product.displayed === true, `${product.code} must be displayed before release verification.`);
}

console.log(
  `Validated paid-video catalog: ${catalog.products.length} products, release ${currentRelease
    .map((product) => product.code)
    .join(", ")}.`,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
