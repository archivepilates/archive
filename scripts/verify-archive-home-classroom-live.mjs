import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const version = "2026-08-31a";
const assetPath = path.resolve("official-home/assets/imweb-my-classroom-20260723a.js");
const assetUrl =
  "https://archivepilates.com/assets/imweb-my-classroom-20260723a.js?v=20260831a";
const imwebHomeUrl = "https://archivepilates.imweb.me/";
const expectedSource = fs.readFileSync(assetPath, "utf8");
const expectedHash = sha256(expectedSource);
const headers = { "User-Agent": "ARCHIVE-PILATES-release-canary/1.0" };

const asset = await retry("official-home classroom asset", async () => {
  const response = await fetchWithTimeout(assetUrl, {
    cache: "no-store",
    headers,
  });
  const source = await response.text();
  const hash = sha256(source);
  const contentType = response.headers.get("content-type") || "";
  const cacheControl = response.headers.get("cache-control") || "";

  assert(response.status === 200, `Asset returned HTTP ${response.status}.`);
  assert(
    contentType.toLowerCase().includes("application/javascript"),
    `Asset content type is ${contentType || "(missing)"}.`,
  );
  assert(
    cacheControl.toLowerCase().includes("no-store"),
    `Asset cache policy is ${cacheControl || "(missing)"}.`,
  );
  assert(hash === expectedHash, `Asset SHA mismatch: live=${hash} local=${expectedHash}.`);
  assert(source.includes(`VERSION="${version}"`), "Live asset version is stale.");

  return {
    cacheControl,
    contentType,
    sha256: hash,
    status: response.status,
  };
});

const imwebScripts = await retry("Imweb classroom loader", async () => {
  const response = await fetchWithTimeout(imwebHomeUrl, {
    cache: "no-store",
    headers,
  });
  const html = await response.text();
  const loaderMarker = `data-archive-pilates-my-classroom-v2="${version}"`;
  const assetMarker = `v=20260831a`;
  const inlineFallbackMarker =
    'data-archive-pilates-my-classroom="2026-07-21b"';

  assert(response.status === 200, `Imweb home returned HTTP ${response.status}.`);
  assert(count(html, loaderMarker) === 1, "Live Imweb loader marker is missing or duplicated.");
  assert(count(html, assetMarker) === 1, "Live Imweb loader asset URL is stale or duplicated.");
  assert(
    count(html, inlineFallbackMarker) === 1,
    "Live Imweb inline fallback is missing or duplicated.",
  );
  assert(
    !html.includes('setAttribute("data-ap-classroom","1")'),
    "Live Imweb loader still preempts the inline fallback.",
  );

  return {
    inlineFallback: true,
    loaderVersion: version,
    status: response.status,
  };
});

const classroom = await verifyAnonymousRedirect(
  "https://archivepilates.imweb.me/48",
  "Anonymous classroom gate",
);
const watchPage = await verifyAnonymousRedirect(
  "https://archivepilates.imweb.me/archive-method-watch-ab9",
  "Anonymous watch-page gate",
);

console.log(
  JSON.stringify(
    {
      asset,
      imwebScripts,
      anonymousAccess: {
        classroom,
        watchPage,
      },
    },
    null,
    2,
  ),
);

async function verifyAnonymousRedirect(url, label) {
  return retry(label, async () => {
    const response = await fetchWithTimeout(url, {
      redirect: "manual",
      headers,
    });
    const location = response.headers.get("location") || "";
    assert(
      isRedirect(response.status) && location.includes("/login"),
      `${label} failed: HTTP ${response.status}, location=${location}.`,
    );
    return response.status;
  });
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function retry(label, operation, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(500 * attempt);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError.message}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function count(value, marker) {
  return value.split(marker).length - 1;
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
