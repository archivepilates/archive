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
  'data-archive-pilates-shipping-products-only="2026-08-28f"',
  'var SHIPPING_PRODUCTS_URL = "/16?ap_shop=knitido";',
  'url.searchParams.has("idx")',
  'mode === "all"',
  'window.history.replaceState(window.history.state, "", SHIPPING_PRODUCTS_URL)',
  'function keepShopHeaderBeforeContent()',
  'parent.insertBefore(header, firstShopNode)',
  'function installMutationObserverGuard()',
  'StableMutationObserver.__apManagedStyleGuard = true',
  ".viewport-nav.desktop>li:has(>a[data-ap-shop-nav='강사레슨']){order:2!important}",
  ".viewport-nav.desktop>li:has(>a[data-ap-shop-nav='영상구매']){order:3!important}",
  ".viewport-nav.desktop>.ap-shop-visual-menu{order:4!important}",
  "#mobile_carousel_menu_0>.nav-item:has(>a[data-ap-shop-nav='커뮤니티']){order:5!important}",
  '.ap-shop-pill-ko{font-size:15px!important;font-weight:750!important',
  '.ap-shop-pill-en{font-size:11px!important;font-weight:880!important',
  '[data-ap-shop-sub="all"]',
  'data-archive-pilates-sidebar-primary-alignment',
  'ap-sidebar-primary-link',
  'min-height:54px',
  'padding:0 30px'
].forEach((required) => {
  if (!installer.includes(required)) failures.push(`shipping products installer missing: ${required}`);
});

if (installer.includes("if (currentListingNeedsRedirect())")) {
  failures.push("shipping products installer still uses the old full-page redirect branch");
}

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
