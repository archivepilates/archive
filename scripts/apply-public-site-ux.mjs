import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

assert(process.argv.includes("--apply"), "Explicit --apply required; prepare and verify the release first.");
const publicResponse = await fetch("https://archivepilates.imweb.me/17", { signal: AbortSignal.timeout(15000) });
assert(publicResponse.ok, "Cannot verify existing public UX installation");
assert(!(await publicResponse.text()).includes('data-archive-pilates-public-ux="2026-09-05a"'),
  "Public UX is already installed. Preserve SEO common code; duplicate unit writes are forbidden.");
const dir = "artifacts/public-site-ux-20260905";
function cli(args) {
  const result = spawnSync("/Users/archivepilates/.local/bin/imweb", ["--output", "json", ...args], { encoding: "utf8", maxBuffer: 32e6 });
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { parsed = {}; }
  if (result.status !== 0) {
    fs.writeFileSync(`${dir}/apply-error.json`, JSON.stringify(parsed, null, 2));
    throw new Error(`Imweb ${args.slice(0, 2).join(" ")} failed (${result.status}). ${parsed.error?.code || parsed.code || "See private apply-error.json"}`);
  }
  return parsed;
}
const scripts = () => Object.fromEntries(cli(["script", "list"]).data.map(row => [row.position, row.scriptContent]));
const current = scripts();
for (const position of ["header", "body", "footer"]) {
  assert.equal(current[position], fs.readFileSync(`${dir}/${position}-before.html`, "utf8"), `${position} changed concurrently; stop before writes`);
}
for (const position of ["footer", "header"]) {
  const file = `@${dir}/${position}-payload.json`;
  const dry = cli(["script", "update", "--dry-run", "--data", file]);
  assert(dry.safety?.execute_ready && dry.confirmation_token, `${position}: dry run not ready`);
  cli(["script", "update", "--yes", "--confirm-token", dry.confirmation_token, "--data", file]);
  const actual = scripts();
  assert.equal(actual[position], fs.readFileSync(`${dir}/${position}-after.html`, "utf8"), `${position}: saved readback differs`);
  assert.equal(actual.body, current.body, "Unrelated body/classroom source changed");
  console.log(`${position}: saved and independently read back`);
}
fs.writeFileSync(`${dir}/applied.json`, JSON.stringify({ applied: true, verified: true, positions: ["footer", "header"], bodyUntouched: true, time: new Date().toISOString() }, null, 2));
