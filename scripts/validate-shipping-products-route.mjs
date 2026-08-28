import fs from "node:fs";

const firebase = JSON.parse(fs.readFileSync("firebase.archive-home.json", "utf8"));
const installer = fs.readFileSync("scripts/imweb/install-shipping-products-only.html", "utf8");
const legacyInstaller = fs.readFileSync("scripts/imweb/install-site-improvements-p0.html", "utf8");
const failures = [];

const shopRedirect = firebase.hosting.redirects.find((entry) => entry.source === "/shop");
if (shopRedirect?.destination !== "https://archivepilates.imweb.me/16?ap_shop=knitido") {
  failures.push("official /shop redirect is not the shipping-products-only route");
}

[
  'data-archive-pilates-shipping-products-only="2026-08-28b"',
  'var SHIPPING_PRODUCTS_URL = "/16?ap_shop=knitido";',
  'url.searchParams.has("idx")',
  'mode === "all"',
  '[data-ap-shop-sub="all"]',
  'data-archive-pilates-sidebar-primary-alignment',
  'ap-sidebar-primary-link',
  'min-height:54px',
  'padding:0 30px'
].forEach((required) => {
  if (!installer.includes(required)) failures.push(`shipping products installer missing: ${required}`);
});

const installerScript = installer
  .replace(/^<script[^>]*>\s*/, "")
  .replace(/\s*<\/script>\s*$/, "");
try {
  new Function(installerScript);
} catch (error) {
  failures.push(`shipping products installer is not valid JavaScript: ${error.message}`);
}

if (!legacyInstaller.includes("https://archivepilates.imweb.me/16?ap_shop=knitido")) {
  failures.push("retired /15 route is not aligned with the shipping-products-only route");
}
if (legacyInstaller.includes("https://archivepilates.imweb.me/16?ap_shop=all")) {
  failures.push("retired /15 route still points to the unfiltered catalog");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("shipping-products-only route validation passed");
