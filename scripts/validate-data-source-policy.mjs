import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const forbiddenCollections = ["member360Cards", "members", "workLanes"];
const actionRoots = [
  "firebase/kangsain-functions/functions/src/alimtalk",
  "firebase/kangsain-functions/functions/src/callable",
  "firebase/kangsain-functions/functions/src/memberSignup",
  "firebase/kangsain-functions/functions/src/privateLessonChart",
  "firebase/kangsain-functions/functions/src/privateSurvey",
  "firebase/kangsain-functions/functions/src/queue",
  "firebase/kangsain-functions/functions/src/sync",
];

const allowedFiles = new Set([
  "firebase/kangsain-functions/functions/src/callable/getInstructorHome.ts",
]);

const collectionPattern = (name) =>
  new RegExp(`(?:collection\\s*\\(\\s*[\\"']${name}[\\"']|refs\\.${escapeRegExp(name)}\\s*\\()`);

const violations = [];
for (const root of actionRoots) {
  for (const file of walk(path.join(repoRoot, root))) {
    const rel = path.relative(repoRoot, file);
    if (!file.endsWith(".ts") || allowedFiles.has(rel)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const collection of forbiddenCollections) {
      if (collectionPattern(collection).test(text)) {
        violations.push({ file: rel, collection });
      }
    }
  }
}

if (violations.length) {
  console.error("validate-data-source-policy failed: member-facing action code must not use mirror/incubation collections directly");
  for (const item of violations) {
    console.error(`- ${item.file}: ${item.collection}`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checkedRoots: actionRoots.length,
      forbiddenCollections,
    },
    null,
    2,
  ),
);

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
