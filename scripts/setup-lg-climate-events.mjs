import fs from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import { randomUUID, X509Certificate, createPrivateKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIRECTORY = "/Users/archivepilates/ArchiveIN/secrets/lg";
const API = "https://api-kic.lgthinq.com";
const PUBLIC_API_KEY = "v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3";

export function mqttHost(route) {
  const value = route?.mqttServer;
  if (typeof value !== "string") throw new Error("mqtt_route_missing");
  const host = value.replace(/^mqtts:\/\//, "").replace(/:8883\/?$/, "");
  if (!/^[a-z0-9-]+\.iot\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) throw new Error("mqtt_route_not_allowed");
  return host;
}

export function issuedCertificate(response) {
  const result = response?.result;
  if (!result || typeof result.certificatePem !== "string" || !Array.isArray(result.subscriptions)
    || result.subscriptions.length < 1 || result.subscriptions.length > 4
    || result.subscriptions.some(topic => typeof topic !== "string" || !topic || topic.length > 512 || /[\x00-\x1f]/.test(topic))) {
    throw new Error("certificate_response_invalid");
  }
  const certificate = new X509Certificate(result.certificatePem);
  if (Date.parse(certificate.validTo) < Date.now() + 86_400_000) throw new Error("certificate_expiring");
  return { pem: result.certificatePem, subscriptions: result.subscriptions, expiresAt: new Date(certificate.validTo).toISOString() };
}

async function save(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await fs.chmod(file, 0o600);
}

export async function setupEvents(mode, { directory = DIRECTORY, fetchImpl = globalThis.fetch } = {}) {
  if (!["--prepare", "--apply"].includes(mode)) throw new Error("use_prepare_or_apply");
  process.umask(0o077);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const connection = JSON.parse(await fs.readFile(path.join(directory, "thinq-connection.json"), "utf8"));
  // MQTT has its own PAT; never rotate the production REST credential here.
  let eventPat;
  try { eventPat = JSON.parse(await fs.readFile(path.join(directory, "thinq-events-pat.json"), "utf8")).pat; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const pat = eventPat ?? connection.pat;
  if (!/^thinqpat_[A-Za-z0-9_-]{20,}$/.test(connection.pat) || connection.allowedDeviceIds?.length !== 8
    || new Set(connection.allowedDeviceIds).size !== 8
    || connection.allowedDeviceIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error("connection_invalid");
  if (!/^thinqpat_[A-Za-z0-9_-]{20,}$/.test(pat)) throw new Error("event_pat_invalid");
  const stateFile = path.join(directory, "thinq-events-registration.json");
  const configFile = path.join(directory, "thinq-events.json");
  let registration;
  try { registration = JSON.parse(await fs.readFile(stateFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!registration) {
    registration = { clientId: randomUUID(), status: "prepared", createdAt: new Date().toISOString() };
    await save(stateFile, registration);
  }
  if (!/^[a-f0-9-]{36}$/.test(registration.clientId)) throw new Error("client_id_invalid");
  const privateKeyPath = path.join(directory, "thinq-events-key.pem");
  const csrPath = path.join(directory, "thinq-events-csr.pem");
  const certificatePath = path.join(directory, "thinq-events-certificate.pem");
  const caPath = path.join(directory, "thinq-events-root-ca.pem");
  if (registration.status === "certificate_response_unknown") throw new Error("certificate_response_requires_review");
  if (registration.status === "registered") {
    await fs.access(configFile); await fs.access(privateKeyPath); await fs.access(certificatePath);
    return { ok: true, alreadyRegistered: true, clientIdPreserved: true, allowedDeviceCount: 8 };
  }
  let keyExists = false;
  try { await fs.access(privateKeyPath); keyExists = true; } catch {}
  if (!keyExists) {
    execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha512", "-subj", "/CN=lg_thinq", "-keyout", privateKeyPath, "-out", csrPath], { stdio: "pipe" });
    await fs.chmod(privateKeyPath, 0o600); await fs.chmod(csrPath, 0o600);
  }
  const root = tls.rootCertificates.find(pem => new X509Certificate(pem).subject.includes("CN=Amazon Root CA 1"));
  if (!root) throw new Error("trusted_amazon_root_missing");
  await fs.writeFile(caPath, root + "\n", { mode: 0o600 });
  if (mode === "--prepare") return { ok: true, prepared: true, registered: false, allowedDeviceCount: 8 };
  const request = async (endpoint, body) => {
    if (!["/route", "/client", "/client/certificate"].includes(endpoint)) throw new Error("endpoint_not_allowed");
    let response;
    try {
      response = await fetchImpl(API + endpoint, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(12_000),
        headers: { Authorization: `Bearer ${pat}`, "x-country": "KR", "x-client-id": registration.clientId,
          "x-service-phase": "OP", "x-api-key": PUBLIC_API_KEY,
          "x-message-id": Buffer.from(randomUUID().replaceAll("-", ""), "hex").toString("base64url"),
          ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new Error("lg_connection_failed"); }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 128_000) throw new Error("lg_response_oversized");
    let parsed; try { parsed = JSON.parse(raw); } catch { throw new Error("lg_response_invalid"); }
    if (!response.ok) {
      const code = String(parsed.error?.code ?? "");
      throw new Error(`lg_${endpoint === "/client" ? "client" : endpoint === "/route" ? "route" : "certificate"}_http_${response.status}${/^\d{4}$/.test(code) ? `_${code}` : ""}`);
    }
    if (!parsed.response || parsed.error) throw new Error("lg_response_invalid");
    return parsed.response;
  };
  const host = mqttHost(await request("/route"));
  await request("/client", { type: "MQTT", "service-code": "SVC202", "device-type": "607", allowExist: true });
  const csr = (await fs.readFile(csrPath, "utf8")).trim().split(/\r?\n/).slice(1, -1).join("");
  if (!/^[A-Za-z0-9+/=]+$/.test(csr)) throw new Error("csr_invalid");
  // A lost certificate response is reviewed, not blindly issued again on restart.
  registration.status = "certificate_response_unknown"; await save(stateFile, registration);
  const certificate = issuedCertificate(await request("/client/certificate", { "service-code": "SVC202", csr }));
  if (!new X509Certificate(certificate.pem).checkPrivateKey(createPrivateKey(await fs.readFile(privateKeyPath)))) throw new Error("certificate_key_mismatch");
  await fs.writeFile(certificatePath, certificate.pem, { mode: 0o600 });
  const config = { pat, clientId: registration.clientId, allowedDeviceIds: connection.allowedDeviceIds,
    mqttHost: host, subscriptions: certificate.subscriptions, certificatePath, privateKeyPath, caPath,
    firebaseCredentialPath: "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json" };
  await save(configFile, config);
  registration.status = "registered"; registration.registeredAt = new Date().toISOString(); registration.certificateExpiresAt = certificate.expiresAt;
  await save(stateFile, registration);
  return { ok: true, registered: true, allowedDeviceCount: 8, topicCount: config.subscriptions.length, certificateExpiresAt: certificate.expiresAt };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await setupEvents(process.argv[2]))); }
  catch (error) {
    const code = String(error?.message || "setup_failed");
    console.error(JSON.stringify({ ok: false, code: /^[a-z0-9_]+$/.test(code) ? code : "setup_failed" }));
    process.exitCode = 1;
  }
}
