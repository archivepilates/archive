#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredFiles = [
  "official-home/index.html",
  "official-home/teams/index.html",
  "official-home/teams/minjin/index.html",
  "official-home/teams/eunyoung/index.html",
  "official-home/teams/chorim/index.html",
  "official-home/teams/kihyo/index.html",
];
const canonicalAddress = "부산광역시 강서구 명지국제2로28번길 34 에코팰리스 704호";
const canonicalStreetAddress = "명지국제2로28번길 34 에코팰리스 704호";
const staleAddressFragments = [
  "명지국제8로 265",
  "신화빌딩 6층",
  "부산 강서구 명지 에코팰리스 704호",
  "부산광역시 강서구 명지국제2로28번길 34, 7층 704호",
  '"streetAddress": "명지국제2로28번길 34, 7층 704호"',
];
const failures = [];

for (const file of requiredFiles) {
  const html = readFileSync(resolve(file), "utf8");
  if (!html.includes(canonicalAddress)) {
    failures.push(`${file}: canonical visitor address is missing`);
  }
  for (const staleAddress of staleAddressFragments) {
    if (html.includes(staleAddress)) {
      failures.push(`${file}: stale address remains (${staleAddress})`);
    }
  }
}

const homeHtml = readFileSync(resolve("official-home/index.html"), "utf8");
if (!homeHtml.includes(`"streetAddress": "${canonicalStreetAddress}"`)) {
  failures.push("official-home/index.html: canonical JSON-LD streetAddress is missing");
}

if (failures.length) {
  console.error(`ARCHIVE PILATES home address validation failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ARCHIVE PILATES home address validation passed.");
