import assert from "node:assert/strict";
import test from "node:test";
import { codebasesForFile } from "../lib/affected-functions.mjs";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

test("member signup handlers deploy with the private chart codebase", () => {
  for (const file of ["onsiteWelcomeRequest.ts", "memberSignupContract.ts"]) {
    assert.deepEqual(
      codebasesForFile(`firebase/kangsain-functions/functions/src/memberSignup/${file}`),
      ["functions-private-chart"],
    );
  }
});

test("welcome history deploy selection matches the actual exported dependency graph", async () => {
  const file = "firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomeHistory.ts";
  const manifest = JSON.parse(await readFile(new URL("../../firebase/codebase-boundaries.json", import.meta.url), "utf8"));
  const consumers = [];
  for (const [codebase, config] of Object.entries(manifest.targetCodebases)) {
    const compiled = await build({ entryPoints: [config.sourceEntrypoint], bundle: true, write: false,
      platform: "node", packages: "external", metafile: true, logLevel: "silent" });
    if (Object.keys(compiled.metafile.inputs).includes(file)) consumers.push(codebase);
  }
  assert.deepEqual(consumers, ["functions-alimtalk"]);
  assert.deepEqual(codebasesForFile(file), consumers);
});
