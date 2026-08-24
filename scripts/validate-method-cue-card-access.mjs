import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const METHOD_ROOT = path.join(ROOT, "archivein", "method");
const OPEN_MESSAGE = "수업자료는 수업 당일 12시에 공개됩니다.";
const failures = [];

function fail(file, message) {
  failures.push(`${path.relative(ROOT, file)}: ${message}`);
}

const cueCardFiles = fs
  .readdirSync(METHOD_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /-\d{6}$/.test(entry.name))
  .map((entry) => path.join(METHOD_ROOT, entry.name, "index.html"))
  .filter((file) => fs.existsSync(file));

for (const file of cueCardFiles) {
  const html = fs.readFileSync(file, "utf8");
  const slug = path.basename(path.dirname(file));
  const dateMatch = slug.match(/-(\d{2})(\d{2})(\d{2})$/);
  const expectedDate = dateMatch ? `20${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : "";
  const bodyTag = html.match(/<body\b[^>]*>/i)?.[0] || "";

  const requiredMarkers = [
    '../assets/method-access.css',
    '../assets/method-access.js',
    'class="method-gate"',
    'data-method-gate',
    'data-method-gate-message',
    'data-method-content',
    OPEN_MESSAGE,
  ];

  for (const marker of requiredMarkers) {
    if (!html.includes(marker)) fail(file, `required marker missing: ${marker}`);
  }

  if (!bodyTag.includes(`data-method-date="${expectedDate}"`)) {
    fail(file, `data-method-date must match the slug date (${expectedDate})`);
  }
  if (!/class="[^"]*\bmethod-locked\b[^"]*"/.test(bodyTag)) {
    fail(file, "body must start with method-locked to prevent an early content flash");
  }

  const forbiddenPatterns = [
    ["data-lesson-start", /data-lesson-start/],
    ["data-sequence-open", /data-sequence-open/],
    ["legacy 13:00 release time", /T13:00:00\+09:00|13:00 공개|오후\s*1시에.*공개/],
  ];
  for (const [label, pattern] of forbiddenPatterns) {
    if (pattern.test(html)) fail(file, `forbidden ${label} remains`);
  }
}

const accessScript = path.join(METHOD_ROOT, "assets", "method-access.js");
const accessScriptSource = fs.readFileSync(accessScript, "utf8");
for (const marker of ["T12:00:00+09:00", OPEN_MESSAGE, 'body.classList.toggle("method-locked"']) {
  if (!accessScriptSource.includes(marker)) fail(accessScript, `default access marker missing: ${marker}`);
}

if (failures.length) {
  console.error(`ARCHIVE METHOD cue-card access validation failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(`ARCHIVE METHOD cue-card access validation passed (${cueCardFiles.length} cue cards, 12:00 KST).`);
