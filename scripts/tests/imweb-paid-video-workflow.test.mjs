import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadPaidVideoCatalog,
  releaseProducts,
  renderClassroomCatalog,
  renderVideoSalesCatalog,
  validatePaidVideoCatalog,
} from "../imweb/lib/paid-video-catalog.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

test("canonical catalog produces both public runtime catalogs", () => {
  const catalog = loadPaidVideoCatalog(ROOT);
  const classroom = renderClassroomCatalog(catalog);
  const sales = renderVideoSalesCatalog(catalog);

  assert.ok(catalog.products.length >= 31);
  assert.equal(catalog.runtime.releaseDate, "2026-09-23");
  const currentRelease = releaseProducts(catalog);
  assert.ok(currentRelease.length > 0);
  assert.ok(currentRelease.every((product) => product.previewYouTubeId));
  for (const product of catalog.products) {
    assert.match(classroom, new RegExp(`"code":"${product.code}"`));
    assert.match(sales, new RegExp(`${product.productNo}: \\{ code: "${product.code}"`));
  }
  assert.doesNotMatch(classroom, /fullYouTubeId|youtube\.com\/embed/);
  assert.doesNotMatch(sales, /fullYouTubeId|youtube\.com\/embed/);
});

test("catalog rejects duplicate product identifiers", () => {
  const catalog = structuredClone(loadPaidVideoCatalog(ROOT));
  catalog.products[1].productNo = catalog.products[0].productNo;
  assert.throws(() => validatePaidVideoCatalog(catalog), /productNo is duplicated/);
});

test("release preparation keeps the full video id out of public product artifacts", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-paid-video-test-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "scripts/imweb/prepare-paid-video-release.mjs"),
        path.join(ROOT, "config/imweb-paid-video-release.example.json"),
        outputDir,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const detail = fs.readFileSync(path.join(outputDir, "aca7-product-detail.html"), "utf8");
    const product = fs.readFileSync(path.join(outputDir, "aca7-product-create.json"), "utf8");
    const privateWatch = fs.readFileSync(
      path.join(outputDir, "aca7-private-watch-page.json"),
      "utf8",
    );
    const youtube = JSON.parse(
      fs.readFileSync(path.join(outputDir, "aca7-youtube-metadata.json"), "utf8"),
    );
    assert.doesNotMatch(detail, /BBBBBBBBBBB/);
    assert.doesNotMatch(product, /BBBBBBBBBBB/);
    assert.match(detail, /AAAAAAAAAAA/);
    assert.match(privateWatch, /BBBBBBBBBBB/);
    assert.equal(youtube.full.privacy, "unlisted");
    assert.equal(youtube.preview.privacy, "public");

    const unsafeApply = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts/imweb/apply-paid-video-products.mjs"), outputDir, "--apply"],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.notEqual(unsafeApply.status, 0);
    assert.match(unsafeApply.stderr, /replace every example placeholder/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
