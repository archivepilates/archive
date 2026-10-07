import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "sites/archive-pilates-home";
const API = "https://firebasehosting.googleapis.com/v1beta1/";

export function planPatch(config, files, sitemapHash) {
  const nextConfig = structuredClone(config);
  const rules = nextConfig.redirects.filter(r => r.glob === "/community{,/**}");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].location, "https://archivepilates.imweb.me/community");
  assert([301, 302].includes(rules[0].statusCode));
  rules[0].statusCode = 301;
  assert(files["/sitemap.xml"]);
  return { config: nextConfig, files: { ...files, "/sitemap.xml": sitemapHash } };
}

export function assertPreserved(before, after) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const [file, hash] of Object.entries(before)) {
    if (file !== "/sitemap.xml") assert.equal(after[file], hash, `Unexpected change: ${file}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  async function api(resource, method = "GET", body) {
    const response = await fetch(API + resource, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json();
    assert(response.ok, `${method} ${resource}: ${response.status} ${JSON.stringify(result)}`);
    return result;
  }
  async function latest() {
    const result = await api(`${SITE}/releases?pageSize=1`);
    assert(result.releases?.[0]?.version?.config);
    return result.releases[0];
  }
  async function manifest(version) {
    const files = {};
    let pageToken = "";
    do {
      const result = await api(`${version}/files?pageSize=1000&pageToken=${encodeURIComponent(pageToken)}`);
      for (const file of result.files || []) {
        assert.equal(file.status, "ACTIVE");
        assert(!Object.hasOwn(files, file.path));
        files[file.path] = file.hash;
      }
      pageToken = result.nextPageToken || "";
    } while (pageToken);
    return files;
  }
  const before = await latest();
  assert.equal(before.version.name, `${SITE}/versions/62fb81c72d9739c8`, "Baseline release changed; review required");
  const files = await manifest(before.version.name);
  assert.equal(Object.keys(files).length, 80, "Live manifest changed; review before deployment");
  for (const file of ["/__/firebase/init.js", "/__/firebase/init.json"]) assert(files[file]);
  const source = fs.readFileSync(path.join(ROOT, "official-home/sitemap.xml"));
  const xml = source.toString();
  assert(!xml.includes("https://archivepilates.com/community"));
  assert.equal((xml.match(/<loc>/g) || []).length, 8);
  const compressed = gzipSync(source);
  const hash = createHash("sha256").update(compressed).digest("hex");
  const baselineResponse = await fetch("https://archivepilates.com/sitemap.xml", { cache: "no-store" });
  assert.equal(baselineResponse.status, 200);
  const baseline = await baselineResponse.text();
  const baselineSource = execFileSync("git", ["show", "d165377:official-home/sitemap.xml"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(baseline, baselineSource, "Public sitemap differs from the reviewed baseline source");
  const communityEntry = /  <url>\s*<loc>https:\/\/archivepilates\.com\/community<\/loc>[\s\S]*?<\/url>\n/;
  assert.equal(baseline.replace(communityEntry, ""), xml, "Sitemap changes exceed removal of community redirect");
  const plan = planPatch(before.version.config, files, hash);
  assertPreserved(files, plan.files);
  const report = { apply, previousRelease: before.name, previousVersion: before.version.name,
    preservedFiles: Object.keys(files).length - 1, changedFiles: ["/sitemap.xml"],
    communityRedirect: 301 };
  if (!apply) { console.log(JSON.stringify(report, null, 2)); return; }
  const created = await api(`${SITE}/versions`, "POST", { config: plan.config });
  const populated = await api(`${created.name}:populateFiles`, "POST", { files: plan.files });
  for (const required of populated.uploadRequiredHashes || []) {
    assert.equal(required, hash, "Existing live asset unexpectedly requires re-upload; aborting");
    const upload = await fetch(`${populated.uploadUrl}/${hash}`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" }, body: compressed });
    assert(upload.ok, `Sitemap upload failed: ${upload.status}`);
  }
  await api(`${created.name}?updateMask=status`, "PATCH", { status: "FINALIZED" });
  const preparedFiles = await manifest(created.name);
  assert.deepEqual(preparedFiles, plan.files);
  const version = await api(created.name);
  assert.deepEqual(version.config, plan.config);
  assert.equal((await latest()).name, before.name, "Concurrent release detected; aborting");
  const release = await api(`${SITE}/releases?versionName=${created.name}`, "POST", {});
  assert.equal(release.version.name, created.name);
  assert.equal((await latest()).version.name, created.name);
  assertPreserved(files, await manifest(created.name));
  const live = await fetch("https://archivepilates.com/sitemap.xml", { cache: "no-store" });
  assert.equal(live.status, 200);
  assert.equal(await live.text(), source.toString());
  const redirect = await fetch("https://archivepilates.com/community", { redirect: "manual", cache: "no-store" });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "https://archivepilates.imweb.me/community");
  report.release = release.name;
  report.version = created.name;
  report.liveVerified = true;
  const directory = path.join(ROOT, "artifacts/google-indexing-20261007");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "hosting-result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lock = path.join(os.homedir(), "ArchiveIN/automation/locks/archive-pilates-home-deploy.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const descriptor = fs.openSync(lock, "wx");
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, task: "google-indexing-20261007" }));
    await main();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}
