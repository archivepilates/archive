import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "firebase", "codebase-boundaries.json");
const baseSrcDir = path.join(repoRoot, "firebase", "kangsain-functions", "functions", "src");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const targets = Object.entries(manifest.targetCodebases || {});
const baseNodeModulesDir = path.join(repoRoot, "firebase", "kangsain-functions", "functions", "node_modules");

const requested = process.argv[2] || "all";
const selected = selectTargets(requested);

for (const [codebase, config] of selected) {
  const sourceDir = path.resolve(repoRoot, config.physicalSource);
  assertInsideRepo(sourceDir);
  const targetSrcDir = path.join(sourceDir, "src");
  const targetLibDir = path.join(sourceDir, "lib");
  await fs.rm(targetSrcDir, { recursive: true, force: true });
  await fs.rm(targetLibDir, { recursive: true, force: true });
  await fs.cp(baseSrcDir, targetSrcDir, { recursive: true });
  await fs.writeFile(path.join(targetSrcDir, "index.ts"), entrypointFor(config.sourceEntrypoint), "utf8");
  await ensureLocalNodeModulesLink(sourceDir);
  console.log(`prepared ${codebase} at ${path.relative(repoRoot, sourceDir)}`);
}

function selectTargets(value) {
  if (value === "all") return targets;
  const absolute = path.resolve(repoRoot, value);
  const matched = targets.filter(([, config]) => path.resolve(repoRoot, config.physicalSource) === absolute);
  if (matched.length) return matched;
  const byName = targets.filter(([codebase, config]) => codebase === value || path.basename(config.physicalSource) === value);
  if (byName.length) return byName;
  throw new Error(`Unknown functions codebase target: ${value}`);
}

function assertInsideRepo(targetPath) {
  const relative = path.relative(repoRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to prepare outside repo: ${targetPath}`);
  }
}

function entrypointFor(sourceEntrypoint) {
  const match = sourceEntrypoint.match(/src\/exports\/([^/]+)\.ts$/);
  if (!match) throw new Error(`Unsupported sourceEntrypoint: ${sourceEntrypoint}`);
  return `import "./config/firebase";\n\nexport * from "./exports/${match[1]}";\n`;
}

async function ensureLocalNodeModulesLink(sourceDir) {
  const targetNodeModules = path.join(sourceDir, "node_modules");
  try {
    const stat = await fs.lstat(targetNodeModules);
    if (stat.isSymbolicLink() || stat.isDirectory()) return;
    throw new Error(`${targetNodeModules} exists but is not a directory or symlink`);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs.symlink(baseNodeModulesDir, targetNodeModules, "dir");
}
