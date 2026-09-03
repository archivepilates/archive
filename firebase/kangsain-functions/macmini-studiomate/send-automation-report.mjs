#!/usr/bin/env node
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";

const REPORT_LABEL = process.env.AUTOMATION_REPORT_LABEL || "자동화 완료보고";
const FROM = process.env.AUTOMATION_REPORT_FROM || "home@archivepilates.com";
const TO = process.env.AUTOMATION_REPORT_TO || "home@archivepilates.com";
const SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
  "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json";
const subject = process.env.AUTOMATION_REPORT_SUBJECT;
const body = process.env.AUTOMATION_REPORT_BODY;

if (!subject || !body) throw new Error("AUTOMATION_REPORT_SUBJECT and AUTOMATION_REPORT_BODY are required.");

const accessToken = await getServiceAccountAccessToken();
const labelId = await ensureLabel(REPORT_LABEL);
const message = [
  `From: ${FROM}`,
  `To: ${TO}`,
  `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=UTF-8",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from(body, "utf8").toString("base64"),
].join("\r\n");

const sent = await gmailFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
  method: "POST",
  body: JSON.stringify({ raw: base64Url(message) }),
});

if (labelId && sent.id) {
  await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${sent.id}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

console.log(JSON.stringify({ ok: true, messageId: sent.id, threadId: sent.threadId, label: REPORT_LABEL }, null, 2));

async function getServiceAccountAccessToken() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) throw new Error(`Missing service account key at ${SERVICE_ACCOUNT_PATH}`);
  const key = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    iss: key.client_email,
    scope: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.modify"].join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
    sub: FROM,
  }, key.private_key);
  const data = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!data.access_token) throw new Error("Google OAuth token response did not include access_token.");
  return data.access_token;
}

function signJwt(payload, privateKey) {
  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

async function gmailFetch(url, options = {}) {
  return fetchJson(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error?.message || `Gmail API ${response.status}`);
  return data;
}

async function ensureLabel(labelName) {
  const labels = await gmailFetch("https://gmail.googleapis.com/gmail/v1/users/me/labels");
  const existing = (labels.labels || []).find((label) => label.name === labelName);
  if (existing?.id) return existing.id;
  const created = await gmailFetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    body: JSON.stringify({ name: labelName, labelListVisibility: "labelShow", messageListVisibility: "show" }),
  });
  return created.id;
}

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
