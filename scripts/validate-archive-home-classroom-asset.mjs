import fs from "node:fs";
import path from "node:path";

const assetPath = path.resolve("official-home/assets/imweb-my-classroom-20260723a.js");

if (!fs.existsSync(assetPath)) {
  throw new Error(`Required Imweb My Classroom asset is missing: ${assetPath}`);
}

const source = fs.readFileSync(assetPath, "utf8");
const requiredMarkers = [
  'VERSION="2026-07-28d"',
  'data-ap-classroom-v2',
  '"/archive-method-watch-ach8"',
  '"/archive-method-watch-ab9"',
  '"/private-lesson-pelvis-hip-b-barrel-260725"',
  '"/private-lesson-jey-260718"',
];

for (const marker of requiredMarkers) {
  if (!source.includes(marker)) {
    throw new Error(`Imweb My Classroom asset is missing required marker: ${marker}`);
  }
}

if (Buffer.byteLength(source, "utf8") < 10_000) {
  throw new Error("Imweb My Classroom asset is unexpectedly small.");
}

new Function(source);

console.log(`Validated Imweb My Classroom asset (${Buffer.byteLength(source, "utf8")} bytes).`);
