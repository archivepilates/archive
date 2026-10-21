import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID, X509Certificate, createPrivateKey } from "node:crypto";
import { mqttHost, issuedCertificate, setupEvents } from "../setup-lg-climate-events.mjs";

const HOST = "synthetic-device.iot.ap-northeast-2.amazonaws.com";
const REST_PAT = `thinqpat_${"synthetic_rest_".repeat(3)}`;
const EVENTS_PAT = `thinqpat_${"synthetic_events_".repeat(3)}`;
const TOPICS = ["synthetic/events/device", "synthetic/events/connection"];
const originalFetch = globalThis.fetch;
const files = {
  connection: "thinq-connection.json", eventPat: "thinq-events-pat.json",
  registration: "thinq-events-registration.json", config: "thinq-events.json",
  key: "thinq-events-key.pem", csr: "thinq-events-csr.pem",
  certificate: "thinq-events-certificate.pem", ca: "thinq-events-root-ca.pem",
};
let certificateDirectory, unrelatedCertificate, expiringCertificate;

function openssl(args) { execFileSync("openssl", args, { stdio: "pipe" }); }
async function json(file) { return JSON.parse(await fs.readFile(file, "utf8")); }
async function absent(file) { await assert.rejects(() => fs.access(file), { code: "ENOENT" }); }
async function privateFile(file) { assert.equal((await fs.stat(file)).mode & 0o777, 0o600, path.basename(file)); }
const response = value => new Response(JSON.stringify({ response: value }), { status: 200 });

before(async () => {
  globalThis.fetch = async () => { throw new Error("unmocked_network_forbidden"); };
  certificateDirectory = await fs.mkdtemp(path.join(tmpdir(), "climate-events-certs-"));
  const key = path.join(certificateDirectory, "throwaway-key.pem");
  const cert = path.join(certificateDirectory, "throwaway-certificate.pem");
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3",
    "-subj", "/CN=synthetic-events-test", "-keyout", key, "-out", cert]);
  unrelatedCertificate = await fs.readFile(cert, "utf8");
  const expiring = path.join(certificateDirectory, "expiring-certificate.pem");
  openssl(["req", "-x509", "-key", key, "-sha256", "-days", "1",
    "-subj", "/CN=synthetic-expiring-test", "-out", expiring]);
  expiringCertificate = await fs.readFile(expiring, "utf8");
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (certificateDirectory) await fs.rm(certificateDirectory, { recursive: true, force: true });
});

async function withFixture(run) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "climate-events-setup-"));
  const umask = process.umask();
  const file = name => path.join(directory, files[name]);
  const connection = { pat: REST_PAT, clientId: randomUUID(), controlsEnabled: true,
    allowedDeviceIds: Array.from({ length: 8 }, (_, index) => `synthetic-device-${index}`) };
  const original = JSON.stringify(connection, null, 2) + "\n";
  try {
    await fs.writeFile(file("connection"), original, { mode: 0o600 });
    await run({ directory, file, connection, original });
    assert.equal(await fs.readFile(file("connection"), "utf8"), original, "production REST configuration analogue stays byte-for-byte unchanged");
  } finally {
    process.umask(umask);
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function fixtureHttp(fixture, override = async () => undefined) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api-kic.lgthinq.com", "direct Korean API only");
    assert.ok(["/route", "/client", "/client/certificate"].includes(parsed.pathname), "registration endpoint allowlist");
    assert.equal(parsed.search, ""); assert.equal(parsed.hash, "");
    assert.equal(options.method, parsed.pathname === "/route" ? "GET" : "POST");
    assert.equal(options.redirect, "error"); assert.equal(options.headers["x-country"], "KR");
    assert.equal(options.headers["x-service-phase"], "OP");
    assert.ok(options.signal instanceof AbortSignal);
    assert.match(options.headers["x-message-id"], /^[A-Za-z0-9_-]{22}$/);
    const call = { endpoint: parsed.pathname, options, body: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    const replaced = await override(call);
    if (replaced !== undefined) return replaced;
    if (parsed.pathname === "/route") return response({ mqttServer: `mqtts://${HOST}:8883` });
    if (parsed.pathname === "/client") return response({});
    const issued = path.join(fixture.directory, "synthetic-issued-certificate.pem");
    openssl(["x509", "-req", "-in", fixture.file("csr"), "-signkey", fixture.file("key"),
      "-sha256", "-days", "3", "-out", issued]);
    return response({ result: { certificatePem: await fs.readFile(issued, "utf8"), subscriptions: TOPICS } });
  };
  return { calls, fetchImpl };
}

test("MQTT route allows only bare or mqtts AWS IoT hosts with the expected TLS port", () => {
  for (const value of [HOST, `mqtts://${HOST}`, `${HOST}:8883`, `mqtts://${HOST}:8883/`]) {
    assert.equal(mqttHost({ mqttServer: value }), HOST);
  }
  for (const route of [undefined, {}, { mqttServer: null }, { mqttServer: 1 }]) {
    assert.throws(() => mqttHost(route), /mqtt_route_missing/);
  }
  for (const value of ["", "localhost", "127.0.0.1", "evil.invalid", `https://${HOST}`, `mqtt://${HOST}:8883`,
    `${HOST}:443`, `${HOST}/topic`, `user@${HOST}`, `${HOST}.evil.invalid`, `${HOST}\n`, `MQTTS://${HOST}`]) {
    assert.throws(() => mqttHost({ mqttServer: value }), /mqtt_route_not_allowed/);
  }
});

test("issued certificate requires the documented envelope, valid PEM, bounded topics and over one day of validity", () => {
  const certificate = issuedCertificate({ result: { certificatePem: unrelatedCertificate, subscriptions: TOPICS } });
  assert.equal(certificate.pem, unrelatedCertificate); assert.deepEqual(certificate.subscriptions, TOPICS);
  assert.equal(certificate.expiresAt, new Date(new X509Certificate(unrelatedCertificate).validTo).toISOString());
  for (const value of [undefined, {}, { certificatePem: unrelatedCertificate, subscriptions: TOPICS }, { result: {} },
    ...[null, "topic", [], Array(5).fill("topic"), [1], [null], [""], ["bad\ntopic"], ["bad\u0000topic"], ["x".repeat(513)]]
      .map(subscriptions => ({ result: { certificatePem: unrelatedCertificate, subscriptions } }))]) {
    assert.throws(() => issuedCertificate(value), /certificate_response_invalid/);
  }
  assert.throws(() => issuedCertificate({ result: { certificatePem: "not-a-certificate", subscriptions: TOPICS } }));
  assert.throws(() => issuedCertificate({ result: { certificatePem: expiringCertificate, subscriptions: TOPICS } }), /certificate_expiring/);
});

test("prepare is offline, idempotent, uses a separate UUID and writes only private setup files", () => withFixture(async fixture => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("Synthetic prepare must never use HTTP"); };
  const options = { directory: fixture.directory, fetchImpl };
  assert.deepEqual(await setupEvents("--prepare", options), { ok: true, prepared: true, registered: false, allowedDeviceCount: 8 });
  const registration = await json(fixture.file("registration"));
  assert.match(registration.clientId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(registration.clientId, fixture.connection.clientId); assert.equal(registration.status, "prepared");
  const before = await Promise.all(["registration", "key", "csr", "ca"].map(name => fs.readFile(fixture.file(name), "utf8")));
  await setupEvents("--prepare", options);
  assert.deepEqual(await Promise.all(["registration", "key", "csr", "ca"].map(name => fs.readFile(fixture.file(name), "utf8"))), before);
  for (const name of ["connection", "registration", "key", "csr", "ca"]) await privateFile(fixture.file(name));
  assert.equal((await fs.stat(fixture.directory)).mode & 0o777, 0o700);
  await absent(fixture.file("config")); await absent(fixture.file("certificate")); assert.equal(calls, 0);
}));

for (const separatePat of [false, true]) test(`${separatePat ? "dedicated events PAT overrides REST PAT" : "REST PAT fallback"}; successful setup is private and idempotent without extra calls`, () => withFixture(async fixture => {
  if (separatePat) await fs.writeFile(fixture.file("eventPat"), JSON.stringify({ pat: EVENTS_PAT }), { mode: 0o600 });
  const { calls, fetchImpl } = fixtureHttp(fixture);
  const options = { directory: fixture.directory, fetchImpl };
  const result = await setupEvents("--apply", options);
  assert.equal(result.ok, true); assert.equal(result.registered, true); assert.equal(result.allowedDeviceCount, 8); assert.equal(result.topicCount, 2);
  assert.deepEqual(calls.map(call => call.endpoint), ["/route", "/client", "/client/certificate"]);
  const registration = await json(fixture.file("registration")), config = await json(fixture.file("config"));
  const pat = separatePat ? EVENTS_PAT : REST_PAT;
  assert.ok(calls.every(call => call.options.headers.Authorization === `Bearer ${pat}`));
  assert.ok(calls.every(call => call.options.headers["x-client-id"] === registration.clientId));
  assert.equal(new Set(calls.map(call => call.options.headers["x-message-id"])).size, 3);
  assert.deepEqual(calls[1].body, { type: "MQTT", "service-code": "SVC202", "device-type": "607", allowExist: true });
  assert.equal(calls[2].body["service-code"], "SVC202"); assert.match(calls[2].body.csr, /^[A-Za-z0-9+/=]+$/);
  const csr = (await fs.readFile(fixture.file("csr"), "utf8")).trim().split(/\r?\n/).slice(1, -1).join("");
  assert.equal(calls[2].body.csr, csr);
  assert.notEqual(registration.clientId, fixture.connection.clientId); assert.equal(config.clientId, registration.clientId);
  assert.equal(config.pat, pat); assert.equal(config.mqttHost, HOST); assert.deepEqual(config.subscriptions, TOPICS);
  assert.deepEqual(config.allowedDeviceIds, fixture.connection.allowedDeviceIds);
  assert.equal(config.privateKeyPath, fixture.file("key")); assert.equal(config.certificatePath, fixture.file("certificate"));
  assert.equal(config.caPath, fixture.file("ca")); assert.equal(registration.status, "registered");
  assert.equal(registration.certificateExpiresAt, result.certificateExpiresAt);
  const certificate = new X509Certificate(await fs.readFile(fixture.file("certificate")));
  assert.equal(certificate.checkPrivateKey(createPrivateKey(await fs.readFile(fixture.file("key")))), true);
  for (const name of ["connection", "registration", "config", "key", "csr", "certificate", "ca"]) await privateFile(fixture.file(name));
  if (separatePat) await privateFile(fixture.file("eventPat"));
  const saved = await Promise.all(["registration", "config", "key", "csr", "certificate"].map(name => fs.readFile(fixture.file(name), "utf8")));
  assert.deepEqual(await setupEvents("--apply", options), { ok: true, alreadyRegistered: true, clientIdPreserved: true, allowedDeviceCount: 8 });
  await setupEvents("--prepare", options);
  assert.equal(calls.length, 3);
  assert.deepEqual(await Promise.all(["registration", "config", "key", "csr", "certificate"].map(name => fs.readFile(fixture.file(name), "utf8"))), saved);
}));

for (const endpoint of ["/route", "/client", "/client/certificate"]) test(`${endpoint} 401/1309 exposes only the sanitized operational code`, () => withFixture(async fixture => {
  const { calls, fetchImpl } = fixtureHttp(fixture, async call => call.endpoint === endpoint
    ? new Response(JSON.stringify({ error: { code: "1309", message: `SYNTHETIC_PRIVATE_ERROR ${REST_PAT}` } }), { status: 401 }) : undefined);
  const expected = `lg_${endpoint === "/route" ? "route" : endpoint === "/client" ? "client" : "certificate"}_http_401_1309`;
  await assert.rejects(() => setupEvents("--apply", { directory: fixture.directory, fetchImpl }), error => {
    assert.equal(error.message, expected); assert.doesNotMatch(error.stack, /SYNTHETIC_PRIVATE_ERROR|thinqpat_/); return true;
  });
  assert.equal(calls.at(-1).endpoint, endpoint);
  await absent(fixture.file("config")); await absent(fixture.file("certificate"));
  assert.equal((await json(fixture.file("registration"))).status, endpoint === "/client/certificate" ? "certificate_response_unknown" : "prepared");
}));

test("non-numeric provider error codes and transport errors cannot echo PATs", () => withFixture(async fixture => {
  const first = fixtureHttp(fixture, async () => new Response(JSON.stringify({ error: { code: REST_PAT, message: REST_PAT } }), { status: 401 }));
  await assert.rejects(() => setupEvents("--apply", { directory: fixture.directory, fetchImpl: first.fetchImpl }), { message: "lg_route_http_401" });
  const second = fixtureHttp(fixture, async () => { throw new Error(`SYNTHETIC_PRIVATE_ERROR ${REST_PAT}`); });
  await assert.rejects(() => setupEvents("--apply", { directory: fixture.directory, fetchImpl: second.fetchImpl }), { message: "lg_connection_failed" });
  await absent(fixture.file("config"));
}));

for (const failure of ["lost", "invalid"]) test(`${failure} certificate response persists uncertainty and blocks issuance on rerun`, () => withFixture(async fixture => {
  const { calls, fetchImpl } = fixtureHttp(fixture, async call => {
    if (call.endpoint !== "/client/certificate") return;
    assert.equal((await json(fixture.file("registration"))).status, "certificate_response_unknown", "uncertainty saved before issuance");
    if (failure === "lost") throw new Error("SYNTHETIC_PRIVATE_RESPONSE_LOST");
    return response({ unexpectedCertificate: unrelatedCertificate });
  });
  const options = { directory: fixture.directory, fetchImpl };
  await assert.rejects(() => setupEvents("--apply", options), { message: failure === "lost" ? "lg_connection_failed" : "certificate_response_invalid" });
  const saved = await fs.readFile(fixture.file("registration"), "utf8");
  assert.equal(JSON.parse(saved).status, "certificate_response_unknown");
  for (const mode of ["--apply", "--prepare"]) {
    await assert.rejects(() => setupEvents(mode, options), { message: "certificate_response_requires_review" });
  }
  assert.equal(calls.length, 3); assert.equal(await fs.readFile(fixture.file("registration"), "utf8"), saved);
  await absent(fixture.file("config")); await absent(fixture.file("certificate"));
}));

test("certificate/key mismatch is never activated and cannot trigger automatic reissuance", () => withFixture(async fixture => {
  const { calls, fetchImpl } = fixtureHttp(fixture, async call => call.endpoint === "/client/certificate"
    ? response({ result: { certificatePem: unrelatedCertificate, subscriptions: TOPICS } }) : undefined);
  const options = { directory: fixture.directory, fetchImpl };
  await setupEvents("--prepare", options);
  const key = await fs.readFile(fixture.file("key"), "utf8");
  await assert.rejects(() => setupEvents("--apply", options), { message: "certificate_key_mismatch" });
  assert.equal((await json(fixture.file("registration"))).status, "certificate_response_unknown");
  assert.equal(await fs.readFile(fixture.file("key"), "utf8"), key);
  await absent(fixture.file("config")); await absent(fixture.file("certificate"));
  await assert.rejects(() => setupEvents("--apply", options), { message: "certificate_response_requires_review" });
  assert.equal(calls.length, 3);
}));
