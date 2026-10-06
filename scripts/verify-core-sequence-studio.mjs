#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const coreRoot = fileURLToPath(new URL("../core/", import.meta.url));
const output = process.env.ARCHIVE_SEQUENCE_QA_DIR || "/tmp/archive-core-sequence-qa";
const liveBase = process.env.ARCHIVE_CORE_BASE_URL?.replace(/\/+$/, "");
const server = liveBase ? null : http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(coreRoot, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
    if (!file.startsWith(coreRoot)) throw new Error("invalid path");
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" }[path.extname(file)] || "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
if (server) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = liveBase || `http://127.0.0.1:${server.address().port}`;
await fs.mkdir(output, { recursive: true });
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  // Isolated Auth fixture: no real account, Firestore reads, or production writes.
  const fixtureAuth = async (context, signedIn) => {
    await context.route("https://www.gstatic.com/firebasejs/**/firebase-*.js", async (route) => {
      const file = new URL(route.request().url()).pathname.split("/").pop();
      const modules = {
        "firebase-app.js": "export const getApps=()=>[];export const initializeApp=()=>({});",
        "firebase-auth.js": `export const getAuth=()=>({currentUser:${signedIn ? '{uid:"sequence-qa"}' : 'null'}});export const onAuthStateChanged=(auth,callback)=>{queueMicrotask(()=>callback(auth.currentUser));return ()=>{};};`,
        "firebase-firestore.js": "export const getFirestore=()=>({});",
        "firebase-functions.js": "export const getFunctions=()=>({});export const httpsCallable=()=>{throw Error('Unexpected callable');};",
      };
      await route.fulfill({ contentType: "text/javascript", body: modules[file], headers: { "Access-Control-Allow-Origin": "*" } });
    });
  };
  const signedOut = await browser.newContext();
  try {
    await fixtureAuth(signedOut, false);
    const page = await signedOut.newPage();
    await page.goto(`${base}/sequence/`);
    await page.getByRole("heading", { name: "ARCHIVE CORE", exact: true }).waitFor();
    assert.equal(await page.locator("iframe").getAttribute("src"), null);
    await page.goto(`${base}/sequence/studio.html`);
    await page.waitForURL(`${base}/sequence/`);
  } finally {
    await signedOut.close();
  }
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    try {
      await fixtureAuth(context, true);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${base}/sequence/`, { waitUntil: "load" });
      const studio = page.frameLocator("iframe");
      await studio.getByRole("heading", { name: "시퀀스 노트 스튜디오" }).waitFor();
      await studio.getByRole("button", { name: "체어", exact: true }).waitFor();
      const otherWindow = await context.newPage();
      await otherWindow.goto(`${base}/sequence/`);
      await otherWindow.frameLocator("iframe").getByRole("alert").filter({ hasText: "다른 창" }).waitFor();
      await otherWindow.close();
      if (width <= 1040) await page.getByRole("button", { name: "메뉴", exact: true }).click();
      const menu = page.getByRole("link", { name: "시퀀스 노트", exact: true });
      assert.equal(await menu.getAttribute("aria-current"), "page");
      if (width <= 1040) await page.getByRole("button", { name: "메뉴", exact: true }).click();
      await studio.getByLabel("수업명", { exact: true }).fill(`시퀀스 검증 ${width}`);
      await studio.getByLabel("작성 강사", { exact: true }).fill("테스트 강사");
      await studio.getByLabel("수업 목표", { exact: true }).fill("흉추 움직임 확인");
      await studio.getByRole("button", { name: "+ 동작 추가", exact: true }).first().click();
      await studio.getByLabel("동작명", { exact: true }).fill("롤백");
      await studio.getByLabel("간단한 동작 설명", { exact: true }).fill("명치를 뒤로 보내기");
      await studio.getByLabel("핵심 큐 1", { exact: true }).fill("등힘으로 지지해요");
      await page.waitForFunction(() => {
        const frame = document.querySelector("iframe").contentWindow;
        return JSON.parse(frame.localStorage.getItem("archive.sequence.studio.draft.v1") || "{}").moves?.warm?.length === 1;
      });
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction((title) => {
        const frame = document.querySelector("iframe").contentWindow;
        return frame.ARCHIVE_TEST?.getState().title === title;
      }, `시퀀스 검증 ${width}`);
      assert.equal(await studio.getByLabel("수업명", { exact: true }).inputValue(), `시퀀스 검증 ${width}`);
      await studio.getByRole("tab", { name: "02 노트 보기" }).click();
      await studio.getByRole("button", { name: "내 시퀀스에 저장", exact: true }).click();
      await studio.getByRole("button", { name: "굿노트용 PDF 만들기", exact: true }).click();
      const downloadPromise = page.waitForEvent("download");
      await studio.getByRole("link", { name: "PDF 저장", exact: true }).click();
      const download = await downloadPromise;
      const pdfPath = path.join(output, `sequence-${width}.pdf`);
      await download.saveAs(pdfPath);
      const pdf = await fs.readFile(pdfPath);
      assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.7");
      assert.ok(pdf.includes(Buffer.from("/ToUnicode")), "PDF must retain selectable Korean text");
      assert.ok(pdf.length > 10000, "PDF must embed fonts and page contents");
      await page.screenshot({ path: path.join(output, `preview-${width}.png`) });
      await studio.getByRole("tab", { name: /내 시퀀스/ }).click();
      await studio.getByLabel("저장된 시퀀스 검색").fill(`시퀀스 검증 ${width}`);
      await studio.getByRole("heading", { name: `시퀀스 검증 ${width}` }).waitFor();
      const backupPromise = page.waitForEvent("download");
      await studio.getByRole("button", { name: "전체 백업", exact: true }).click();
      const backup = await backupPromise;
      const backupPath = path.join(output, `sequence-${width}.json`);
      await backup.saveAs(backupPath);
      const records = JSON.parse(await fs.readFile(backupPath, "utf8"));
      assert.equal(records.records.length, 1);
      assert.equal(records.records[0].moves.warm[0].name, "롤백");
      const chooserPromise = page.waitForEvent("filechooser");
      await studio.getByRole("button", { name: "응답 불러오기", exact: true }).click();
      page.once("dialog", (dialog) => dialog.accept());
      const chooser = await chooserPromise;
      await chooser.setFiles(backupPath);
      await studio.getByRole("status").filter({ hasText: "백업을 불러왔어요." }).waitFor();
      const dimensions = await page.evaluate(() => {
        const iframe = document.querySelector("iframe");
        const inner = iframe.contentDocument.documentElement;
        return { outerOverflow: document.documentElement.scrollWidth > innerWidth + 1, innerOverflow: inner.scrollWidth > inner.clientWidth + 1, frameHeight: iframe.clientHeight };
      });
      assert.equal(dimensions.outerOverflow, false, "CORE must not overflow horizontally");
      assert.equal(dimensions.innerOverflow, false, "studio must not overflow horizontally");
      assert.ok(dimensions.frameHeight > 300, "writing surface must stay usable");
      assert.deepEqual(errors, [], "page scripts must not throw");
      const edgeCases = await page.evaluate(async () => {
        const frame = document.querySelector("iframe").contentWindow;
        const test = frame.ARCHIVE_TEST;
        const sample = test.sample();
        sample.memo = "A\n".repeat(110);
        const pages = test.buildPages(sample);
        const clipped = pages.flat().some(op => op.t === "text" && op.y > 900);
        const stored = frame.localStorage.getItem("archive.sequence.studio.library.v1");
        const original = frame.Storage.prototype.setItem;
        frame.Storage.prototype.setItem = function (key, value) {
          if (key === "archive.sequence.studio.library.v1") throw new Error("quota fixture");
          return original.call(this, key, value);
        };
        test.setState(sample);
        frame.document.getElementById("saveRecord").click();
        frame.Storage.prototype.setItem = original;
        return { clipped, quotaMessage: frame.document.getElementById("toast").textContent, unchanged: stored === frame.localStorage.getItem("archive.sequence.studio.library.v1") };
      });
      assert.equal(edgeCases.clipped, false, "multiline memo must paginate");
      assert.ok(edgeCases.quotaMessage.includes("저장 공간이 부족"));
      assert.equal(edgeCases.unchanged, true);
      const conflict = await page.evaluate(() => {
        const frame = document.querySelector("iframe").contentWindow;
        const key = "archive.sequence.studio.library.v1";
        const newer = JSON.parse(frame.localStorage.getItem(key));
        newer.push({ ...frame.ARCHIVE_TEST.sample(), id: "other-window", title: "다른 창 저장" });
        frame.localStorage.setItem(key, JSON.stringify(newer));
        frame.document.getElementById("saveRecord").click();
        const draft = frame.ARCHIVE_TEST.sample();
        draft.duration = "0";
        frame.localStorage.setItem("archive.sequence.studio.draft.v1", JSON.stringify(draft));
        return { message: frame.document.getElementById("toast").textContent, records: JSON.parse(frame.localStorage.getItem(key)).length };
      });
      assert.ok(conflict.message.includes("다른 창"));
      assert.equal(conflict.records, 2, "conflicting save must not replace newer library");
      await page.reload({ waitUntil: "load" });
      await studio.getByRole("button", { name: "체어", exact: true }).waitFor();
      await studio.getByRole("tab", { name: /내 시퀀스/ }).click();
      await studio.getByRole("heading", { name: "다른 창 저장", exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `library-${width}.png`) });
      results.push({ width, pdfBytes: pdf.length, ...dimensions, errors });
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ ok: true, base, output, results }, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
