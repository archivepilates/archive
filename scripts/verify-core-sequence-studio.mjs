#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { chromium } from "playwright";

// Actual adapter and UI, fake Auth/Firestore SDK. This is NOT real Firestore QA.
const coreRoot = fileURLToPath(new URL("../core/", import.meta.url));
const output = "/tmp/archive-core-sequence-cloud-qa";
const liveBase = process.env.ARCHIVE_CORE_BASE_URL?.replace(/\/+$/, "");
const clone = (value) => JSON.parse(JSON.stringify(value));
const KEY = "archive.sequence.studio.draft.v1";
const LIBKEY = "archive.sequence.studio.library.v1";
const results = [];
const subscriptions = new Map();
const documents = new Map();
const failures = new Map();
let serial = Promise.resolve();
let transactionId = 0;
let clock = 0;
let browser;
let server;
let base;
const transactions = new Map();
const pendingBroadcasts = new Set();
const contexts = new Set();
const blockedRequests = [];
const runFile = promisify(execFile);
await fs.mkdir(output, { recursive: true });

function queryRows(ref) {
  let rows = [...documents].filter(([key]) => key.startsWith(`${ref.path}/`) && key.split("/").length === ref.path.split("/").length + 1)
    .map(([key, data]) => ({ path: key, data: clone(data) }));
  for (const constraint of ref.constraints || []) {
    if (constraint.type === "where") {
      assert.equal(constraint.operator, "==", "fixture supports equality queries only");
      rows = rows.filter((row) => row.data[constraint.field] === constraint.value);
    }
    if (constraint.type === "orderBy") rows.sort((a, b) => {
      const aa = a.data[constraint.field], bb = b.data[constraint.field];
      return (aa < bb ? -1 : aa > bb ? 1 : a.path.localeCompare(b.path)) * (constraint.direction === "desc" ? -1 : 1);
    });
    if (constraint.type === "limit") rows = rows.slice(0, constraint.count);
  }
  return rows;
}

function broadcast() {
  for (const [id, subscription] of subscriptions) {
    const task = subscription.frame.evaluate(({ id, rows }) => window.__sequenceSnapshot?.(id, rows), {
      id, rows: snapshotPayload(subscription.ref),
    }).catch((error) => {
      if (!/closed|destroyed|detached|navigation/i.test(error.message)) subscription.errors.push(error.message);
      subscriptions.delete(id);
    }).finally(() => pendingBroadcasts.delete(task));
    pendingBroadcasts.add(task);
  }
}

function snapshotPayload(ref) {
  return ref.kind === "doc" ? (documents.has(ref.path) ? clone(documents.get(ref.path)) : null) : queryRows(ref);
}

function applyWrites(writes) {
  const next = new Map(documents);
  for (const write of writes) {
    if (write.type === "delete") next.delete(write.ref.path);
    else {
      const data = clone(write.data);
      for (const [key, value] of Object.entries(data)) if (value?.__serverTimestamp) data[key] = ++clock;
      if (write.type === "update") assert.ok(next.has(write.ref.path), "update requires existing document");
      next.set(write.ref.path, write.type === "update" ? { ...next.get(write.ref.path), ...data } : data);
    }
  }
  documents.clear();
  for (const entry of next) documents.set(...entry);
  broadcast();
}

// Hold a Node-side mutex for the whole SDK callback, including its reads.
async function dispatch(uid, operation, args = {}, source) {
  if (operation === "begin") {
    const previous = serial;
    let release;
    serial = new Promise((resolve) => { release = resolve; });
    await previous;
    const token = `${uid}:${++transactionId}`;
    transactions.set(token, { uid, release });
    return token;
  }
  if (operation === "commit" || operation === "rollback") {
    const transaction = transactions.get(args.token);
    assert.equal(transaction?.uid, uid, "transaction must belong to this fixture context");
    try {
      if (operation === "commit") {
        if (failures.get(uid)) throw Error("QA injected server save failure");
        applyWrites(args.writes);
      }
    } finally { transactions.delete(args.token); transaction.release(); }
    return true;
  }
  if (operation === "get") return documents.has(args.ref.path) ? clone(documents.get(args.ref.path)) : null;
  if (operation === "list") return queryRows(args.ref);
  if (operation === "subscribe") {
    assert.ok(source, "browser subscription requires an exposed binding source");
    subscriptions.set(args.id, { ref: args.ref, frame: source.frame, context: source.context, errors: source.errors });
    return snapshotPayload(args.ref);
  }
  if (operation === "unsubscribe") { subscriptions.delete(args.id); return true; }
  if (operation === "batch") {
    const token = await dispatch(uid, "begin");
    return dispatch(uid, "commit", { token, writes: args.writes });
  }
  throw Error(`Unsupported fake Firebase operation: ${operation}`);
}

// Shared by the browser fixture and the Node actual-adapter checks.
function sdkRuntime(call) {
  const snapshot = (ref, data) => ({ id: ref.path.split("/").pop(), ref, exists: () => data !== null, data: () => data });
  const snapshots = (rows) => ({ docs: rows.map((row) => snapshot({ path: row.path }, row.data)), metadata: { fromCache: false, hasPendingWrites: false } });
  const callbacks = new Map();
  const deliver = (id, rows) => callbacks.get(id)?.next(rows);
  if (typeof window !== "undefined") window.__sequenceSnapshot = deliver;
  return {
    __deliver: deliver,
    db: {},
    doc: (_db, ...parts) => ({ path: parts.join("/"), kind: "doc" }),
    collection: (_db, ...parts) => ({ path: parts.join("/"), kind: "collection" }),
    query: (ref, ...constraints) => ({ ...ref, constraints }),
    where: (field, operator, value) => ({ type: "where", field, operator, value }),
    orderBy: (field, direction = "asc") => ({ type: "orderBy", field, direction }),
    limit: (count) => ({ type: "limit", count }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    getDocFromServer: async (ref) => snapshot(ref, await call("get", { ref })),
    getDocsFromServer: async (ref) => snapshots(await call("list", { ref })),
    onSnapshot: (ref, _options, next, error) => {
      const id = crypto.randomUUID();
      const send = (value) => {
        const rows = value?.__fixtureSnapshot ? value.rows : value;
        const metadata = value?.__fixtureSnapshot ? value.metadata : { fromCache: false, hasPendingWrites: false };
        next(ref.kind === "doc" ? { ...snapshot(ref, rows), metadata } : { ...snapshots(rows), metadata });
      };
      callbacks.set(id, { next: send, error });
      call("subscribe", { id, ref }).then((rows) => { if (callbacks.has(id)) send(rows); }).catch(error);
      return () => { callbacks.delete(id); void call("unsubscribe", { id }).catch(() => {}); };
    },
    runTransaction: async (_db, callback) => {
      const token = await call("begin");
      const writes = [];
      let committed = false;
      let writing = false;
      try {
        const value = await callback({
          get: async (ref) => { if (writing) throw Error("Transaction read after write"); return snapshot(ref, await call("get", { ref, token })); },
          set: (ref, data) => { writing = true; writes.push({ type: "set", ref, data }); },
          update: (ref, data) => { writing = true; writes.push({ type: "update", ref, data }); },
          delete: (ref) => { writing = true; writes.push({ type: "delete", ref }); },
        });
        // Commit consumes the token even when an injected failure occurs.
        committed = true;
        await call("commit", { token, writes });
        return value;
      } finally { if (!committed) await call("rollback", { token }); }
    },
    writeBatch: () => {
      const writes = [];
      return { delete: (ref) => writes.push({ type: "delete", ref }), commit: () => call("batch", { writes }) };
    },
  };
}

const adapterSource = await fs.readFile(path.join(coreRoot, "assets/sequence-store.js"), "utf8");
const adapterHash = createHash("sha256").update(adapterSource).digest("hex");
const { createSequenceStore } = await import(`data:text/javascript;base64,${Buffer.from(adapterSource).toString("base64")}`);
const runtimeFor = (uid) => {
  let runtime;
  runtime = sdkRuntime((operation, args) => dispatch(uid, operation, args, {
    frame: { evaluate: async (_callback, { id, rows }) => runtime.__deliver(id, rows) },
    errors: [],
  }));
  runtime.authClient = { currentUser: { uid } };
  return runtime;
};
const note = (id, title = "실제 adapter 검증") => ({ schema: "archive.sequence.v1", id, title, teacher: "QA", equipment: "체어", equipmentOther: "", date: "", duration: "", audience: "", goal: "흉추 움직임", cues: ["", "", ""], memo: "", sketchSpace: true, source: "", moves: { warm: [{ id: "warm", name: "롤백", description: "명치를 뒤로", muscles: "복부", purpose: "굴곡", image: "" }], main: [], cool: [] } });
const rowsFor = (uid) => [...documents].filter(([key, data]) => key.startsWith("sequenceNotes/") && data.ownerUid === uid && !data.deleted);

async function check(name, action) {
  const start = Date.now();
  try { const evidence = await action(); results.push({ name, status: "passed", milliseconds: Date.now() - start, evidence }); }
  catch (error) {
    results.push({ name, status: "failed", milliseconds: Date.now() - start, error: error.stack });
    console.error(`FAIL ${name}: ${error.message}`);
  }
  console.log(`${results.at(-1).status.toUpperCase()} ${name}`);
}

async function actualAdapterChecks() {
  const uid = "adapter-qa";
  const a = createSequenceStore(runtimeFor(uid), { uid });
  const runtimeB = runtimeFor(uid);
  const b = createSequenceStore(runtimeB, { uid });
  const state = note("adapter-note");
  state.moves.warm[0].image = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 217]).toString("base64")}`;
  assert.equal(await a.save(state, 0), 1);
  assert.equal(documents.get("sequenceNotes/adapter-note").revision, 1);
  assert.ok(!documents.get("sequenceNotes/adapter-note").payload.includes("data:image"));
  assert.equal([...documents.keys()].filter((key) => key.startsWith("sequenceNoteImages/adapter-note_")).length, 1);
  const loaded = await b.get(state.id);
  assert.deepEqual(loaded.state, state);
  const watched = [];
  const listed = [];
  let readyWatch, readyList;
  const initialWatch = new Promise((resolve) => { readyWatch = resolve; });
  const initialList = new Promise((resolve) => { readyList = resolve; });
  const stopWatch = b.watch(state.id, (data) => { watched.push(data); readyWatch(); }, (error) => { throw error; });
  const stopList = b.subscribe((data) => { listed.push(data); readyList(); }, (error) => { throw error; });
  try {
  await Promise.all([initialWatch, initialList]);
  assert.equal(watched.at(-1).revision, 1);
  assert.equal(listed.at(-1).length, 1);
  const counts = [watched.length, listed.length];
  for (const [id, sub] of subscriptions) {
    for (const metadata of [{ fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }]) {
      runtimeB.__deliver(id, { __fixtureSnapshot: true, rows: snapshotPayload(sub.ref), metadata });
    }
  }
  assert.deepEqual([watched.length, listed.length], counts, "ignore cached and pending-write snapshots");
  const concurrent = await Promise.allSettled([a.save({ ...state, title: "winner-a" }, 1), b.save({ ...state, title: "winner-b" }, 1)]);
  assert.equal(concurrent.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(concurrent.find((item) => item.status === "rejected").reason.code, "sequence/conflict");
  assert.equal((await a.get(state.id)).revision, 2);
  await Promise.allSettled([...pendingBroadcasts]);
  assert.equal(watched.at(-1).revision, 2, "active document watcher receives revisions");
  // The active-note watcher must still work outside the recent-100 query.
  for (let index = 0; index < 101; index++) documents.set(`sequenceNotes/recent_${index}`, { ownerUid: uid, deleted: false, updatedAt: 10000 + index, payload: "{}" });
  assert.equal((await b.list()).length, 100);
  assert.ok(!(await b.list()).some((row) => row.id === state.id));
  assert.equal(await a.save({ ...state, title: "outside recent-100" }, 2), 3);
  await Promise.allSettled([...pendingBroadcasts]);
  assert.equal(watched.at(-1).revision, 3, "watch receives updates to notes outside recent-100");
  assert.ok(!listed.at(-1).some((row) => row.id === state.id));
  for (let index = 0; index < 101; index++) documents.delete(`sequenceNotes/recent_${index}`);
  const foreign = createSequenceStore(runtimeFor("another-operator"), { uid: "another-operator" });
  assert.equal((await foreign.list()).length, 0);
  await assert.rejects(foreign.get(state.id), { code: "sequence/conflict" });
  await assert.rejects(foreign.save(state, 3), { code: "sequence/conflict" });
  failures.set(uid, true);
  const beforeFailure = clone([...documents]);
  await assert.rejects(a.save({ ...state, title: "must not commit" }, 3), /injected/);
  assert.deepEqual([...documents], beforeFailure, "failed transaction must be atomic");
  failures.delete(uid);
  await assert.rejects(a.save({ ...state, id: "bad/id" }, 0), /ID/);
  const tooLarge = clone(state);
  tooLarge.id = "oversized";
  tooLarge.moves.warm[0].image = `data:image/jpeg;base64,${Buffer.alloc(65537).toString("base64")}`;
  await assert.rejects(a.save(tooLarge, 0), /사진/);
  assert.ok(!documents.has("sequenceNotes/oversized"));
  await assert.rejects(a.save({ ...state, id: "oversized-payload", memo: "x".repeat(180001) }, 0), /내용/);
  await assert.rejects(a.remove(state.id, 1), { code: "sequence/conflict" });
  // Exercise multiple cleanup batches, not just the one UI attachment.
  for (let index = 0; index < 401; index++) documents.set(`sequenceNoteImages/cleanup_${index}`, { ownerUid: uid, noteId: state.id, dataUrl: "fixture" });
  await a.remove(state.id, 3);
  assert.equal(documents.get(`sequenceNotes/${state.id}`).deleted, true);
  assert.equal(documents.get(`sequenceNotes/${state.id}`).revision, 4);
  assert.equal(documents.get(`sequenceNotes/${state.id}`).payload, "{}");
  assert.ok(![...documents.values()].some((data) => data.noteId === state.id));
  await Promise.allSettled([...pendingBroadcasts]);
  assert.equal(watched.at(-1).deleted, true, "doc watch delivers deletion even though list excludes tombstones");
  assert.equal(listed.at(-1).length, 0);
  assert.equal((await b.list()).length, 0);
  await assert.rejects(a.save(state, 0), { code: "sequence/conflict" });
  runtimeB.authClient.currentUser = { uid: "changed-account" };
  await assert.rejects(b.list(), { code: "permission-denied" });
  await assert.rejects(b.save(note("session-test"), 0), { code: "permission-denied" });
  return { actualAdapter: true, mockSDK: true, realFirestore: false, concurrentWinnerCount: 1, cleanupAssets: 402, watch: true, confirmedSnapshotsOnly: true, listLimit: 100, deletedExcluded: true, sessionGuard: true, adapterHash };
  } finally { stopWatch(); stopList(); }
}

async function fixture(context, uid, legacy = {}) {
  const errors = [];
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  await context.exposeBinding("__sequenceQA", (source, operation, args) => dispatch(uid, operation, args, { ...source, context, errors }));
  await context.addInitScript(({ uid, legacy, origin }) => {
    window.__sequenceFixtureUid = uid;
    if (location.origin !== origin) return;
    // Seed only once per isolated context/origin, preserving migration evidence.
    if (!sessionStorage.getItem("sequence-qa-seeded")) {
      for (const [key, value] of Object.entries(legacy)) localStorage.setItem(key, value);
      sessionStorage.setItem("sequence-qa-seeded", "true");
    }
  }, { uid, legacy, origin: new URL(base).origin });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "www.gstatic.com" && /\/firebase-[a-z-]+\.js$/.test(url.pathname)) {
      const file = url.pathname.split("/").pop();
      const firestore = `const sdk=(${sdkRuntime.toString()})((op,args)=>window.__sequenceQA(op,args));\n` +
        ["doc", "collection", "query", "where", "orderBy", "limit", "serverTimestamp", "getDocFromServer", "getDocsFromServer", "onSnapshot", "runTransaction", "writeBatch"]
          .map((name) => `export const ${name}=sdk.${name};`).join("\n") + "\nexport const getFirestore=()=>sdk.db;";
      const modules = {
        "firebase-app.js": "export const getApps=()=>[];export const initializeApp=()=>({});",
        "firebase-auth.js": "export const getAuth=()=>({currentUser:window.__sequenceFixtureUid?{uid:window.__sequenceFixtureUid}:null});export const onAuthStateChanged=(auth,callback)=>{queueMicrotask(()=>callback(auth.currentUser));return ()=>{};};",
        "firebase-firestore.js": firestore,
        "firebase-functions.js": "export const getFunctions=()=>({});export const httpsCallable=()=>{throw Error('Unexpected callable in isolated QA');};",
      };
      assert.ok(modules[file], `Unsupported Firebase module: ${file}`);
      return route.fulfill({ contentType: "text/javascript", body: modules[file], headers: { "Access-Control-Allow-Origin": "*" } });
    }
    if (url.origin === new URL(base).origin && ["GET", "HEAD"].includes(route.request().method())) return route.continue();
    blockedRequests.push({ url: `${url.origin}${url.pathname}`, method: route.request().method() });
    return route.abort("blockedbyclient");
  });
  return errors;
}

async function withContext(uid, width, action, legacy = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true, serviceWorkers: "block" });
  contexts.add(context);
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const errors = await fixture(context, uid, legacy);
    return await action(context, errors);
  } catch (error) {
    for (const page of context.pages()) await page.screenshot({ path: path.join(output, `failure-${uid}-${width}.png`), fullPage: true }).catch(() => {});
    await context.tracing.stop({ path: path.join(output, `failure-${uid}-${width}.zip`) }).catch(() => {});
    throw error;
  } finally {
    await context.tracing.stop().catch(() => {});
    await context.close();
    contexts.delete(context);
    for (const [id, subscription] of subscriptions) if (subscription.context === context) subscriptions.delete(id);
  }
}

async function openStudio(context) {
  const page = await context.newPage();
  await page.goto(`${base}/sequence/`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("iframe")?.contentWindow?.ARCHIVE_TEST && !document.querySelector("iframe").contentDocument.getElementById("title").disabled);
  const frame = page.frames().find((item) => /\/sequence\/studio\.html/.test(item.url()));
  assert.ok(frame, "authenticated studio iframe must load");
  await frame.getByRole("heading", { name: "시퀀스 노트 스튜디오" }).waitFor();
  return { page, frame };
}

async function flush(frame) {
  assert.equal(await frame.evaluate(() => window.ARCHIVE_TEST.flush()), true, "server-confirmed save must succeed");
  await frame.waitForFunction(() => !window.ARCHIVE_TEST.dirty() && window.ARCHIVE_TEST.getRevision() > 0);
}

async function snapshot(frame) {
  return frame.evaluate(() => ({ state: window.ARCHIVE_TEST.getState(), revision: window.ARCHIVE_TEST.getRevision(), dirty: window.ARCHIVE_TEST.dirty() }));
}

async function downloadJSON(page, button, filename) {
  const promise = page.waitForEvent("download");
  await button.click();
  const download = await promise;
  const target = path.join(output, filename);
  await download.saveAs(target);
  return { target, data: JSON.parse(await fs.readFile(target, "utf8")) };
}

async function confirm(context, action) {
  const handler = (dialog) => void dialog.accept();
  context.on("dialog", handler);
  try { return await action(); } finally { context.off("dialog", handler); }
}

async function layout(page, frame, filename) {
  await page.screenshot({ path: path.join(output, filename), fullPage: true });
  const outer = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, height: document.querySelector("iframe").clientHeight }));
  const inner = await frame.evaluate(() => {
    const root = document.documentElement;
    const shown = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
    const textOverflow = [...document.querySelectorAll("button,label,h1,h2,h3,p")].filter(shown).filter((el) => el.scrollWidth > el.clientWidth + 2).map((el) => el.textContent.slice(0,80));
    const mediaOverflow = [...document.querySelectorAll("img,svg,canvas")].filter(shown).filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1).length;
    const smallTargets = [...document.querySelectorAll("button,a.btn")].filter(shown).filter((el) => el.getBoundingClientRect().height < 44).length;
    return { scroll: root.scrollWidth, width: root.clientWidth, textOverflow, mediaOverflow, smallTargets };
  });
  assert.ok(outer.scroll <= outer.width + 1, "CORE horizontal overflow");
  assert.ok(inner.scroll <= inner.width + 1, "studio horizontal overflow");
  assert.deepEqual(inner.textOverflow, [], "clipped text");
  assert.equal(inner.mediaOverflow, 0, "media overflow");
  assert.equal(inner.smallTargets, 0, "44px touch targets");
  assert.ok(outer.height > 300, "usable editor frame");
  return { outer, inner };
}

async function responsive(width) {
  const uid = `responsive-${width}`;
  return withContext(uid, width, async (context, errors) => {
    let { page, frame } = await openStudio(context);
    if (width <= 1040) await page.getByRole("button", { name: "메뉴", exact: true }).click();
    assert.equal(await page.getByRole("link", { name: "시퀀스 노트", exact: true }).getAttribute("aria-current"), "page");
    if (width <= 1040) await page.getByRole("button", { name: "메뉴", exact: true }).click();
    // Same-profile WebLock is expected; cross-device checks use separate contexts below.
    const sameContext = await context.newPage();
    try {
      await sameContext.goto(`${base}/sequence/`);
      await sameContext.frameLocator("iframe").getByRole("alert").filter({ hasText: "다른 창" }).waitFor();
    } finally { await sameContext.close(); }
    await frame.getByLabel("수업명", { exact: true }).fill(`시퀀스 검증 ${width}`);
    await frame.getByLabel("작성 강사", { exact: true }).fill("테스트 강사");
    await frame.getByLabel("수업 목표", { exact: true }).fill("흉추 움직임 확인");
    await frame.getByRole("button", { name: "+ 동작 추가", exact: true }).first().click();
    await frame.getByLabel("동작명", { exact: true }).fill("롤백");
    await frame.getByLabel("간단한 동작 설명", { exact: true }).fill("명치를 뒤로 보내기");
    await frame.getByLabel("핵심 큐 1", { exact: true }).fill("등힘으로 지지해요");
    await flush(frame);
    const saved = await snapshot(frame);
    assert.equal(documents.get(`sequenceNotes/${saved.state.id}`).title, saved.state.title);
    const writeLayout = await layout(page, frame, `write-${width}.png`);
    await frame.getByLabel("수업명", { exact: true }).focus();
    const focus = await frame.getByLabel("수업명", { exact: true }).evaluate((el) => ({ active: document.activeElement === el, outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow }));
    assert.ok(focus.active && (focus.outline !== "none" || focus.shadow !== "none"), "visible input focus");
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction((id) => document.querySelector("iframe")?.contentWindow?.ARCHIVE_TEST?.getState().id === id, saved.state.id);
    frame = page.frames().find((item) => /\/sequence\/studio\.html/.test(item.url()));
    assert.deepEqual((await snapshot(frame)).state, saved.state, "cloud persists across reload without localStorage");
    await frame.getByRole("tab", { name: "02 노트 보기" }).click();
    await frame.getByRole("button", { name: "내 시퀀스에 저장", exact: true }).click();
    await frame.getByRole("button", { name: "굿노트용 PDF 만들기", exact: true }).click();
    const promise = page.waitForEvent("download");
    await frame.getByRole("link", { name: "PDF 저장", exact: true }).click();
    const pdfDownload = await promise;
    const pdfPath = path.join(output, `sequence-${width}.pdf`);
    await pdfDownload.saveAs(pdfPath);
    const pdf = await fs.readFile(pdfPath);
    assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.7");
    assert.ok(pdf.includes(Buffer.from("/ToUnicode")), "selectable Korean mapping");
    assert.ok(pdf.includes(Buffer.from("/FontFile2")), "embedded Korean font");
    // This writer emits Identity-H text; decode actual PDF text operators, not metadata.
    const text = [...pdf.toString("latin1").matchAll(/<([0-9A-F]+)> Tj/g)].map((match) => match[1].match(/.{4}/g).map((hex) => String.fromCharCode(parseInt(hex, 16))).join("")).join("\n");
    assert.ok(text.includes("롤백") && text.includes("시퀀스 검증"), "PDF text operators preserve Korean");
    assert.ok(pdf.includes(Buffer.from("/MediaBox [0 0 1200 900]")));
    await fs.writeFile(path.join(output, `sequence-${width}-text.txt`), text);
    const previewLayout = await layout(page, frame, `preview-${width}.png`);
    const pagination = await frame.evaluate(() => {
      const state = window.ARCHIVE_TEST.sample();
      state.memo = "A\n".repeat(110);
      for (const stage of Object.keys(state.moves)) state.moves[stage] = Array.from({ length: 30 }, (_, index) => ({ ...state.moves.warm[0], id: `${stage}_${index}`, name: "긴 동작 이름 ".repeat(6), description: "동작 설명 ".repeat(20), purpose: "흉추 회전 ".repeat(10) }));
      const pages = window.ARCHIVE_TEST.buildPages(state);
      return { pages: pages.length, clipped: pages.flat().filter((op) => op.x < 0 || op.y < 0 || op.x > 1200 || op.y > 900 || (op.t === "rect" && (op.x + op.w > 1201 || op.y + op.h > 901))).length };
    });
    assert.ok(pagination.pages > 1);
    assert.equal(pagination.clipped, 0, "long content must paginate within PDF bounds");
    await frame.getByRole("tab", { name: /내 시퀀스/ }).click();
    await frame.getByLabel("저장된 시퀀스 검색").fill(saved.state.title);
    await frame.getByRole("heading", { name: saved.state.title, exact: true }).waitFor();
    const backup = await downloadJSON(page, frame.getByRole("button", { name: "최근 기록 백업", exact: true }), `backup-${width}.json`);
    assert.equal(backup.data.records.length, 1);
    assert.deepEqual(backup.data.records[0], saved.state);
    const chooserPromise = page.waitForEvent("filechooser");
    await frame.getByRole("button", { name: "응답 불러오기", exact: true }).click();
    const chooser = await chooserPromise;
    await confirm(context, async () => {
      await chooser.setFiles(backup.target);
      await frame.getByRole("status").filter({ hasText: "1개 기록을 Firestore에 저장했어요." }).waitFor();
    });
    assert.equal(rowsFor(uid).length, 2, "import must create copies");
    assert.ok(rowsFor(uid).some(([key]) => key !== `sequenceNotes/${saved.state.id}`));
    const libraryLayout = await layout(page, frame, `library-${width}.png`);
    assert.deepEqual(await frame.evaluate(({ KEY, LIBKEY }) => [localStorage.getItem(KEY), localStorage.getItem(LIBKEY)], { KEY, LIBKEY }), [null, null]);
    assert.deepEqual(errors, []);
    return { width, writeLayout, previewLayout, libraryLayout, pdfBytes: pdf.length, selectableKorean: true, pagination, focus };
  });
}

async function sharingAndConflicts() {
  const uid = "shared-operator";
  return withContext(uid, 1440, async (contextA, errorsA) => {
    const a = await openStudio(contextA);
    await a.frame.evaluate(() => { const state = window.ARCHIVE_TEST.sample(); state.title = "공유 원본"; window.ARCHIVE_TEST.setState(state); });
    await flush(a.frame);
    const original = await snapshot(a.frame);
    return withContext(uid, 390, async (contextB, errorsB) => {
      assert.notEqual(contextA, contextB);
      const b = await openStudio(contextB);
      assert.deepEqual((await snapshot(b.frame)).state, original.state);
      await a.frame.getByLabel("수업 목표", { exact: true }).fill("다른 기기 서버 변경");
      await flush(a.frame);
      await b.frame.waitForFunction(() => window.ARCHIVE_TEST.getState().goal === "다른 기기 서버 변경");
      // B keeps unsaved local text while A commits the next revision.
      await b.frame.getByLabel("수업명", { exact: true }).fill("보존할 로컬 수정");
      await a.frame.getByLabel("수업명", { exact: true }).fill("최신 원본");
      await flush(a.frame);
      await b.frame.getByRole("alert").filter({ has: b.frame.getByRole("button", { name: "사본으로 저장", exact: true }) }).waitFor();
      assert.equal((await snapshot(b.frame)).state.title, "보존할 로컬 수정");
      assert.equal(await b.frame.evaluate(() => window.ARCHIVE_TEST.flush()), false);
      assert.equal(documents.get(`sequenceNotes/${original.state.id}`).title, "최신 원본");
      await b.frame.getByRole("button", { name: "사본으로 저장", exact: true }).click();
      await b.frame.waitForFunction((id) => window.ARCHIVE_TEST.getState().id !== id && !window.ARCHIVE_TEST.dirty() && window.ARCHIVE_TEST.getRevision() === 1, original.state.id);
      const copied = await snapshot(b.frame);
      assert.equal(documents.get(`sequenceNotes/${copied.state.id}`).title, "보존할 로컬 수정");
      assert.equal(documents.get(`sequenceNotes/${original.state.id}`).title, "최신 원본");
      // A separate transaction-conflict path, even if no snapshot arrived first.
      await a.frame.getByLabel("수업 목표", { exact: true }).fill("버릴 로컬 목표");
      const other = createSequenceStore(runtimeFor(uid), { uid });
      const latest = await other.get(original.state.id);
      await other.save({ ...latest.state, goal: "최신 기록 복구 목표" }, latest.revision);
      assert.equal(await a.frame.evaluate(() => window.ARCHIVE_TEST.flush()), false);
      await confirm(contextA, async () => {
        await a.frame.getByRole("button", { name: "최신 기록 열기", exact: true }).click();
        await a.frame.waitForFunction(() => window.ARCHIVE_TEST.getState().goal === "최신 기록 복구 목표" && !window.ARCHIVE_TEST.dirty());
      });
      await a.frame.getByLabel("수업명", { exact: true }).fill("삭제 후 보존할 로컬 수정");
      const toDelete = await other.get(original.state.id);
      await other.remove(original.state.id, toDelete.revision);
      await a.frame.getByRole("status").filter({ hasText: "다른 기기에서 삭제된 노트" }).waitFor();
      assert.equal((await snapshot(a.frame)).state.title, "삭제 후 보존할 로컬 수정");
      assert.equal(await a.frame.evaluate(() => window.ARCHIVE_TEST.flush()), false);
      await a.frame.getByRole("button", { name: "사본으로 저장", exact: true }).click();
      await a.frame.waitForFunction((id) => window.ARCHIVE_TEST.getState().id !== id && !window.ARCHIVE_TEST.dirty(), original.state.id);
      assert.equal(documents.get(`sequenceNotes/${original.state.id}`).deleted, true);
      assert.deepEqual(errorsA, []); assert.deepEqual(errorsB, []);
      return { distinctContexts: true, sharedUid: true, snapshotBroadcast: true, keptLocalChanges: true, copyRecovery: true, latestRecovery: true, remoteDeleteRecovery: true };
    });
  });
}

async function imagesAndFailures() {
  const uid = "image-operator";
  return withContext(uid, 390, async (context, errors) => {
    const { page, frame } = await openStudio(context);
    await frame.getByLabel("수업명", { exact: true }).fill("이미지 검증");
    await frame.getByRole("button", { name: "+ 동작 추가", exact: true }).first().click();
    await frame.getByLabel("동작명", { exact: true }).fill("스완");
    // Deterministic noisy PNG forces real compression rather than a blank canvas shortcut.
    const png = await frame.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 1800; canvas.height = 1200;
      const ctx = canvas.getContext("2d"); const pixels = ctx.createImageData(canvas.width, canvas.height);
      let seed = 12345;
      for (let index = 0; index < pixels.data.length; index += 4) {
        for (let channel = 0; channel < 3; channel++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[index + channel] = seed >>> 24; }
        pixels.data[index + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0); return canvas.toDataURL("image/png").split(",")[1];
    });
    const imagePath = path.join(output, "noisy-image.png");
    await fs.writeFile(imagePath, Buffer.from(png, "base64"));
    const chooserPromise = page.waitForEvent("filechooser");
    await frame.getByRole("button", { name: "스케치·사진 첨부", exact: true }).click();
    await (await chooserPromise).setFiles(imagePath);
    await frame.waitForFunction(() => window.ARCHIVE_TEST.getState().moves.warm[0]?.image.startsWith("data:image/jpeg;base64,"));
    const image = await frame.evaluate(async () => {
      const data = window.ARCHIVE_TEST.getState().moves.warm[0].image;
      const img = new Image(); img.src = data; await img.decode();
      return { bytes: atob(data.split(",")[1]).length, width: img.width, height: img.height, jpeg: data.startsWith("data:image/jpeg;base64,") };
    });
    assert.ok(image.jpeg && image.bytes <= 65536 && Math.max(image.width, image.height) <= 640);
    await flush(frame);
    const saved = await snapshot(frame);
    const raw = clone(documents.get(`sequenceNotes/${saved.state.id}`));
    assert.ok(!raw.payload.includes("data:image"), "note JSON must reference assets, not embed images");
    const assets = [...documents].filter(([, data]) => data.noteId === saved.state.id);
    assert.equal(assets.length, 1);
    assert.equal(Buffer.from(assets[0][1].dataUrl.split(",")[1], "base64").length, image.bytes);
    const loaded = await page.evaluate(async (id) => window.archiveSequenceStore.get(id), saved.state.id);
    assert.equal(loaded.state.moves.warm[0].image, saved.state.moves.warm[0].image);
    failures.set(uid, true);
    await frame.getByLabel("수업명", { exact: true }).fill("저장되면 안 되는 변경");
    assert.equal(await frame.evaluate(() => window.ARCHIVE_TEST.flush()), false);
    assert.deepEqual(documents.get(`sequenceNotes/${saved.state.id}`), raw);
    assert.equal((await snapshot(frame)).dirty, true);
    assert.equal((await snapshot(frame)).revision, saved.revision);
    const status = await frame.getByRole("status", { includeHidden: true }).allTextContents();
    assert.ok(status.some((text) => text.includes("저장 실패")), JSON.stringify({ status }));
    assert.ok(status.every((text) => !text.includes("저장 완료") && !text.includes("Firestore에 저장했어요")), "failed save must not claim success");
    await frame.getByRole("tab", { name: "02 노트 보기" }).click();
    await frame.getByRole("button", { name: "내 시퀀스에 저장", exact: true }).click();
    assert.ok(!(await frame.getByRole("status", { includeHidden: true }).allTextContents()).some((text) => text === "Firestore에 저장했어요."));
    const exported = await downloadJSON(page, frame.getByRole("button", { name: "응답 파일 저장 (.json)", exact: true }), "unsaved-response.json");
    assert.equal(exported.data.title, "저장되면 안 되는 변경");
    assert.ok(exported.data.moves.warm[0].image.startsWith("data:image/jpeg;base64,"), "portable response export includes resolved attachment");
    failures.delete(uid);
    await frame.getByRole("button", { name: "저장 재시도", exact: true }).click();
    await frame.waitForFunction(() => !window.ARCHIVE_TEST.dirty());
    await frame.getByRole("tab", { name: /내 시퀀스/ }).click();
    await confirm(context, async () => {
      await frame.getByRole("button", { name: "삭제", exact: true }).click();
      await frame.getByRole("status").filter({ hasText: "삭제했어요." }).waitFor();
    });
    assert.equal(documents.get(`sequenceNotes/${saved.state.id}`).deleted, true);
    assert.ok(![...documents.values()].some((data) => data.noteId === saved.state.id), "note delete cleans up images");
    assert.equal(rowsFor(uid).length, 0);
    assert.deepEqual(errors, []);
    return { image, imageReferencesOnly: true, failedSavePreservedDirty: true, noFalseSuccess: true, retry: true, deleteCleanup: true };
  });
}

async function migration() {
  const uid = "migration-operator";
  const legacyNote = note("legacy-note", "이전 브라우저 원본");
  const legacyDraft = note("legacy-draft", "이전 임시 기록");
  const legacy = { [KEY]: JSON.stringify(legacyDraft), [LIBKEY]: JSON.stringify([legacyNote]) };
  return withContext(uid, 768, async (context, errors) => {
    const { page, frame } = await openStudio(context);
    assert.equal(rowsFor(uid).length, 0, "no implicit migration on initial load");
    assert.notEqual((await snapshot(frame)).state.id, legacyDraft.id);
    await frame.getByRole("tab", { name: /내 시퀀스/ }).click();
    for (const count of [2, 0]) {
      await confirm(context, async () => {
        await frame.getByRole("button", { name: "이전 브라우저 기록 가져오기", exact: true }).click();
        await frame.getByRole("status").filter({ hasText: `${count}개 기록을 Firestore에 저장했어요.` }).waitFor();
      });
      assert.equal(rowsFor(uid).length, 2, "explicit migration must be idempotent");
      assert.deepEqual(await frame.evaluate(({ KEY, LIBKEY }) => ({ [KEY]: localStorage.getItem(KEY), [LIBKEY]: localStorage.getItem(LIBKEY) }), { KEY, LIBKEY }), legacy);
    }
    assert.ok(rowsFor(uid).every(([key]) => key.startsWith("sequenceNotes/legacy_")));
    await page.reload();
    await page.waitForFunction(() => document.querySelector("iframe")?.contentWindow?.ARCHIVE_TEST?.getRevision() > 0);
    assert.equal(rowsFor(uid).length, 2);
    assert.deepEqual(errors, []);
    return { explicitOnly: true, idempotent: true, originalLocalStorageUntouched: true };
  }, legacy);
}

async function independentPDFChecks() {
  const python = process.env.ARCHIVE_SEQUENCE_PDF_PYTHON || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3");
  const script = `
import json, pathlib, sys
import pypdf, pypdfium2
from PIL import ImageStat
root = pathlib.Path(sys.argv[1])
results = []
for width in [320, 390, 768, 1440]:
    file = root / ('sequence-%s.pdf' % width)
    reader = pypdf.PdfReader(file, strict=True)
    text = '\\n'.join(page.extract_text() for page in reader.pages)
    assert '롤백' in text and ('시퀀스 검증 %s' % width) in text, 'Independent Korean extraction failed'
    (root / ('parsed-pdf-%s.txt' % width)).write_text(text)
    pdf = pypdfium2.PdfDocument(str(file))
    try:
        for index, page in enumerate(reader.pages):
            assert list(page.mediabox) == [0, 0, 1200, 900], 'Incorrect PDF layout size'
            rendered = pdf[index]
            try:
                bitmap = rendered.render(scale=0.75)
                try:
                    image = bitmap.to_pil().convert('RGB')
                    assert max(ImageStat.Stat(image).stddev) > 5, 'Blank PDF raster'
                    image.save(root / ('pdf-raster-%s-%s.png' % (width, index)))
                finally:
                    bitmap.close()
            finally:
                rendered.close()
        results.append({'width': width, 'pages': len(reader.pages), 'koreanExtracted': True, 'rasterNonblank': True})
    finally:
        pdf.close()
print(json.dumps(results))
`;
  const { stdout } = await runFile(python, ["-c", script, output], { timeout: 60000, maxBuffer: 1024 * 1024 });
  return { parser: "pypdf", rasterizer: "PDFium", results: JSON.parse(stdout) };
}

try {
  await check("actual adapter: transactions/revisions/assets/tombstone/owner guard (fake SDK)", actualAdapterChecks);
  server = liveBase ? null : http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = path.resolve(coreRoot, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      if (!file.startsWith(coreRoot)) throw Error("invalid path");
      res.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" }[path.extname(file)] || "application/octet-stream");
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  if (server) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = liveBase || `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  await check("isolated auth gate and direct studio redirect", () => withContext(null, 390, async (context, errors) => {
    const page = await context.newPage();
    await page.goto(`${base}/sequence/`);
    await page.getByRole("heading", { name: "ARCHIVE CORE", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.querySelector("iframe").getAttribute("src")), null);
    assert.equal(await page.evaluate(() => !!window.archiveSequenceStore), false);
    await page.goto(`${base}/sequence/studio.html`);
    await page.waitForURL(`${base}/sequence/`);
    assert.deepEqual(errors, []);
  }));
  for (const width of [320, 390, 768, 1440]) await check(`responsive ${width}: persistence/import/export/selectable Korean PDF/layout`, () => responsive(width));
  await check("distinct contexts same UID: broadcast/conflict/kept edits/copy/latest recovery", sharingAndConflicts);
  await check("noisy image: compression/assets/save failure/export/retry/delete", imagesAndFailures);
  await check("legacy: untouched localStorage/explicit migration/idempotence", migration);
  await check("cross-operator query and adapter isolation (NOT security rules proof)", () => withContext("isolated-operator", 1440, async (context, errors) => {
    const { page, frame } = await openStudio(context);
    assert.equal(await page.evaluate(async () => (await window.archiveSequenceStore.list()).length), 0);
    assert.equal((await snapshot(frame)).state.title, "");
    const foreignId = rowsFor("responsive-320")[0]?.[0].split("/")[1];
    assert.ok(foreignId);
    const rejected = await page.evaluate(async (id) => {
      try { await window.archiveSequenceStore.get(id); return false; } catch (error) { return error.code === "sequence/conflict"; }
    }, foreignId);
    assert.equal(rejected, true);
    assert.deepEqual(errors, []);
    return { queryIsolation: true, adapterOwnerGuard: true, realRules: "not run; separate emulator agent/script required" };
  }));
  await check("independent PDF parser/rasterizer: Korean extraction and nonblank 4:3 pages", independentPDFChecks);
} catch (error) {
  results.push({ name: "runner", status: "failed", error: error.stack });
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  contexts.clear();
  await browser?.close();
  await Promise.allSettled([...pendingBroadcasts]);
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  const cleanup = { browserDisconnected: !browser?.isConnected(), contexts: contexts.size, subscriptions: subscriptions.size, openTransactions: transactions.size, serverStopped: !server?.listening };
  const changedDuringRun = adapterHash !== createHash("sha256").update(await fs.readFile(path.join(coreRoot, "assets/sequence-store.js"))).digest("hex");
  const warnings = ["Security rules and real Firebase Auth/Firestore are not verified by this fixture; use the emulator and live verifier."];
  const report = { ok: results.every((result) => result.status === "passed"), mode: "actual adapter + actual UI; isolated Auth + Node-shared fake Firebase SDK", realFirestore: false, productionWrites: false, base, output, adapterHash, adapterChangedDuringRun: changedDuringRun, securityRules: "not verified by this fixture; use separate real Firestore rules emulator suite", warnings, blockedRequests, cleanup, results };
  if (Object.values(cleanup).some((value) => value === false) || cleanup.contexts || cleanup.subscriptions || cleanup.openTransactions || changedDuringRun) report.ok = false;
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2));
  const escape = (value) => String(value).replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  await fs.writeFile(path.join(output, "report.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCHIVE CORE Sequence Studio QA</title><style>*{box-sizing:border-box}body{font:16px system-ui;margin:24px auto;padding:0 16px;max-width:1000px;color:#202020}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f3f4;padding:16px}li{margin:12px 0}.failed{color:#ad2020}img{max-width:100%;height:auto}</style><h1>ARCHIVE CORE Sequence Studio QA</h1><p>${report.ok ? "PASS" : "ATTENTION"}: actual adapter and UI, mock Firebase SDK. No real Firestore or security-rules claim. No production writes.</p><ul>${results.map((result) => `<li class="${result.status}">${escape(result.status.toUpperCase() + ": " + result.name)}${result.error ? `<pre>${escape(result.error)}</pre>` : ""}</li>`).join("")}</ul><h2>Cleanup</h2><pre>${escape(JSON.stringify(cleanup, null, 2))}</pre><h2>Evidence</h2>${[320,390,768,1440].map((width) => `<h3>${width}px</h3><img src="preview-${width}.png" alt="Preview at ${width}px">`).join("")}</html>`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
