import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export const EXPORT_SHEET_NAME = "대시보드_EXPORT";

export function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      parsed[key] = rest.join("=");
    } else if (arg.startsWith("--")) {
      parsed[arg.slice(2)] = true;
    }
  }
  return parsed;
}

export function monthKey(value) {
  const text = String(value || "").trim();
  const monthOnly = text.match(/^(20\d{2})[-./년\s]+(\d{1,2})\s*월?$/);
  if (monthOnly) return `${monthOnly[1]}-${monthOnly[2].padStart(2, "0")}`;
  const date = dateKey(text);
  return date ? date.slice(0, 7) : text;
}

export function dateKey(value) {
  if (value == null || value === "") return "";
  const text = String(value).trim();
  const matched = text.match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  return matched ? `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}` : "";
}

export function stringValue(value) {
  return value == null ? "" : String(value).trim();
}

export function amount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const numeric = Number(String(value ?? "").replace(/[,\s원%]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

export function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function sheetRowsToObjects(values) {
  const [headers, ...rows] = values || [];
  return rows
    .filter((row) => row.some((cell) => cell !== "" && cell != null))
    .map((row) =>
      Object.fromEntries((headers || []).map((header, index) => [String(header || `col${index + 1}`), row[index] ?? ""])),
    );
}

export function dashboardDataToExportRows({ data, sourceSpreadsheetId, sourceSpreadsheetName, generatedAt }) {
  const headers = ["section", "month", "key", "payloadJson", "sourceSpreadsheetId", "sourceSpreadsheetName", "generatedAt"];
  const rows = [headers];
  const sections = ["summary", "강사별", "강사통계", "월별강사평균인원", "매출일일누적"];
  for (const section of sections) {
    for (const payload of data[section] || []) {
      rows.push([
        section,
        monthKey(payload.월 || payload.기준월),
        exportRowKey(section, payload),
        JSON.stringify(payload),
        sourceSpreadsheetId,
        sourceSpreadsheetName,
        generatedAt,
      ]);
    }
  }
  rows.push(["meta", monthKey(data.summary?.[0]?.월), "updatedAt", JSON.stringify({ updatedAt: data.updatedAt }), sourceSpreadsheetId, sourceSpreadsheetName, generatedAt]);
  return rows;
}

export function exportRowsToDashboardData(values) {
  const rows = sheetRowsToObjects(values);
  const data = {
    summary: [],
    강사별: [],
    강사통계: [],
    월별강사평균인원: [],
    매출일일누적: [],
    updatedAt: new Date().toISOString(),
  };
  const meta = {};
  for (const row of rows) {
    const section = stringValue(row.section);
    if (!section) continue;
    let payload = {};
    try {
      payload = JSON.parse(stringValue(row.payloadJson) || "{}");
    } catch {
      payload = {};
    }
    if (section === "meta") {
      Object.assign(meta, payload);
      continue;
    }
    if (Array.isArray(data[section])) data[section].push(payload);
  }
  if (meta.updatedAt) data.updatedAt = stringValue(meta.updatedAt);
  return data;
}

function exportRowKey(section, payload) {
  if (payload.강사) return `${section}:${monthKey(payload.월 || payload.기준월)}:${payload.강사}`;
  if (payload.기준일) return `${section}:${payload.기준일}`;
  return `${section}:${monthKey(payload.월 || payload.기준월)}`;
}

export async function googleAccessToken({ credentialsPath, scopes, delegatedUser = "home@archivepilates.com", delegated = true }) {
  const key = JSON.parse(readFileSync(credentialsPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: key.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  if (delegated && delegatedUser) payload.sub = delegatedUser;
  const assertion = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(assertion).sign(key.private_key);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${assertion}.${base64url(signature)}`,
  });
  const result = await fetchWithRetry("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!result.ok) throw new Error(`Google token request failed ${result.status}: ${await result.text()}`);
  const json = await result.json();
  if (!json.access_token) throw new Error("Google token response did not include access_token");
  return json.access_token;
}

export async function sheetsRequest(token, method, apiPath, body) {
  const result = await fetchWithRetry(`https://sheets.googleapis.com${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await result.text();
  if (!result.ok) throw new Error(`Sheets API failed ${result.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

export async function driveRequest(token, apiPath) {
  const result = await fetchWithRetry(`https://www.googleapis.com/drive/v3${apiPath}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await result.text();
  if (!result.ok) throw new Error(`Drive API failed ${result.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

export function quotedRange(sheetName, range) {
  return `'${sheetName.replace(/'/g, "''")}'!${range}`;
}

export async function ensureSheets(token, spreadsheetId, sheetNames) {
  const metadata = await sheetsRequest(token, "GET", `/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`);
  const existing = new Set((metadata.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));
  const missing = sheetNames.filter((name) => !existing.has(name));
  if (!missing.length) return;
  await sheetsRequest(token, "POST", `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
  });
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function fetchWithRetry(url, options = {}, maxAttempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) return response;
      lastError = new Error(`Retryable HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (!isRetryableFetchError(error) || attempt === maxAttempts) throw error;
    }
    await sleep(500 * 2 ** (attempt - 1));
  }
  throw lastError || new Error("fetch failed");
}

function isRetryableFetchError(error) {
  const code = error?.cause?.code || error?.code || "";
  return ["UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"].includes(code);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
