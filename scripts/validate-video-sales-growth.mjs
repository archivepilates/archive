import fs from "node:fs";
import path from "node:path";
import { loadPaidVideoCatalog, releaseProducts } from "./imweb/lib/paid-video-catalog.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const catalog = loadPaidVideoCatalog(ROOT);
const analytics = fs.readFileSync(
  path.join(ROOT, "official-home/assets/archive-analytics-20260729a.js"),
  "utf8"
);
const sales = fs.readFileSync(
  path.join(ROOT, "official-home/assets/imweb-video-sales-20260730b.js"),
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
for (const product of catalog.products) {
  assert(
    sales.includes(`${product.productNo}: { code: "${product.code}"`),
    `${product.code} product ${product.productNo} is missing from the sales catalog.`,
  );
}
for (const route of catalog.merchandising.routes) {
  assert(sales.includes(`title: ${JSON.stringify(route.title)}`), `Missing route ${route.title}.`);
}
for (const item of catalog.merchandising.best) {
  assert(sales.includes(`label: ${JSON.stringify(item.label)}`), `Missing ${item.label}.`);
}
for (const product of releaseProducts(catalog)) {
  assert(sales.includes(`code: "${product.code}"`), `Missing current release ${product.code}.`);
}
assert(
  installer.includes("imweb-video-sales-20260730b.js"),
  "Imweb loader does not reference the versioned sales asset."
);
assert(
  installer.includes(
    `data-archive-pilates-video-sales-growth="${catalog.runtime.videoSalesVersion}"`,
  ),
  "Imweb video-sales loader version is stale."
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
