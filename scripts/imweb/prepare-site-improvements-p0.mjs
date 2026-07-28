import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const [inputDirectory, outputDirectory] = process.argv.slice(2);

if (!inputDirectory || !outputDirectory) {
  throw new Error("Usage: node prepare-site-improvements-p0.mjs <input-directory> <output-directory>");
}

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const installerDirectory = path.join(projectRoot, "scripts", "imweb");

function read(name) {
  return fs.readFileSync(path.join(inputDirectory, name), "utf8");
}

function readInstaller(name) {
  return fs.readFileSync(path.join(installerDirectory, name), "utf8").trim();
}

function replaceExactlyOnce(content, search, replacement, label) {
  const first = content.indexOf(search);
  const last = content.lastIndexOf(search);
  if (first < 0 || first !== last) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return content.slice(0, first) + replacement + content.slice(first + search.length);
}

function replaceMarkedScript(content, marker, replacement, label) {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<script\\b[^>]*\\b${escapedMarker}="[^"]+"[^>]*>[\\s\\S]*?<\\/script>\\s*`, "g");
  const matches = content.match(pattern) || [];
  if (matches.length > 1) {
    throw new Error(`${label}: found ${matches.length} marked scripts`);
  }
  if (matches.length === 1) return content.replace(pattern, replacement + "\n\n");
  return content.trimEnd() + "\n\n" + replacement + "\n";
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

let header = read("header.html");
let body = read("body.html");
let footer = read("footer.html");

body = replaceExactlyOnce(
  body,
  'var BASE = "https://archive-pilates.web.app/assets/imweb-home/v2/";',
  'var BASE = "https://archivepilates.com/assets/";',
  "home image base"
);

const imageNames = {
  "archive_home_01_hero_bg_2400x1600.webp": "hero.webp",
  "archive_home_02_wide_field_record_2400x1000.webp": "field-record.webp",
  "archive_home_03_card_offline_instructor_1200x1000.webp": "offline-class.webp",
  "archive_home_04_card_online_class_1200x1000.webp": "online-class.webp",
  "archive_home_05_card_topic_content_1200x1000.webp": "topic-content.webp",
  "archive_home_06_card_class_feedback_1200x1000.webp": "class-feedback.webp"
};

Object.entries(imageNames).forEach(([oldName, newName]) => {
  body = replaceExactlyOnce(body, oldName, newName, `home image ${oldName}`);
});

body = body.replaceAll("data-archive-pilates-home-images=\"2026-07-04b\"", 'data-archive-pilates-home-images="2026-07-28a"');
body = body.replaceAll('var VERSION = "2026-07-04b";', 'var VERSION = "2026-07-28a";');

header = replaceMarkedScript(
  header,
  "data-archive-pilates-site-improvements",
  readInstaller("install-site-improvements-p0.html"),
  "site improvements installer"
);

footer = replaceMarkedScript(
  footer,
  "data-archive-pilates-logo-official-home",
  readInstaller("install-logo-official-home.html"),
  "official home logo installer"
);

const combined = header + body + footer;
const requiredMarkers = [
  'data-archive-pilates-wishlist-loader="2026-07-28d"',
  'data-archive-pilates-mobile-header-stability="2026-07-28a"',
  'data-archive-pilates-site-improvements="2026-07-28b"',
  'data-archive-pilates-logo-official-home="2026-07-28a"',
  'data-archive-pilates-home-images="2026-07-28a"'
];

requiredMarkers.forEach((marker) => {
  if (!combined.includes(marker)) throw new Error(`missing required marker: ${marker}`);
});

const forbiddenFragments = [
  "archive-pilates.web.app/assets/imweb-home/v2/",
  "data-archive-pilates-home-bg-fix",
  "preloadHomeImages",
  "data-ap-home-preload"
];

forbiddenFragments.forEach((fragment) => {
  if (combined.includes(fragment)) throw new Error(`forbidden fragment remains: ${fragment}`);
});

fs.mkdirSync(outputDirectory, { recursive: true });
const outputs = { header, body, footer };
Object.entries(outputs).forEach(([name, content]) => {
  fs.writeFileSync(path.join(outputDirectory, `${name}.html`), content);
});

process.stdout.write(JSON.stringify({
  inputDirectory: path.resolve(inputDirectory),
  outputDirectory: path.resolve(outputDirectory),
  outputs: Object.fromEntries(Object.entries(outputs).map(([name, content]) => [
    name,
    { length: content.length, sha256: checksum(content) }
  ]))
}, null, 2) + "\n");
