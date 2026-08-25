import fs from "node:fs";
import path from "node:path";

const firebasePath = path.resolve("firebase.archive-home.json");
const packagePath = path.resolve("package.json");
const workflowPath = path.resolve(".github/workflows/archive-home-classroom-guard.yml");

const firebaseConfig = JSON.parse(fs.readFileSync(firebasePath, "utf8"));
const packageConfig = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const workflow = fs.readFileSync(workflowPath, "utf8");
const hosting = firebaseConfig.hosting;

assert(hosting?.site === "archive-pilates-home", "Unexpected Firebase Hosting site.");
assert(hosting?.public === "official-home", "Unexpected Firebase Hosting public directory.");
assert(
  hosting.predeploy?.includes("npm run validate:archive-home-address"),
  "ARCHIVE PILATES address predeploy guard is missing.",
);
assert(
  hosting.predeploy?.includes("npm run validate:archive-home-classroom"),
  "My Classroom predeploy guard is missing.",
);
assert(
  hosting.postdeploy?.includes("npm run verify:archive-home-classroom-live"),
  "My Classroom postdeploy canary is missing.",
);

const classroomHeader = hosting.headers?.find(
  ({ source }) => source === "/assets/imweb-my-classroom-20260723a.js",
);
const headerMap = new Map(
  (classroomHeader?.headers || []).map(({ key, value }) => [key.toLowerCase(), value]),
);
assert(
  headerMap.get("cache-control")?.includes("no-store"),
  "My Classroom asset must keep a no-store cache policy.",
);
assert(
  headerMap.get("content-type")?.includes("application/javascript"),
  "My Classroom asset must keep an explicit JavaScript content type.",
);

const validateCommand = packageConfig.scripts?.["validate:archive-home-classroom"] || "";
assert(
  validateCommand.includes("validate-archive-home-classroom-release-config.mjs"),
  "The classroom validation command no longer checks release config.",
);
assert(
  validateCommand.includes("validate-archive-home-classroom-asset.mjs"),
  "The classroom validation command no longer checks the deployed asset.",
);
assert(
  validateCommand.includes("validate-imweb-classroom-loader-fallback.mjs"),
  "The classroom validation command no longer checks loader fallback behavior.",
);
assert(
  packageConfig.scripts?.["verify:archive-home-classroom-live"] ===
    "node scripts/verify-archive-home-classroom-live.mjs",
  "The classroom live verification command changed unexpectedly.",
);

[
  "firebase.archive-home.json",
  "official-home/index.html",
  "official-home/assets/imweb-my-classroom-20260723a.js",
  "scripts/imweb/imweb-my-classroom-loader.html",
  "scripts/validate-archive-home-classroom-release-config.mjs",
  "scripts/validate-archive-home-address.mjs",
  "scripts/validate-archive-home-classroom-asset.mjs",
  "scripts/validate-imweb-classroom-loader-fallback.mjs",
  "scripts/verify-archive-home-classroom-live.mjs",
].forEach((watchedPath) => {
  assert(
    workflow.includes(`- "${watchedPath}"`),
    `GitHub classroom guard no longer watches ${watchedPath}.`,
  );
});
assert(
  workflow.includes("run: npm run validate:archive-home-classroom"),
  "GitHub classroom guard no longer runs the validation command.",
);
assert(
  workflow.includes("run: npm run validate:archive-home-address"),
  "GitHub classroom guard no longer validates the ARCHIVE PILATES address.",
);

console.log("Validated My Classroom release configuration.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
