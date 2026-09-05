import assert from "node:assert/strict";
import fs from "node:fs";

const destination = "https://archivepilates.imweb.me/community";
const files = ["index.html", "teams/index.html", ...["kihyo", "minjin", "eunyoung", "chorim"].map(name => `teams/${name}/index.html`)];
for (const file of files) {
  const html = fs.readFileSync(`official-home/${file}`, "utf8");
  assert(html.includes('data-nav="community"'), `${file}: community menu missing`);
  assert(html.includes(`href="${destination}"`) || html.includes('href="/community"'), `${file}: community link missing`);
}
const page = fs.readFileSync("official-home/community/index.html", "utf8");
assert(page.includes(`location.replace("${destination}")`), "Direct-file fallback missing");
assert(!page.includes("게시판 열기"), "Intermediate community action returned");
const { hosting } = JSON.parse(fs.readFileSync("firebase.archive-home.json", "utf8"));
assert(hosting.redirects.some(rule => rule.source === "/community{,/**}" && rule.destination === destination && rule.type === 302), "Immediate board redirect missing");
assert(!hosting.rewrites.some(rule => rule.source === "/community"), "Obsolete landing rewrite returned");
console.log("Community navigation opens the actual board directly; legacy URLs retained.");
