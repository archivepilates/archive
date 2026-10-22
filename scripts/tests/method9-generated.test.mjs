import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("one content edit updates both dated cards and both previews; stale output fails", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "method9-build-"));
  try {
    for (const file of ["scripts/build-method9-cuecards.mjs", "docs/tasks/2026-10-22-method9-content.json", "archivein/logo120.png", ...["method-access.css", "support-movement-card.css", "external-feedback-card.css", "support-movement-card.js"].map((name) => `archivein/method/assets/${name}`)]) {
      fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(temp, file));
    }
    const run = (...args) => execFileSync(process.execPath, ["scripts/build-method9-cuecards.mjs", ...args], { cwd: temp, encoding: "utf8" });
    run();
    const input = path.join(temp, "docs/tasks/2026-10-22-method9-content.json");
    const data = JSON.parse(fs.readFileSync(input, "utf8"));
    data.core = "공통 원본 수정이 네 교재에 함께 반영되는지 검사합니다.";
    fs.writeFileSync(input, JSON.stringify(data));
    const rejected = spawnSync(process.execPath, ["scripts/build-method9-cuecards.mjs", "--check"], { cwd: temp, encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /out of sync/);
    run();
    const revision = createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
    const outputs = ["docs/reports/2026-10-22-method9-cuecard.html", "archivein/method/external-feedback-2610-preview/index.html", ...data.dates.map((item) => `archivein/method/${item.code}/index.html`)];
    const mtimes = outputs.map((file) => fs.statSync(path.join(temp, file)).mtimeMs);
    for (const file of outputs) {
      const html = fs.readFileSync(path.join(temp, file), "utf8");
      assert.ok(html.includes(data.core), file);
      assert.ok(html.includes(`name="method-content-revision" content="${revision}"`), file);
    }
    run("--check");
    assert.deepEqual(outputs.map((file) => fs.statSync(path.join(temp, file)).mtimeMs), mtimes);
    assert.equal(fs.readFileSync(path.join(temp, outputs[0]), "utf8"), fs.readFileSync(path.join(temp, outputs[1]), "utf8"));
    for (const item of data.dates) {
      const html = fs.readFileSync(path.join(temp, `archivein/method/${item.code}/index.html`), "utf8");
      assert.ok(html.includes(`data-method-date="${item.date}"`));
      assert.ok(html.includes('class="method-locked"'));
      assert.ok(html.includes(`data-method-preview-code="${item.preview}"`));
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
