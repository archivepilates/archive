import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const installer = fs.readFileSync("scripts/imweb/install-public-site-ux.html", "utf8");
const assets = [...installer.matchAll(/(?:src|href)="https:\/\/archivepilates\.com([^\"]+)"/g)].map(match => match[1]);
assert(assets.length >= 4, "UI installer assets missing");
for (const asset of assets) {
  const file = `official-home${asset}`;
  assert(fs.existsSync(file), `Installer references missing asset: ${asset}`);
  if (asset.endsWith(".js")) execFileSync(process.execPath, ["--check", file]);
}
for (const name of ["team", "coast", "factory"]) {
  for (const width of [640, 1280]) {
    const image = `official-home/assets/knitido-${name}-20260905-${width}.webp`;
    assert(fs.statSync(image).size < 220000, `Unoptimized Knitido image: ${image}`);
  }
}
assert(!installer.includes("imweb-knitido-shipping-review-20260729c"), "Missing asset loader returned");
assert(!installer.includes("imweb-my-classroom"), "UI release must not replace classroom loader");
assert(installer.includes('type="application/json" data-archive-pilates-knitido-shipping-review-asset="2026-07-29c"'), "Legacy loader retirement marker missing");
for (const script of ["prepare-public-site-ux.mjs", "apply-public-site-ux.mjs"]) {
  assert(fs.readFileSync(`scripts/${script}`, "utf8").includes("Public UX is already installed"), "Duplicate installation guard missing");
  execFileSync(process.execPath, ["--check", `scripts/${script}`]);
}
console.log(`Public-site UI installer validated: ${assets.length} assets and six responsive images.`);
