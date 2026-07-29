import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const analytics = fs.readFileSync(
  path.join(ROOT, "official-home/assets/archive-analytics-20260729a.js"),
  "utf8"
);
const sales = fs.readFileSync(
  path.join(ROOT, "official-home/assets/imweb-video-sales-20260729a.js"),
  "utf8"
);
const installer = fs.readFileSync(
  path.join(ROOT, "scripts/imweb/install-video-sales-growth.html"),
  "utf8"
);
const index = fs.readFileSync(path.join(ROOT, "official-home/index.html"), "utf8");
const firebase = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.archive-home.json"), "utf8"));

assert(
  analytics.includes("window.ARCHIVE_PUBLIC_GA4_ID"),
  "Public GA4 configuration gate is missing."
);
assert(
  !analytics.includes("G-KG5SQ5HE6S"),
  "The ARCHIVE IN measurement id must not be reused for the public site."
);
assert(
  analytics.includes('"archivepilates.com", "archivepilates.imweb.me"'),
  "Cross-domain linker domains are missing."
);
[
  "view_item_list",
  "select_item",
  "view_item",
  "begin_checkout",
  "next_product_click"
].forEach((eventName) => {
  assert(sales.includes(`"${eventName}"`), `Missing analytics event: ${eventName}`);
});
["ACH8", "AB9", "AR4", "호흡과 중심", "골반·고관절", "순환과 FLOW", "정렬과 코어"].forEach(
  (needle) => {
    assert(sales.includes(needle), `Missing curated route value: ${needle}`);
  }
);
assert(
  installer.includes("imweb-video-sales-20260729a.js"),
  "Imweb loader does not reference the versioned sales asset."
);
assert(
  index.includes("/assets/archive-analytics-20260729a.js"),
  "Official home does not load the shared analytics asset."
);
assert(firebase.hosting.site === "archive-pilates-home", "Unexpected Firebase Hosting site.");
assert(firebase.hosting.public === "official-home", "Unexpected Firebase Hosting public directory.");
assert(
  firebase.hosting.predeploy.includes("npm run validate:video-sales-growth"),
  "Video sales validation is missing from the archive home predeploy."
);
assert(
  !sales.includes('"purchase"'),
  "Purchase must not be emitted without a confirmed payment-completion transaction."
);

console.log("Validated ARCHIVE PILATES video sales growth assets.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
