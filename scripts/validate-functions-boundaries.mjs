import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "firebase", "codebase-boundaries.json");
const firebaseConfigPath = path.join(repoRoot, "firebase.json");

function fail(message) {
  console.error(`validate-functions-boundaries failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail(`missing manifest ${manifestPath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const targetCodebases = manifest.targetCodebases || {};
const groupedNames = Object.values(targetCodebases)
  .flatMap((group) => group.owns || [])
  .sort();

const duplicateNames = groupedNames.filter((name, index) => groupedNames.indexOf(name) !== index);
if (duplicateNames.length) fail(`duplicate function ownership: ${[...new Set(duplicateNames)].join(", ")}`);

const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
const functionsConfig = Array.isArray(firebaseConfig.functions) ? firebaseConfig.functions : [firebaseConfig.functions];
const configuredCodebases = functionsConfig.map((config) => config.codebase).sort();
const expectedCodebases = Object.keys(targetCodebases).sort();
if (configuredCodebases.join("\n") !== expectedCodebases.join("\n")) {
  fail(`firebase.json codebases do not match manifest: ${configuredCodebases.join(", ")} vs ${expectedCodebases.join(", ")}`);
}

const buildSummaries = {};
for (const [codebase, group] of Object.entries(targetCodebases)) {
  const physicalSource = group.physicalSource;
  if (!physicalSource) fail(`${codebase} is missing physicalSource`);
  const sourceDir = path.join(repoRoot, physicalSource);
  const packagePath = path.join(sourceDir, "package.json");
  const tsconfigPath = path.join(sourceDir, "tsconfig.json");
  if (!fs.existsSync(packagePath)) fail(`${codebase} is missing package.json`);
  if (!fs.existsSync(tsconfigPath)) fail(`${codebase} is missing tsconfig.json`);
  const exportModuleName = exportModuleNameFromEntrypoint(group.sourceEntrypoint);
  const compiledExportPath = path.join(sourceDir, "lib", "exports", `${exportModuleName}.js`);
  if (!fs.existsSync(compiledExportPath)) {
    fail(`${codebase} compiled export is missing; run npm run build:function-codebases first`);
  }
  const actualNames = exportedNamesFromCompiledFile(compiledExportPath);
  const expectedNames = [...(group.owns || [])].sort();
  const missingFromBuild = expectedNames.filter((name) => !actualNames.includes(name));
  const missingFromManifest = actualNames.filter((name) => !expectedNames.includes(name));
  if (missingFromBuild.length) fail(`${codebase} manifest functions missing from compiled export: ${missingFromBuild.join(", ")}`);
  if (missingFromManifest.length) fail(`${codebase} compiled exports missing from manifest: ${missingFromManifest.join(", ")}`);
  buildSummaries[codebase] = actualNames.length;
}

if (manifest.physicalCodebaseSplitEnabled !== true) {
  fail("physical codebase split must be explicitly enabled in manifest");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      previousCodebase: manifest.previousFirebaseCodebase,
      physicalCodebaseSplitEnabled: manifest.physicalCodebaseSplitEnabled,
      groups: Object.fromEntries(
        Object.entries(targetCodebases).map(([name, group]) => [name, (group.owns || []).length]),
      ),
      builtCodebases: buildSummaries,
      exportedFunctions: groupedNames.length,
    },
    null,
    2,
  ),
);

function exportModuleNameFromEntrypoint(sourceEntrypoint) {
  const match = String(sourceEntrypoint || "").match(/src\/exports\/([^/]+)\.ts$/);
  if (!match) fail(`Unsupported sourceEntrypoint: ${sourceEntrypoint}`);
  return match[1];
}

function exportedNamesFromCompiledFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return [...new Set([...text.matchAll(/exports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g)].map((match) => match[1]))].sort();
}
