import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { planPatch, assertPreserved } from "../patch-official-home-indexing.mjs";

test("Hosting patch preserves every unrelated asset and config field", () => {
  const config = { headers: [{ glob: "**", headers: { example: "preserved" } }],
    redirects: [{ glob: "/community{,/**}", location: "https://archivepilates.imweb.me/community", statusCode: 302 },
      { glob: "/my-classroom", location: "https://archivepilates.imweb.me/my-page", statusCode: 302 }],
    rewrites: [{ glob: "**", path: "/index.html" }] };
  const files = { "/sitemap.xml": "old", "/assets/classroom.js": "untouched", "/index.html": "same" };
  const result = planPatch(config, files, "new");
  assertPreserved(files, result.files);
  assert.equal(config.redirects[0].statusCode, 302);
  const expected = structuredClone(config);
  expected.redirects[0].statusCode = 301;
  assert.deepEqual(result.config, expected);
  assert.throws(() => assertPreserved(files, { ...result.files, "/assets/classroom.js": "rollback" }));
  assert.throws(() => assertPreserved(files, { "/sitemap.xml": "new" }));
});

test("All 80 live paths, including Firebase initialization, survive the delta", () => {
  const files = Object.fromEntries(Array.from({ length: 77 }, (_, i) => [`/assets/${i}.js`, `hash${i}`]));
  Object.assign(files, { "/sitemap.xml": "old", "/__/firebase/init.js": "init-js", "/__/firebase/init.json": "init-json" });
  const config = { redirects: [{ glob: "/community{,/**}", location: "https://archivepilates.imweb.me/community", statusCode: 302 }] };
  const plan = planPatch(config, files, "new");
  assert.equal(Object.keys(plan.files).length, 80);
  assertPreserved(files, plan.files);
});

const source = fs.readFileSync(new URL("../imweb/install-site-improvements-p1.html", import.meta.url), "utf8");
const policy = source.slice(source.indexOf("  function normalizedPath()"), source.indexOf("  function installStyle()"));
function inspect(pathname, search) {
  const tags = new Map([["canonical", "https://archivepilates.imweb.me/17/?idx=33"]]);
  const context = { URLSearchParams, OFFICIAL_HOME: "https://archivepilates.com/", window: { location: { pathname, search, origin: "https://archivepilates.imweb.me" } },
    document: { querySelector: selector => tags.has(selector.includes("canonical") ? "canonical" : "robots")
      ? { setAttribute: (_, value) => tags.set(selector.includes("canonical") ? "canonical" : "robots", value) } : null,
    createElement: () => ({ setAttribute(name, value) { this[name] = value; } }),
    head: { appendChild: node => tags.set(node.name || "canonical", node.content || node.href) } } };
  vm.runInNewContext(policy + "applyIndexPolicy();applyIndexPolicy();", context);
  return Object.fromEntries(tags);
}
test("Root-query product aliases are not treated as the homepage", () => {
  for (const route of ["/", "/index", "/index/", "/shop_view/33", "/17/"]) {
    assert.deepEqual(inspect(route, "?idx=33"), { canonical: "https://archivepilates.imweb.me/17/?idx=33" });
  }
});
test("Genuine home and existing filter/private policies remain unchanged", () => {
  for (const route of ["/", "/index"]) assert.deepEqual(inspect(route, ""), {
    canonical: "https://archivepilates.com/", robots: "noindex,follow" });
  assert.equal(inspect("/48", "").robots, "noindex,nofollow");
  assert.equal(inspect("/17", "?ap_equipment=chair").robots, "noindex,follow");
  for (const route of ["/16", "/shop_view"]) assert.equal(inspect(route, "?idx=33").robots, "noindex,follow");
});
