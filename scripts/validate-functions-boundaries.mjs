import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "firebase", "codebase-boundaries.json");
const functionsLibPath = path.join(repoRoot, "firebase", "kangsain-functions", "functions", "lib", "index.js");

function fail(message) {
  console.error(`validate-functions-boundaries failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail(`missing manifest ${manifestPath}`);
if (!fs.existsSync(functionsLibPath)) fail("functions lib/index.js is missing; run npm run build in functions first");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const require = createRequire(import.meta.url);
const exportsObject = require(functionsLibPath);
const actualNames = Object.keys(exportsObject).sort();
const targetCodebases = manifest.targetCodebases || {};
const groupedNames = Object.values(targetCodebases)
  .flatMap((group) => group.owns || [])
  .sort();

const duplicateNames = groupedNames.filter((name, index) => groupedNames.indexOf(name) !== index);
if (duplicateNames.length) fail(`duplicate function ownership: ${[...new Set(duplicateNames)].join(", ")}`);

const missingFromBuild = groupedNames.filter((name) => !actualNames.includes(name));
if (missingFromBuild.length) fail(`manifest functions missing from compiled exports: ${missingFromBuild.join(", ")}`);

const missingFromManifest = actualNames.filter((name) => !groupedNames.includes(name));
if (missingFromManifest.length) fail(`compiled exports missing from manifest: ${missingFromManifest.join(", ")}`);

if (manifest.physicalCodebaseSplitEnabled !== false) {
  fail("physical codebase split should stay disabled until a dedicated deploy migration task");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      activeCodebase: manifest.currentActiveFirebaseCodebase,
      physicalCodebaseSplitEnabled: manifest.physicalCodebaseSplitEnabled,
      groups: Object.fromEntries(
        Object.entries(targetCodebases).map(([name, group]) => [name, (group.owns || []).length]),
      ),
      exportedFunctions: actualNames.length,
    },
    null,
    2,
  ),
);
