import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const asset = fs.readFileSync(
  path.join(ROOT, "official-home/assets/imweb-knitido-shipping-review-20260729b.js"),
  "utf8"
);
const installer = fs.readFileSync(
  path.join(ROOT, "scripts/imweb/install-knitido-shipping-review.html"),
  "utf8"
);
const applyScript = fs.readFileSync(
  path.join(ROOT, "scripts/imweb/apply-knitido-shipping-review.mjs"),
  "utf8"
);

const requiredAssetText = [
  "2026-07-29b",
  "평균 배송일",
  "결제 완료 후 영업일 기준 2~3일",
  "재고 확인 후 영업일 기준 1~2일 이내",
  "결제일로부터 1개월 이내",
  "3,000원 · 조건부 무료배송 없음",
  ".archive-knitido-product",
  "ap_shop"
];

for (const text of requiredAssetText) {
  if (!asset.includes(text)) throw new Error(`shipping asset is missing: ${text}`);
}
if (!installer.includes("imweb-knitido-shipping-review-20260729b.js")) {
  throw new Error("installer does not load the versioned shipping-review asset");
}
if (!installer.includes('data-archive-pilates-knitido-shipping-review="2026-07-29b"')) {
  throw new Error("installer marker/version mismatch");
}
for (const scopeGuard of ['path === "/16"', 'path !== "/shop_view"', "productNumber >= 52", "productNumber <= 78"]) {
  if (!installer.includes(scopeGuard)) {
    throw new Error(`installer is missing scope guard: ${scopeGuard}`);
  }
}
if (!applyScript.includes('data-archive-pilates-my-classroom-v2="2026-07-28d"')) {
  throw new Error("apply script does not protect the active My Classroom loader");
}
if (!applyScript.includes('data-archive-pilates-knitido-brand-page="2026-07-19a"')) {
  throw new Error("apply script does not protect the active Knitido renderer");
}
if (
  !applyScript.includes("https://archivepilates.imweb.me/16?ap_shop=knitido") ||
  !applyScript.includes('script", "list", "--position", "header"')
) {
  throw new Error("apply script does not verify the live page before updating the header");
}

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      version: "2026-07-29b",
      categoryNotice: true,
      detailSelector: ".archive-knitido-product",
      deliveryWindow: "영업일 기준 2~3일",
      maximumCompletion: "결제일로부터 1개월 이내"
    },
    null,
    2
  ) + "\n"
);
