import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const dir = "artifacts/public-site-ux-20260905";
const publicResponse = await fetch("https://archivepilates.imweb.me/17", { signal: AbortSignal.timeout(15000) });
if (!publicResponse.ok) throw new Error("Cannot verify existing public UX installation");
if ((await publicResponse.text()).includes('data-archive-pilates-public-ux="2026-09-05a"')) {
  throw new Error("Public UX is already installed. Preserve SEO common code; do not prepare duplicate unit scripts.");
}
fs.mkdirSync(dir, { recursive: true });
const listing = JSON.parse(execFileSync("/Users/archivepilates/.local/bin/imweb", ["--output", "json", "script", "list"], { encoding: "utf8", maxBuffer: 32e6 }));
const before = Object.fromEntries(listing.data.map(row => [row.position, row.scriptContent]));
for (const key of ["header", "body", "footer"]) {
  if (!before[key]) throw new Error(`Missing ${key}`);
  const saved = path.join(dir, `${key}-before.html`);
  if (fs.existsSync(saved) && fs.readFileSync(saved, "utf8") !== before[key]) throw new Error(`Live ${key} changed since snapshot; review concurrent work first`);
  fs.writeFileSync(saved, before[key]);
}
let header = before.header;
const obsolete = /<script data-archive-pilates-knitido-shipping-review="2026-07-29c">[\s\S]*?<\/script>/g;
if ([...header.matchAll(obsolete)].length !== 1) throw new Error("Unexpected missing-asset loader count");
header = header.replace(obsolete, "");
const loader = fs.readFileSync("scripts/imweb/install-public-site-ux.html", "utf8").trim();
if (header.includes("data-archive-pilates-public-ux")) throw new Error("UX installer already exists");
header += "\n\n" + loader + "\n";
let footer = before.footer;
for (const [variable, name, height] of [["GROUP_IMG", "team", 853], ["FACTORY_IMG", "factory", 854], ["SEA_IMG", "coast", 853]]) {
  const pattern = new RegExp(`var ${variable}="https://storage.googleapis.com/[^\"]+";`, "g");
  if ([...footer.matchAll(pattern)].length !== 1) throw new Error(`${variable} source changed`);
  footer = footer.replace(pattern, `var ${variable}="https://archivepilates.com/assets/knitido-${name}-20260905-1280.webp";`);
  const template = `<img src="'+${variable}+'"`;
  if (footer.split(template).length !== 2) throw new Error(`${variable} template changed`);
  footer = footer.replace(template, `${template} srcset="https://archivepilates.com/assets/knitido-${name}-20260905-640.webp 640w, https://archivepilates.com/assets/knitido-${name}-20260905-1280.webp 1280w" sizes="(max-width: 860px) calc(100vw - 32px), 590px" width="1280" height="${height}" decoding="async"`);
}
const after = { ...before, header, footer };
const summary = {};
for (const position of ["header", "body", "footer"]) {
  fs.writeFileSync(`${dir}/${position}-after.html`, after[position]);
  const payload = { unitCode: "u2026051698c99ea234719", position, scriptContent: after[position] };
  fs.writeFileSync(`${dir}/${position}-payload.json`, JSON.stringify(payload));
  summary[position] = { changed: before[position] !== after[position], before: crypto.createHash("sha256").update(before[position]).digest("hex"), after: crypto.createHash("sha256").update(after[position]).digest("hex"), length: after[position].length };
}
fs.writeFileSync(`${dir}/script-manifest.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
