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
  const manager = mode.startsWith("manager") || ["owner", "revoked-session", "access-transient"].includes(mode);
  return {
    mode, uid: "qa-instructor", staffId: "qa-staff",
    staffName: mode.endsWith("name-safe") ? 'QA <b>& "이름"</b>' : mode.endsWith("name-missing") ? "" : manager ? "QA 관리자" : "QA 강사",
    phone: "01000000000", email: "qa-login@example.invalid",
    rawRole: mode === "owner" ? "owner" : manager ? "manager" : "instructor",
    mustChangePassword: ["first-login", "signout-retry"].includes(mode),
    signOutFailures: ["signout-retry", "manager-logout-failure"].includes(mode) ? 1 : 0,
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
        { id: "qa-task-sent", memberName: "QA 완료 회원", date: "2026-10-10", startTime: "10:00", status: "sent", recordSubmitted: true,
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
  sdkInitializations: 0, authClientsCreated: 0,
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
  currentUser: localStorage.getItem("core-ui-user") === fixture.uid
    ? { uid: fixture.uid, phoneNumber: fixture.phone, email: fixture.email, displayName: fixture.email } : null,
};
export function changeAuth(user) {
  authClient.currentUser = user;
  if (user) localStorage.setItem("core-ui-user", user.uid);
  else localStorage.removeItem("core-ui-user");
  for (const listener of [...listeners]) listener(user);
}
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
    export const initializeApp = () => { state.sdkInitializations++; return app; };
    export const getApps = () => [];
  `;
  if (kind === "auth") return shared + `
    export const getAuth = () => { state.authClientsCreated++; return authClient; };
    export const onAuthStateChanged = (_, callback) => observe(callback);
    export const signOut = () => logout();
    export const signInWithEmailAndPassword = () => rejectWrite("unexpected-login");
  `;
  if (kind === "functions") return shared + `
    export const getFunctions = () => ({ mock: true });
    export const httpsCallable = (_, name) => async (payload) => {
      const call = record("callables", { name, month: payload?.month, path: location.pathname });
      if (!authClient.currentUser) throw denied("Synthetic session is signed out");
      if (name === "getCoreAccessSession") {
        const destination = document.querySelector('[data-core-navigation-frame][hidden]');
        if (destination) call.destination = new URL(destination.dataset.destination).pathname;
        const gate = state.nextAccessGate;
        if (gate) {
          state.nextAccessGate = null;
          gate.started = true;
          await gate.promise;
          if (gate.errorCode) {
            call.errorCode = gate.errorCode;
            throw Object.assign(new Error("Synthetic pending access failure"), { code: gate.errorCode });
          }
          if (!authClient.currentUser) throw Object.assign(new Error("Signed out during access"), { code: "functions/unauthenticated" });
        }
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
        call.resolved = true;
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
        return { data: { ...fixture.workspace, privateTasks: payload?.month && payload.month !== "2026-10" ? [] : fixture.workspace.privateTasks } };
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
  window.__coreUiQA = { events: [], frames: 0, operatorFlashes: 0, documentId: crypto.randomUUID() };
  const inspectFrame = () => {
    const qa = window.__coreUiQA;
    qa.frames++;
    const shell = document.querySelector(".shell");
    const box = shell?.getBoundingClientRect();
    if (box?.width && box?.height && getComputedStyle(shell).visibility !== "hidden"
      && document.documentElement.dataset.coreAccess !== "manager") {
      qa.operatorFlashes++;
    }
    requestAnimationFrame(inspectFrame);
  };
  requestAnimationFrame(inspectFrame);
  for (const name of ["core-password-changed", "core-instructor-signed-out"]) {
    document.addEventListener(name, () => window.__coreUiQA.events.push(name));
  }
  const hooks = {
    ".shell": "qa-operator-shell", ".nav": "qa-operator-nav", "#refreshButton": "qa-refresh",
    "#coreInstructorAccess": "qa-instructor", "#coreLoginGate": "qa-login",
    "[data-sequence-studio]": "qa-sequence-frame",
    "[data-core-login-name]": "qa-login-name", ".core-account-bar": "qa-account-bar",
    ".cia-account": "qa-instructor-account",
    "[data-core-navigation-frame]": "qa-navigation-frame",
    ".core-navigation-status": "qa-navigation-status",
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
      sdkInitializations: state.sdkInitializations, authClientsCreated: state.authClientsCreated,
      uiEvents: window.__coreUiQA.events, operatorFlashes: window.__coreUiQA.operatorFlashes };
  });
}

async function settled(page) {
  await page.waitForFunction(() => {
    if (!window.__coreFirebaseQA?.accessResolved) return false;
    const refresh = document.querySelector('[data-testid="qa-refresh"]');
    return !refresh || refresh.getAttribute("aria-busy") !== "true";
  });
}

async function loginName(page, manager = false, missing = false) {
  const fixture = await page.evaluate(async () => (await import("/__qa/state.mjs")).fixture);
  const name = page.getByTestId("qa-login-name");
  await name.waitFor({ state: "visible" });
  assert.equal(await name.count(), 1, "Exactly one current login name");
  const text = (await name.textContent()).trim();
  if (!missing && fixture.staffName) assert.equal(text, fixture.staffName, "Canonical session staffName, including manager");
  assert.ok(!text.includes(fixture.phone) && !text.includes(fixture.email), "No phone/email name substitution");
  assert.equal(await name.evaluate(node => node.childElementCount), 0, "Name must be safe text, not HTML");
  const account = page.getByTestId(manager ? "qa-account-bar" : "qa-instructor-account");
  assert.equal(await account.count(), 1, "Account toolbar cannot duplicate");
  const box = await account.boundingBox();
  const nameBox = await name.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && nameBox && box.y >= 0 && box.y < 160 && box.x + box.width >= viewport.width * .75,
    "Account must be visible in top-right of first viewport");
  assert.ok(nameBox.x >= box.x - 1 && nameBox.x + nameBox.width <= box.x + box.width + 1, "Name fits account toolbar");
  const logout = account.getByRole("button", { name: "로그아웃", exact: true });
  assert.equal(await logout.isVisible(), true);
  const logoutBox = await logout.boundingBox();
  assert.ok(logoutBox.width >= 44 && logoutBox.height >= 44, "Logout touch target");
  assert.ok(nameBox.x + nameBox.width <= logoutBox.x + 1, "Name and logout do not overlap");
}

async function clearedLoginName(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="qa-login-name"]')]
    .every(node => !node.textContent.trim()));
  assert.equal(await page.getByTestId("qa-account-bar").count(), 0, "Manager toolbar removed with session");
}

async function managerLogout(page, failure = false) {
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  if (failure) {
    await page.getByRole("alert").waitFor({ state: "visible" });
    assert.equal(await page.getByRole("alert").textContent(), "로그아웃하지 못했습니다. 다시 시도하세요.");
    await loginName(page, true);
    assert.equal(await page.getByTestId("qa-operator-shell").isVisible(), true, "Failed logout restores current manager UI");
    assert.equal((await telemetry(page)).currentUid, "qa-instructor", "Failed logout keeps authenticated user");
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  }
  await page.getByTestId("qa-login").waitFor({ state: "visible" });
  await clearedLoginName(page);
  await page.getByTestId("qa-operator-shell").waitFor({ state: "hidden" });
  const state = await telemetry(page);
  assert.equal(state.currentUid, null);
  assert.equal(state.storedUid, null);
  assert.deepEqual(state.auth.map(event => event.success), failure ? [false, true] : [true]);
  assert.deepEqual(state.uiEvents, ["core-instructor-signed-out"]);
  assert.deepEqual(state.writes, []);
  return state;
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
      const style = getComputedStyle(node);
      // Icon buttons retain a deliberately clipped label for screen readers.
      const accessibleIconLabel = box.width === 1 && box.height === 1 && style.clipPath === "inset(50%)"
        && node.parentElement?.getAttribute("aria-label") === node.textContent.trim();
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && !accessibleIconLabel;
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
  return { ...metrics, screenshot: path.join(output, `${name}.png`) };
}

async function instructorNav(page, base) {
  const nav = page.getByRole("navigation", { name: "강사 메뉴" });
  await nav.waitFor({ state: "visible" });
  assert.equal(await nav.getByRole("link").count(), 2);
  assert.equal(await nav.getByRole("link", { name: "홈", exact: true }).count(), 0);
  for (const [name, suffix] of [["프라이빗", "private/"], ["시퀀스 노트", "sequence/"]]) {
    assert.equal(await nav.getByRole("link", { name, exact: true }).evaluate(node => node.href), `${origin}${base}${suffix}`);
  }
  assert.equal(await page.getByRole("link", { name: "ARCHIVE CORE", exact: true }).evaluate(node => node.href), `${origin}${base}private/`);
  assert.equal(await page.getByRole("button", { name: "로그아웃", exact: true }).isVisible(), true);
}

async function workspaceCase(page, base, kind, surface = page) {
  if (kind === "home") await page.waitForURL(`${origin}${base}private/`);
  await surface.getByRole("heading", { name: "프라이빗 기록·리포트", exact: true }).waitFor();
  await settled(page);
  await instructorNav(page, base);
  const ui = surface.getByTestId("qa-instructor");
  assert.equal(await ui.getByRole("link", { name: "기록 작성", exact: true }).count(), 1);
  assert.equal(await ui.getByRole("link", { name: "설문", exact: true }).count(), 1);
  assert.equal(await ui.getByRole("link", { name: "리포트 확인", exact: true }).count(), 1);
  const text = await ui.innerText();
  assert.equal(text.includes("QA 내일 수업"), false, "Lesson roster must not be displayed");
  assert.equal(text.includes("QA 오늘 회원"), false, "Lesson member rows must not be counted as classes");
  assert.equal(await ui.getByRole("heading", { name: /오늘.*수업/ }).count(), 0);
  assert.equal(text.includes("QA 완료 회원"), true, "Private keeps own task history");
  const links = await ui.getByRole("link").evaluateAll(nodes => nodes.filter(node => node.target === "_blank").map(node => node.href));
  for (const href of links) {
    const url = new URL(href);
    assert.equal(url.protocol, "https:");
    assert.ok(["in.archivepilates.com", "core.archivepilates.com"].includes(url.hostname));
    assert.equal(url.username + url.password + url.port, "");
  }
  {
    const filters = ui.getByRole("group", { name: "내 프라이빗 보기" });
    await filters.getByRole("button", { name: "기록", exact: true }).click();
    assert.equal(await ui.getByRole("listitem").count(), 1);
    assert.equal((await ui.innerText()).includes("QA 완료 회원"), true);
    await filters.getByRole("button", { name: "리포트", exact: true }).click();
    assert.equal(await ui.getByRole("listitem").count(), 1);
    assert.equal(await ui.getByRole("link", { name: "리포트 확인", exact: true }).count(), 1);
    await filters.getByRole("button", { name: "전체", exact: true }).click();
    assert.equal(await ui.getByRole("listitem").count(), 3);
    await ui.getByLabel("조회 월").fill("2026-08");
    await ui.getByRole("paragraph").filter({ hasText: "연결된 프라이빗 기록이 없습니다." }).waitFor();
    assert.equal((await telemetry(page)).callables.at(-1).month, "2026-08");
    await ui.getByLabel("조회 월").fill("2026-10");
    await ui.getByRole("link", { name: "리포트 확인", exact: true }).waitFor();
    const before = (await telemetry(page)).callables.length;
    await ui.getByRole("button", { name: "새로고침", exact: true }).click();
    await page.waitForFunction(count => window.__coreFirebaseQA.callables.length > count, before);
    await ui.getByRole("link", { name: "리포트 확인", exact: true }).waitFor();
  }
  return noOperatorReads(page);
}

function summaryControl(frame, name) {
  if (name === "시퀀스 도구") return frame.getByLabel(name, { exact: true });
  return frame.getByTestId(name === "불러오기·백업" ? "sequence-library-tools" : "sequence-file-tools");
}

async function expandTools(frame, name) {
  const summary = summaryControl(frame, name);
  await summary.waitFor({ state: "visible" });
  if (name !== "시퀀스 도구") assert.equal((await summary.textContent()).trim(), name, "Maintenance summary label");
  assert.equal(await summary.evaluate((node) => node.parentElement.tagName), "DETAILS");
  if (!(await summary.evaluate((node) => node.parentElement.open))) await summary.click();
  assert.equal(await summary.evaluate((node) => node.parentElement.open), true, `${name}: tools expanded`);
  return summary;
}

async function visibleFocus(control) {
  await control.focus();
  // Enter keyboard modality before measuring :focus-visible after pointer commands.
  await control.press("ArrowLeft");
  const focus = await control.evaluate((node) => {
    const style = getComputedStyle(node);
    return { active: node === document.activeElement, outline: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor, shadow: style.boxShadow };
  });
  assert.ok(focus.active && ((focus.outline !== "none" && focus.width > 0 && focus.color !== "rgba(0, 0, 0, 0)") || focus.shadow !== "none"), "Visible keyboard focus");
  return focus;
}

async function simplifiedChrome(frame) {
  await frame.evaluate(() => document.fonts.ready);
  await frame.getByRole("heading", { name: "시퀀스 노트", exact: true }).waitFor();
  const author = frame.getByLabel("작성 강사", { exact: true });
  assert.equal(await author.inputValue(), "", "Fresh author must be blank for managers and instructors");
  assert.equal(await author.getAttribute("placeholder"), "강사명");
  assert.equal(await frame.evaluate(() => window.ARCHIVE_TEST.getState().teacher), "");
  assert.equal(await frame.evaluate(() => window.ARCHIVE_TEST.sample().teacher), "정유리", "Sample keeps its explicitly named author");
  const previousId = await frame.evaluate(() => window.ARCHIVE_TEST.getState().id);
  await frame.getByRole("button", { name: "새 시퀀스", exact: true }).click();
  await frame.waitForFunction(id => window.ARCHIVE_TEST.getState().id !== id, previousId);
  assert.equal(await author.inputValue(), "", "New sequence author must be blank");
  assert.equal(await author.getAttribute("placeholder"), "강사명");
  assert.equal(await frame.evaluate(() => window.ARCHIVE_TEST.getState().teacher), "");
  const metrics = await frame.evaluate(() => {
    const header = document.querySelector("header.top").getBoundingClientRect();
    const tabs = document.querySelector('[role="tablist"]').getBoundingClientRect();
    const first = document.querySelector("#survey .q").getBoundingClientRect();
    return { headerHeight: header.height, firstSectionY: first.y, tabsBottom: tabs.bottom,
      removed: document.querySelectorAll(".mast,.workflow,.aside,.aside-box,#generateSide").length,
      prose: document.querySelectorAll(".top p,.qhead p").length };
  });
  assert.equal(metrics.removed, 0, "Hero/aside/generateSide removed, not merely hidden");
  assert.equal(metrics.prose, 0, "No header or section introductory prose");
  assert.ok(metrics.headerHeight <= 160, "Compact header on all viewports");
  assert.ok(metrics.firstSectionY - metrics.tabsBottom <= 32, "Form starts immediately below tabs");
  for (const name of ["작성", "미리보기"]) assert.equal(await frame.getByRole("tab", { name, exact: true }).count(), 1);
  const tools = summaryControl(frame, "시퀀스 도구");
  assert.equal(await tools.getAttribute("title"), "시퀀스 도구");
  const toolBox = await tools.boundingBox();
  assert.ok(toolBox.width >= 44 && toolBox.height >= 44, "Tool icon has a 44px square hit area");
  await frame.waitForFunction(() => document.querySelector(".tool-menu > summary svg")?.getBoundingClientRect().width > 0);
  assert.equal(await tools.evaluate((node) => node.parentElement.open), false, "Tools closed initially");
  assert.equal(await frame.getByRole("button", { name: "AI 정리 요청문", exact: true }).isVisible(), false);
  const focus = await visibleFocus(tools);
  await tools.press("Enter");
  await frame.getByRole("button", { name: "AI 정리 요청문", exact: true }).waitFor({ state: "visible" });
  await tools.press("Escape");
  assert.equal(await tools.evaluate((node) => node.parentElement.open), false);
  assert.equal(await tools.evaluate((node) => node === document.activeElement), true, "Escape returns focus to tools");
  await expandTools(frame, "시퀀스 도구");
  await frame.getByLabel("수업명", { exact: true }).click();
  assert.equal(await tools.evaluate((node) => node.parentElement.open), false, "Outside pointer closes tools");
  await expandTools(frame, "시퀀스 도구");
  await frame.getByRole("button", { name: "AI 정리 요청문", exact: true }).click();
  const dialog = frame.getByRole("dialog").filter({ has: frame.getByRole("heading", { name: "긴 메모 → 짧은 응답", exact: true }) });
  await dialog.waitFor({ state: "visible" });
  assert.equal(await tools.evaluate((node) => node.parentElement.open), false, "Command closes tools");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await frame.waitForFunction(() => document.activeElement === document.querySelector(".tool-menu > summary"));
  assert.equal(await tools.evaluate((node) => node === document.activeElement), true, "Dialog close returns focus to visible tools");
  await visibleFocus(tools);
  return { ...metrics, focus, toolsKeyboardOutsideAndCommand: true };
}

async function sequenceChromeLayout(page, frame, name) {
  const chrome = await simplifiedChrome(frame);
  const layout = await frame.evaluate(() => {
    const shown = node => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      const control = node.tagName === "LABEL" && document.getElementById(node.htmlFor);
      const accessibleLabel = box.width === 1 && box.height === 1 && style.clipPath === "inset(50%)"
        && control?.labels && [...control.labels].includes(node) && control.getClientRects().length > 0;
      return node.getClientRects().length && style.visibility !== "hidden" && !accessibleLabel;
    };
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      clipped: [...document.querySelectorAll("button,summary,h1,h2,label,p")].filter(shown)
        .filter(node => node.scrollWidth > node.clientWidth + 2).map(node => node.textContent.slice(0, 80)),
      smallTargets: [...document.querySelectorAll("button,summary,a.btn")].filter(shown)
        .filter(node => node.getBoundingClientRect().height < 44).map(node => node.textContent.slice(0, 80)),
    };
  });
  assert.equal(layout.overflow, false, "Sequence chrome has no horizontal overflow");
  assert.deepEqual(layout.clipped, [], "Sequence chrome text is not clipped");
  assert.deepEqual(layout.smallTargets, [], "Sequence action hit areas are at least 44px high");
  await frame.getByRole("tab", { name: /내 시퀀스/ }).click();
  assert.equal(await frame.getByRole("contentinfo").isVisible(), false, "Library hides footer");
  const summary = summaryControl(frame, "불러오기·백업");
  assert.equal(await summary.evaluate(node => node.parentElement.open), false);
  for (const name of ["응답 불러오기", "최근 기록 백업", "이전 브라우저 기록 가져오기"]) {
    assert.equal(await frame.getByRole("button", { name, exact: true }).isVisible(), false);
  }
  await visibleFocus(summary);
  await expandTools(frame, "불러오기·백업");
  for (const name of ["응답 불러오기", "최근 기록 백업", "이전 브라우저 기록 가져오기"]) {
    const button = frame.getByRole("button", { name, exact: true });
    assert.equal(await button.isVisible(), true);
    const box = await button.boundingBox();
    assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= frame.page().viewportSize().width + 1);
  }
  const screenshot = path.join(output, `${name}-sequence-library-tools.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await summary.click();
  await frame.getByRole("tab", { name: "작성", exact: true }).click();
  await page.screenshot({ path: path.join(output, `${name}-sequence-write.png`), fullPage: true });
  return { chrome, layout, screenshot, noWrites: true };
}

async function managerSequenceGeometry(page, frame) {
  await page.evaluate(() => document.fonts.ready);
  await frame.evaluate(() => document.fonts.ready);
  const main = await page.getByRole("main", { name: "시퀀스 노트", exact: true }).boundingBox();
  const shell = await page.getByTestId("qa-operator-shell").boundingBox();
  const account = await page.getByTestId("qa-account-bar").boundingBox();
  const studio = await page.getByTestId("qa-sequence-frame").boundingBox();
  assert.ok(main && shell && account && studio, "Manager sequence layout must be visible");
  const aligned = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 1, message);
  const viewport = page.viewportSize();
  assert.ok(main.x >= 0 && main.x + main.width <= viewport.width + 1, "Sequence main fits viewport");
  aligned(main.x + main.width, shell.x + shell.width, "Main fills available shell width");
  if (viewport.width <= 1040) aligned(main.x, shell.x, "Mobile main starts at shell left edge");
  for (const [label, box] of [["Account", account], ["Iframe", studio]]) {
    aligned(box.x, main.x, `${label} left edge aligns with main`);
    aligned(box.width, main.width, `${label} spans full main width`);
  }
  aligned(account.y, main.y, "Account starts at top of main");
  assert.ok(account.y + account.height <= studio.y + 1, "Account stays above iframe without overlap");
  aligned(studio.y + studio.height, main.y + main.height, "Iframe fills remaining main height");
  assert.ok(studio.height > 300, "Manager studio iframe retains usable height");
  const inner = await frame.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
  }));
  aligned(inner.width, studio.width, "Actual studio viewport spans iframe width");
  aligned(inner.height, studio.height, "Actual studio viewport spans iframe height");
  assert.ok(inner.scrollWidth <= inner.width + 1 && inner.bodyScrollWidth <= inner.width + 1,
    "Actual manager studio has no horizontal overflow");
  return { main, shell, account, studio, inner };
}

async function managerSequenceCase(page, base, name) {
  await settled(page);
  await page.getByTestId("qa-operator-shell").waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("qa-instructor").count(), 0);
  await loginName(page, true);
  await page.waitForFunction(() => window.archiveSequenceStore?.uid === "qa-instructor"
    && window.__coreFirebaseQA?.reads.some(read => read.operation === "onSnapshot"));
  const frameElement = page.getByTestId("qa-sequence-frame");
  await frameElement.waitFor({ state: "visible" });
  assert.equal(await frameElement.getAttribute("data-auth-ready"), "true");
  assert.equal(await frameElement.getAttribute("src"), "./studio.html");
  const frame = page.frames().find(frame => new URL(frame.url()).pathname === `${base}sequence/studio.html`);
  assert.ok(frame, "Actual manager studio iframe loads on the matching surface");
  await frame.getByRole("heading", { name: "시퀀스 노트", exact: true }).waitFor();
  await frame.getByRole("tab", { name: /내 시퀀스/ }).waitFor();
  const sequenceLayout = { chrome: await sequenceChromeLayout(page, frame, name), initial: await managerSequenceGeometry(page, frame) };
  const menu = page.getByRole("button", { name: "메뉴", exact: true });
  const nav = page.getByTestId("qa-operator-nav");
  assert.ok(await nav.getByRole("link", { includeHidden: true }).count() > 3);
  if (page.viewportSize().width <= 1040) {
    await menu.waitFor({ state: "visible" });
    const menuBox = await menu.boundingBox();
    assert.ok(menuBox.width >= 44 && menuBox.height >= 44, "Menu touch target");
    assert.equal(await menu.getAttribute("aria-expanded"), "false");
    await nav.waitFor({ state: "hidden" });
    await menu.click();
    assert.equal(await menu.getAttribute("aria-expanded"), "true");
    await nav.waitFor({ state: "visible" });
    sequenceLayout.menuOpen = await layout(page, `${name}-menu-open`, false);
    await menu.click();
    assert.equal(await menu.getAttribute("aria-expanded"), "false");
    await nav.waitFor({ state: "hidden" });
    sequenceLayout.menuClosed = await managerSequenceGeometry(page, frame);
    assert.deepEqual(sequenceLayout.menuClosed, sequenceLayout.initial, "Closing menu restores studio geometry");
  } else {
    assert.equal(await menu.isVisible(), false);
    await nav.waitFor({ state: "visible" });
  }
  const state = await telemetry(page);
  assert.equal(state.role, "manager");
  assert.equal(state.events[0]?.name, "getCoreAccessSession", "Access check precedes sequence reads");
  assert.equal(state.events.find(event => event.kind === "session")?.rawRole, "manager");
  assert.deepEqual(state.callables.map(call => call.name), ["getCoreAccessSession"]);
  assert.ok(state.reads.length > 0, "Actual manager sequence store reads its notes");
  for (const read of state.reads) {
    assert.equal(read.path, "sequenceNotes");
    assert.equal(read.allowed, true);
    assert.ok(read.filters.some(filter => filter.kind === "where" && filter.field === "ownerUid"
      && filter.operator === "==" && filter.value === "qa-instructor"));
  }
  assert.deepEqual(state.writes, [], "Manager studio QA must not write");
  return { ...state, sequenceLayout };
}

async function navigationSetup(page, manager) {
  await page.getByRole("heading", { name: manager ? "오늘 할 일" : "프라이빗 기록·리포트", exact: true }).waitFor();
  await page.waitForFunction(() => Boolean(window.archiveCoreNavigation));
  await loginName(page, manager);
  await page.evaluate(() => {
    const host = window.archiveCoreNavigation;
    const ready = host.ready;
    window.__coreNavigationQA = { ready: [], prepareCalls: 0 };
    host.ready = function(frame, runtime, session, error) {
      const access = window.__coreFirebaseQA.callables.filter(call => call.name === "getCoreAccessSession").at(-1);
      window.__coreNavigationQA.ready.push({
        destination: frame.dataset.destination, hidden: frame.hidden,
        sharedRuntime: runtime === host.runtime, distinctSession: session !== host.session,
        accessResolved: access?.resolved === true, accessDestination: access?.destination,
        childHasTelemetry: Boolean(frame.contentWindow.__coreFirebaseQA),
      });
      return ready.call(this, frame, runtime, session, error);
    };
  });
  return page.evaluate(() => window.__coreUiQA.documentId);
}

async function navigationLink(page, manager, label) {
  if (manager && page.viewportSize().width <= 1040) {
    const menu = page.getByRole("button", { name: "메뉴", exact: true });
    if (await menu.getAttribute("aria-expanded") !== "true") await menu.click();
  }
  const nav = manager ? page.getByTestId("qa-operator-nav") : page.getByRole("navigation", { name: "강사 메뉴", exact: true });
  return nav.getByRole("link", { name: label, exact: true });
}

async function armNavigationAccess(page, errorCode = null) {
  await page.evaluate(errorCode => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    const gate = window.__coreNavigationGate = { promise, release, started: false, errorCode };
    window.__coreFirebaseQA.nextAccessGate = gate;
  }, errorCode);
}

async function pendingNavigation(page, destination, documentId) {
  await page.waitForFunction(() => window.__coreNavigationGate?.started);
  assert.equal(page.url(), `${origin}${destination.before}`, "Top URL changes only after destination verification");
  assert.equal(await page.evaluate(() => window.__coreUiQA.documentId), documentId, "No outer document reload");
  const pending = page.getByTestId("qa-navigation-frame");
  assert.equal(await pending.evaluateAll(nodes => nodes.filter(node => node.hidden).length), 1);
  assert.equal(await pending.evaluateAll(nodes => nodes.filter(node => node.hidden && !node.inert && getComputedStyle(node).display !== "none").length), 0,
    "Unverified destination is not displayed");
  const last = (await telemetry(page)).callables.filter(call => call.name === "getCoreAccessSession").at(-1);
  assert.equal(last.destination, destination.after, "Separate destination access call is pending");
  assert.notEqual(last.resolved, true);
}

async function destinationFrame(page, pathName, documentId, manager) {
  await page.waitForURL(`${origin}${pathName}`);
  await page.waitForFunction(pathName => [...document.querySelectorAll('[data-core-navigation-frame]')]
    .some(frame => !frame.hidden && new URL(frame.dataset.destination).pathname === pathName), pathName);
  const frame = page.frames().find(frame => frame !== page.mainFrame() && new URL(frame.url()).pathname === pathName);
  assert.ok(frame, "Verified content frame exists");
  const evidence = await page.evaluate(() => ({
    documentId: window.__coreUiQA.documentId,
    ready: window.__coreNavigationQA.ready.at(-1),
  }));
  assert.equal(evidence.documentId, documentId, "Outer document identity retained through history");
  assert.equal(evidence.ready.hidden, true, "Readiness follows revalidation while destination is hidden");
  assert.equal(evidence.ready.sharedRuntime, true, "Destination uses the exact outer Firebase runtime");
  assert.equal(evidence.ready.distinctSession, true, "Destination obtains a fresh access session");
  assert.equal(evidence.ready.accessResolved, true);
  assert.equal(evidence.ready.accessDestination, pathName);
  assert.equal(evidence.ready.childHasTelemetry, false, "Shared SDK telemetry stays in the outer fixture");
  const hiddenSiblings = await page.evaluate(() => [...document.querySelectorAll('.core-navigation-container > [hidden]')]
    .map(node => ({ tag: node.tagName, className: node.className, display: getComputedStyle(node).display })));
  assert.ok(hiddenSiblings.length, "Original destination siblings are retired");
  assert.ok(hiddenSiblings.every(node => node.display === "none"),
    `Retired original siblings must not leave stale headings/content: ${JSON.stringify(hiddenSiblings)}`);
  const sdk = await telemetry(page);
  assert.equal(sdk.sdkInitializations, 1, "Only one Firebase app initialization across content transitions");
  assert.equal(sdk.authClientsCreated, 1, "Only one Auth client across content transitions");
  assert.deepEqual(sdk.writes, [], "Navigation never writes through the SDK");
  const child = await frame.evaluate(async () => {
    const module = await import(new URL('./core-navigation.js', document.querySelector('script[src$="assets/app.js"]').src).href);
    return {
      sharedRuntime: module.sharedNavigationRuntime() === parent.archiveCoreNavigation.runtime,
      operatorFlashes: window.__coreUiQA.operatorFlashes,
      overflow: document.documentElement.scrollWidth > innerWidth,
      navigationVisible: [...document.querySelectorAll('.sidebar,.cia-header,.core-account-bar')]
        .some(node => node.getBoundingClientRect().height > 0 && getComputedStyle(node).display !== 'none'),
    };
  });
  assert.equal(child.sharedRuntime, true);
  assert.equal(child.operatorFlashes, 0, "No child operator flash before authorization");
  assert.equal(child.overflow, false, "Content frame fits its mobile/desktop viewport");
  assert.equal(child.navigationVisible, false, "Destination does not duplicate the outer navigation/account");
  await loginName(page, manager);
  if (manager && page.viewportSize().width <= 1040) {
    assert.equal(await page.getByRole("button", { name: "메뉴", exact: true }).getAttribute("aria-expanded"), "false",
      "Mobile menu collapsed and ARIA state reset after navigation");
  }
  return frame;
}

async function navigationCase(page, base, manager, name) {
  const documentId = await navigationSetup(page, manager);
  const initial = `${base}${manager ? '' : 'private/'}`;
  const sequence = `${base}sequence/`;
  const privatePath = `${base}private/`;
  const before = (await telemetry(page)).callables.filter(call => call.name === "getCoreAccessSession").length;
  await armNavigationAccess(page);
  await (await navigationLink(page, manager, "시퀀스 노트")).click();
  await pendingNavigation(page, { before: initial, after: sequence }, documentId);
  await page.evaluate(() => window.__coreNavigationGate.release());
  const sequencePage = await destinationFrame(page, sequence, documentId, manager);
  const studio = sequencePage.childFrames().find(frame => new URL(frame.url()).pathname === `${sequence}studio.html`);
  assert.ok(studio, "Sequence studio remains a nested authenticated editor");
  await studio.getByRole("tab", { name: /내 시퀀스/ }).waitFor();
  await studio.waitForFunction(() => Boolean(window.archiveSequenceNavigation));
  assert.equal(await studio.evaluate(() => parent.archiveSequenceStore.uid), "qa-instructor");
  const nestedViewport = await studio.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(nestedViewport.height >= 300 && nestedViewport.width > 0, "Nested editor retains a usable, nonblank viewport");
  assert.ok(nestedViewport.scrollWidth <= nestedViewport.width + 1 && nestedViewport.bodyWidth <= nestedViewport.width + 1,
    "Nested Sequence editor has no horizontal overflow");
  await page.screenshot({ path: path.join(output, `${name}-frame-sequence.png`), fullPage: true });
  // Exercise the production prepare boundary without making a Firestore save.
  await studio.evaluate(() => {
    window.__qaOriginalPrepare = window.archiveSequenceNavigation.prepare;
    window.archiveSequenceNavigation.prepare = async () => {
      top.__coreNavigationQA.prepareCalls++;
      return false;
    };
  });
  const accessBeforeFailure = (await telemetry(page)).callables.length;
  await (await navigationLink(page, manager, "프라이빗")).click();
  await page.getByTestId("qa-navigation-status").filter({ hasText: "저장을 확인하지 못했습니다" }).waitFor();
  assert.equal(page.url(), `${origin}${sequence}`, "Failed save leaves URL and draft frame intact");
  assert.equal(await page.getByTestId("qa-navigation-frame").count(), 1, "Save failure creates no destination frame");
  assert.equal((await telemetry(page)).callables.length, accessBeforeFailure, "Save failure precedes all destination access calls");
  assert.equal(await studio.evaluate(() => Boolean(window.__qaOriginalPrepare)), true, "Departing editor stays alive");
  await studio.evaluate(() => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    window.__qaPrepareGate = { release };
    window.archiveSequenceNavigation.prepare = () => {
      top.__coreNavigationQA.prepareCalls++;
      return promise;
    };
  });
  await armNavigationAccess(page);
  await (await navigationLink(page, manager, "프라이빗")).click();
  await page.waitForFunction(() => window.__coreNavigationQA.prepareCalls === 2);
  assert.equal((await telemetry(page)).callables.length, accessBeforeFailure, "Destination access waits for save acknowledgement");
  assert.equal(await page.getByTestId("qa-navigation-frame").count(), 1);
  await studio.evaluate(() => window.__qaPrepareGate.release(true));
  await pendingNavigation(page, { before: sequence, after: privatePath }, documentId);
  assert.equal(studio.isDetached(), false, "Saved editor is retained until destination passes access validation");
  await page.evaluate(() => window.__coreNavigationGate.release());
  await destinationFrame(page, privatePath, documentId, manager);
  await page.goBack();
  await destinationFrame(page, sequence, documentId, manager);
  await page.goBack();
  await destinationFrame(page, initial, documentId, manager);
  await page.goForward();
  await destinationFrame(page, sequence, documentId, manager);
  await page.goForward();
  await destinationFrame(page, privatePath, documentId, manager);
  const evidence = await page.evaluate(() => window.__coreNavigationQA);
  assert.equal(evidence.prepareCalls, 2, "One failed prepare and one successful prepare");
  assert.equal((await telemetry(page)).callables.filter(call => call.name === "getCoreAccessSession").length - before, 6,
    "Each click/back/forward destination independently revalidates access");
  await layout(page, `${name}-continuity`, !manager);
  return { ...await telemetry(page), navigation: evidence };
}

async function pendingAccessCase(page, base, manager, revoked) {
  const documentId = await navigationSetup(page, manager);
  const initial = `${base}${manager ? '' : 'private/'}`;
  await armNavigationAccess(page, revoked ? "functions/unauthenticated" : null);
  await (await navigationLink(page, manager, "시퀀스 노트")).click();
  await pendingNavigation(page, { before: initial, after: `${base}sequence/` }, documentId);
  if (!revoked) await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.evaluate(() => window.__coreNavigationGate.release());
  await page.waitForFunction(() => window.__coreFirebaseQA.auth.some(event => event.action === "signOut" && event.success));
  await page.getByTestId("qa-login").waitFor({ state: "visible" });
  await clearedLoginName(page);
  await page.getByTestId("qa-operator-shell").waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("qa-navigation-frame").count(), 0, "Auth invalidation removes pending/current destination frames");
  assert.equal(await page.evaluate(() => Boolean(window.archiveCoreNavigation)), false);
  assert.equal(await page.evaluate(() => window.__coreUiQA.documentId), documentId);
  assert.deepEqual(await page.evaluate(() => window.__coreNavigationQA.ready), [], "Late access never installs a destination after sign-out");
  const state = await telemetry(page);
  assert.equal(state.currentUid, null);
  assert.equal(state.storedUid, null);
  assert.deepEqual(state.writes, []);
  assert.equal(state.callables.filter(call => call.name === "getCoreAccessSession").length, 2);
  return state;
}

async function destinationFailureCase(page, base, manager, timeout) {
  const documentId = await navigationSetup(page, manager);
  const initial = `${base}${manager ? '' : 'private/'}`;
  await armNavigationAccess(page, timeout ? null : "functions/unavailable");
  await (await navigationLink(page, manager, "시퀀스 노트")).click();
  await pendingNavigation(page, { before: initial, after: `${base}sequence/` }, documentId);
  if (timeout) {
    await page.clock.fastForward(30001);
    await page.getByTestId("qa-navigation-status").filter({ hasText: "응답이 늦어지고" }).waitFor();
    await page.evaluate(() => window.__coreNavigationGate.release());
  } else {
    await page.evaluate(() => window.__coreNavigationGate.release());
    await page.waitForFunction(documentId => window.__coreUiQA.documentId !== documentId
      || !document.querySelector('[data-core-navigation-frame][hidden]'), documentId);
  }
  assert.equal(await page.evaluate(() => window.__coreUiQA.documentId), documentId,
    "Transient destination failures preserve the authenticated outer document");
  assert.equal(page.url(), `${origin}${initial}`, "Failed destination never replaces URL/history");
  assert.equal(await page.getByTestId("qa-navigation-frame").count(), 0, "Failed pending frame removed");
  if (manager && page.viewportSize().width <= 1040) {
    const menu = page.getByRole("button", { name: "메뉴", exact: true });
    if (await menu.getAttribute("aria-expanded") === "true") await menu.click();
  }
  await loginName(page, manager);
  const state = await telemetry(page);
  assert.equal(state.currentUid, "qa-instructor", "Transient failures do not sign out");
  assert.deepEqual(state.auth, []);
  assert.deepEqual(state.writes, []);
  // A new click must recover; late readiness from the failed frame is not reusable.
  await (await navigationLink(page, manager, "시퀀스 노트")).click();
  await destinationFrame(page, `${base}sequence/`, documentId, manager);
  return { ...await telemetry(page), recoveredDestination: true, timeout };
}

async function currentRefreshDowngrade(page, base, name) {
  const documentId = await navigationSetup(page, true);
  const target = `${base}private/`;
  await (await navigationLink(page, true, "프라이빗")).click();
  const child = await destinationFrame(page, target, documentId, true);
  const fixtureId = await page.evaluate(() => window.__coreFirebaseQA.fixtureId);
  fixtures.get(fixtureId).rawRole = "instructor";
  await page.evaluate(async () => { (await import("/__qa/state.mjs")).fixture.rawRole = "instructor"; });
  await child.getByTestId("qa-refresh").click();
  await page.waitForFunction(documentId => window.__coreUiQA.documentId !== documentId, documentId);
  await page.getByRole("heading", { name: "프라이빗 기록·리포트", exact: true }).waitFor();
  await instructorNav(page, base);
  await page.getByTestId("qa-operator-shell").waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("qa-account-bar").count(), 0, "Current-child downgrade cannot retain manager toolbar");
  assert.equal(await page.getByTestId("qa-navigation-frame").count(), 0, "Downgrade destroys old content frame");
  const state = await noOperatorReads(page);
  assert.equal(state.role, "instructor");
  await layout(page, `${name}-downgraded`);
  return { ...state, currentRefreshDowngrade: true };
}

async function runCase(page, base, kind, name) {
  if (["navigation", "manager-navigation"].includes(kind)) return navigationCase(page, base, kind.startsWith("manager-"), name);
  if (kind === "manager-current-refresh-downgrade") return currentRefreshDowngrade(page, base, name);
  if (/^(?:manager|instructor)-destination-(?:transient|timeout)$/.test(kind)) {
    return destinationFailureCase(page, base, kind.startsWith("manager-"), kind.endsWith("timeout"));
  }
  if (/^(?:manager|instructor)-pending-(?:logout|revocation)$/.test(kind)) {
    return pendingAccessCase(page, base, kind.startsWith("manager-"), kind.endsWith("revocation"));
  }
  if (kind === "manager-sequence") return managerSequenceCase(page, base, name);
  if (kind === "logged-out") {
    await page.getByTestId("qa-login").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("qa-operator-shell").isVisible(), false);
    const state = await telemetry(page);
    assert.deepEqual(state.reads, []);
    assert.deepEqual(state.callables, []);
    assert.deepEqual(state.writes, []);
    return state;
  }
  if (kind === "instructor-bfcache") {
    await workspaceCase(page, base, "private");
      // Deterministic persisted-page lifecycle simulation; not proof of browser cache eligibility.
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
      assert.equal(await page.getByTestId("qa-operator-shell").isVisible(), false);
      await Promise.all([
        page.waitForEvent("load"),
        page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))),
      ]);
    return workspaceCase(page, base, "private");
  }
  if (/^(manager|instructor)-/.test(kind)) {
    const manager = kind.startsWith("manager-");
    await runCase(page, base, manager ? "manager" : "home", name);
    await loginName(page, manager, kind.endsWith("name-missing"));
    if (kind === "manager-bfcache") {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
      assert.equal(await page.getByTestId("qa-operator-shell").isVisible(), false);
      await Promise.all([
        page.waitForEvent("load"),
        page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))),
      ]);
      return runCase(page, base, "manager", name);
    }
    if (kind.endsWith("auth-change")) {
      await page.evaluate(async () => {
        const { changeAuth } = await import("/__qa/state.mjs");
        changeAuth({ uid: "qa-other-user", email: "other@example.invalid" });
      });
      await clearedLoginName(page);
      await page.getByTestId("qa-operator-shell").waitFor({ state: "hidden" });
    }
    if (kind === "manager-revoked-after-login") {
      await page.evaluate(async () => { (await import("/__qa/state.mjs")).fixture.mode = "revoked-session"; });
      await page.getByTestId("qa-refresh").click();
      await page.getByTestId("qa-login").waitFor({ state: "visible" });
      await clearedLoginName(page);
      assert.equal((await telemetry(page)).currentUid, null);
    }
    if (kind === "manager-logout-failure") return managerLogout(page, true);
    return telemetry(page);
  }
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
    await loginName(page, true);
    for (let refresh = 0; refresh < 2; refresh++) {
      const before = (await telemetry(page)).callables.filter(call => call.name === "getCoreAccessSession").length;
      await page.getByTestId("qa-refresh").click();
      await page.waitForFunction(count => window.__coreFirebaseQA.callables.filter(call => call.name === "getCoreAccessSession").length > count, before);
      await settled(page);
      await loginName(page, true);
    }
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
    const sequenceLayout = await sequenceChromeLayout(page, frame, name);
    const state = await noOperatorReads(page, true);
    state.sequenceLayout = sequenceLayout;
    assert.equal(state.callables.some(call => call.name === "getCoreInstructorWorkspace"), false);
    return state;
  }
  if (kind.startsWith("blocked-")) {
    await page.getByRole("heading", { name: "접근할 수 없는 페이지", exact: true }).waitFor();
    await settled(page);
    await instructorNav(page, base);
    assert.equal(await page.getByRole("link", { name: "프라이빗으로", exact: true }).getAttribute("href"), `${base}private/`);
    const state = await noOperatorReads(page);
    assert.equal(state.callables.some(call => call.name === "getCoreInstructorWorkspace"), false);
    if (kind === "blocked-rules") {
      await layout(page, `${name}-blocked`);
      const documentId = await page.evaluate(() => window.__coreUiQA.documentId);
      await page.getByRole("link", { name: "프라이빗으로", exact: true }).click();
      await page.waitForURL(`${origin}${base}private/`);
      await page.getByTestId("qa-navigation-frame").waitFor({ state: "visible" });
      const child = page.frames().find(frame => frame !== page.mainFrame() && new URL(frame.url()).pathname === `${base}private/`);
      assert.ok(child, "Blocked-route recovery loads an authorized private content frame");
      assert.equal(await page.evaluate(() => window.__coreUiQA.documentId), documentId);
      assert.equal(await child.evaluate(() => Boolean(window.__coreFirebaseQA)), false);
      await workspaceCase(page, base, "private", child);
      state.returnPrivateVerified = true;
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
    await page.getByRole("heading", { name: "프라이빗 기록·리포트", exact: true }).waitFor();
    assert.equal((await telemetry(page)).callables.filter(call => call.name === "getCoreInstructorWorkspace").length, 2);
    return workspaceCase(page, base, "private");
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
  if (kind === "manager-sequence") return `${base}sequence/`;
  if (kind === "private" || kind === "sequence") return `${base}${kind}/`;
  if (kind === "workspace-retry") return `${base}private/`;
  if (["navigation", "instructor-bfcache"].includes(kind) || /^instructor-(?:pending|destination)-/.test(kind)) return `${base}private/`;
  if (kind.startsWith("blocked-")) return `${base}${kind.slice(8)}/`;
  return base;
}

async function attemptCase(base, viewport, kind, retry) {
  const fixture = await seedFixture(["home", "private", "sequence"].includes(kind) || kind.startsWith("blocked-") ? "instructor" : kind);
  const name = `${base === "/" ? "root" : "core"}-${viewport.width}-${kind.replace(/[^a-z0-9-]/g, "-")}-${retry}`;
  const context = await browser.newContext({
    viewport, locale: "ko-KR", timezoneId: "Asia/Seoul", reducedMotion: "reduce", serviceWorkers: "block",
    storageState: { cookies: [], origins: [{ origin, localStorage: [
      { name: "core-ui-fixture", value: fixture.id }, { name: "core-ui-user", value: kind === "logged-out" ? "" : fixture.uid },
    ] }] },
  });
  report.cleanup.contextsOpened++;
  let page;
  let failure;
  let state;
  let metrics;
  const pageErrors = [];
  const deniedRequests = [];
  let releaseBootstrap;
  const bootstrapGate = new Promise(resolve => { releaseBootstrap = resolve; });
  let bootstrapHeld = false;
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
      if (url.origin === origin && request.method() === "GET") {
        if (!bootstrapHeld && url.pathname.endsWith("/assets/app.js")) {
          bootstrapHeld = true;
          await bootstrapGate;
          if (kind === "bootstrap-failure") return route.fulfill({ status: 503, contentType: "text/javascript", body: "" });
        }
        return route.continue();
      }
      deniedRequests.push({ type: request.resourceType(), method: request.method(), url: `${url.origin}${url.pathname}` });
      return route.abort("blockedbyclient");
    });
    if (retry === 1 && options.trace === "on-first-retry") {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    }
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", error => pageErrors.push(error.message));
    if (kind.endsWith("destination-timeout")) await page.clock.install({ time: new Date(fixedTime) });
    else await page.clock.setFixedTime(new Date(fixedTime));
    await page.goto(`${origin}${routeFor(base, kind)}`, { waitUntil: "commit" });
    await page.getByTestId("qa-operator-shell").waitFor({ state: "attached" });
    await page.waitForFunction(() => window.__coreUiQA.frames >= 3);
    assert.equal(await page.getByTestId("qa-operator-shell").isVisible(), false, "Operator shell hidden before app/auth startup");
    assert.equal(await page.evaluate(() => window.__coreUiQA.operatorFlashes), 0, "No first-paint flash while module is delayed");
    if (kind === "manager-sequence") {
      const frame = page.getByTestId("qa-sequence-frame");
      assert.equal(await frame.isVisible(), false, "Manager studio hidden before access check");
      assert.equal(await frame.getAttribute("src"), null, "Studio must not load before access check");
      assert.equal(await frame.getAttribute("data-auth-ready"), null);
    }
    releaseBootstrap();
    if (kind === "bootstrap-failure") {
      await page.getByRole("paragraph").filter({ hasText: /^연결 중$/ }).waitFor();
      assert.equal(await page.getByRole("link", { name: "다시 연결", exact: true }).isVisible(), true);
      assert.equal(await page.getByTestId("qa-operator-shell").isVisible(), false);
      assert.equal(await page.evaluate(() => Boolean(window.__coreFirebaseQA)), false);
      state = { bootstrapRecovery: true };
    } else state = await runCase(page, base, kind, name);
    if (["home", "private", "sequence"].includes(kind) || kind.startsWith("blocked-")) await loginName(page);
    metrics = await layout(page, name, !["manager", "owner", "revoked-session", "logged-out", "bootstrap-failure"].includes(kind) && !kind.startsWith("manager-"));
    if (kind === "manager-sequence") metrics.sequenceLayout = state.sequenceLayout;
    if (kind === "home") {
      await page.getByRole("button", { name: "로그아웃", exact: true }).click();
      await page.getByTestId("qa-login").waitFor({ state: "visible" });
      state = await noOperatorReads(page);
      assert.ok(state.uiEvents.includes("core-instructor-signed-out"));
      await clearedLoginName(page);
    }
    if (["manager", "owner", "manager-sequence"].includes(kind)) state = await managerLogout(page);
    if (kind === "manager-sequence") {
      await page.getByTestId("qa-sequence-frame").waitFor({ state: "hidden" });
      assert.equal(await page.getByTestId("qa-sequence-frame").getAttribute("src"), null, "Logout unloads manager studio");
      assert.equal(await page.evaluate(() => Boolean(window.archiveSequenceStore)), false, "Logout clears sequence store");
    }
    if (kind === "revoked-session") await clearedLoginName(page);
    assert.deepEqual(pageErrors, [], "No unhandled page errors");
    assert.deepEqual(deniedRequests, [], "No external/unknown network attempts");
    assert.equal(await page.evaluate(() => window.__coreUiQA.operatorFlashes), 0, "No frame exposes operator UI before verified manager access");
    if (kind === "home") {
      assert.ok(state.callables.filter(call => call.name === "getCoreInstructorWorkspace")
        .every(call => call.path === `${base}private/`), "Home never requests lesson workspace before redirect");
    }
  } catch (error) {
    failure = error.message;
    console.error(`${name}: ${failure}`);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
      state = await telemetry(page).catch(() => undefined);
    }
  } finally {
    releaseBootstrap();
    try {
      if (retry === 1) await context.tracing.stop({ path: path.join(output, `${name}-trace.zip`) });
    } finally {
      await context.close().catch(error => {
        if (browser.isConnected() || context.pages().length) throw error;
      });
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
    "blocked-business", "blocked-members/detail", "blocked-rules", "manager", "manager-sequence", "owner", "revoked-session", "access-transient",
    "logged-out", "bootstrap-failure", "navigation", "manager-navigation"];
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
    for (const kind of ["signout-retry", "workspace-retry", "manager-name-safe", "instructor-name-safe",
      "manager-name-missing", "instructor-name-missing", "manager-auth-change", "instructor-auth-change",
      "manager-logout-failure", "manager-revoked-after-login", "instructor-bfcache", "manager-bfcache"]) {
      let result;
      for (let retry = 0; retry <= options.retries; retry++) {
        result = await attemptCase(base, viewports[1], kind, retry);
        if (!result.failure) break;
      }
      if (result.failure) report.failures.push({ name: result.name, message: result.failure });
    }
    for (const viewport of [viewports[1], viewports[3]]) {
      for (const kind of ["instructor-pending-logout", "instructor-pending-revocation", "manager-pending-logout", "manager-pending-revocation",
        "manager-current-refresh-downgrade", "instructor-destination-transient", "manager-destination-transient",
        "instructor-destination-timeout", "manager-destination-timeout"]) {
        let result;
        for (let retry = 0; retry <= options.retries; retry++) {
          result = await attemptCase(base, viewport, kind, retry);
          if (!result.failure) break;
        }
        if (result.failure) report.failures.push({ name: result.name, message: result.failure });
      }
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
