#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const requiredChunkExpression = "16 * 1024 * 1024";
const expectedBytes = 16 * 1024 * 1024;

const required = [
  {
    file: "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonMedia.ts",
    label: "server chunk size",
    markers: [`const CHUNK_SIZE = ${requiredChunkExpression};`],
  },
  {
    file: "archivein/private-chart/index.html",
    label: "browser fallback chunk size",
    markers: [`init.chunkSize || ${requiredChunkExpression}`],
  },
  {
    file: "scripts/validate-private-media-upload-live.mjs",
    label: "live validation chunk expectation",
    markers: [`init.chunkSize || ${requiredChunkExpression}`],
  },
  {
    file: "core/rules/index.html",
    label: "operator rule copy",
    markers: ["업로드는 16MB 청크 기준"],
  },
];

const forbidden = [
  {
    file: "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonMedia.ts",
    markers: ["const CHUNK_SIZE = 8 * 1024 * 1024;", "const CHUNK_SIZE = 1024 * 1024;"],
  },
  {
    file: "archivein/private-chart/index.html",
    markers: ["init.chunkSize || 8 * 1024 * 1024", "init.chunkSize || 1024 * 1024"],
  },
  {
    file: "scripts/validate-private-media-upload-live.mjs",
    markers: ["init.chunkSize || 8 * 1024 * 1024", "init.chunkSize || 1024 * 1024"],
  },
  {
    file: "core/rules/index.html",
    markers: ["업로드는 8MB 청크 기준", "업로드는 1MB 청크 기준"],
  },
];

const failures = [];
for (const item of required) {
  const content = readFile(item.file);
  for (const marker of item.markers) {
    if (!content.includes(marker)) {
      failures.push({ type: "missing", file: item.file, label: item.label, marker });
    }
  }
}

for (const item of forbidden) {
  const content = readFile(item.file);
  for (const marker of item.markers) {
    if (content.includes(marker)) {
      failures.push({ type: "forbidden", file: item.file, marker });
    }
  }
}

if (failures.length) {
  console.error("Private media upload config guard failed.");
  console.error("Expected private lesson media uploads to use 16MB Drive direct upload chunks.");
  console.error(JSON.stringify({ expectedBytes, failures }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      guard: "private-media-upload-16mb-drive-direct",
      expectedBytes,
      checked: required.map((item) => item.file),
    },
    null,
    2,
  ),
);

function readFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}
