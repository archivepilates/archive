import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../../firebase/kangsain-functions/functions/", import.meta.url);
const ts = createRequire(new URL("package.json", root))("typescript");
const compiled = new Map(["imwebOAuthApi", "imwebOAuthPolicy", "imwebWebhookProtocol"].map(name => [name,
  ts.transpileModule(readFileSync(new URL(`src/sync/${name}.ts`, root), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText,
]));
const NOW = Date.parse("2026-10-22T00:00:00Z");
const LANE = "workLanes/imweb-app-webhook-onboarding";
const SITE = "S20260516852c71a014d08";
const APP = "ga202609279410fb87e608a";
const CALLBACK = "https://asia-northeast3-archive-pilates.cloudfunctions.net/imwebOAuthApi/callback";
const GATE = `${LANE}/private/config`;
const ENVELOPE = `${LANE}/private/ownSiteTokenEnvelope`;
const COOKIE = "__Host-imweb-oauth-state";
const START_COOKIE = "__Host-imweb-oauth-start";
const CAPABILITY = "c".repeat(64);
const START_HEADER = `${START_COOKIE}=${CAPABILITY}`;
const STATE = "a".repeat(64);
const CODE = "synthetic-authorization-code-not-real";
const KEY = Buffer.alloc(32, 37).toString("base64");
const CONFIG = { clientId: "synthetic-client", clientSecret: "synthetic-client-secret-not-real", encryptionKey: KEY };
const TOKENS = { accessToken: "synthetic-access-token-not-real", refreshToken: "synthetic-refresh-token-not-real",
  scope: ["site-info:write", "member-info:write", "order:read", "member-info:read"] };
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const attemptPath = (state = STATE) => `${LANE}/oauthAttempts/${digest(state)}`;
const clone = value => value === undefined ? undefined : structuredClone(value);
const openGate = () => ({ oauthEnabledAtMs: NOW - 1_000, oauthEnabledUntilMs: NOW + 60_000,
  oauthStartCapabilitySha256: digest(CAPABILITY), oauthAttemptCount: 0, retained: "synthetic-gate-marker" });

function memoryFirestore(seed, options) {
  const store = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
  const reads = [], writes = [];
  let tail = Promise.resolve();
  const write = (next, item) => {
    if (item.method === "create") assert.ok(!next.has(item.path), "create cannot overwrite");
    if (item.method === "update") assert.ok(next.has(item.path), "update requires an existing document");
    if (options.failEnvelope && item.path === ENVELOPE) throw Error(options.errorMessage);
    next.set(item.path, item.merge || item.method === "update"
      ? { ...next.get(item.path), ...clone(item.data) } : clone(item.data));
  };
  const doc = path => {
    assert.equal(path.split("/").length % 2, 0);
    assert.ok(path.startsWith(`${LANE}/`), "all writes and reads stay in the provisional lane");
    return { path, id: path.split("/").at(-1),
      get: async () => {
        if (options.failRead) throw Error(options.errorMessage);
        reads.push(path);
        const data = clone(store.get(path));
        return { exists: data !== undefined, data: () => clone(data) };
      },
      set: async (data, settings) => {
        if (options.failReviewWrite) throw Error(options.errorMessage);
        const item = { method: "set", path, data: clone(data), merge: settings?.merge === true };
        write(store, item);
        writes.push(item);
      },
    };
  };
  const db = { doc, runTransaction(callback) {
    // Serialize atomic commits; aborted callbacks never publish their staged writes.
    const run = tail.then(async () => {
      if (options.failTransaction) throw Error(options.errorMessage);
      const staged = [];
      const result = await callback({
        get: async ref => {
          assert.equal(staged.length, 0, "transaction reads must precede writes");
          reads.push(ref.path);
          const data = clone(store.get(ref.path));
          return { id: ref.id, exists: data !== undefined, data: () => clone(data) };
        },
        create: (ref, data) => staged.push({ method: "create", path: ref.path, data: clone(data) }),
        update: (ref, data) => staged.push({ method: "update", path: ref.path, data: clone(data) }),
        set: (ref, data) => staged.push({ method: "set", path: ref.path, data: clone(data) }),
      });
      const next = new Map(store);
      for (const item of staged) write(next, item);
      store.clear();
      for (const entry of next) store.set(...entry);
      writes.push(...staged);
      return result;
    });
    tail = run.catch(() => undefined);
    return run;
  } };
  return { db, store, reads, writes };
}

function fixture(options = {}) {
  const seed = options.gate === null ? {} : { [GATE]: options.gate ?? openGate() };
  const memory = memoryFirestore({ ...seed, ...options.seed }, options);
  const fetchCalls = [], logs = [];
  let now = NOW;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const timeoutSignal = Object.freeze({ synthetic: "timeout-signal" });
  const context = vm.createContext({ Buffer, URL, URLSearchParams, TextDecoder, Date: FixedDate,
    AbortSignal: { timeout: ms => { assert.equal(ms, 20_000); return timeoutSignal; } },
    console: Object.fromEntries(["log", "info", "warn", "error", "debug"].map(level => [level,
      (...args) => logs.push({ level, args })])),
  });
  const realmJson = vm.runInContext("JSON.parse", context);
  const dependencies = {
    "node:crypto": crypto,
    "firebase-functions/params": { defineSecret: name => {
      assert.equal(name, "IMWEB_APP_OAUTH_CONNECTION");
      return { value: () => options.secretValue ?? JSON.stringify(CONFIG) };
    } },
    "firebase-functions/v2/https": { onRequest: (_settings, handler) => handler },
    "firebase-admin/firestore": { Timestamp: { now: () => ({ seconds: now / 1_000, nanoseconds: 0 }) } },
    "../config/firebase": { db: memory.db },
  };
  context.fetch = async (url, init) => {
    // No native fetch, SDK, process, environment or network capability enters the VM.
    fetchCalls.push({ url, init });
    if (options.exchange) return options.exchange(url, init, realmJson);
    return { ok: true, json: async () => realmJson(JSON.stringify({ statusCode: 200, data: TOKENS })) };
  };
  const loaded = new Map();
  function load(name) {
    if (loaded.has(name)) return loaded.get(name);
    const exports = {};
    loaded.set(name, exports);
    const require = id => {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      if (id.startsWith("./") && compiled.has(id.slice(2))) return load(id.slice(2));
      throw Error(`Unmocked dependency prohibited: ${id}`);
    };
    const execute = vm.runInContext(`(function (exports, require) {\n${compiled.get(name)}\n})`, context,
      { timeout: 1_000, filename: `${name}.test-runtime.cjs` });
    execute(exports, require);
    return exports;
  }
  // Keep real policy modules in the handler's realm for strict plain-object validation.
  dependencies["./imwebOAuthPolicy"] = load("imwebOAuthPolicy");
  dependencies["./imwebWebhookProtocol"] = load("imwebWebhookProtocol");
  const { imwebOAuthApi } = load("imwebOAuthApi");
  const invoke = async (request = {}) => {
    const res = { statusCode: 200, headers: {}, body: "", location: undefined,
      set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      type(value) { this.contentType = value; return this; },
      send(body) { this.body = body; return this; },
      redirect(code, location) { this.statusCode = code; this.location = location; return this; },
    };
    await imwebOAuthApi({ method: "GET", path: "/connect", query: {}, headers: { cookie: START_HEADER }, ...request }, res);
    return res;
  };
  return { ...memory, fetchCalls, logs, timeoutSignal, invoke, advanceTime: ms => { now += ms; } };
}

function callbackFixture(options = {}) {
  const gate = { ...openGate(), oauthCurrentAttemptHash: digest(STATE), ...options.gate };
  const attempt = { status: "pending", siteCode: SITE, expiresAtMs: NOW + 60_000, ...options.attempt };
  return fixture({ ...options, gate, seed: { [attemptPath()]: attempt, ...options.seed } });
}
const callback = (f, patch = {}) => f.invoke({ path: "/callback", query: { state: STATE, code: CODE },
  headers: { cookie: `${COOKIE}=${STATE}; ${START_HEADER}` }, ...patch });
const assertNoEffects = (f, before) => {
  assert.deepEqual(f.store, before);
  assert.equal(f.writes.length, 0);
  assert.equal(f.fetchCalls.length, 0);
};
function assertPrivate(f, res) {
  const visible = JSON.stringify({ body: res.body, headers: res.headers, location: res.location, logs: f.logs });
  for (const value of [CONFIG.clientSecret, KEY, TOKENS.accessToken, TOKENS.refreshToken, CODE]) {
    assert.equal(visible.includes(value), false, "no credentials in response or logs");
  }
  assert.deepEqual(f.logs, []);
  assert.equal(JSON.stringify({ body: res.body, location: res.location, logs: f.logs }).includes(CAPABILITY), false,
    "start capability only belongs in its secure cookie, not response content, redirects or logs");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["referrer-policy"], "no-referrer");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["content-security-policy"], "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
}

const invalidGates = [
  ["missing operator gate", null],
  ["no operator window", { oauthAttemptCount: 0 }],
  ["expired operator window", { ...openGate(), oauthEnabledUntilMs: NOW }],
  ["future operator window", { ...openGate(), oauthEnabledAtMs: NOW + 1 }],
  ["overlong operator window", { ...openGate(), oauthEnabledUntilMs: NOW + 20 * 60_000 }],
  ["nonfinite operator window", { ...openGate(), oauthEnabledUntilMs: Infinity }],
  ["missing attempt count", { ...openGate(), oauthAttemptCount: undefined }],
  ["negative attempt count", { ...openGate(), oauthAttemptCount: -1 }],
  ["fractional attempt count", { ...openGate(), oauthAttemptCount: 0.5 }],
  ["exhausted attempt count", { ...openGate(), oauthAttemptCount: 5 }],
];
for (const [name, gate] of invalidGates) test(`connect rejects ${name} without state or exchange`, async () => {
  const f = fixture({ gate });
  const before = clone(f.store);
  const res = await f.invoke();
  assert.equal(res.statusCode, 503);
  assert.equal(res.location, undefined);
  assert.equal(res.headers["set-cookie"], undefined);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

for (const path of ["/", "/connect"]) test(`${path} rejects a caller-supplied different fixed site`, async () => {
  const f = fixture();
  const before = clone(f.store);
  const res = await f.invoke({ path, query: { siteCode: "synthetic-other-site" } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body, "site_not_allowed");
  assert.equal(f.reads.length, 0);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

test("connect creates hashed expiring state, sets a secure cookie and redirects to the fixed site", async () => {
  const f = fixture();
  const res = await f.invoke({ query: { siteCode: SITE } });
  assert.equal(res.statusCode, 302);
  const url = new URL(res.location);
  const state = url.searchParams.get("state");
  assert.match(state, /^[a-f0-9]{64}$/);
  assert.equal(url.origin + url.pathname, "https://openapi.imweb.me/oauth2/authorize");
  assert.deepEqual(Object.fromEntries(url.searchParams), { responseType: "code", clientId: CONFIG.clientId,
    redirectUri: CALLBACK, scope: "site-info:write member-info:write order:read", state, siteCode: SITE });
  assert.equal(res.headers["set-cookie"], `${COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  assert.equal(f.store.get(GATE).oauthAttemptCount, 1);
  assert.equal(f.store.get(GATE).oauthCurrentAttemptHash, digest(state));
  assert.deepEqual(f.store.get(attemptPath(state)), { status: "pending", siteCode: SITE,
    createdAt: { seconds: NOW / 1_000, nanoseconds: 0 }, expiresAtMs: NOW + 600_000 });
  assert.equal(JSON.stringify([...f.store]).includes(state), false);
  assert.equal(f.fetchCalls.length, 0);
  assertPrivate(f, res);
});

test("start validates the capability, sets only its secure cookie and does not allocate an attempt", async () => {
  const f = fixture();
  const before = clone(f.store);
  const res = await f.invoke({ path: `/start/${CAPABILITY}`, headers: {} });
  assert.equal(res.statusCode, 302);
  assert.equal(res.location, "/imwebOAuthApi/connect");
  assert.equal(res.headers["set-cookie"], `${START_COOKIE}=${CAPABILITY}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1200`);
  assert.deepEqual(f.reads, [GATE]);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

test("start does not consume or reset an already exhausted attempt budget", async () => {
  const f = fixture({ gate: { ...openGate(), oauthAttemptCount: 5 } });
  const before = clone(f.store);
  assert.equal((await f.invoke({ path: `/start/${CAPABILITY}`, headers: {} })).statusCode, 302);
  assertNoEffects(f, before);
  assert.equal((await f.invoke()).statusCode, 503);
  assertNoEffects(f, before);
});

const invalidCapabilities = [
  ["empty", ""], ["short", "c".repeat(63)], ["long", "c".repeat(65)],
  ["nonhex", "g".repeat(64)], ["uppercase", "C".repeat(64)], ["wrong digest", "d".repeat(64)],
  ["padded", `${CAPABILITY} `], ["encoded", `%63${"c".repeat(63)}`],
  ["trailing path", `${CAPABILITY}/extra`],
];
for (const [name, capability] of invalidCapabilities) test(`start rejects ${name} capability without allocating`, async () => {
  const f = fixture();
  const before = clone(f.store);
  const res = await f.invoke({ path: `/start/${capability}`, headers: {} });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body, "operator_start_required");
  assert.equal(res.location, undefined);
  assert.equal(res.headers["set-cookie"], undefined);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

const invalidateGate = [
  ["deleted gate", f => f.store.delete(GATE)],
  ["revoked window", f => { f.store.get(GATE).oauthEnabledUntilMs = 0; }],
  ["expired window", f => { f.store.get(GATE).oauthEnabledUntilMs = NOW; }],
  ["missing window", f => { delete f.store.get(GATE).oauthEnabledUntilMs; }],
  ["future window", f => { f.store.get(GATE).oauthEnabledAtMs = NOW + 1; }],
  ["overlong window", f => { f.store.get(GATE).oauthEnabledUntilMs = NOW + 20 * 60_000; }],
  ["nonfinite window", f => { f.store.get(GATE).oauthEnabledUntilMs = Infinity; }],
  ["missing capability digest", f => { delete f.store.get(GATE).oauthStartCapabilitySha256; }],
  ["rotated capability digest", f => { f.store.get(GATE).oauthStartCapabilitySha256 = digest("d".repeat(64)); }],
  ["malformed capability digest", f => { f.store.get(GATE).oauthStartCapabilitySha256 = "synthetic-invalid-digest"; }],
  ["raw capability instead of digest", f => { f.store.get(GATE).oauthStartCapabilitySha256 = CAPABILITY; }],
];
for (const [name, invalidate] of invalidateGate) test(`start rejects ${name} without a cookie or allocation`, async () => {
  const f = fixture();
  invalidate(f);
  const before = clone(f.store);
  const res = await f.invoke({ path: `/start/${CAPABILITY}`, headers: {} });
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers["set-cookie"], undefined);
  assert.equal(res.location, undefined);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

const invalidStartCookies = [
  ["missing start cookie", ""],
  ["wrong start cookie name", `other=${CAPABILITY}`],
  ["wrong start capability", `${START_COOKIE}=${"d".repeat(64)}`],
  ["duplicate identical start cookies", `${START_HEADER}; ${START_HEADER}`],
  ["duplicate conflicting start cookies", `${START_HEADER}; ${START_COOKIE}=${"d".repeat(64)}`],
  ["short start capability", `${START_COOKIE}=${"c".repeat(63)}`],
  ["long start capability", `${START_COOKIE}=${"c".repeat(65)}`],
  ["nonhex start capability", `${START_COOKIE}=${"g".repeat(64)}`],
  ["uppercase start capability", `${START_COOKIE}=${"C".repeat(64)}`],
  ["encoded start capability", `${START_COOKIE}=%63${"c".repeat(63)}`],
];
for (const path of ["/", "/connect"]) {
  for (const [name, cookie] of invalidStartCookies) test(`${path} rejects ${name} without exhausting the budget`, async () => {
    const f = fixture({ gate: { ...openGate(), oauthAttemptCount: 4 } });
    const before = clone(f.store);
    for (let request = 0; request < 6; request++) {
      const res = await f.invoke({ path, headers: { cookie }, query: { capability: CAPABILITY } });
      assert.equal(res.statusCode, 503);
      assert.equal(res.location, undefined);
      assert.equal(res.headers["set-cookie"], undefined);
      assertNoEffects(f, before);
      assertPrivate(f, res);
    }
    assert.equal((await f.invoke({ path })).statusCode, 302, "remaining attempt is still usable with a valid cookie");
    assert.equal(f.store.get(GATE).oauthAttemptCount, 5);
    assert.equal([...f.store.keys()].filter(key => key.startsWith(`${LANE}/oauthAttempts/`)).length, 1);
    assert.equal(f.fetchCalls.length, 0);
  });
}

for (const [name, invalidate] of invalidateGate) test(`connect rejects ${name} despite a valid start cookie`, async () => {
  const f = fixture();
  invalidate(f);
  const before = clone(f.store);
  const res = await f.invoke();
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["set-cookie"], undefined);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

for (const [name, cookie] of invalidStartCookies) test(`callback rejects ${name} before token exchange`, async () => {
  const f = callbackFixture();
  const before = clone(f.store);
  const res = await callback(f, { headers: { cookie: `${COOKIE}=${STATE}; ${cookie}` } });
  assert.equal(res.statusCode, 409);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

for (const [name, invalidate] of invalidateGate) {
  test(`callback rejects ${name} before claiming or exchanging`, async () => {
    const f = callbackFixture();
    invalidate(f);
    const before = clone(f.store);
    const res = await callback(f);
    assert.equal(res.statusCode, 409);
    assert.equal(f.store.get(attemptPath()).status, "pending");
    assert.equal(f.store.has(ENVELOPE), false);
    assertNoEffects(f, before);
    assertPrivate(f, res);
  });

  test(`callback rejects ${name} during exchange without persisting an envelope`, async () => {
    let f;
    f = callbackFixture({ exchange: async (_url, _init, parse) => {
      assert.equal(f.store.get(attemptPath()).status, "exchange_intent");
      invalidate(f);
      return { ok: true, json: async () => parse(JSON.stringify({ statusCode: 200, data: TOKENS })) };
    } });
    const res = await callback(f);
    assert.equal(res.statusCode, 503);
    assert.equal(res.contentType, "html");
    assert.equal(f.fetchCalls.length, 1);
    assert.equal(f.store.get(attemptPath()).status, "exchange_result_review_required");
    assert.equal(f.store.has(ENVELOPE), false);
    assert.equal(f.writes.some(write => write.data.status === "token_received" || write.path === ENVELOPE), false);
    assertPrivate(f, res);
    const writes = f.writes.length;
    assert.equal((await callback(f)).statusCode, 409);
    assert.equal((await f.invoke()).statusCode, 503);
    assert.equal(f.writes.length, writes);
    assert.equal(f.fetchCalls.length, 1);
  });
}

for (const duringExchange of [false, true]) test(`clock-driven gate expiry ${duringExchange ? "during" : "before"} exchange is rejected`, async () => {
  let f;
  f = callbackFixture({ exchange: async (_url, _init, parse) => {
    f.advanceTime(60_000);
    return { ok: true, json: async () => parse(JSON.stringify({ statusCode: 200, data: TOKENS })) };
  } });
  // Keep the attempt valid so only the operator gate can trigger this rejection.
  f.store.get(attemptPath()).expiresAtMs = NOW + 600_000;
  if (!duringExchange) f.advanceTime(60_000);
  const before = clone(f.store);
  const res = await callback(f);
  assert.equal(res.statusCode, duringExchange ? 503 : 409);
  assert.equal(f.fetchCalls.length, duringExchange ? 1 : 0);
  assert.equal(f.store.has(ENVELOPE), false);
  assert.equal(f.store.get(attemptPath()).status, duringExchange ? "exchange_result_review_required" : "pending");
  if (!duringExchange) assertNoEffects(f, before);
  assertPrivate(f, res);
});

test("start datastore failure is generic and does not allocate or expose the capability", async () => {
  const f = fixture({ failRead: true, errorMessage: [CONFIG.clientSecret, CAPABILITY, KEY].join(":") });
  const before = clone(f.store);
  const res = await f.invoke({ path: `/start/${CAPABILITY}`, headers: {} });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body, "operator_start_unavailable");
  assert.equal(res.headers["set-cookie"], undefined);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

const invalidCallbacks = [
  ["missing cookie", { headers: {} }],
  ["wrong cookie name", { headers: { cookie: `other=${STATE}` } }],
  ["duplicate state cookies", { headers: { cookie: `${COOKIE}=${STATE}; ${COOKIE}=${STATE}` } }],
  ["mismatched cookie", { headers: { cookie: `${COOKIE}=${"b".repeat(64)}` } }],
  ["malformed cookie", { headers: { cookie: `${COOKIE}=bad` } }],
  ["missing state", { query: { code: CODE } }],
  ["array state", { query: { state: [STATE], code: CODE } }],
  ["malformed state", { query: { state: "g".repeat(64), code: CODE } }],
  ["missing code", { query: { state: STATE } }],
  ["array code", { query: { state: STATE, code: [CODE] } }],
  ["empty code", { query: { state: STATE, code: "" } }],
  ["oversized code", { query: { state: STATE, code: "x".repeat(4097) } }],
  ["whitespace code", { query: { state: STATE, code: "synthetic code" } }],
  ["control-character code", { query: { state: STATE, code: "synthetic\u0000code" } }],
];
for (const [name, patch] of invalidCallbacks) test(`callback rejects ${name} before claiming an attempt`, async () => {
  const f = callbackFixture();
  const before = clone(f.store);
  const res = await callback(f, patch);
  assert.equal(res.statusCode, 400);
  assert.equal(f.reads.length, 0);
  assert.equal(res.headers["set-cookie"], undefined);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

for (const [name, options] of [
  ["expiry boundary", { attempt: { expiresAtMs: NOW } }],
  ["past expiry", { attempt: { expiresAtMs: NOW - 1 } }],
  ["invalid expiry", { attempt: { expiresAtMs: "future" } }],
  ["current-attempt mismatch", { gate: { oauthCurrentAttemptHash: digest("b".repeat(64)) } }],
  ["missing current attempt", { gate: { oauthCurrentAttemptHash: undefined } }],
  ["wrong attempt site", { attempt: { siteCode: "synthetic-other-site" } }],
  ["already completed", { attempt: { status: "token_received" } }],
  ["already claimed", { attempt: { status: "exchange_intent" } }],
]) test(`callback rejects ${name} without an exchange`, async () => {
  const f = callbackFixture(options);
  const before = clone(f.store);
  const res = await callback(f);
  assert.equal(res.statusCode, 409);
  assert.equal(res.headers["set-cookie"], `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

test("callback rejects a missing attempt without an exchange", async () => {
  const f = callbackFixture();
  f.store.delete(attemptPath());
  const before = clone(f.store);
  assert.equal((await callback(f)).statusCode, 409);
  assertNoEffects(f, before);
});

test("successful callback persists a decryptable encrypted envelope and closes the operator window", async () => {
  const f = fixture();
  const start = await f.invoke({ path: `/start/${CAPABILITY}`, headers: {} });
  assert.equal(start.statusCode, 302);
  const startCookie = start.headers["set-cookie"].split(";")[0];
  const connect = await f.invoke({ headers: { cookie: startCookie } });
  const state = new URL(connect.location).searchParams.get("state");
  const res = await callback(f, { query: { state, code: CODE },
    headers: { cookie: `unrelated=synthetic; ${COOKIE}=${state}; ${startCookie}; other=synthetic` } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.contentType, "html");
  assert.equal(f.fetchCalls.length, 1);
  const { url, init } = f.fetchCalls[0];
  assert.equal(url, "https://openapi.imweb.me/oauth2/token");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.deepEqual({ ...init.headers }, { "Content-Type": "application/x-www-form-urlencoded" });
  assert.deepEqual(Object.fromEntries(init.body), { grantType: "authorization_code", clientId: CONFIG.clientId,
    clientSecret: CONFIG.clientSecret, redirectUri: CALLBACK, code: CODE });
  assert.equal(init.signal, f.timeoutSignal);
  const stored = f.store.get(ENVELOPE);
  assert.deepEqual(Object.keys(stored).sort(), ["version", "algorithm", "iv", "authTag", "ciphertext", "siteCode",
    "scopes", "tokenReceivedAt", "sourceAttempt", "authority", "integrationVerified"].sort());
  assert.equal(stored.version, 1);
  assert.equal(stored.algorithm, "aes-256-gcm");
  assert.equal(Buffer.from(stored.iv, "base64").length, 12);
  assert.equal(Buffer.from(stored.authTag, "base64").length, 16);
  assert.equal(stored.siteCode, SITE);
  assert.equal(stored.sourceAttempt, digest(state));
  assert.equal(stored.authority, "oauth_token_only");
  assert.equal(stored.integrationVerified, false);
  assert.deepEqual(stored.scopes, [...TOKENS.scope].sort());
  assert.deepEqual(stored.tokenReceivedAt, { seconds: NOW / 1_000, nanoseconds: 0 });
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(KEY, "base64"), Buffer.from(stored.iv, "base64"));
  decipher.setAAD(Buffer.from(JSON.stringify([SITE, APP])));
  decipher.setAuthTag(Buffer.from(stored.authTag, "base64"));
  const decrypted = JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, "base64")), decipher.final()]).toString());
  assert.deepEqual(decrypted, { ...TOKENS, scope: [...TOKENS.scope].sort() });
  const persisted = JSON.stringify([...f.store]);
  for (const value of [TOKENS.accessToken, TOKENS.refreshToken, CONFIG.clientSecret, KEY, CODE, state, CAPABILITY]) {
    assert.equal(persisted.includes(value), false);
  }
  assert.deepEqual(f.store.get(GATE), { ...openGate(), oauthAttemptCount: 1,
    oauthCurrentAttemptHash: digest(state), oauthEnabledUntilMs: 0 });
  assert.equal(f.store.get(attemptPath(state)).status, "token_received");
  assert.deepEqual(f.store.get(attemptPath(state)).scopes, [...TOKENS.scope].sort());
  assert.equal(res.headers["set-cookie"], `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  assertPrivate(f, res);
  const writeCount = f.writes.length;
  assert.equal((await f.invoke()).statusCode, 503, "success does not leave authorization enabled");
  assert.equal(f.writes.length, writeCount);
  assert.equal(f.fetchCalls.length, 1);
});

test("overlapping and replayed callbacks perform exactly one token exchange", async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const continueExchange = new Promise(resolve => { release = resolve; });
  const f = callbackFixture({ exchange: async (_url, _init, parse) => {
    entered();
    await continueExchange;
    return { ok: true, json: async () => parse(JSON.stringify({ statusCode: 200, data: TOKENS })) };
  } });
  const first = callback(f);
  try {
    await started;
    assert.equal(f.store.get(attemptPath()).status, "exchange_intent");
    const writes = f.writes.length;
    const duplicate = await callback(f);
    assert.equal(duplicate.statusCode, 409);
    assert.equal(f.writes.length, writes);
    assert.equal(f.fetchCalls.length, 1);
    assertPrivate(f, duplicate);
  } finally {
    release();
    await first;
  }
  assert.equal((await first).statusCode, 200);
  const before = clone(f.store);
  assert.equal((await callback(f)).statusCode, 409);
  assert.deepEqual(f.store, before);
  assert.equal(f.fetchCalls.length, 1);
  assert.equal(f.writes.filter(write => write.path === ENVELOPE).length, 1);
});

const privateError = ["synthetic-internal-error", CONFIG.clientSecret, KEY, TOKENS.accessToken, TOKENS.refreshToken, CODE].join(":");
for (const [name, exchange] of [
  ["network exception", async () => { throw Error(privateError); }],
  ["non-OK exchange", async () => ({ ok: false, json: async () => { throw Error(privateError); } })],
  ["invalid JSON", async () => ({ ok: true, json: async () => { throw Error(privateError); } })],
  ["invalid token response", async (_url, _init, parse) => ({ ok: true,
    json: async () => parse(JSON.stringify({ statusCode: 200, data: { ...TOKENS, scope: ["payment:write"] } })) })],
]) test(`${name} marks unknown exchange result and blocks replay and new authorization`, async () => {
  const f = callbackFixture({ exchange });
  const res = await callback(f);
  assert.equal(res.statusCode, 503);
  assert.equal(f.store.get(attemptPath()).status, "exchange_result_review_required");
  assert.equal(f.store.has(ENVELOPE), false);
  assert.equal(f.fetchCalls.length, 1);
  assertPrivate(f, res);
  assert.equal(res.body.includes("synthetic-internal-error"), false);
  const before = clone(f.store), writes = f.writes.length;
  assert.equal((await callback(f)).statusCode, 409);
  assert.equal((await f.invoke()).statusCode, 503);
  assert.deepEqual(f.store, before);
  assert.equal(f.writes.length, writes);
  assert.equal(f.fetchCalls.length, 1);
});

test("an in-flight exchange blocks new authorization even before its result is known", async () => {
  const f = callbackFixture({ attempt: { status: "exchange_intent" } });
  const before = clone(f.store);
  assert.equal((await f.invoke()).statusCode, 503);
  assertNoEffects(f, before);
});

test("envelope persistence failure rolls back completion, marks review and prevents new authorization", async () => {
  const f = callbackFixture({ failEnvelope: true, errorMessage: privateError });
  const res = await callback(f);
  assert.equal(res.statusCode, 503);
  assert.equal(f.store.has(ENVELOPE), false);
  assert.equal(f.store.get(attemptPath()).status, "exchange_result_review_required");
  assert.equal(f.store.get(GATE).oauthEnabledUntilMs, NOW + 60_000);
  assert.equal(f.writes.some(write => write.data.status === "token_received"), false);
  assert.equal((await f.invoke()).statusCode, 503);
  assert.equal(f.fetchCalls.length, 1);
  assertPrivate(f, res);
});

test("current-attempt change during exchange prevents envelope storage and window closure", async () => {
  let f;
  f = callbackFixture({ exchange: async (_url, _init, parse) => {
    f.store.get(GATE).oauthCurrentAttemptHash = digest("b".repeat(64));
    return { ok: true, json: async () => parse(JSON.stringify({ statusCode: 200, data: TOKENS })) };
  } });
  const res = await callback(f);
  assert.equal(res.statusCode, 503);
  assert.equal(f.store.has(ENVELOPE), false);
  assert.equal(f.store.get(attemptPath()).status, "exchange_result_review_required");
  assert.equal(f.store.get(GATE).oauthEnabledUntilMs, NOW + 60_000);
  assert.equal(f.fetchCalls.length, 1);
  assertPrivate(f, res);
});

test("failed review-marker write retains exchange_intent and still blocks fresh authorization", async () => {
  const f = callbackFixture({ failReviewWrite: true, errorMessage: privateError,
    exchange: async () => { throw Error(privateError); } });
  const res = await callback(f);
  assert.equal(res.statusCode, 503);
  assert.equal(f.store.get(attemptPath()).status, "exchange_intent");
  assert.equal(f.store.has(ENVELOPE), false);
  assert.equal((await f.invoke()).statusCode, 503);
  assert.equal(f.fetchCalls.length, 1);
  assertPrivate(f, res);
});

for (const secretValue of ["synthetic-invalid-json", JSON.stringify({ ...CONFIG, encryptionKey: "synthetic-invalid-key" })]) {
  test("invalid synthetic secret configuration produces a generic error without credentials", async () => {
    const f = fixture({ secretValue });
    const before = clone(f.store);
    const res = await f.invoke();
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.includes(secretValue), false);
    assert.equal(f.reads.length, 0);
    assertNoEffects(f, before);
    assertPrivate(f, res);
  });
}

for (const path of ["/connect", "/callback"]) test(`${path} masks datastore errors before claim without exchange`, async () => {
  const f = callbackFixture({ failTransaction: true, errorMessage: privateError });
  const before = clone(f.store);
  const res = path === "/callback" ? await callback(f) : await f.invoke();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.includes("synthetic-internal-error"), false);
  assertNoEffects(f, before);
  assertPrivate(f, res);
});

test("non-GET methods and unknown paths do not mutate state or exchange credentials", async () => {
  const f = fixture();
  const before = clone(f.store);
  const method = await f.invoke({ method: "POST" });
  assert.equal(method.statusCode, 405);
  assert.equal(method.body, "method_not_allowed");
  const path = await f.invoke({ path: "/synthetic-unknown" });
  assert.equal(path.statusCode, 404);
  assert.equal(path.body, "not_found");
  assertNoEffects(f, before);
  assertPrivate(f, method);
  assertPrivate(f, path);
});
