#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadPaidVideoCatalog } from "./lib/paid-video-catalog.mjs";

const APPLY = process.argv.includes("--apply");
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!positional[0]) {
  throw new Error("Usage: apply-paid-video-products.mjs RELEASE_OUTPUT_DIR [--apply]");
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const IMWEB = process.env.IMWEB_CLI || "/Users/archivepilates/.local/bin/imweb";
const releaseDir = path.resolve(positional[0]);
const releasePath = path.join(releaseDir, "release-private.json");
const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
const catalog = loadPaidVideoCatalog(ROOT);
assert(Array.isArray(release.videos) && release.videos.length > 0, "release-private.json has no videos.");
if (APPLY) {
  for (const video of release.videos) {
    assert(
      !["AAAAAAAAAAA", "BBBBBBBBBBB"].includes(video.previewYouTubeId) &&
        !["AAAAAAAAAAA", "BBBBBBBBBBB"].includes(video.fullYouTubeId) &&
        !String(video.thumbnailPath || "").includes("example.com") &&
        video.groupCode !== "g000000000000000000000",
      `${video.code}: replace every example placeholder before --apply.`,
    );
  }
}

const context = runJson(["config", "context"]);
const contextText = JSON.stringify(context);
assert(contextText.includes(catalog.site.siteCode), "Imweb context has the wrong siteCode.");
assert(contextText.includes(catalog.site.unitCode), "Imweb context has the wrong unitCode.");

const productList = runJson(["product", "list", "--all", "--max-pages", "20"]);
const products = Array.isArray(productList) ? productList : productList?.data || [];
const results = [];

for (const video of release.videos) {
  const draftPath = path.join(releaseDir, `${video.code.toLowerCase()}-product-create.json`);
  const draft = JSON.parse(fs.readFileSync(draftPath, "utf8"));
  const candidates = products.filter(
    (product) =>
      product.name === draft.name ||
      String(product.name || "").includes(`(${video.code})`) ||
      String(product.simpleContent || "").includes(`· ${video.code} ·`),
  );
  assert(candidates.length <= 1, `${video.code}: multiple existing products matched.`);

  if (candidates.length === 1) {
    const live = runJson(["product", "get", String(candidates[0].prodNo)])?.data;
    assertProductMatches(video, draft, live);
    video.productNo = live.prodNo;
    results.push({ code: video.code, action: "reused", productNo: live.prodNo, readback: "ok" });
    continue;
  }

  const dryRun = runJson(["product", "create", "--dry-run", "--data", `@${draftPath}`]);
  assert(dryRun?.dry_run === true, `${video.code}: product-create dry-run failed.`);
  if (!APPLY) {
    results.push({ code: video.code, action: "planned", productNo: null, dryRun: "ok" });
    continue;
  }

  const created = runJson(["product", "create", "--yes", "--data", `@${draftPath}`]);
  const productNo = Number(created?.data?.prodNo || created?.data?.productNo || created?.prodNo || 0);
  assert(Number.isInteger(productNo) && productNo > 0, `${video.code}: create response has no productNo.`);
  const live = runJson(["product", "get", String(productNo)])?.data;
  assertProductMatches(video, draft, live);
  video.productNo = productNo;
  results.push({ code: video.code, action: "created", productNo, dryRun: "ok", readback: "ok" });
}

if (APPLY || results.every((result) => result.action === "reused")) {
  fs.writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`, "utf8");
}
const summary = {
  mode: APPLY ? "apply" : "dry-run",
  siteCode: catalog.site.siteCode,
  results,
  nextStep: results.every((result) => Number.isInteger(result.productNo))
    ? "숨김 시청 페이지를 연결한 뒤 release-private.json을 --write-catalog 입력으로 사용합니다."
    : "--apply 승인 후 상품을 생성하고 상품번호를 release-private.json에 기록합니다.",
};
fs.writeFileSync(
  path.join(releaseDir, "product-apply-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(summary, null, 2));

function assertProductMatches(video, draft, live) {
  assert(live, `${video.code}: product readback returned no data.`);
  assert(live.name === draft.name, `${video.code}: product name mismatch.`);
  assert(Number(live.price) === Number(draft.price), `${video.code}: price mismatch.`);
  assert(live.prodStatus === "sale", `${video.code}: sale status mismatch.`);
  assert(live.prodType === "subscribe", `${video.code}: product type mismatch.`);
  assert(live.isDisplay === "Y", `${video.code}: display state mismatch.`);
  assert(
    JSON.stringify([...(live.categories || [])].sort()) ===
      JSON.stringify([...draft.categories].sort()),
    `${video.code}: category mismatch.`,
  );
  assert(
    live.prodDigitalData?.subscribeData?.group_code === video.groupCode,
    `${video.code}: entitlement group mismatch.`,
  );
  assert(
    Number(live.prodDigitalData?.subscribeData?.period) === Number(video.entitlementDays),
    `${video.code}: entitlement period mismatch.`,
  );
  assert(String(live.content || "").includes(video.previewYouTubeId), `${video.code}: preview missing.`);
  assert(!String(live.content || "").includes(video.fullYouTubeId), `${video.code}: full video id leaked.`);
}

function runJson(args) {
  const result = spawnSync(IMWEB, ["--output", "json", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Imweb CLI failed: ${String(result.stderr || result.stdout || "").trim()}`);
  }
  return JSON.parse(result.stdout);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
