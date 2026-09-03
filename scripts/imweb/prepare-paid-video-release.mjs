#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import {
  daysFor,
  equipmentFor,
  groupName,
  loadPaidVideoCatalog,
  priceFor,
  productName,
  validatePaidVideoCatalog,
} from "./lib/paid-video-catalog.mjs";

const args = process.argv.slice(2);
const WRITE_CATALOG = args.includes("--write-catalog");
const positional = args.filter((arg) => !arg.startsWith("--"));
if (!positional[0]) {
  throw new Error(
    "Usage: prepare-paid-video-release.mjs INPUT_JSON [OUTPUT_DIR] [--write-catalog]",
  );
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const inputPath = path.resolve(positional[0]);
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
assert(/^\d{4}-\d{2}-\d{2}$/.test(input.releaseDate || ""), "releaseDate must be YYYY-MM-DD.");
assert(Array.isArray(input.videos) && input.videos.length > 0, "videos must be a non-empty array.");

const catalog = loadPaidVideoCatalog(ROOT);
const outputDir = path.resolve(
  positional[1] || path.join(ROOT, "artifacts/imweb-paid-video-release", input.releaseDate),
);
fs.mkdirSync(outputDir, { recursive: true });

const normalized = input.videos.map((video, index) => normalizeVideo(video, index));
assertUnique(normalized, "code");
assertUnique(normalized.filter((video) => video.productNo != null), "productNo");
assertUnique(normalized, "groupCode");

const publicFiles = [];
for (const video of normalized) {
  const detailHtml = renderProductDetail(video);
  const productDraft = renderProductDraft(video, detailHtml);
  const code = video.code.toLowerCase();
  const detailPath = path.join(outputDir, `${code}-product-detail.html`);
  const productPath = path.join(outputDir, `${code}-product-create.json`);
  const watchPath = path.join(outputDir, `${code}-private-watch-page.json`);
  const youtubePath = path.join(outputDir, `${code}-youtube-metadata.json`);

  write(detailPath, `${detailHtml}\n`);
  write(productPath, `${JSON.stringify(productDraft, null, 2)}\n`);
  write(
    watchPath,
    `${JSON.stringify(
      {
        code: video.code,
        title: video.title,
        groupCode: video.groupCode,
        groupName: video.groupName,
        watchPath: video.watchPath,
        fullYouTubeId: video.fullYouTubeId,
        embedUrl: `https://www.youtube.com/embed/${video.fullYouTubeId}?rel=0`,
        pageRule: "회원그룹 전용 숨김 페이지이며 전체 영상은 이 페이지의 로컬 영상 위젯에만 둡니다.",
        acceptedPlayableSelectors: [
          "[data-widget-type=video]",
          ".ap-watch",
          ".ap-private-watch",
          "iframe[src*=youtube.com/embed]",
        ],
      },
      null,
      2,
    )}\n`,
  );
  write(youtubePath, `${JSON.stringify(renderYouTubeMetadata(video), null, 2)}\n`);
  publicFiles.push(detailPath, productPath);
}

for (const filePath of publicFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  for (const video of normalized) {
    assert(
      !source.includes(video.fullYouTubeId),
      `Full video id leaked into public artifact ${path.basename(filePath)}.`,
    );
  }
}

const privateReleasePath = path.join(outputDir, "release-private.json");
write(privateReleasePath, `${JSON.stringify({ releaseDate: input.releaseDate, videos: normalized }, null, 2)}\n`);

let catalogUpdated = false;
if (WRITE_CATALOG) {
  const missingProductNos = normalized.filter((video) => !Number.isInteger(video.productNo));
  assert(
    missingProductNos.length === 0,
    `--write-catalog requires productNo for: ${missingProductNos.map((video) => video.code).join(", ")}`,
  );
  updateCatalog(normalized);
  catalogUpdated = true;
}

const result = {
  mode: WRITE_CATALOG ? "prepare-and-update-catalog" : "prepare-only",
  releaseDate: input.releaseDate,
  outputDir,
  codes: normalized.map((video) => video.code),
  productDraftsReady: true,
  privateWatchConfigsReady: true,
  youtubeMetadataReady: true,
  catalogUpdateReady: normalized.every((video) => Number.isInteger(video.productNo)),
  catalogUpdated,
  remainingAdminStep:
    "아임웹 디자인 모드에서 각 숨김 시청 페이지를 회원그룹 전용으로 만들고 private-watch-page.json의 전체 영상을 페이지 로컬 영상 위젯에 연결합니다.",
};
write(path.join(outputDir, "release-summary.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

function normalizeVideo(video, index) {
  const label = `videos[${index}]`;
  assert(/^(?:ACA|ACH|AR|AB)\d+(?:-\d+)?$/.test(video.code || ""), `${label}.code is invalid.`);
  assert(String(video.title || "").trim(), `${label}.title is required.`);
  assert(String(video.instructor || "").trim(), `${label}.instructor is required.`);
  assert(/^\d{1,3}:\d{2}(?::\d{2})?$/.test(video.duration || ""), `${label}.duration is invalid.`);
  assert(String(video.summary || "").trim(), `${label}.summary is required.`);
  assert(/^[A-Za-z0-9_-]{11}$/.test(video.previewYouTubeId || ""), `${label}.previewYouTubeId is invalid.`);
  assert(/^[A-Za-z0-9_-]{11}$/.test(video.fullYouTubeId || ""), `${label}.fullYouTubeId is invalid.`);
  assert(video.previewYouTubeId !== video.fullYouTubeId, `${label} preview and full video ids must differ.`);
  assert(/^g[0-9a-z]+$/.test(video.groupCode || ""), `${label}.groupCode is required and invalid.`);
  assert(
    video.productNo == null || (Number.isInteger(video.productNo) && video.productNo > 0),
    `${label}.productNo must be a positive integer when present.`,
  );
  assert(
    isRemoteUrl(video.thumbnailPath) || path.isAbsolute(video.thumbnailPath || ""),
    `${label}.thumbnailPath must be an HTTPS URL or absolute local path.`,
  );
  if (!isRemoteUrl(video.thumbnailPath)) {
    assert(fs.existsSync(video.thumbnailPath), `${label}.thumbnailPath does not exist.`);
  }

  const product = {
    code: video.code,
    title: String(video.title).trim(),
    productNo: video.productNo,
    groupCode: video.groupCode,
    watchPath: `/archive-method-watch-${video.code.toLowerCase()}`,
    price: video.price,
    entitlementDays: video.entitlementDays,
  };
  const equipment = equipmentFor(catalog, product);
  assert(product.title.startsWith(equipment.name), `${label}.title must start with ${equipment.name}.`);

  return {
    ...product,
    instructor: String(video.instructor).trim(),
    duration: video.duration,
    summary: String(video.summary).trim(),
    previewYouTubeId: video.previewYouTubeId,
    fullYouTubeId: video.fullYouTubeId,
    thumbnailPath: video.thumbnailPath,
    price: priceFor(catalog, product),
    entitlementDays: daysFor(catalog, product),
    equipment: equipment.name,
    categoryCode: equipment.categoryCode,
    groupName: groupName(catalog, product),
    productName: productName(catalog, product),
  };
}

function renderProductDraft(video, content) {
  return {
    unitCode: catalog.site.unitCode,
    name: video.productName,
    price: video.price,
    prodStatus: "sale",
    prodType: catalog.defaults.productType,
    categories: [catalog.site.onlineCategoryCode, video.categoryCode],
    content,
    simpleContent: `${video.instructor} · ${video.equipment} · ${video.title.replace(`${video.equipment} `, "")} · ${video.code} · 회원그룹 이용권 ${video.entitlementDays}일 시청`,
    prodDigitalData: {
      downloadChk: true,
      subscribeData: {
        expire_date: "",
        group_code: video.groupCode,
        is_complete: false,
        period: video.entitlementDays,
        real_expire_time: 0,
        real_period: 0,
      },
      type: catalog.defaults.productType,
    },
    productImages: [video.thumbnailPath],
    seoTitle: video.productName,
    seoDescription: `결제 완료 후 ${video.groupName} 회원그룹 권한으로 ${video.entitlementDays}일 동안 구매자 전용 시청 페이지에서 이용합니다.`,
    seoAccessBot: "Y",
    isDisplay: "Y",
    stockUse: "N",
    priceTax: "Y",
  };
}

function renderYouTubeMetadata(video) {
  const topic = video.title.replace(`${video.equipment} `, "");
  const commonTags = [
    "ARCHIVE PILATES",
    "ARCHIVE METHOD",
    video.equipment,
    topic,
    "필라테스 강사레슨",
    "필라테스 시퀀스",
  ];
  return {
    full: {
      videoId: video.fullYouTubeId,
      title: `ARCHIVE METHOD ${video.title} (${video.code}) | ${video.instructor}`,
      description: `${video.summary}\n\nARCHIVE PILATES 구매자 전용 전체 수업 영상입니다.`,
      privacy: "unlisted",
      playlistRole: "판매용 재생목록",
      tags: commonTags,
    },
    preview: {
      videoId: video.previewYouTubeId,
      title: `[미리보기] ARCHIVE METHOD ${video.title} (${video.code})`,
      description: `${video.summary}\n\n전체 영상은 ARCHIVE PILATES 공식 사이트에서 구매 후 ${video.entitlementDays}일 동안 시청할 수 있습니다.`,
      privacy: "public",
      playlistRole: "공개 미리보기 재생목록",
      tags: [...commonTags, "필라테스 미리보기"],
    },
  };
}

function renderProductDetail(video) {
  const title = escapeHtml(`ARCHIVE METHOD ${video.title} (${video.code})`);
  const group = escapeHtml(video.groupName);
  const summary = escapeHtml(video.summary);
  const watchUrl = `https://archivepilates.imweb.me${video.watchPath}`;
  const previewThumb = `https://i.ytimg.com/vi/${video.previewYouTubeId}/maxresdefault.jpg`;
  return `<style>
._item_detail_wrap .prod-detail-section--select-group,
._item_detail_wrap .prod-detail-section--delivery,
._item_detail_wrap .prod-detail-section--delivery-guide { display:none!important; }
</style>
<section class="archive-online-product" style="font-family:inherit;line-height:1.75;color:#1f1f1f;">
  <p style="display:inline-block;margin:0 0 14px;padding:7px 10px;background:#f8de59;color:#1f1f1f;font-weight:700;font-size:13px;border:1px solid #e2c83c;">온라인 영상 클래스</p>
  <h2 style="font-size:28px;line-height:1.25;margin:0 0 12px;color:#171717;">${title}</h2>
  <p style="margin:0 0 18px;color:#555;">${escapeHtml(video.instructor)} · ${escapeHtml(video.equipment)} · ${escapeHtml(video.duration)} · 결제 후 ${video.entitlementDays}일 시청 권한</p>
  <div data-archive-pilates-watch-cta="${input.releaseDate}" style="margin:18px 0 24px;padding:20px 22px;border:1px solid #1e1b18;background:#fffdfa;color:#1f1f1f;line-height:1.75;">
    <strong style="display:block;margin:0 0 8px;font-size:20px;line-height:1.35;color:#171717;">구매 후 시청 페이지</strong>
    <p style="margin:0 0 12px;color:#333;">결제 완료 후 구매 계정에 <strong>${group}</strong> 권한이 자동 부여됩니다. 로그인 후 <strong>내 강의실</strong>에서 시청할 수 있습니다.</p>
    <p style="margin:0 0 14px;color:#6b625b;font-size:14px;">비회원 또는 미구매 계정은 로그인 또는 권한 확인 화면으로 이동합니다.</p>
    <a href="${watchUrl}" style="display:inline-block;min-height:44px;padding:13px 18px;background:#1e1b18;color:#fff!important;text-decoration:none;font-weight:800;border:1px solid #1e1b18;">${video.code} 구매 후 시청 페이지 열기</a>
  </div>
  <figure style="margin:24px 0 0;"><img src="${previewThumb}" alt="${title} 미리보기 썸네일" style="display:block;width:100%;max-width:960px;border:1px solid #e8e0d6;"></figure>
  <div data-archive-pilates-preview="${input.releaseDate}" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:16px 0 26px;background:#111;">
    <iframe src="https://www.youtube.com/embed/${video.previewYouTubeId}" title="ARCHIVE PILATES preview" style="position:absolute;inset:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
  </div>
  <div style="padding:20px;border:1px solid #e7e1d8;background:#fbfaf7;margin:22px 0;"><strong style="display:block;margin-bottom:8px;color:#171717;">수업 구성</strong>${summary}</div>
  <h3 style="font-size:20px;margin:26px 0 10px;color:#171717;">구매 후 이용 안내</h3>
  <ul style="padding-left:20px;margin:0 0 18px;color:#333;">
    <li>결제 완료 후 주문자 계정에 <strong>${group}</strong> 권한이 자동 부여됩니다.</li>
    <li>전체 영상은 공개 링크로 발송하지 않고 로그인 후 구매자 전용 페이지에서 시청합니다.</li>
    <li>시청 가능 기간은 권한 부여일 기준 ${video.entitlementDays}일이며 파일 다운로드는 제공하지 않습니다.</li>
    <li>무단 저장, 복제, 공유, 재배포는 금지됩니다.</li>
  </ul>
  <!-- ARCHIVE_TOSSPAY_POLICY_START -->
  <div data-archive-pilates-tosspay="online-2026-07-30" style="padding:22px;border:2px solid #1e1b18;background:#fffdfa;margin:24px 0;color:#1f1f1f;line-height:1.75;">
    <h3 style="font-size:20px;margin:0 0 12px;color:#171717;">결제 후 제공 방식 · 이용기간 · 환불 기준</h3>
    <ul style="padding-left:20px;margin:0;color:#333;">
      <li><strong>제공 방식:</strong> 결제 완료 즉시 구매 계정에 시청 권한이 자동 부여되며 로그인 후 <strong>내 강의실</strong>에서 스트리밍합니다.</li>
      <li><strong>최종 제공 완료:</strong> 시청 권한 부여일로부터 ${video.entitlementDays}일이 되는 날에 이용기간이 종료됩니다.</li>
      <li><strong>전액 환불:</strong> 결제일로부터 7일 이내이면서 영상 재생 이력이 없는 경우 전액 환불합니다.</li>
      <li><strong>재생 시작 후 환불:</strong> 시청을 시작했거나 결제 후 7일이 지난 경우, 이용기간의 1/3 경과 전에는 결제금액의 2/3, 1/3 이후부터 1/2 경과 전에는 1/2을 환불하며, 1/2 경과 후에는 환불되지 않습니다.</li>
      <li><strong>예외 처리:</strong> 중복 결제, 권한 미부여 또는 사업자 귀책의 재생 장애는 확인 후 전액 환불하거나 이용기간을 연장합니다.</li>
    </ul>
  </div>
  <!-- ARCHIVE_TOSSPAY_POLICY_END -->
  <a href="http://pf.kakao.com/_AHdvn/chat" style="display:inline-block;margin-top:4px;padding:13px 18px;background:#f8de59;color:#171717!important;text-decoration:none;font-weight:800;border:1px solid #d9be2d;">카카오톡 문의</a>
</section>`;
}

function updateCatalog(videos) {
  const next = structuredClone(catalog);
  for (const product of next.products) delete product.verifyInRelease;

  for (const video of videos) {
    const product = {
      code: video.code,
      productNo: video.productNo,
      title: video.title,
      groupCode: video.groupCode,
      watchPath: video.watchPath,
      saleStatus: "sale",
      displayed: true,
      previewYouTubeId: video.previewYouTubeId,
      verifyInRelease: true,
    };
    const codeIndex = next.products.findIndex((item) => item.code === video.code);
    const productNoConflict = next.products.find(
      (item) => item.productNo === video.productNo && item.code !== video.code,
    );
    assert(!productNoConflict, `${video.productNo} already belongs to ${productNoConflict?.code}.`);
    if (codeIndex >= 0) next.products[codeIndex] = { ...next.products[codeIndex], ...product };
    else next.products.push(product);
  }
  next.products.sort((left, right) => left.productNo - right.productNo);
  const changed = JSON.stringify(next.products) !== JSON.stringify(catalog.products);
  if (changed) next.runtime = advanceRuntime(next.runtime, input.releaseDate);
  validatePaidVideoCatalog(next);
  const protectedPaths = [
    "config/imweb-paid-video-catalog.json",
    "official-home/assets/imweb-my-classroom-20260723a.js",
    "official-home/assets/imweb-video-sales-20260730b.js",
    "scripts/imweb/imweb-my-classroom-loader.html",
    "scripts/imweb/install-video-sales-growth.html",
  ].map((relativePath) => path.join(ROOT, relativePath));
  const snapshots = new Map(
    protectedPaths.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]),
  );

  try {
    write(path.join(ROOT, "config/imweb-paid-video-catalog.json"), `${JSON.stringify(next, null, 2)}\n`);
    runLocalScript("scripts/imweb/sync-paid-video-catalog.mjs", ["--write"]);
    runLocalScript("scripts/validate-imweb-paid-video-catalog.mjs");
  } catch (error) {
    for (const [filePath, source] of snapshots) fs.writeFileSync(filePath, source, "utf8");
    throw new Error(`Catalog update rolled back: ${error.message}`);
  }
}

function advanceRuntime(runtime, releaseDate) {
  const classroomAssetVersion = nextVersion(runtime.classroomAssetVersion, releaseDate, "a");
  const classroomLoaderVersion = nextVersion(
    runtime.classroomLoaderVersion,
    releaseDate,
    classroomAssetVersion.endsWith("a") ? "b" : "a",
  );
  return {
    releaseDate,
    classroomAssetVersion,
    classroomLoaderVersion,
    classroomAssetQuery: `${releaseDate.replaceAll("-", "")}${classroomAssetVersion.at(-1)}`,
    videoSalesVersion: nextVersion(runtime.videoSalesVersion, releaseDate, "a"),
  };
}

function nextVersion(current, date, firstSuffix) {
  const match = String(current || "").match(/^(\d{4}-\d{2}-\d{2})([a-z])$/);
  if (!match || match[1] !== date) return `${date}${firstSuffix}`;
  const nextCode = match[2].charCodeAt(0) + 1;
  assert(nextCode <= "z".charCodeAt(0), `Version suffix exhausted for ${date}.`);
  return `${date}${String.fromCharCode(nextCode)}`;
}

function assertUnique(rows, key) {
  const seen = new Set();
  for (const row of rows) {
    const value = row[key];
    assert(!seen.has(value), `${key} is duplicated: ${value}`);
    seen.add(value);
  }
}

function isRemoteUrl(value) {
  return /^https:\/\//.test(String(value || ""));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function runLocalScript(relativePath, extraArgs = []) {
  const result = spawnSync(process.execPath, [path.join(ROOT, relativePath), ...extraArgs], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${relativePath} failed.`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
