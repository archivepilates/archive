import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = await fs.mkdtemp(path.join(tmpdir(), "core-member-registration-welcome-"));
const now = "2026-10-21T08:00:00.000Z", old = "2026-10-19T08:00:00.000Z";
const codes = ["history_time_limit", "membership_welcome_preflight_state_conflict", "unknown_welcome_template",
  "invalid_or_stale_signature_time", "previous_welcome_attempt_requires_review", "welcome_preflight_unavailable", "member_identity_is_incomplete"];
const key = (phone) => `membership_welcome_${createHash("sha256")
  .update(JSON.stringify(["5330", "new_member_welcome", phone])).digest("hex")}`;
const contracts = [], candidates = [], sends = [];
for (let index = 0; index <= codes.length; index += 1) {
  const memberId = String(10001 + index), phone = `010${String(index + 1).padStart(8, "0")}`;
  const id = key(phone), accepted = index === codes.length;
  const memberName = accepted ? "합성 오래된 접수회원" : `합성 실패회원 ${index + 1}`;
  contracts.push({ id: createHash("sha256").update(memberId).digest("hex"), studioId: "5330", memberName,
    welcomeCandidateId: id, welcomeStatus: "queued", status: "signed", updatedAt: old,
    binding: { memberId, memberPhone: phone, userTicketId: `synthetic-ticket-${index}` },
    completion: { memberId, memberPhone: phone, studioId: "5330", checkedAt: old } });
  const record = { id, candidateId: id, studioId: "5330", memberId, memberPhone: phone, memberName,
    status: accepted ? "accepted" : "failed", attempts: 1, lastError: accepted ? null : codes[index], updatedAt: old };
  if (!accepted) candidates.push({ ...record, type: "membership_welcome" });
  sends.push({ ...record, sendId: id });
}
const unrelated = Array.from({ length: 301 }, (_, index) => ({ id: `unrelated-${index}`, candidateId: `unrelated-${index}`,
  studioId: "5330", memberId: `unrelated-${index}`, type: "private_survey", status: "done", updatedAt: now }));
const legacyId=createHash("sha256").update("synthetic-legacy").digest("hex");
contracts.push({id:legacyId,contractId:legacyId,schemaVersion:1,source:"studiomate_native_contract",studioId:"5330",bindingVerified:true,
  memberName:"합성 기존회원",status:"signed",welcomeStatus:"not_required",updatedAt:old,
  binding:{contractId:legacyId,studioId:"5330",memberId:"10099",memberPhone:"01099990000",userTicketId:"101"},
  welcomeDisposition:{verified:true,source:"studiomate_native_member_ticket",reason:"legacy_member_before_contract_cutover",
    memberId:"10099",contractId:legacyId,registeredAt:"2024-01-01T00:00:00.000Z",cutoverAt:"2026-09-23T03:50:35.295Z",
    checkedAt:old,priorRegularIssuanceIds:["100"]}});
const fixtures = { memberProfiles: [], studiomateMembershipContracts: contracts,
  alimtalkCandidates: [...unrelated, ...candidates], alimtalkSends: [...unrelated, ...sends] };
const report = { scope: "Synthetic read-only browser QA; no real auth, production data, delivery proof or writes.",
  output, sources: [], results: [], deniedRequests: [], errors: [],
  cleanup: { contextsClosed: 0, browserClosed: false, serverClosed: false } };
const assets = new Map();
const server = http.createServer((req, res) => {
  const asset = assets.get(new URL(req.url, "http://fixture").pathname);
  res.writeHead(req.method === "GET" && asset ? 200 : 404, { "Content-Type": asset?.type || "text/plain" });
  res.end(req.method === "GET" && asset ? asset.body : "fixture-only");
});
let browser;
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const source = await fs.readFile(path.join(root, "core/assets/app.js"), "utf8");
  const end = source.lastIndexOf("\nenhanceNav();");
  assert.ok(end > 0, "Stop before automatic auth/refresh startup");
  const filterStart = source.indexOf('qs("memberRegistrationFilters")?.addEventListener');
  const filterEnd = source.indexOf('qs("instructorLessonScheduleList")', filterStart);
  assert.ok(filterStart > end && filterEnd > filterStart);
  // Bundle the current real loader/renderer, replacing only the served startup with a fixture entry point.
  const body = buildSync({ stdin: { contents: `${source.slice(0, end)}
    ${source.slice(filterStart, filterEnd)}
    window.__welcomeQA = { async run(runtime) {
      document.documentElement.dataset.coreAccess = "manager";
      enhanceNav(); activateNav();
      setText("connectionLabel", "합성 데이터"); setText("connectionDetail", "운영 연결 없음");
      state.memberRegistrationDashboard = await loadMemberRegistrationDashboard(runtime);
      setReadState("memberRegistrationDashboard", "success");
      memberRegistrationFilter = "all"; renderMemberRegistrationDashboard();
      return state.memberRegistrationDashboard;
    } };`, resolveDir: path.join(root, "core/assets"), sourcefile: "app.js" },
    bundle: true, treeShaking: false, format: "iife", write: false,
    define: { "import.meta.url": JSON.stringify(`${origin}/core/assets/app.js`) }, external: ["https://*"],
  }).outputFiles[0].text;
  let html = await fs.readFile(path.join(root, "core/member-registration/index.html"), "utf8");
  html = html.replace(/<link\b[^>]*rel="(?:icon|apple-touch-icon|manifest)"[^>]*>/g, "")
    .replace('<script src="../firebase-config.js"></script>', "");
  assets.set("/core/member-registration/", { type: "text/html", body: html });
  assets.set("/core/assets/app.js", { type: "text/javascript", body });
  for (const file of ["core/assets/styles.css", "core/assets/interface.css", "core/icons/archive-pilates-icon-192.png"]) {
    assets.set(`/${file}`, { type: file.endsWith("css") ? "text/css" : "image/png", body: await fs.readFile(path.join(root, file)) });
  }
  for (const file of ["core/assets/app.js", "core/member-registration/index.html", "core/assets/styles.css", "core/assets/interface.css"]) {
    report.sources.push({ file, sha256: createHash("sha256").update(await fs.readFile(path.join(root, file))).digest("hex") });
  }
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "ko-KR",
      timezoneId: "Asia/Seoul", reducedMotion: "reduce", serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
    try {
      await context.routeWebSocket("**/*", (socket) => { report.deniedRequests.push(socket.url()); socket.close(); });
      await context.route("**/*", (route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin || request.method() !== "GET" || !assets.has(url.pathname) ||
            ["fetch", "xhr", "eventsource"].includes(request.resourceType())) {
          report.deniedRequests.push({ url: url.href, method: request.method() });
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => report.errors.push(String(error)));
      await page.clock.install({ time: new Date(now) });
      await page.goto(`${origin}/core/member-registration/`);
      const readback = await page.evaluate(async (fixtures) => {
        const queries = [], exactReads = [];
        const snap = (row) => ({ id: row.id, exists: () => true, data: () => ({ ...row }) });
        const runtime = {
          db: {}, collection: (_db, path) => path,
          where: (field, op, value) => ({ kind: "where", field, op, value }),
          orderBy: (field) => ({ kind: "order", field }), limit: (count) => ({ kind: "limit", count }),
          query: (path, ...constraints) => ({ path, constraints }),
          getDocs: async ({ path, constraints }) => {
            let rows = [...(fixtures[path] || [])];
            for (const c of constraints) {
              if (c.kind === "where") rows = rows.filter((row) => row[c.field] === c.value);
              if (c.kind === "order") rows.sort((a, b) => String(b[c.field]).localeCompare(String(a[c.field])));
              if (c.kind === "limit") rows = rows.slice(0, c.count);
            }
            queries.push({ path, count: rows.length, unrelatedOnly: rows.every((row) => row.id.startsWith("unrelated-")) });
            return { docs: rows.map(snap) };
          },
          doc: (_db, collection, id) => {
            if (!["alimtalkCandidates", "alimtalkSends"].includes(collection) || !/^membership_welcome_[a-f0-9]{64}$/.test(id))
              throw new Error("unexpected-fixture-reference");
            return { collection, id };
          },
          getDoc: async ({ collection, id }) => {
            exactReads.push(`${collection}/${id}`);
            const row = fixtures[collection]?.find((row) => row.id === id);
            return row ? snap(row) : { id, exists: () => false };
          },
        };
        const dashboard = await window.__welcomeQA.run(runtime);
        return { queries, exactReads, counts: dashboard.counts };
      }, fixtures);
      assert.deepEqual(readback.counts, { recent: codes.length + 2, active: 0, review: codes.length, completed: 2 });
      assert.equal(readback.exactReads.length, (codes.length + 1) * 2);
      for (const path of ["alimtalkCandidates", "alimtalkSends"]) {
        const query = readback.queries.find((query) => query.path === path);
        assert.equal(query.count, 250); assert.equal(query.unrelatedOnly, true);
      }
      const main = page.getByRole("main"), articles = main.getByRole("article");
      const proof = [];
      for (let index = 0; index < codes.length; index += 1) {
        const row = articles.filter({ has: page.getByRole("link", { name: `합성 실패회원 ${index + 1}`, exact: true }) });
        const step = row.getByRole("listitem").filter({ hasText: "웰컴" });
        assert.match(await step.innerText(), /확인필요/);
        assert.doesNotMatch(await row.innerText(), /발송대기|발송완료|발송을 준비|history_time_limit|preflight_state/);
        const reason = await row.evaluate((el) => el.querySelector(".instructor-registration-next span").textContent);
        assert.match(reason, /[가-힣].*확인/); assert.doesNotMatch(reason.replaceAll("StudioMate", ""), /[a-z_]/i);
        proof.push({ member: `합성 실패회원 ${index + 1}`, code: codes[index], welcome: await step.innerText(), reason });
      }
      const accepted = articles.filter({ has: page.getByRole("link", { name: "합성 오래된 접수회원", exact: true }) });
      assert.match(await accepted.getByRole("listitem").filter({ hasText: "웰컴" }).innerText(), /발송완료/);
      const excluded=articles.filter({has:page.getByRole("link",{name:"합성 기존회원",exact:true})});
      assert.match(await excluded.innerText(),/기존 회원 · 대상 제외/);
      assert.doesNotMatch(await excluded.innerText(),/발송완료/);
      proof.push({ member: "합성 오래된 접수회원", candidateAbsent: true,
        welcome: await accepted.getByRole("listitem").filter({ hasText: "웰컴" }).innerText() });
      // Disable page-level clipping to ensure the width check cannot pass by masking an overflow.
      await page.evaluate(() => { document.documentElement.style.overflowX = "visible"; document.body.style.overflowX = "visible"; });
      await page.evaluate(() => document.fonts.ready);
      const geometry = await main.evaluate((main) => {
        const visible = (el) => el.checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().height > 0;
        const nodes = [...main.querySelectorAll("article, ol, li, button, p, strong, span, small, em, a")].filter(visible);
        return {
          viewport: innerWidth, documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          overflowing: nodes.filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
            .map((el) => ({ tag: el.tagName, text: el.textContent.trim().slice(0, 80) })),
          outside: nodes.filter((el) => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; })
            .map((el) => ({ tag: el.tagName, text: el.textContent.trim().slice(0, 80) })),
          shortButtons: [...main.querySelectorAll("button")].filter(visible)
            .filter((el) => el.getBoundingClientRect().height < 43.5).map((el) => el.textContent.trim()),
        };
      });
      assert.ok(geometry.documentWidth <= width, JSON.stringify(geometry));
      assert.deepEqual(geometry.overflowing, []); assert.deepEqual(geometry.outside, []); assert.deepEqual(geometry.shortButtons, []);
      const screenshot = path.join(output, `all-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
      const filters = page.getByRole("group", { name: "회원등록 상태 필터", exact: true });
      await filters.getByRole("button", { name: "확인필요", exact: true }).click();
      assert.equal(await main.getByRole("list").count(), codes.length);
      await filters.getByRole("button", { name: "완료", exact: true }).click();
      assert.equal(await main.getByRole("list").count(), 2);
      assert.match(await main.getByRole("article").filter({has:page.getByRole("link",{name:"합성 오래된 접수회원",exact:true})}).innerText(), /발송완료/);
      await filters.getByRole("button", { name: "완료", exact: true }).press("Shift+Tab");
      await filters.getByRole("button", { name: "확인필요", exact: true }).press("Tab");
      const focus = await filters.getByRole("button", { name: "완료", exact: true }).evaluate((el) => ({
        active: document.activeElement === el, outline: getComputedStyle(el).outlineStyle,
      }));
      assert.equal(focus.active, true); assert.notEqual(focus.outline, "none");
      report.results.push({ width, oldFailed: "확인필요 + 직원용 사유", oldAccepted: "발송완료",
        ...readback, proof, geometry, focus, screenshot });
    } finally { await context.close(); report.cleanup.contextsClosed += 1; }
  }
  assert.deepEqual(report.deniedRequests, []); assert.deepEqual(report.errors, []);
} catch (error) {
  report.errors.push(String(error.stack || error)); process.exitCode = 1;
} finally {
  try {
    if (browser) { await browser.close(); report.cleanup.browserClosed = !browser.isConnected(); }
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    report.cleanup.serverClosed = !server.listening;
    await fs.writeFile(path.join(output, "verification.json"), JSON.stringify(report, null, 2));
  }
}
console.log(JSON.stringify(report, null, 2));
