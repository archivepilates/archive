import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const assetPath = path.resolve("official-home/assets/imweb-my-classroom-20260723a.js");
const assetUrl =
  "https://archivepilates.com/assets/imweb-my-classroom-20260723a.js?v=20260728c";
const expectedSource = fs.readFileSync(assetPath, "utf8");
const expectedHash = sha256(expectedSource);

const assetResponse = await fetch(assetUrl, {
  cache: "no-store",
  headers: { "User-Agent": "ARCHIVE-PILATES-release-canary/1.0" },
});
const liveSource = await assetResponse.text();
const liveHash = sha256(liveSource);
const contentType = assetResponse.headers.get("content-type") || "";
const cacheControl = assetResponse.headers.get("cache-control") || "";

assert(assetResponse.status === 200, `Asset returned HTTP ${assetResponse.status}.`);
assert(
  contentType.toLowerCase().includes("application/javascript"),
  `Asset content type is ${contentType || "(missing)"}.`,
);
assert(
  cacheControl.toLowerCase().includes("no-store"),
  `Asset cache policy is ${cacheControl || "(missing)"}.`,
);
assert(liveHash === expectedHash, `Asset SHA mismatch: live=${liveHash} local=${expectedHash}.`);
assert(liveSource.includes('VERSION="2026-07-28c"'), "Live asset version is stale.");

const classroomRedirect = await fetch("https://archivepilates.imweb.me/48", {
  redirect: "manual",
  headers: { "User-Agent": "ARCHIVE-PILATES-release-canary/1.0" },
});
const classroomLocation = classroomRedirect.headers.get("location") || "";
assert(
  isRedirect(classroomRedirect.status) && classroomLocation.includes("/login"),
  `Anonymous classroom gate failed: HTTP ${classroomRedirect.status}, location=${classroomLocation}.`,
);

const watchRedirect = await fetch(
  "https://archivepilates.imweb.me/archive-method-watch-ab9",
  {
    redirect: "manual",
    headers: { "User-Agent": "ARCHIVE-PILATES-release-canary/1.0" },
  },
);
const watchLocation = watchRedirect.headers.get("location") || "";
assert(
  isRedirect(watchRedirect.status) && watchLocation.includes("/login"),
  `Anonymous watch-page gate failed: HTTP ${watchRedirect.status}, location=${watchLocation}.`,
);

console.log(
  JSON.stringify(
    {
      asset: {
        cacheControl,
        contentType,
        sha256: liveHash,
        status: assetResponse.status,
      },
      anonymousAccess: {
        classroom: classroomRedirect.status,
        watchPage: watchRedirect.status,
      },
    },
    null,
    2,
  ),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
