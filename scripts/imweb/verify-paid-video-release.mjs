#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  daysFor,
  equipmentFor,
  groupName,
  loadPaidVideoCatalog,
  priceFor,
  productName,
  releaseProducts,
} from "./lib/paid-video-catalog.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const IMWEB = process.env.IMWEB_CLI || "/Users/archivepilates/.local/bin/imweb";
const SITE = "https://archivepilates.imweb.me";
const catalog = loadPaidVideoCatalog(ROOT);
const requestedCodes = flagValue("--codes")
  ?.split(",")
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean);
const selected = requestedCodes?.length
  ? requestedCodes.map((code) => {
      const product = catalog.products.find((item) => item.code === code);
      assert(product, `Unknown paid-video code: ${code}`);
      return product;
    })
  : releaseProducts(catalog);
assert(selected.length > 0, "No paid-video release products selected.");

const privateReleasePath = flagValue("--private-release");
const privateIds = privateReleasePath
  ? JSON.parse(fs.readFileSync(path.resolve(privateReleasePath), "utf8")).videos.map(
      (video) => video.fullYouTubeId,
    )
  : [];

const context = runJson(["config", "context"]);
const contextText = JSON.stringify(context);
assert(contextText.includes(catalog.site.siteCode), "Imweb context has the wrong siteCode.");
assert(contextText.includes(catalog.site.unitCode), "Imweb context has the wrong unitCode.");

const menuResponse = runJson(["site", "menu"]);
const menus = Array.isArray(menuResponse?.data) ? menuResponse.data : [];
const groupsResponse = runJson(["member", "groups", "list", "--all", "--max-pages", "10"]);
const groups = Array.isArray(groupsResponse) ? groupsResponse : groupsResponse?.data || [];
const results = [];

for (const product of selected) {
  const live = runJson(["product", "get", String(product.productNo)])?.data;
  assert(live, `${product.code}: product API returned no data.`);
  const equipment = equipmentFor(catalog, product);
  const expectedCategories = [catalog.site.onlineCategoryCode, equipment.categoryCode].sort();
  const actualCategories = [...(live.categories || [])].sort();
  const subscribe = live.prodDigitalData?.subscribeData || {};

  assert(live.name === productName(catalog, product), `${product.code}: product name mismatch.`);
  assert(Number(live.price) === priceFor(catalog, product), `${product.code}: price mismatch.`);
  assert(live.prodStatus === product.saleStatus, `${product.code}: sale status mismatch.`);
  assert(live.prodType === catalog.defaults.productType, `${product.code}: product type mismatch.`);
  assert(live.isDisplay === (product.displayed ? "Y" : "N"), `${product.code}: display state mismatch.`);
  assert(
    JSON.stringify(actualCategories) === JSON.stringify(expectedCategories),
    `${product.code}: category mismatch.`,
  );
  assert(subscribe.group_code === product.groupCode, `${product.code}: entitlement group mismatch.`);
  assert(Number(subscribe.period) === daysFor(catalog, product), `${product.code}: period mismatch.`);
  assert(Array.isArray(live.productImages) && live.productImages.length > 0, `${product.code}: thumbnail missing.`);
  const detailContent = [live.content, live.mobileContent].filter(Boolean).join("\n");
  assert(
    detailContent.includes(product.previewYouTubeId),
    `${product.code}: preview is missing from saved product content.`,
  );
  assert(
    detailContent.includes(product.watchPath),
    `${product.code}: watch CTA is missing from saved product content.`,
  );
  for (const fullId of privateIds) {
    assert(!detailContent.includes(fullId), `${product.code}: a full video id leaked to saved product content.`);
  }
  const group = groups.find((item) => item.siteGroupCode === product.groupCode);
  assert(group, `${product.code}: entitlement group does not exist.`);
  assert(group.title === groupName(catalog, product), `${product.code}: entitlement group title mismatch.`);

  const menu = menus.find(
    (item) => `/${String(item.url || "").replace(/^\/+/, "")}` === product.watchPath,
  );
  assert(menu, `${product.code}: hidden watch page is missing from the site menu.`);
  assert(menu.accessPermission?.type === "group", `${product.code}: watch page is not group-only.`);
  assert(
    Array.isArray(menu.accessPermission?.groupCodes) &&
      menu.accessPermission.groupCodes.length === 1 &&
      menu.accessPermission.groupCodes[0] === product.groupCode,
    `${product.code}: watch-page group permission mismatch.`,
  );

  const detailUrl = `${SITE}${catalog.site.shopPath}/?idx=${product.productNo}`;
  const detail = await fetchText(detailUrl);
  assert(detail.status === 200, `${product.code}: public product page returned ${detail.status}.`);
  assert(detail.body.includes(product.previewYouTubeId), `${product.code}: preview is missing from product detail.`);
  assert(detail.body.includes(product.watchPath), `${product.code}: watch CTA is missing from product detail.`);

  const gate = await fetch(`${SITE}${product.watchPath}`, {
    redirect: "manual",
    headers: { "User-Agent": "ARCHIVE-PILATES-paid-video-release/1.0" },
  });
  const location = gate.headers.get("location") || "";
  assert(
    [301, 302, 303, 307, 308].includes(gate.status) && location.includes("/login"),
    `${product.code}: anonymous watch gate failed (${gate.status}, ${location}).`,
  );

  results.push({
    code: product.code,
    productNo: product.productNo,
    product: "ok",
    entitlementGroup: "ok",
    hiddenPagePermission: "ok",
    publicPreview: "ok",
    anonymousGate: "ok",
  });
}

console.log(JSON.stringify({ ok: true, siteCode: catalog.site.siteCode, results }, null, 2));

function flagValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  assert(value && !value.startsWith("--"), `${name} requires a value.`);
  return value;
}

function runJson(args) {
  const result = spawnSync(IMWEB, ["--output", "json", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Imweb CLI failed: ${String(result.stderr || result.stdout || "").trim()}`);
  }
  return JSON.parse(result.stdout);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "ARCHIVE-PILATES-paid-video-release/1.0" },
      signal: controller.signal,
    });
    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
