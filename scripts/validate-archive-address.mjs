#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const canonicalAddress = "부산광역시 강서구 명지국제2로28번길 34 에코팰리스 704호";
const requiredFiles = [
  "privacy/index.html",
  "method/index.html",
  "careers/src/App.tsx",
  "core/rules/index.html",
  "docs/tasks/2026-06-03-privacy-subdomain.md",
  "docs/decisions/2026-08-24-instructor-lesson-booking-confirmation-calendar.md",
];
const scannedRoots = ["archivein", "careers/src", "core", "method", "privacy"];
const staleAddressFragments = [
  "명지국제8로 265",
  "신화빌딩 6층",
  "부산 강서구 명지 에코팰리스 704호",
  "부산 강서구 명지국제2로28번길 34",
  "부산광역시 강서구 명지국제2로 28번길 34",
  "부산광역시 강서구 명지국제2로28번길 34, 7층 704호",
];
const failures = [];

for (const file of requiredFiles) {
  const content = readFileSync(join(root, file), "utf8");
  if (!content.includes(canonicalAddress)) {
    failures.push(`${file}: canonical ARCHIVE PILATES address is missing`);
  }
}

for (const directory of scannedRoots) {
  for (const file of walk(join(root, directory))) {
    if (!isTextFile(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const staleAddress of staleAddressFragments) {
      if (content.includes(staleAddress)) {
        failures.push(`${relative(root, file)}: stale address fragment remains (${staleAddress})`);
      }
    }
  }
}

if (failures.length) {
  console.error(`ARCHIVE PILATES address validation failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`ARCHIVE PILATES address validation passed (${requiredFiles.length} canonical sources)`);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function isTextFile(file) {
  return /\.(?:css|html|ics|js|json|md|mjs|txt|ts)$/i.test(file);
}
