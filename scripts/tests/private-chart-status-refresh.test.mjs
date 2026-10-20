import assert from "node:assert/strict";
import { after, before, test as nodeTest } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// NODE_PATH may point at the runtime checkout; no package or lockfile changes are needed.
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const html = await readFile(new URL("../../archivein/private-chart/index.html", import.meta.url), "utf8");
const origin = "https://private-chart.test";
const url = `${origin}/archivein/private-chart/?r=synthetic-request&t=synthetic-token`;

const outputDirectory = path.join(tmpdir(), `private-chart-status-refresh-${process.pid}`);
let browser;
before(async () => {
  await mkdir(outputDirectory, { recursive: true });
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

function test(name, run) {
  nodeTest(name, { timeout: 30_000 }, async () => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      await run({ page }, { outputPath: (file) => path.join(outputDirectory, file) });
    } finally {
      await context.close();
    }
  });
}

async function eventually(check) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try { return await check(); }
    catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(10);
    }
  }
}

async function disabled(control, expected = true) {
  await control.waitFor({ state: "visible" });
  await eventually(async () => assert.equal(await control.isDisabled(), expected));
}

async function value(control, expected) {
  await eventually(async () => assert.equal(await control.inputValue(), expected));
}

async function text(control, expected) {
  await control.waitFor({ state: "visible" });
  await eventually(async () => assert.ok((await control.textContent()).includes(expected)));
}

async function fixture(page, options = {}) {
  const source = {
    ok: true, mode: "post", memberName: "합성 회원", staffName: "합성 강사",
    sessionNumber: 1, lessonDate: "2026-10-20", postStatus: "submitted", locked: false,
    existingAnswers: { post: { focusAreas: ["어깨"], changes: ["호흡 연결 개선"], nextDirection: "저장된 기록" } },
    media: { files: [] },
    report: {
      status: "draft_created", url: `${origin}/report`, summary: "저장된 핵심",
      nextDirection: "저장된 방향", canEdit: true, postSubmitted: true,
    },
  };
  const model = { source, gets: 0, posts: [], requests: [], getMode: "ok", postMode: "ok", errors: [] };
  Object.assign(source.report, options.report);
  if (options.unsubmitted) {
    source.postStatus = "pending";
    source.report.postSubmitted = false;
    source.report.url = "";
  }
  page.on("pageerror", (error) => model.errors.push(error.message));
  await page.addInitScript(() => {
    const nativeFetch = window.fetch;
    window.__fetchOptions = [];
    window.fetch = (url, options) => {
      window.__fetchOptions.push({ cache: options?.cache, signal: Boolean(options?.signal) });
      return nativeFetch(url, options);
    };
    window.__unhandled = [];
    window.addEventListener("unhandledrejection", (event) => window.__unhandled.push(String(event.reason)));
    window.__visible = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__visible ? "visible" : "hidden" });
  });
  await page.clock.install({ time: new Date("2026-10-20T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-20T00:00:01Z"));
  await page.route("**/*", async (route) => {
    const request = route.request();
    model.requests.push({ url: request.url(), method: request.method(), headers: request.headers() });
    if (request.url().startsWith(`${origin}/archivein/private-chart/`)) {
      return route.fulfill({ contentType: "text/html", body: html });
    }
    if (request.url().startsWith(`${origin}/archivein/api/privateChart`)) {
      if (request.method() === "GET") {
        model.gets += 1;
        if (options.onGet && await options.onGet(model, route)) return;
        if (model.getMode === "hang") return;
        if (model.getMode === "error") return route.fulfill({ status: 503, json: { ok: false, error: "합성 조회 오류" } });
        return route.fulfill({ json: structuredClone(source) });
      }
      const body = request.postDataJSON();
      model.posts.push(body);
      if (options.onPost) {
        const handled = await options.onPost(body, model, route);
        if (handled) return;
      }
      if (body.action === "editReport") Object.assign(source.report, { summary: body.summary, nextDirection: body.nextDirection });
      if (body.action === "approveReport") source.report.status = "queued";
      if (body.mode === "post") {
        source.postStatus = "submitted";
        source.report.postSubmitted = true;
      }
      if (model.postMode === "hang") return;
      if (model.postMode === "error") return route.fulfill({ status: 409, json: { ok: false, error: "합성 변경 오류" } });
      return route.fulfill({ json: { ok: true, uploadId: "synthetic-upload", bytesUploaded: 3 } });
    }
    if (request.url().startsWith(`${origin}/report`)) {
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>합성 리포트</h1>" });
    }
    model.errors.push(`Unexpected network: ${request.method()} ${request.url()}`);
    return route.abort();
  });
  await page.goto(url);
  await page.getByRole("button", { name: "기록 수정 · 리포트 다시 확인" }).waitFor({ state: "visible" });
  await idle(page);
  return model;
}

async function idle(page) {
  await eventually(async () => assert.equal(await page.evaluate(() => !state.loading && !state.refreshPromise), true));
}

async function tick(page, model, milliseconds = 10_000) {
  const before = model.gets;
  await page.clock.runFor(milliseconds);
  await eventually(() => assert.ok(model.gets > before));
  await idle(page);
}

async function visibility(page, visible) {
  await page.evaluate((value) => {
    window.__visible = value;
    document.dispatchEvent(new Event("visibilitychange"));
  }, visible);
}

async function cleanErrors(page, model) {
  assert.deepEqual(model.errors, []);
  assert.deepEqual(await page.evaluate(() => window.__unhandled), []);
}

for (const width of [320, 390, 768, 1440]) {
  test(`queued -> processing -> sent preserves drafts, ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const model = await fixture(page);
    await page.getByRole("textbox", { name: "오늘의 핵심", exact: true }).fill("승인할 문장");
    await page.getByRole("button", { name: "검토 완료 · 회원에게 발송" }).click();
    await disabled(page.getByRole("button", { name: "발송 대기 중", exact: true }));
    await idle(page);
    await page.getByRole("textbox", { name: "오늘의 핵심", exact: true }).fill("아직 저장하지 않은 문장");
    await page.getByLabel("다음 방향", { exact: true }).fill("아직 저장하지 않은 기록");
    await page.getByRole("group", { name: "진행 부위", exact: true }).getByLabel("고관절", { exact: true }).check();
    const focusedEditor = page.getByRole("textbox", { name: "오늘의 핵심", exact: true });
    await focusedEditor.focus();
    await visibility(page, false);
    const hiddenGets = model.gets;
    await page.clock.runFor(60_000);
    assert.equal(model.gets, hiddenGets);
    model.source.report.status = "processing";
    await visibility(page, true);
    await disabled(page.getByRole("button", { name: "발송 처리 중", exact: true }));
    await idle(page);
    await disabled(page.getByRole("button", { name: "기록 수정 · 리포트 다시 확인" }));
    await value(focusedEditor, "아직 저장하지 않은 문장");
    await value(page.getByLabel("다음 방향", { exact: true }), "아직 저장하지 않은 기록");
    assert.equal(await page.getByRole("group", { name: "진행 부위", exact: true }).getByLabel("고관절", { exact: true }).isChecked(), true);
    model.source.report.status = "sent";
    model.source.report.sent = true;
    model.source.locked = true;
    await tick(page, model);
    await disabled(page.getByRole("button", { name: "발송 완료", exact: true }));
    await value(focusedEditor, "아직 저장하지 않은 문장");
    await disabled(page.getByLabel("다음 방향", { exact: true }));
    assert.match(await page.getByTestId("unsaved-report-note").textContent(), /회원에게 발송되지 않았습니다/);
    assert.equal(await page.getByTestId("unsaved-report-note").evaluate((note) => {
      const editor = document.getElementById("reportSummaryEdit").closest(".report-edit");
      return note.parentElement === editor.parentElement && Boolean(note.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), true, "the unsaved warning must precede the retained editor");
    assert.deepEqual(model.posts.map((post) => post.action), ["editReport", "approveReport"]);
    const sentGets = model.gets;
    await page.clock.runFor(90_000);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    assert.equal(model.gets, sentGets);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: testInfo.outputPath(`sent-${width}.png`), fullPage: true });
    await cleanErrors(page, model);
    assert.equal(await page.evaluate(() => window.__fetchOptions.every((options) => options.cache === "no-store" && options.signal)), true);
  });
}

test("pageshow and failed refresh preserve drafts, media queue and active upload", async ({ page }) => {
  let releaseUpload;
  const uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
  const model = await fixture(page, { onPost: async (body, _model, route) => {
    if (body.action !== "initMediaUpload") return false;
    await uploadGate;
    await route.fulfill({ json: { ok: true, uploadId: "synthetic-upload" } });
    return true;
  } });
  await page.getByRole("textbox", { name: "오늘의 핵심", exact: true }).fill("보존할 편집");
  await page.getByLabel("다음 방향", { exact: true }).fill("보존할 답변");
  await page.getByLabel("사진/영상 선택").evaluate((input) => { input.closest("details").open = true; });
  await page.getByLabel("사진/영상 선택").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from([1, 2, 3]) });
  await eventually(() => assert.equal(model.posts.length, 1));
  await page.getByLabel("사진/영상 선택").evaluate((input) => { window.__picker = input; window.__queue = document.getElementById("mediaUploadQueue"); });
  model.getMode = "error";
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await text(page.getByRole("alert"), "합성 조회 오류");
  model.getMode = "ok";
  const before = model.gets;
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await eventually(() => assert.ok(model.gets > before));
  await idle(page);
  assert.equal(await page.getByLabel("사진/영상 선택").evaluate((input) => input === window.__picker && document.getElementById("mediaUploadQueue") === window.__queue), true);
  await value(page.getByRole("textbox", { name: "오늘의 핵심", exact: true }), "보존할 편집");
  await value(page.getByLabel("다음 방향", { exact: true }), "보존할 답변");
  releaseUpload();
  await eventually(() => assert.equal(model.posts.length, 2));
  await disabled(page.getByLabel("사진/영상 선택"), false);
  assert.deepEqual(model.posts.map((post) => post.action), ["initMediaUpload", "uploadMediaChunk"]);
  await cleanErrors(page, model);
});

for (const action of ["approveReport", "editReport", "submit", "convertReport"]) {
  test(`${action} rejection reconciles sent state without another POST`, async ({ page }) => {
    const model = await fixture(page, {
      report: action === "convertReport" ? { url: "" } : {},
      onPost: async (_body, current, route) => {
        current.source.locked = true;
        current.source.report.status = "sent";
        current.source.report.sent = true;
        await route.fulfill({ status: 409, json: { ok: false, error: "이미 발송됨" } });
        return true;
      },
    });
    if (action === "editReport") await page.getByRole("textbox", { name: "오늘의 핵심", exact: true }).fill("수정 문장");
    const name = action === "submit" ? "기록 수정 · 리포트 다시 확인"
      : action === "convertReport" ? "리포트 생성 다시 시도" : "검토 완료 · 회원에게 발송";
    await page.getByRole("button", { name, exact: true }).click();
    await idle(page);
    await text(page.getByRole("alert"), "현재 원본 상태: 발송 완료");
    await disabled(page.getByRole("button", { name: "회원 리포트 발송 완료", exact: true }));
    assert.equal(model.posts.length, 1);
    assert.equal(model.posts[0].action || "submit", action);
    await cleanErrors(page, model);
  });
}

test("POST timeout is ambiguous, releases busy, reconciles queued and never retries POST", async ({ page }) => {
  const model = await fixture(page);
  model.postMode = "hang";
  await page.getByRole("button", { name: "검토 완료 · 회원에게 발송" }).click();
  await eventually(() => assert.equal(model.posts.length, 1));
  await page.clock.runFor(45_000);
  await idle(page);
  await text(page.getByRole("alert"), "서버 처리는 계속될 수 있습니다");
  await text(page.getByRole("alert"), "현재 원본 상태: 발송 대기 중");
  await text(page.getByRole("alert"), "요청 성공 여부는 응답만으로 확인되지 않았습니다");
  await disabled(page.getByRole("button", { name: "발송 대기 중", exact: true }));
  await disabled(page.getByRole("textbox", { name: "오늘의 핵심", exact: true }), false);
  model.source.report.status = "sent";
  model.source.locked = true;
  await tick(page, model);
  await disabled(page.getByRole("button", { name: "발송 완료", exact: true }));
  assert.equal(model.posts.length, 1);
  await cleanErrors(page, model);
});

test("follow-up GET timeout releases busy; pageshow later reconciles", async ({ page }) => {
  const model = await fixture(page, { onPost: async (_body, current) => {
    current.getMode = "hang";
    return false;
  } });
  await page.getByRole("button", { name: "검토 완료 · 회원에게 발송" }).click();
  await eventually(() => assert.equal(model.gets, 2));
  await page.clock.runFor(15_000);
  await idle(page);
  await text(page.getByRole("alert"), "상태 조회 시간이 초과");
  await disabled(page.getByRole("textbox", { name: "오늘의 핵심", exact: true }), false);
  model.getMode = "ok";
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await disabled(page.getByRole("button", { name: "발송 대기 중", exact: true }));
  assert.equal(model.posts.length, 1);
  await cleanErrors(page, model);
});

test("polling is bounded, coalesces resume requests and can resume after cap", async ({ page }) => {
  const model = await fixture(page, { report: { status: "queued" } });
  for (let index = 0; index < 90; index += 1) await tick(page, model);
  await text(page.getByRole("status"), "자동 상태 확인을 잠시 멈췄습니다");
  const capped = model.gets;
  await page.clock.runFor(60_000);
  assert.equal(model.gets, capped);
  model.getMode = "hang";
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await eventually(() => assert.equal(model.gets, capped + 1));
  model.getMode = "ok";
  await page.clock.runFor(15_000);
  await idle(page);
  await tick(page, model);
  assert.equal(model.posts.length, 0);
  await cleanErrors(page, model);
});

test("queued polling continues past 321 seconds and observes delayed delivery", async ({ page }) => {
  const model = await fixture(page, { report: { status: "queued" } });
  for (let index = 0; index < 33; index += 1) await tick(page, model);
  await disabled(page.getByRole("button", { name: "발송 대기 중", exact: true }));
  model.source.report.status = "sent";
  model.source.locked = true;
  await tick(page, model);
  await disabled(page.getByRole("button", { name: "발송 완료", exact: true }));
  assert.equal(model.posts.length, 0);
  await cleanErrors(page, model);
});

for (const action of ["submit", "editReport"]) {
  test(`${action} success reloads same-URL preview, unchanged polling retains it`, async ({ page }) => {
    const model = await fixture(page, { report: action === "submit" ? { status: "queued" } : {} });
    const previewRequests = () => model.requests.filter((request) => request.url.startsWith(`${origin}/report`)).length;
    await eventually(() => assert.equal(previewRequests(), 1));
    await page.getByRole("heading", { name: "회원용 리포트", exact: true }).evaluate((heading) => {
      window.__initialPreview = heading.parentElement.querySelector("iframe");
    });
    if (action === "editReport") {
      await page.getByRole("textbox", { name: "오늘의 핵심", exact: true }).fill("미리보기 갱신 문장");
      await page.getByRole("button", { name: "검토 완료 · 회원에게 발송", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "기록 수정 · 리포트 다시 확인", exact: true }).click();
    }
    await eventually(() => assert.equal(model.posts.length, action === "submit" ? 1 : 2));
    await idle(page);
    await eventually(() => assert.equal(previewRequests(), 2));
    assert.equal(await page.getByRole("heading", { name: "회원용 리포트", exact: true }).evaluate((heading) => {
      const preview = heading.parentElement.querySelector("iframe");
      window.__refreshedPreview = preview;
      return preview !== window.__initialPreview && preview.dataset.sourceUrl === "https://private-chart.test/report";
    }), true, "content changes must reload the preview even when the source URL is unchanged");
    model.source.report.status = "queued";
    const getsBeforeResume = model.gets;
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await eventually(() => assert.ok(model.gets > getsBeforeResume));
    await idle(page);
    await tick(page, model);
    assert.equal(previewRequests(), 2, "unchanged status polling must not request the preview again");
    assert.equal(await page.getByRole("heading", { name: "회원용 리포트", exact: true }).evaluate((heading) =>
      heading.parentElement.querySelector("iframe") === window.__refreshedPreview), true);
    assert.deepEqual(model.posts.map((post) => post.action || "submit"), action === "submit" ? ["submit"] : ["editReport", "approveReport"]);
    await cleanErrors(page, model);
  });
}

test("stale GET rejection cannot overwrite newer queued approval success", async ({ page }) => {
  let staleRoute;
  const model = await fixture(page, { onGet: async (current, route) => {
    if (current.gets !== 2) return false;
    staleRoute = route;
    return true;
  } });
  await page.getByRole("status").evaluate((status) => {
    window.__statusMessages = [];
    window.__statusObserver = new MutationObserver(() => window.__statusMessages.push(status.textContent));
    window.__statusObserver.observe(status, { childList: true, characterData: true, subtree: true });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await eventually(() => assert.ok(staleRoute));
  await page.getByRole("button", { name: "검토 완료 · 회원에게 발송", exact: true }).click();
  await text(page.getByRole("status"), "검토한 리포트를 발송 대기열에 등록했습니다");
  await staleRoute.fulfill({ status: 503, json: { ok: false, error: "과거 조회 실패" } });
  await idle(page);
  await disabled(page.getByRole("button", { name: "발송 대기 중", exact: true }));
  assert.equal(await page.getByRole("alert").count(), 0);
  await text(page.getByRole("status"), "검토한 리포트를 발송 대기열에 등록했습니다");
  assert.equal(await page.evaluate(() => window.__statusMessages.some((message) => message.includes("과거 조회 실패"))), false);
  assert.equal(model.gets, 3);
  assert.deepEqual(model.posts.map((post) => post.action), ["approveReport"]);
  await cleanErrors(page, model);
});

test("JSON HTTP 503 POST remains ambiguous and continues GET reconciliation without POST retry", async ({ page }) => {
  const model = await fixture(page, { onPost: async (_body, _current, route) => {
    await route.fulfill({ status: 503, json: { ok: false, error: "합성 서버 처리 오류" } });
    return true;
  } });
  await page.getByRole("button", { name: "검토 완료 · 회원에게 발송", exact: true }).click();
  await eventually(() => assert.equal(model.posts.length, 1));
  await idle(page);
  await text(page.getByRole("alert"), "합성 서버 처리 오류");
  await text(page.getByRole("alert"), "요청 성공 여부는 응답만으로 확인되지 않았습니다");
  await text(page.getByRole("alert"), "기록 저장됨 · 발송 확인 안 됨");
  assert.equal(model.source.report.status, "draft_created");
  await eventually(() => assert.equal(model.requests.filter((request) => request.url.startsWith(`${origin}/report`)).length, 2));
  await tick(page, model);
  model.source.report.status = "queued";
  await tick(page, model);
  await disabled(page.getByRole("button", { name: "발송 대기 중", exact: true }));
  model.source.report.status = "sent";
  model.source.locked = true;
  await tick(page, model);
  await disabled(page.getByRole("button", { name: "발송 완료", exact: true }));
  assert.deepEqual(model.posts.map((post) => post.action), ["approveReport"]);
  await cleanErrors(page, model);
});

test("ambiguous content POST reloads again when delayed same-URL source changes, then retains stable preview", async ({ page }) => {
  const model = await fixture(page, { onPost: async (_body, _current, route) => {
    await route.fulfill({ status: 503, json: { ok: false, error: "저장 응답 미확인" } });
    return true;
  } });
  const previewRequests = () => model.requests.filter((request) => request.url.startsWith(`${origin}/report`)).length;
  await eventually(() => assert.equal(previewRequests(), 1));
  await page.getByLabel("다음 방향", { exact: true }).fill("서버에서 늦게 저장되는 기록");
  await page.getByRole("button", { name: "기록 수정 · 리포트 다시 확인", exact: true }).click();
  await eventually(() => assert.equal(model.posts.length, 1));
  await idle(page);
  await text(page.getByRole("alert"), "요청 성공 여부는 응답만으로 확인되지 않았습니다");
  await eventually(() => assert.equal(previewRequests(), 2));
  await value(page.getByRole("textbox", { name: "오늘의 핵심", exact: true }), "저장된 핵심");
  assert.equal(await page.evaluate(() => state.previewRefreshNeeded), false, "the immediate old-source GET must consume the one-shot refresh flag");
  await page.getByRole("heading", { name: "회원용 리포트", exact: true }).evaluate((heading) => {
    window.__oldSourcePreview = heading.parentElement.querySelector("iframe");
  });
  model.source.report.summary = "서버 처리가 끝난 뒤 달라진 핵심";
  await tick(page, model);
  await eventually(() => assert.equal(previewRequests(), 3));
  await value(page.getByRole("textbox", { name: "오늘의 핵심", exact: true }), "서버 처리가 끝난 뒤 달라진 핵심");
  assert.equal(await page.getByRole("heading", { name: "회원용 리포트", exact: true }).evaluate((heading) => {
    const preview = heading.parentElement.querySelector("iframe");
    window.__eventualSourcePreview = preview;
    return preview !== window.__oldSourcePreview && preview.dataset.sourceUrl === "https://private-chart.test/report";
  }), true, "eventually changed source must reload even after the immediate refresh flag was consumed");
  await tick(page, model);
  assert.equal(previewRequests(), 3, "unchanged source polling must retain the eventual preview");
  assert.equal(await page.getByRole("heading", { name: "회원용 리포트", exact: true }).evaluate((heading) =>
    heading.parentElement.querySelector("iframe") === window.__eventualSourcePreview), true);
  assert.equal(model.posts.length, 1);
  assert.equal(model.posts[0].mode, "post");
  assert.equal(model.posts[0].answers.nextDirection, "서버에서 늦게 저장되는 기록");
  await cleanErrors(page, model);
});
