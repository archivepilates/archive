import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://www.hohoyoga.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const BOARD_SLUG = process.env.BOARD_SLUG || "job_pilates_gyeongsang";
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 45);
const MAX_PAGES = Number(process.env.MAX_PAGES || 80);
const DETAIL_DELAY_MS = Number(process.env.DETAIL_DELAY_MS || 80);
const OUTPUT_PATH = process.env.OUTPUT_PATH || "";
const USER_ID = process.env.HOHO_USER_ID || process.env.HOHO_ACCOUNT || "kihyo2215";
const PASSWORD = process.env.HOHO_PASSWORD || readKeychainPassword(USER_ID);
const TRACKED_IDS = new Set(
  (process.env.TRACKED_DOCUMENT_SRLS || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean),
);

if (!USER_ID || !PASSWORD) {
  throw new Error("HohoYoga login requires HOHO_USER_ID/HOHO_PASSWORD or a macOS Keychain password.");
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  set(name, value) {
    this.cookies.set(name, value);
  }

  add(setCookieHeaders = []) {
    for (const header of setCookieHeaders) {
      const pair = String(header).split(";")[0];
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

function readKeychainPassword(account) {
  try {
    return execFileSync("/usr/bin/security", [
      "find-generic-password",
      "-s",
      "hohoyoga.com",
      "-a",
      account,
      "-w",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEntities(value = "") {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value = "") {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function parseLocalDateTime(value) {
  const match = String(value || "").match(
    /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/,
  );
  if (!match) return null;
  const [, y, m, d, hh = "0", mm = "0"] = match;
  return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
}

function formatDateTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function formatDate(value) {
  return formatDateTime(value).slice(0, 10);
}

function extractFirst(pattern, html) {
  const match = html.match(pattern);
  return match ? decodeEntities(match[1]).trim() : "";
}

function extractAll(pattern, html) {
  return [...html.matchAll(pattern)];
}

function parseExtraFields(detailHtml) {
  const table = detailHtml.match(/<table class="et_vars bd_tb">[\s\S]*?<\/table>/i)?.[0] || "";
  const fields = {};
  for (const row of extractAll(/<tr[\s\S]*?<\/tr>/gi, table)) {
    const key = cleanText(row[0].match(/<th[^>]*>([\s\S]*?)<\/th>/i)?.[1] || "");
    const value = cleanText(row[0].match(/<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] || "");
    if (key) fields[key] = value;
  }
  return fields;
}

function parseListRows(html, slug) {
  const rows = [];
  for (const table of extractAll(/<table class="bd_lst bd_tb_lst bd_tb"[\s\S]*?<\/table>/gi, html).map(
    (match) => match[0],
  )) {
    for (const row of extractAll(/<tr[\s\S]*?<\/tr>/gi, table).map((match) => match[0])) {
      const link = row.match(/<a href="([^"]+)" class="hx"[^>]*>([\s\S]*?)<\/a>/i);
      if (!link) continue;
      const href = decodeEntities(link[1]);
      const documentSrl =
        href.match(new RegExp(`/${slug}/(\\d+)`, "i"))?.[1] ||
        href.match(/[?&]document_srl=(\d+)/i)?.[1] ||
        "";
      if (!documentSrl) continue;
      const tds = extractAll(/<td[\s\S]*?<\/td>/gi, row).map((match) => match[0]);
      const authorCell = tds[4] || "";
      rows.push({
        documentSrl,
        sourceUrl: `${BASE_URL}/${slug}/${documentSrl}`,
        listStatus: cleanText(tds[0] || ""),
        listArea: cleanText(tds[2] || ""),
        title: cleanText(link[2] || ""),
        author: cleanText(authorCell)
          .replace(/\[레벨:\d+\]/g, "")
          .replace(/포인트:[^)]+\)/g, "")
          .trim(),
        authorMemberSrl: authorCell.match(/class="member_(\d+)"/)?.[1] || "",
      });
    }
  }
  return rows;
}

function parseDetail(detailHtml, listRow) {
  const dateText =
    extractFirst(/<span class="date m_no">([\s\S]*?)<\/span>/i, detailHtml) ||
    extractFirst(/<span class="date">([\s\S]*?)<\/span>/i, detailHtml);
  const postedAt = parseLocalDateTime(dateText);
  const status =
    extractFirst(/<span class="ico_secret"[^>]*>([\s\S]*?)<\/span>/i, detailHtml) ||
    extractFirst(/<th[^>]*>\s*모집여부\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i, detailHtml) ||
    listRow.listStatus;
  const title =
    cleanText(extractFirst(/<h1[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>\s*<\/h1>/i, detailHtml)) ||
    listRow.title;
  const authorHtml = detailHtml.match(/<a[^>]+class="nick member_\d+"[\s\S]*?<\/a>/i)?.[0] || "";
  const author = cleanText(authorHtml)
    .replace(/\[레벨:\d+\]/g, "")
    .replace(/포인트:[^)]+\)/g, "")
    .trim();
  const articleHtml = detailHtml.match(/<article>[\s\S]*?<\/article>/i)?.[0] || "";
  const content = cleanText(articleHtml);
  const detailMessage = cleanText(
    detailHtml.match(/<div class="rd_body clear">[\s\S]*?<h3>([\s\S]*?)<\/h3>/i)?.[1] || "",
  );
  const contentStatus = content
    ? "본문확보"
    : /모집 완료/.test(detailMessage) || status === "완료"
      ? "숨김_모집완료"
      : "본문없음";
  const extra = parseExtraFields(detailHtml);
  const emailMatches = new Set([
    ...content.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
    ...Object.values(extra).join(" ").matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
  ].map((match) => match[0]));
  const phoneMatches = new Set(
    [
      ...content.matchAll(/(?:0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4})/g),
      ...(extra["연락처"] || "").matchAll(/(?:0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4})/g),
    ].map((match) => match[0]),
  );

  return {
    boardSlug: BOARD_SLUG,
    documentSrl: listRow.documentSrl,
    sourceUrl: listRow.sourceUrl,
    postedAt: formatDateTime(postedAt),
    postedDate: formatDate(postedAt),
    status,
    isCompleted: status === "완료" || contentStatus === "숨김_모집완료",
    contentStatus,
    detailMessage,
    title,
    author: author || listRow.author,
    authorMemberSrl: authorHtml.match(/member_(\d+)/)?.[1] || listRow.authorMemberSrl,
    businessName: extra["업체명"] || "",
    area: extra["지역"] || listRow.listArea,
    pay: extra["임금"] || "",
    weekdays: extra["요일"] || "",
    deadline: extra["마감날짜"] || "",
    address: extra["주소"] || "",
    phone: [...phoneMatches].join(", "),
    email: [...emailMatches].join(", "),
    profileRequired: extra["프로필 필수여부"] || "",
    content,
    contentPreview: content.slice(0, 500),
  };
}

async function request(jar, url, options = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
    headers: {
      "user-agent": USER_AGENT,
      cookie: jar.header(),
      ...options.headers,
    },
  });
  jar.add(response.headers.getSetCookie());
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) return response;
    return request(jar, new URL(location, url).toString(), {
      ...options,
      method: "GET",
      body: undefined,
    });
  }
  return response;
}

async function requestText(jar, url, options = {}) {
  const response = await request(jar, url, options);
  return { response, text: await response.text() };
}

async function login() {
  const jar = new CookieJar();
  await requestText(jar, `${BASE_URL}/`);
  jar.set(
    "bd_viewer_font",
    "%22Nanum%20Gothic%22%2C%20gulim%2C%20Tahoma%2C%20Arial%2C%20sans-serif",
  );
  jar.set("use_np", "use_np");
  const body = new URLSearchParams({
    error_return_url: "/",
    mid: "home",
    vid: "",
    ruleset: "@login",
    act: "procMemberLogin",
    success_return_url: "/",
    user_id: USER_ID,
    password: PASSWORD,
  });
  await requestText(jar, `${BASE_URL}/`, {
    method: "POST",
    headers: {
      origin: BASE_URL,
      referer: `${BASE_URL}/`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const { text } = await requestText(jar, `${BASE_URL}/`);
  if (!text.includes("로그아웃")) {
    throw new Error("HohoYoga login failed.");
  }
  return jar;
}

async function scrapeDetail(jar, documentSrl, referer = `${BASE_URL}/${BOARD_SLUG}`) {
  await sleep(DETAIL_DELAY_MS);
  const sourceUrl = `${BASE_URL}/${BOARD_SLUG}/${documentSrl}`;
  const { text } = await requestText(jar, sourceUrl, { headers: { referer } });
  return parseDetail(text, { documentSrl, sourceUrl, title: "", listStatus: "", listArea: "" });
}

async function main() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const jar = await login();
  const seen = new Set();
  const activePosts = [];
  const listStatuses = [];
  const boardStats = { pages: 0, listRows: 0, detailChecked: 0, stopped: "max_pages" };

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    boardStats.pages = page;
    const pageUrl =
      page === 1
        ? `${BASE_URL}/${BOARD_SLUG}`
        : `${BASE_URL}/index.php?mid=${encodeURIComponent(BOARD_SLUG)}&page=${page}`;
    const { text } = await requestText(jar, pageUrl, {
      headers: { referer: `${BASE_URL}/${BOARD_SLUG}` },
    });
    const rows = parseListRows(text, BOARD_SLUG);
    if (!rows.length) {
      boardStats.stopped = "empty_page";
      break;
    }
    boardStats.listRows += rows.length;

    let pageKnownDates = 0;
    let pageOlder = 0;
    for (const row of rows) {
      if (seen.has(row.documentSrl)) continue;
      seen.add(row.documentSrl);
      const detail = await scrapeDetail(jar, row.documentSrl, pageUrl);
      boardStats.detailChecked += 1;
      listStatuses.push(detail);
      const postedAt = parseLocalDateTime(detail.postedAt);
      if (postedAt) {
        pageKnownDates += 1;
        if (postedAt < cutoff) pageOlder += 1;
      }
      if (detail.status === "진행중" && detail.contentStatus === "본문확보") {
        activePosts.push(detail);
      }
    }
    if (pageKnownDates > 0 && pageKnownDates === pageOlder) {
      boardStats.stopped = "older_than_cutoff";
      break;
    }
  }

  const trackedStatuses = [];
  for (const documentSrl of TRACKED_IDS) {
    if (seen.has(documentSrl)) {
      const existing = listStatuses.find((row) => row.documentSrl === documentSrl);
      if (existing) trackedStatuses.push(existing);
      continue;
    }
    const detail = await scrapeDetail(jar, documentSrl);
    boardStats.detailChecked += 1;
    trackedStatuses.push(detail);
  }

  const snapshot = {
    runAt: formatDateTime(now),
    boardSlug: BOARD_SLUG,
    boardUrl: `${BASE_URL}/${BOARD_SLUG}`,
    lookbackDays: LOOKBACK_DAYS,
    stats: boardStats,
    activePosts,
    trackedStatuses,
  };

  if (OUTPUT_PATH) {
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), "utf8");
  }
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
