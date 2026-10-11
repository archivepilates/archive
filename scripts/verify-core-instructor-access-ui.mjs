#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = await fs.mkdtemp(path.join(os.tmpdir(), "core-instructor-access-ui-"));
const fixedTime = "2026-10-11T00:00:00.000Z";
const viewports = [
  { width: 320, height: 860 }, { width: 390, height: 844 },
  { width: 768, height: 1024 }, { width: 1440, height: 1000 },
];
const surfaces = ["/", "/core/"];
const options = { retries: 1, trace: "on-first-retry" };
const sources = new Map();
const fixtures = new Map();
const report = {
  scope: "Offline full-app integration with synthetic fixtures and mocked Firebase SDKs, including revoked-session and transient access failures. No live auth, backend authorization, canonical matching, revocation, or delivery proof.",
  fixedTime, options, sources: [], scenarios: [], failures: [],
  cleanup: { contextsOpened: 0, contextsClosed: 0, browserClosed: false, serverClosed: false, fixturesRemaining: 0 },
};
let fixtureNumber = 0;
let origin;
let browser;
let server;

function makeFixture(mode) {
  return {
    mode, uid: "qa-instructor", staffId: "qa-staff", staffName: "QA 강사",
    rawRole: mode === "owner" ? "owner" : ["manager", "revoked-session", "access-transient"].includes(mode) ? "manager" : "instructor",
    mustChangePassword: ["first-login", "signout-retry"].includes(mode),
    signOutFailures: mode === "signout-retry" ? 1 : 0,
    workspaceFailures: mode === "workspace-retry" ? 1 : 0,
    workspace: {
      date: "2026-10-11", staffName: "QA 강사",
      lessons: [
        { id: "qa-lesson-today", date: "2026-10-11", startTime: "09:00", title: "QA 프라이빗 수업", memberName: "QA 오늘 회원" },
        { id: "qa-lesson-tomorrow", date: "2026-10-12", startTime: "10:00", title: "QA 내일 수업", memberName: "QA 내일 회원" },
      ],
      privateTasks: [
        { id: "qa-task-pending", memberName: "QA 긴이름으로줄바꿈을검증하는가상회원", date: "2026-10-11", startTime: "09:00", status: "pending",
          recordUrl: "https://in.archivepilates.com/private-chart/?r=qa-record&t=synthetic",
          surveyUrl: "https://core.archivepilates.com/private/?qa=survey", reportUrl: "https://unapproved.example/report" },
        { id: "qa-task-sent", memberName: "QA 완료 회원", date: "2026-10-10", startTime: "10:00", status: "sent",
          recordUrl: "javascript:alert(1)", surveyUrl: "http://in.archivepilates.com/private-chart/",
          reportUrl: "https://core.archivepilates.com/private/?qa=report" },
        { id: "qa-task-unsafe", memberName: "QA 링크 확인 회원", date: "2026-10-09", startTime: "11:00", status: "pending",
          recordUrl: "https://in.archivepilates.com.unapproved.example/record",
          surveyUrl: "https://user:synthetic@in.archivepilates.com/survey", reportUrl: "https://in.archivepilates.com:444/report" },
      ],
    },
  };
}

async function source(relative) {
  if (!sources.has(relative)) sources.set(relative, await fs.readFile(path.join(repo, relative)));
  return sources.get(relative);
}

// These are SDK substitutes, not a replacement bootstrap or a call to the UI exports.
const stateModule = String.raw`
const fixtureId = localStorage.getItem("core-ui-fixture");
const response = await fetch("/__qa/fixtures/" + encodeURIComponent(fixtureId));
if (!response.ok) throw new Error("Missing synthetic fixture");
export const fixture = await response.json();
export const state = window.__coreFirebaseQA = {
  fixtureId, events: [], reads: [], writes: [], callables: [], auth: [],
  accessResolved: false, session: null, workspaceAttempts: 0, passwordChanged: false,
};
export function record(kind, detail) {
  const entry = { kind, ...detail };
  state.events.push(entry);
  if (Array.isArray(state[kind])) state[kind].push(entry);
  return entry;
}
export function denied(message) {
  return Object.assign(new Error(message), { code: "permission-denied" });
}
const listeners = new Set();
export const authClient = {
  currentUser: localStorage.getItem("core-ui-user") === fixture.uid ? { uid: fixture.uid } : null,
};
export function observe(callback) {
  listeners.add(callback);
  queueMicrotask(() => { if (listeners.has(callback)) callback(authClient.currentUser); });
  return () => listeners.delete(callback);
}
export async function logout() {
  record("auth", { action: "signOut", success: fixture.signOutFailures <= 0 });
  if (fixture.signOutFailures-- > 0) throw new Error("Synthetic sign-out failure");
  authClient.currentUser = null;
  localStorage.removeItem("core-ui-user");
  for (const listener of [...listeners]) listener(null);
}
export function rejectWrite(operation) {
  record("writes", { operation });
  throw denied("Unexpected SDK write in offline UI QA");
}
export function read(operation, ref) {
  const filters = ref.filters || [];
  const ownerScoped = ref.path === "sequenceNotes" && filters.some(filter =>
    filter.kind === "where" && filter.field === "ownerUid" && filter.operator === "==" && filter.value === fixture.uid);
  const manager = state.session?.role === "manager" && !!authClient.currentUser;
  const sequence = state.session?.role === "instructor" && !state.session.mustChangePassword &&
    !!authClient.currentUser && ownerScoped;
  record("reads", { operation, path: ref.path, filters, allowed: manager || sequence });
  if (!manager && !sequence) throw denied("Unexpected broad Firestore read");
  return { docs: [], size: 0, empty: true, metadata: { fromCache: false, hasPendingWrites: false },
    exists: () => false, data: () => undefined, forEach: () => {} };
}
`;

function firebaseModule(kind) {
  const shared = `import { fixture, state, record, denied, authClient, observe, logout, read, rejectWrite } from ${JSON.stringify(`${origin}/__qa/state.mjs`)};\n`;
  if (kind === "app") return shared + `
    const app = { name: "qa-only" };
    export const initializeApp = () => app;
    export const getApps = () => [];
  `;
  if (kind === "auth") return shared + `
    export const getAuth = () => authClient;
    export const onAuthStateChanged = (_, callback) => observe(callback);
    export const signOut = () => logout();
    export const signInWithEmailAndPassword = () => rejectWrite("unexpected-login");
  `;
  if (kind === "functions") return shared + `
    export const getFunctions = () => ({ mock: true });
    export const httpsCallable = (_, name) => async (payload) => {
      const call = record("callables", { name });
      if (!authClient.currentUser) throw denied("Synthetic session is signed out");
      if (name === "getCoreAccessSession") {
        if (fixture.mode === "access-denied") throw denied("Synthetic pending access");
        if (["revoked-session", "access-transient"].includes(fixture.mode)) {
          call.errorCode = fixture.mode === "revoked-session" ? "functions/unauthenticated" : "functions/unavailable";
          throw Object.assign(new Error("Synthetic access-session failure"), { code: call.errorCode });
        }
        // The backend contract normalizes owners; this is a frontend test of that response.
        const role = ["manager", "owner"].includes(fixture.rawRole) ? "manager"
          : fixture.mode === "pending-role" ? "pending" : "instructor";
        const session = { role, staffId: fixture.staffId, staffName: fixture.staffName,
          mustChangePassword: fixture.mustChangePassword };
        state.session = session;
        state.accessResolved = true;
        record("session", { role, rawRole: fixture.rawRole });
        return { data: session };
      }
      if (name === "completeCoreFirstLogin") {
        const valid = typeof payload?.password === "string" && payload.password.length >= 8 &&
          payload.password.length <= 64 && payload.password !== "111111" && payload.password.trim() === payload.password;
        record("password", { valid });
        if (!valid || state.session?.role !== "instructor" || !fixture.mustChangePassword) throw denied("Invalid synthetic change");
        state.passwordChanged = true;
        fixture.mustChangePassword = false;
        return { data: { ok: true, requireFreshLogin: true } };
      }
      if (name === "getCoreInstructorWorkspace") {
        if (state.session?.role !== "instructor" || fixture.mustChangePassword) throw denied("Workspace before access");
        state.workspaceAttempts++;
        if (fixture.workspaceFailures-- > 0) throw new Error("Synthetic workspace failure");
        return { data: fixture.workspace };
      }
      if (name === "getParkingDashboard" && state.session?.role === "manager") {
        return { data: { vehicles: [], jobs: [], config: null } };
      }
      record("writes", { operation: "unexpected-callable", name });
      throw denied("Unexpected callable in offline QA");
    };
  `;
  assert.equal(kind, "firestore");
  return shared + `
    export const getFirestore = () => ({ mock: true });
    const reference = (args) => ({ path: args.filter(value => typeof value === "string").join("/"), filters: [] });
    export const doc = (...args) => reference(args);
    export const collection = (...args) => reference(args);
    export const where = (field, operator, value) => ({ kind: "where", field, operator, value });
    export const orderBy = (field, direction) => ({ kind: "orderBy", field, direction });
    export const limit = (value) => ({ kind: "limit", value });
    export const query = (ref, ...filters) => ({ ...ref, filters: [...ref.filters, ...filters] });
    export const getDoc = async (ref) => read("getDoc", ref);
    export const getDocs = async (ref) => read("getDocs", ref);
    export const getDocFromServer = async (ref) => read("getDocFromServer", ref);
    export const getDocsFromServer = async (ref) => read("getDocsFromServer", ref);
    export function onSnapshot(ref, options, next, error) {
      const callback = typeof options === "function" ? options : next;
      let subscribed = true;
      queueMicrotask(() => { if (subscribed) { try { callback(read("onSnapshot", ref)); } catch (failure) { error?.(failure); } } });
      return () => { subscribed = false; };
    }
    export const updateDoc = () => rejectWrite("updateDoc");
    export const setDoc = () => rejectWrite("setDoc");
    export const deleteDoc = () => rejectWrite("deleteDoc");
    export const runTransaction = () => rejectWrite("runTransaction");
    export const writeBatch = () => ({ delete: () => rejectWrite("batch.delete"), commit: () => rejectWrite("batch.commit") });
    export const serverTimestamp = () => ({ seconds: 1791676800 });
    export const Timestamp = { fromDate: (date) => ({ seconds: date.getTime() / 1000, toDate: () => date }),
      now: () => ({ seconds: Date.now() / 1000 }) };
  `;
}

async function serve(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const url = new URL(request.url, origin || "http://127.0.0.1");
    if (url.pathname === "/__qa/fixtures" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 100_000) throw new Error("Fixture too large");
      }
      const fixture = JSON.parse(body);
      const id = `fixture-${++fixtureNumber}`;
      fixtures.set(id, fixture);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ id, uid: fixture.uid }));
      return;
    }
    const fixtureMatch = /^\/__qa\/fixtures\/(fixture-\d+)$/.exec(url.pathname);
    if (fixtureMatch) {
      if (request.method === "DELETE") {
        fixtures.delete(fixtureMatch[1]);
        response.writeHead(204).end();
      } else if (request.method === "GET" && fixtures.has(fixtureMatch[1])) {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(fixtures.get(fixtureMatch[1])));
      } else response.writeHead(404).end();
      return;
    }
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (url.pathname === "/__qa/state.mjs") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(stateModule);
      return;
    }
    if (["/firebase-config.js", "/core/firebase-config.js"].includes(url.pathname)) {
      response.setHeader("Content-Type", "text/javascript");
      response.end('window.KANGSAIN_FIREBASE_CONFIG = { apiKey: "qa-not-a-real-key", projectId: "qa-only", functionsRegion: "qa-only" };');
      return;
    }
    if (["/site.webmanifest", "/core/site.webmanifest"].includes(url.pathname)) {
      response.setHeader("Content-Type", "application/manifest+json");
      response.end('{"name":"ARCHIVE CORE QA","icons":[]}');
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const suffix = pathname.startsWith("/core/") ? pathname.slice(6) : pathname.slice(1);
    if (suffix.split("/").some(segment => segment === "." || segment === "..") || suffix.includes("\\")) {
      response.writeHead(403).end(); return;
    }
    let relative = `core/${suffix}`;
    if (!suffix || suffix.endsWith("/")) relative += "index.html";
    if (!/\.(?:html|js|css|png|svg|ico|woff2?|ttf)$/.test(relative) || !pathname.startsWith("/")) {
      response.writeHead(404).end(); return;
    }
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
      ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };
    response.setHeader("Content-Type", mime[path.extname(relative)]);
    response.end(await source(relative));
  } catch {
    response.writeHead(404).end();
  }
}

async function seedFixture(mode) {
  const response = await fetch(`${origin}/__qa/fixtures`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(makeFixture(mode)),
  });
  assert.equal(response.status, 200);
  return response.json();
}

// Add test IDs only; do not change DOM visibility, app bootstrap, or access decisions.
function installDomHooks() {
  window.__coreUiQA = { events: [] };
  for (const name of ["core-password-changed", "core-instructor-signed-out"]) {
    document.addEventListener(name, () => window.__coreUiQA.events.push(name));
  }
  const hooks = {
    ".shell": "qa-operator-shell", ".nav": "qa-operator-nav", "#refreshButton": "qa-refresh",
    "#coreInstructorAccess": "qa-instructor", "#coreLoginGate": "qa-login",
    "[data-sequence-studio]": "qa-sequence-frame",
  };
  const tag = () => {
    for (const [selector, id] of Object.entries(hooks)) {
      for (const element of document.querySelectorAll(selector)) element.dataset.testid = id;
    }
  };
  new MutationObserver(tag).observe(document, { childList: true, subtree: true });
  tag();
}

async function telemetry(page) {
  return page.evaluate(async () => {
    const { authClient } = await import("/__qa/state.mjs");
    const state = window.__coreFirebaseQA;
    return { events: state.events, reads: state.reads, writes: state.writes, callables: state.callables,
      auth: state.auth, role: state.session?.role, storedUid: localStorage.getItem("core-ui-user"),
      currentUid: authClient.currentUser?.uid ?? null,
      uiEvents: window.__coreUiQA.events };
  });
}

async function settled(page) {
  await page.waitForFunction(() => {
    if (!window.__coreFirebaseQA?.accessResolved) return false;
    const refresh = document.querySelector('[data-testid="qa-refresh"]');
    return !refresh || refresh.getAttribute("aria-busy") !== "true";
  });
}

async function noOperatorReads(page, sequence = false) {
  const state = await telemetry(page);
  assert.deepEqual(state.writes, [], "No unplanned SDK/callable writes");
  assert.equal(state.events[0]?.kind, "callables", "Access check must precede any Firestore read");
  assert.equal(state.events[0]?.name, "getCoreAccessSession");
  if (!sequence) assert.deepEqual(state.reads, [], "No manager or sequence reads on this route");
  else {
    assert.ok(state.reads.length > 0, "Actual sequence store must read its own notes");
    for (const read of state.reads) {
      assert.equal(read.path, "sequenceNotes");
      assert.equal(read.allowed, true);
      assert.ok(read.filters.some(filter => filter.kind === "where" && filter.field === "ownerUid"
        && filter.operator === "==" && filter.value === "qa-instructor"));
    }
  }
  const names = state.callables.map(call => call.name);
  assert.ok(names.every(name => ["getCoreAccessSession", "getCoreInstructorWorkspace", "completeCoreFirstLogin"].includes(name)));
  await page.getByTestId("qa-operator-shell").waitFor({ state: "hidden" });
  return state;
}

async function layout(page, name, instructor = true) {
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.evaluate((instructorOnly) => {
    const root = document.getElementById("coreInstructorAccess");
    const target = instructorOnly ? root : document.body;
    const visible = node => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== "hidden";
    };
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      clippedText: [...target.querySelectorAll("h1,h2,p,strong,span,label")].filter(visible)
        .filter(node => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX === "hidden")
        .map(node => node.tagName),
      smallTargets: instructorOnly ? [...target.querySelectorAll("a,button,input")].filter(visible)
        .filter(node => node.getBoundingClientRect().height < 44).map(node => node.tagName) : [],
    };
  }, instructor);
  assert.equal(metrics.overflow, false, "No horizontal page overflow");
  assert.deepEqual(metrics.clippedText, [], "No hidden clipped text");
  assert.deepEqual(metrics.smallTargets, [], "Instructor touch targets at least 44px high");
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  return metrics;
}

async function instructorNav(page, base) {
  const nav = page.getByRole("navigation", { name: "강사 메뉴" });
  await nav.waitFor({ state: "visible" });
  assert.equal(await nav.getByRole("link").count(), 3);
  for (const [name, suffix] of [["홈", ""], ["프라이빗", "private/"], ["시퀀스 노트", "sequence/"]]) {
    assert.equal(await nav.getByRole("link", { name, exact: true }).getAttribute("href"), `${base}${suffix}`);
  }
  assert.equal(await page.getByRole("link", { name: "ARCHIVE CORE", exact: true }).getAttribute("href"), base);
  assert.equal(await page.getByRole("button", { name: "로그아웃", exact: true }).isVisible(), true);
}

async function workspaceCase(page, base, kind) {
  await page.getByRole("heading", { name: kind === "private" ? "프라이빗 기록" : "오늘의 수업", exact: true }).waitFor();
  await settled(page);
  await instructorNav(page, base);
  const ui = page.getByTestId("qa-instructor");
  assert.equal(await ui.getByRole("link", { name: "기록 작성", exact: true }).count(), 1);
  assert.equal(await ui.getByRole("link", { name: "설문", exact: true }).count(), 1);
  assert.equal(await ui.getByRole("link", { name: "리포트 확인", exact: true }).count(), kind === "private" ? 1 : 0);
  const text = await ui.innerText();
  assert.equal(text.includes("QA 내일 수업"), false, "Home must not show another date's lesson");
  assert.equal(text.includes("QA 완료 회원"), kind === "private", "Home excludes terminal tasks; private keeps own task history");
  const links = await ui.getByRole("link").evaluateAll(nodes => nodes.filter(node => node.target === "_blank").map(node => node.href));
  for (const href of links) {
    const url = new URL(href);
    assert.equal(url.protocol, "https:");
    assert.ok(["in.archivepilates.com", "core.archivepilates.com"].includes(url.hostname));
    assert.equal(url.username + url.password + url.port, "");
  }
  return noOperatorReads(page);
}

async function runCase(page, base, kind, name) {
  if (["home", "private"].includes(kind)) return workspaceCase(page, base, kind);
  if (["manager", "owner"].includes(kind)) {
    await page.getByRole("heading", { name: "오늘 할 일", exact: true }).waitFor();
    await settled(page);
    assert.equal(await page.getByTestId("qa-operator-shell").isVisible(), true);
    assert.equal(await page.getByTestId("qa-instructor").count(), 0);
    assert.ok(await page.getByTestId("qa-operator-nav").getByRole("link", { includeHidden: true }).count() > 3);
    const state = await telemetry(page);
    assert.equal(state.role, "manager");
    assert.equal(state.events.find(event => event.kind === "session").rawRole, kind);
    assert.equal(state.events[0]?.name, "getCoreAccessSession");
    assert.ok(state.reads.some(read => read.path === "workLanes/archive-core-transition"));
    assert.ok(state.reads.every(read => read.allowed));
    assert.deepEqual(state.writes, []);
    return state;
  }
  if (kind === "sequence") {
    await instructorNav(page, base);
    await page.waitForFunction(() => window.archiveSequenceStore?.uid === "qa-instructor"
      && window.__coreFirebaseQA?.reads.some(read => read.operation === "onSnapshot"));
    const frameElement = page.getByTestId("qa-sequence-frame");
    await frameElement.waitFor({ state: "visible" });
    assert.equal(await frameElement.getAttribute("data-auth-ready"), "true");
    assert.equal(await frameElement.getAttribute("src"), "./studio.html");
    const frame = page.frames().find(frame => new URL(frame.url()).pathname === `${base}sequence/studio.html`);
    assert.ok(frame, "Actual sequence studio iframe must load on the matching surface");
    await frame.getByRole("tab", { name: /내 시퀀스/ }).waitFor();
    await frame.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    const state = await noOperatorReads(page, true);
    assert.equal(state.callables.some(call => call.name === "getCoreInstructorWorkspace"), false);
    return state;
  }
  if (kind.startsWith("blocked-")) {
    await page.getByRole("heading", { name: "접근할 수 없는 페이지", exact: true }).waitFor();
    await settled(page);
    await instructorNav(page, base);
    assert.equal(await page.getByRole("link", { name: "홈으로", exact: true }).getAttribute("href"), base);
    const state = await noOperatorReads(page);
    assert.equal(state.callables.some(call => call.name === "getCoreInstructorWorkspace"), false);
    if (kind === "blocked-rules") {
      await layout(page, `${name}-blocked`);
      await page.getByRole("link", { name: "홈으로", exact: true }).click();
      await page.waitForURL(`${origin}${base}`);
      await workspaceCase(page, base, "home");
      state.returnHomeVerified = true;
    }
    return state;
  }
  if (kind === "pending-role") {
    await page.getByTestId("qa-login").waitFor({ state: "visible" });
    await settled(page);
    const state = await noOperatorReads(page);
    assert.deepEqual(state.callables.map(call => call.name), ["getCoreAccessSession"]);
    assert.equal((await page.getByTestId("qa-instructor").textContent()).includes("QA 오늘 회원"), false);
    return state;
  }
  if (kind === "access-denied") {
    await page.getByRole("heading", { name: "접근 권한 확인 필요", exact: true }).waitFor();
    const state = await noOperatorReads(page);
    assert.deepEqual(state.callables.map(call => call.name), ["getCoreAccessSession"]);
    return state;
  }
  if (["revoked-session", "access-transient"].includes(kind)) {
    const revoked = kind === "revoked-session";
    if (revoked) {
      await page.getByTestId("qa-login").waitFor({ state: "visible" });
      await page.getByTestId("qa-instructor").waitFor({ state: "hidden" });
      for (const label of ["휴대폰번호", "비밀번호"]) {
        assert.equal(await page.getByLabel(label, { exact: true }).isVisible(), true);
      }
      assert.equal(await page.getByRole("button", { name: "로그인", exact: true }).isVisible(), true);
    } else {
      await page.getByRole("heading", { name: "접근 권한 확인 필요", exact: true }).waitFor();
      await page.getByTestId("qa-login").waitFor({ state: "hidden" });
    }
    // Failed access checks never resolve a session; wait for the actual refresh to finish instead.
    await page.waitForFunction(() => document.querySelector('[data-testid="qa-refresh"]')?.getAttribute("aria-busy") !== "true");
    const state = await noOperatorReads(page);
    assert.deepEqual(state.callables.map(call => ({ name: call.name, errorCode: call.errorCode })), [
      { name: "getCoreAccessSession", errorCode: revoked ? "functions/unauthenticated" : "functions/unavailable" },
    ]);
    assert.equal(state.role, undefined, "Failed access check cannot grant a role");
    await page.getByTestId("qa-operator-nav").waitFor({ state: "hidden" });
    assert.equal((await page.getByTestId("qa-instructor").textContent()).includes("QA 오늘 회원"), false);
    if (revoked) {
      assert.deepEqual(state.auth.map(event => ({ action: event.action, success: event.success })), [
        { action: "signOut", success: true },
      ], "Revocation must call local Firebase signOut exactly once");
      assert.equal(state.currentUid, null, "Firebase currentUser cleared");
      assert.equal(state.storedUid, null, "Persisted synthetic user cleared");
      assert.deepEqual(state.uiEvents, ["core-instructor-signed-out"]);
    } else {
      assert.deepEqual(state.auth, [], "Transient network failure must not force signOut");
      assert.equal(state.currentUid, "qa-instructor", "Firebase currentUser retained");
      assert.equal(state.storedUid, "qa-instructor", "Persisted synthetic user retained");
      assert.deepEqual(state.uiEvents, [], "No signed-out event for transient failure");
    }
    return state;
  }
  if (kind === "workspace-retry") {
    await page.getByRole("button", { name: "다시 시도", exact: true }).waitFor();
    await noOperatorReads(page);
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    const state = await workspaceCase(page, base, "home");
    assert.equal(state.callables.filter(call => call.name === "getCoreInstructorWorkspace").length, 2);
    return state;
  }
  assert.ok(["first-login", "signout-retry"].includes(kind));
  await page.getByRole("dialog", { name: "새 비밀번호 설정" }).waitFor();
  await layout(page, `${name}-password-gate`);
  const password = page.getByLabel("새 비밀번호", { exact: true });
  const confirmation = page.getByLabel("새 비밀번호 확인", { exact: true });
  assert.equal(await password.getAttribute("minlength"), "8");
  assert.equal(await password.getAttribute("maxlength"), "64");
  assert.equal(await page.getByLabel(/activation|활성화 코드/i).count(), 0);
  await noOperatorReads(page);
  await password.fill("111111");
  await confirmation.fill("111111");
  await page.getByRole("button", { name: "변경 후 다시 로그인", exact: true }).click();
  assert.equal((await telemetry(page)).callables.some(call => call.name === "completeCoreFirstLogin"), false);
  await password.fill("qa-password-a");
  await confirmation.fill("qa-password-b");
  await page.getByRole("button", { name: "변경 후 다시 로그인", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("ciaPasswordError")?.textContent === "새 비밀번호가 일치하지 않습니다.");
  await page.getByRole("button", { name: "로그아웃", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await password.evaluate(node => node === document.activeElement), true);
  await confirmation.fill("qa-password-a");
  await page.getByRole("button", { name: "변경 후 다시 로그인", exact: true }).click();
  if (kind === "signout-retry") {
    await page.getByRole("button", { name: "로그아웃 후 다시 로그인", exact: true }).waitFor();
    await noOperatorReads(page);
    await page.getByRole("button", { name: "로그아웃 후 다시 로그인", exact: true }).click();
  }
  await page.getByTestId("qa-login").waitFor({ state: "visible" });
  const state = await noOperatorReads(page);
  assert.equal(state.callables.filter(call => call.name === "completeCoreFirstLogin").length, 1);
  assert.equal(state.callables.some(call => call.name === "getCoreInstructorWorkspace"), false);
  assert.ok(state.auth.some(event => event.action === "signOut" && event.success));
  assert.ok(state.uiEvents.includes("core-password-changed"), "Actual app must receive re-login event");
  return state;
}

function routeFor(base, kind) {
  if (kind === "private" || kind === "sequence") return `${base}${kind}/`;
  if (kind.startsWith("blocked-")) return `${base}${kind.slice(8)}/`;
  return base;
}

async function attemptCase(base, viewport, kind, retry) {
  const fixture = await seedFixture(["home", "private", "sequence"].includes(kind) || kind.startsWith("blocked-") ? "instructor" : kind);
  const name = `${base === "/" ? "root" : "core"}-${viewport.width}-${kind.replace(/[^a-z0-9-]/g, "-")}-${retry}`;
  const context = await browser.newContext({
    viewport, locale: "ko-KR", timezoneId: "Asia/Seoul", reducedMotion: "reduce", serviceWorkers: "block",
    storageState: { cookies: [], origins: [{ origin, localStorage: [
      { name: "core-ui-fixture", value: fixture.id }, { name: "core-ui-user", value: fixture.uid },
    ] }] },
  });
  report.cleanup.contextsOpened++;
  let page;
  let failure;
  let state;
  let metrics;
  const pageErrors = [];
  const deniedRequests = [];
  try {
    await context.addInitScript(installDomHooks);
    await context.routeWebSocket("**/*", socket => {
      deniedRequests.push({ type: "websocket", url: socket.url() });
      socket.close();
    });
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const match = /^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\/firebase-(app|auth|functions|firestore)\.js$/.exec(request.url());
      if (match && request.method() === "GET") return route.fulfill({
        contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: firebaseModule(match[1]),
      });
      if (url.origin === origin && request.method() === "GET") return route.continue();
      deniedRequests.push({ type: request.resourceType(), method: request.method(), url: `${url.origin}${url.pathname}` });
      return route.abort("blockedbyclient");
    });
    if (retry === 1 && options.trace === "on-first-retry") {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    }
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.clock.setFixedTime(new Date(fixedTime));
    await page.goto(`${origin}${routeFor(base, kind)}`, { waitUntil: "load" });
    state = await runCase(page, base, kind, name);
    metrics = await layout(page, name, !["manager", "owner", "revoked-session"].includes(kind));
    if (kind === "home") {
      await page.getByRole("button", { name: "로그아웃", exact: true }).click();
      await page.getByTestId("qa-login").waitFor({ state: "visible" });
      state = await noOperatorReads(page);
      assert.ok(state.uiEvents.includes("core-instructor-signed-out"));
    }
    assert.deepEqual(pageErrors, [], "No unhandled page errors");
    assert.deepEqual(deniedRequests, [], "No external/unknown network attempts");
  } catch (error) {
    failure = error.message;
    console.error(`${name}: ${failure}`);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      state = await telemetry(page).catch(() => undefined);
    }
  } finally {
    try {
      if (retry === 1) await context.tracing.stop({ path: path.join(output, `${name}-trace.zip`) });
    } finally {
      await context.close();
      report.cleanup.contextsClosed++;
      assert.equal(context.pages().length, 0, "All task-owned pages closed");
      const deletion = await fetch(`${origin}/__qa/fixtures/${fixture.id}`, { method: "DELETE" });
      assert.equal(deletion.status, 204);
    }
  }
  const result = { name, surface: base, viewport: viewport.width, kind, retry, failure, metrics, state, pageErrors, deniedRequests };
  report.scenarios.push(result);
  return result;
}

try {
  const app = (await source("core/assets/app.js")).toString();
  const refresh = app.slice(app.indexOf("async function refresh()"));
  assert.ok(app.includes('from "./core-instructor-access.js"'), "Main integration import is required");
  assert.ok(refresh.indexOf("await prepareCoreAccess(runtime, user)") >= 0);
  assert.ok(refresh.indexOf("await prepareCoreAccess(runtime, user)") < refresh.indexOf("const { db, doc, getDoc }"), "Access preparation must precede operator reads");
  assert.ok(refresh.includes("await renderInstructorCore(runtime, access)"));
  const moduleFile = path.join(repo, "core/assets/core-instructor-access.js");
  await source("core/assets/core-instructor-access.js");
  await source("core/assets/core-instructor-access.css");
  const bundle = await build({ entryPoints: [moduleFile], bundle: true, treeShaking: false, format: "cjs", write: false,
    define: { "import.meta.url": JSON.stringify(new URL("../core/assets/core-instructor-access.js", import.meta.url).href) } });
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, URL });
  assert.equal(typeof module.exports.prepareCoreAccess, "function", "Module imports without window/document startup side effects");
  server = http.createServer((request, response) => { void serve(request, response); });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const cases = ["home", "private", "first-login", "pending-role", "access-denied", "sequence",
    "blocked-business", "blocked-members/detail", "blocked-rules", "manager", "owner", "revoked-session", "access-transient"];
  for (const base of surfaces) {
    for (const viewport of viewports) {
      for (const kind of cases) {
        let result;
        for (let retry = 0; retry <= options.retries; retry++) {
          result = await attemptCase(base, viewport, kind, retry);
          if (!result.failure) break;
        }
        if (result.failure) report.failures.push({ name: result.name, message: result.failure });
      }
      console.log(`${base} ${viewport.width}px: ${cases.length} integration scenarios checked`);
    }
    for (const kind of ["signout-retry", "workspace-retry"]) {
      let result;
      for (let retry = 0; retry <= options.retries; retry++) {
        result = await attemptCase(base, viewports[1], kind, retry);
        if (!result.failure) break;
      }
      if (result.failure) report.failures.push({ name: result.name, message: result.failure });
    }
  }
} catch (error) {
  report.failures.push({ name: "harness", message: error.message });
} finally {
  try {
    if (browser) {
      await browser.close();
      report.cleanup.browserClosed = !browser.isConnected() && browser.contexts().length === 0;
    }
  } finally {
    if (server?.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      report.cleanup.serverClosed = !server.listening;
    }
    report.cleanup.fixturesRemaining = fixtures.size;
    for (const [file, bytes] of sources) {
      report.sources.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
      // Fail rather than reporting mixed revisions if the command thread patches during this run.
      if (!(await fs.readFile(path.join(repo, file))).equals(bytes)) report.failures.push({ name: "source-drift", message: file });
    }
    if (report.cleanup.contextsOpened !== report.cleanup.contextsClosed || fixtures.size) {
      report.failures.push({ name: "cleanup", message: "Unclosed contexts or undeleted local fixtures" });
    }
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  }
}
const passed = report.scenarios.filter(scenario => !scenario.failure).length;
console.log(JSON.stringify({ result: report.failures.length ? "FAIL" : "PASS", passed,
  failures: report.failures, report: path.join(output, "report.json"), cleanup: report.cleanup }, null, 2));
if (report.failures.length) process.exitCode = 1;
