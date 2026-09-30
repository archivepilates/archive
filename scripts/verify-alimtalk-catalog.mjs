#!/usr/bin/env node
// Synthetic loopback fixture for CUA. This script never launches a browser.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./lib/alimtalk-catalog-source.mjs";

const boot = 'if (document.querySelector("[data-firestore-dashboard]")) refresh();';
export function instrumentCatalogApp(source) {
  assert.equal(source.split(boot).length, 2);
  assert.ok(source.trimEnd().endsWith(boot), "Only the final live bootstrap can be removed");
  const call = "mountTemplateCatalog(templateCatalogHost)";
  assert.equal(source.split(call).length, 2);
  return source.slice(0, source.lastIndexOf(boot)).replace(call,
    'mountTemplateCatalog(templateCatalogHost, { url: new URL(location.href).searchParams.get("scenario") === "error" ? "/assets/alimtalk-catalog-error.json" : "/assets/alimtalk-catalog.json" })') + `
for (const item of currentReadRequirements()) setReadState(item.label, "success");
state.alimtalkCandidates = [{ id: "qa-candidate", candidateId: "qa-candidate", type: "reservation_open", memberName: "QA 합성회원", status: "candidate", sourceDate: "2026-09-30" }];
state.alimtalkSends = [];
renderMessages(state.alimtalkCandidates, state.alimtalkSends);
document.getElementById("connectionLabel").textContent = "합성 데이터";
document.getElementById("connectionDetail").textContent = "로컬 QA · 운영 연결 없음";
document.getElementById("refreshButton").disabled = true;
`;
}

const guard = `
(() => {
  const fixture = { synthetic: true, denied: [], reads: [], externalNetwork: "blocked-by-csp-and-fetch-allowlist" };
  Object.defineProperty(window, "__catalogFixture", { value: fixture });
  const original = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    const method = options.method || input?.method || "GET";
    const allowed = ["/assets/alimtalk-catalog.json", "/assets/alimtalk-catalog-error.json"];
    if (url.origin !== location.origin || method !== "GET" || !allowed.includes(url.pathname)) {
      fixture.denied.push({ url: url.href, method });
      return Promise.reject(new Error("Synthetic fixture blocked non-catalog request"));
    }
    fixture.reads.push(url.pathname);
    return original(url, { ...options, credentials: "omit" });
  };
  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"]) window[name] = class {
    constructor() { fixture.denied.push({ type: name }); throw new Error("Synthetic fixture blocks " + name); }
  };
  navigator.sendBeacon = () => { fixture.denied.push({ type: "beacon" }); return false; };
  document.addEventListener("securitypolicyviolation", (event) => fixture.denied.push({ type: "csp", url: event.blockedURI }));
})();
`;

export async function createCatalogFixture({ port = 0, autoCloseMs = 20 * 60_000 } = {}) {
  const assets = new Map();
  for (const [url, file] of Object.entries({
    "/messages/": "core/messages/index.html",
    "/rules/": "core/rules/index.html",
    "/assets/styles.css": "core/assets/styles.css",
    "/assets/app.js": "core/assets/app.js",
    "/assets/alimtalk-catalog.js": "core/assets/alimtalk-catalog.js",
    "/assets/alimtalk-catalog.css": "core/assets/alimtalk-catalog.css",
    "/assets/alimtalk-catalog.json": "core/assets/alimtalk-catalog.json",
  })) assets.set(url, await fs.readFile(path.join(root, file), "utf8"));
  assets.set("/assets/app.js", instrumentCatalogApp(assets.get("/assets/app.js")));
  for (const route of ["/messages/", "/rules/"]) {
    let html = assets.get(route).replace('<script src="../firebase-config.js"></script>', '<script src="/fixture-guard.js"></script>').replace(/<link rel="manifest"[^>]+>/, "");
    if (route === "/rules/") html = html.replace('<script type="module" src="../assets/app.js"></script>', "");
    assets.set(route, html);
  }
  assets.set("/fixture-guard.js", guard);
  for (const icon of ["/icons/favicon-32.png", "/favicon.png", "/icons/archive-pilates-icon-192.png", "/icons/apple-touch-icon.png"])
    assets.set(icon, await fs.readFile(path.join(root, "core", icon)).catch(() => Buffer.alloc(0)));
  const csp = "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'";
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("Content-Security-Policy", csp);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (url.pathname === "/") { response.writeHead(302, { Location: "/messages/" }); response.end(); return; }
    if (url.pathname === "/assets/alimtalk-catalog-error.json") { response.writeHead(503, { "Content-Type": "application/json" }); response.end('{"syntheticError":true}'); return; }
    const body = assets.get(url.pathname);
    if (request.method !== "GET" || body == null) { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", mime[path.extname(url.pathname)] || "text/html");
    response.end(body);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let timer;
  const close = async () => {
    clearTimeout(timer);
    if (!server.listening) return;
    await new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
  };
  if (autoCloseMs > 0) timer = setTimeout(() => { void close().then(() => console.log("Synthetic catalog fixture auto-closed")); }, autoCloseMs);
  return { origin, close, assets, server, csp };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const autoCloseMs = Number(process.argv.find((arg) => arg.startsWith("--auto-close-ms="))?.split("=")[1] || 1200000);
  const port = Number(process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1] || 0);
  const fixture = await createCatalogFixture({ port, autoCloseMs });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void fixture.close(); });
  if (process.argv.includes("--check-fixture")) {
    try {
      const page = await fetch(`${fixture.origin}/messages/`);
      assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
      assert.doesNotMatch(await page.text(), /firebase-config\.js/);
      assert.doesNotMatch(fixture.assets.get("/assets/app.js"), new RegExp(boot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal((await fetch(`${fixture.origin}/assets/alimtalk-catalog.json`)).status, 200);
      assert.equal((await fetch(`${fixture.origin}/assets/alimtalk-catalog-error.json`)).status, 503);
      assert.equal((await fetch(`${fixture.origin}/firebase-config.js`)).status, 404);
      assert.equal((await fetch(`${fixture.origin}/assets/alimtalk-catalog.json`, { method: "POST" })).status, 404);
      assert.ok(fixture.assets.get("/rules/").includes('id="alimtalk-catalog-draft"'));
      console.log("Synthetic fixture transport/guard checks passed; no browser was launched.");
    } finally { await fixture.close(); }
  } else {
    console.log(`CATALOG_FIXTURE_URL=${fixture.origin}/messages/`);
    console.log(`CATALOG_ERROR_URL=${fixture.origin}/messages/?scenario=error`);
    console.log(`Auto-close: ${autoCloseMs}ms. Stop: Ctrl-C. Browser ownership stays with the main CUA chat.`);
    console.log("QA: widths 320/390/768/1440; all/known/source scopes; implementation filters; details; search no-such-template; error URL. window.__catalogFixture.denied should stay empty.");
  }
}
