import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, lstat, realpath, open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { acquireEformsignBrowserLock } from "./lib/eformsign-browser-lock.mjs";

export const ORIGINAL_TEMPLATE = "a5b5ea6b85ec44c8bcb4af1e980e94eb";
const ACCOUNT = "archivepilates@gmail.com";
const COMPANY = "848f6dc7fa024a6cb28a2994c0835e53";
const LIST_PATH = `/v1.0/companies/${COMPANY}/documents`;
const ORIGINS = new Set(["https://www.eformsign.com", "https://kr-service.eformsign.com"]);
const DIRECTORY = "/Users/archivepilates/ArchiveIN/operations/instructor-signup-enrichment-20261030";
const PROFILE = "/Users/archivepilates/ArchiveIN/automation/eformsign-browser-profile";
const LOCK = "/Users/archivepilates/ArchiveIN/automation/locks/eformsign-browser-profile.lock";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalized = value => String(value || "").replace(/\s+/g, " ").trim();

function requireProof(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

export function validInventoryQuery(query) {
  const keys = query && Object.keys(query).filter(key => key !== "search").sort();
  const integer = value => Number.isInteger(value) || (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value));
  return Boolean(query && JSON.stringify(keys) === JSON.stringify(["limit", "skip", "sort", "sort_type", "type"])
    && query.type === "ai" && (query.search == null || query.search === "")
    && integer(query.skip) && Number(query.skip) >= 0 && Number(query.skip) <= 100000
    && integer(query.limit) && [20, 100].includes(Number(query.limit)) && Number(query.skip) % Number(query.limit) === 0
    && query.sort === "update_date" && query.sort_type === "desc");
}

export function inventoryRequestKind({ url: value, method, payload }) {
  const url = new URL(value);
  if (/\/eform\/document\/view_service\.html$/.test(url.pathname)
    || /\/v1\.0\/companies\/[^/]+\/documents\/[^/]+(?:\/|$)/.test(url.pathname)) return "blocked_document_detail";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return "read";
  if (method === "POST" && ORIGINS.has(url.origin) && url.pathname === LIST_PATH
    && validInventoryQuery(payload?.input?.query)) return "completed_list";
  if (method === "POST" && url.origin === "https://kr-service.eformsign.com"
    && [`/v1.0/companies/${COMPANY}/members/${ACCOUNT}/unstructured_forms`,
      `/v1.0/companies/${COMPANY}/multi_category_by_permission`].includes(url.pathname)) return "metadata";
  return "blocked_non_read";
}

function documentId(row) {
  const values = [row?.document_id, row?.id, row?.documentId].filter(value => value != null && value !== "");
  requireProof(values.length > 0 && values.every(value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value))
    && new Set(values).size === 1, "LIST_DOCUMENT_ID_UNVERIFIED");
  return values[0];
}

export function parseInventoryPage({ request, body, httpStatus, domRows, expectedSkip, expectedLimit }) {
  const query = request?.input?.query;
  requireProof(validInventoryQuery(query) && Number(query.skip) === expectedSkip && Number(query.limit) === expectedLimit, "PAGE_QUERY_MISMATCH");
  requireProof(httpStatus === 200 && body?.status === "200" && body?.code === "-1", "LIST_RESPONSE_UNVERIFIED");
  const total = body?.result?.total_rows, rows = body?.result?.documents;
  requireProof(Number.isInteger(total) && total >= 0 && total <= 100000 && Array.isArray(rows), "LIST_TOTAL_UNVERIFIED");
  requireProof(rows.length === Math.max(0, Math.min(query.limit, total - query.skip)), "INCOMPLETE_LIST_PAGE");
  const ids = rows.map(documentId);
  requireProof(new Set(ids).size === ids.length && domRows.length === rows.length, "DUPLICATE_OR_MISSING_PAGE_ROWS");
  requireProof(JSON.stringify(domRows.map(row => row.documentId).sort()) === JSON.stringify([...ids].sort()), "DOM_RESPONSE_ID_MISMATCH");
  const documents = [];
  for (const row of rows) {
    const id = documentId(row), dom = domRows.find(item => item.documentId === id);
    requireProof(typeof row.title === "string" && row.title.length > 0
      && normalized(row.title) === normalized(dom.title), "DOCUMENT_TITLE_MISMATCH");
    const url = new URL(dom.href, "https://www.eformsign.com");
    requireProof(url.origin === "https://www.eformsign.com" && url.pathname === "/eform/document/view_service.html"
      && url.searchParams.get("document_id") === id && /^[a-f0-9]{32}$/.test(url.searchParams.get("form_id") || ""), "DOCUMENT_LINK_UNVERIFIED");
    if (url.searchParams.get("form_id") !== ORIGINAL_TEMPLATE) continue;
    // ai proves completed-folder membership only; individual status/recipients are a later audit.
    documents.push({ documentId: id, title: row.title, templateId: ORIGINAL_TEMPLATE,
      status: "completed_list_only", listProofHash: hash(body), sourceSkip: Number(query.skip) });
  }
  return { ids, documents, total, proof: { source: "native_ui_and_list_post", skip: Number(query.skip), limit: Number(query.limit), totalRows: total,
    rowCount: ids.length, queryHash: hash(query), responseHash: hash(body), documentIdsHash: hash(ids),
    matchedCount: documents.length } };
}

function valueAt(row, keys) { return keys.reduce((value, key) => value?.[key], row); }

export function nativeTemplatePath(rows, domRows) {
  const leaves = (value, keys = []) => {
    if (keys.length > 6 || !value || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([key, next]) => {
      const path = [...keys, key];
      return typeof next === "string" && /^[a-f0-9]{32}$/.test(next) && path.some(k => /form|template/i.test(k))
        ? [path] : leaves(next, path);
    });
  };
  requireProof(rows.length > 0, "TEMPLATE_BINDING_REQUIRES_INITIAL_ROWS");
  const paths = leaves(rows[0]).filter(keys => rows.every(row => {
    const dom = domRows.find(item => item.documentId === documentId(row));
    return dom && valueAt(row, keys) === new URL(dom.href, "https://www.eformsign.com").searchParams.get("form_id");
  })).sort((a, b) => a.length - b.length || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  requireProof(paths.length > 0, "TEMPLATE_BINDING_NOT_IN_NATIVE_LIST");
  return paths[0];
}

export function parseNativeInventoryPage({ request, body, httpStatus, templatePath, expectedSkip, expectedLimit }) {
  // The initial DOM proves which native template field to use; later pages are native POST proof, not UI proof.
  const rows = body?.result?.documents;
  requireProof(Array.isArray(rows) && Array.isArray(templatePath) && templatePath.length > 0, "NATIVE_TEMPLATE_BINDING_REQUIRED");
  const parsed = parseInventoryPage({ request, body, httpStatus, expectedSkip, expectedLimit,
    domRows: rows.map(row => {
      const templateId = valueAt(row, templatePath);
      requireProof(typeof templateId === "string" && /^[a-f0-9]{32}$/.test(templateId), "NATIVE_TEMPLATE_ID_UNVERIFIED");
      return { documentId: documentId(row), title: row.title,
        href: `/eform/document/view_service.html?document_id=${documentId(row)}&form_id=${templateId}` };
    }) });
  parsed.proof.source = "native_list_post";
  parsed.proof.templateBindingHash = hash(templatePath);
  return parsed;
}

export function verifyInventoryCoverage(pages, anchor) {
  requireProof(pages.length > 0, "NO_VERIFIED_PAGES");
  const total = pages[0].total, limit = pages[0].proof.limit;
  requireProof(pages.length === Math.max(1, Math.ceil(total / limit)), "MISSING_PAGES");
  const ids = [], documents = [];
  pages.forEach((page, index) => {
    requireProof(page.total === total && page.proof.skip === index * limit && page.proof.limit === limit, "PAGE_TOTAL_OR_ORDER_CHANGED");
    ids.push(...page.ids); documents.push(...page.documents);
  });
  requireProof(ids.length === total && new Set(ids).size === total, "INVENTORY_IDS_NOT_COMPLETE_UNIQUE");
  const stableDocuments = page => page.documents.map(({ documentId, title, templateId, status }) => ({ documentId, title, templateId, status }));
  requireProof(anchor.total === total && anchor.proof.skip === 0 && anchor.proof.limit === limit
    && hash(anchor.ids) === hash(pages[0].ids)
    && hash(stableDocuments(anchor)) === hash(stableDocuments(pages[0])), "INVENTORY_CHANGED_DURING_WINDOW");
  return { totalAllTemplates: total, uniqueAllTemplates: ids.length,
    matchedOriginalTemplate: documents.length, pageSize: limit,
    pagesVerified: pages.length, pagesExpected: Math.max(1, Math.ceil(total / limit)),
    firstPageRevalidated: true, complete: true };
}

async function account(page) {
  requireProof(new URL(page.url()).origin === "https://www.eformsign.com"
    && (await page.locator("body").innerText()).includes(ACCOUNT), "ACCOUNT_NOT_VERIFIED");
}

async function captureList(page, action, expectedSkip, expectedLimit) {
  const waiting = page.waitForResponse(response => {
    try {
      const url = new URL(response.url()), query = response.request().postDataJSON()?.input?.query;
      return response.request().method() === "POST" && ORIGINS.has(url.origin) && url.pathname === LIST_PATH
        && validInventoryQuery(query) && Number(query.skip) === expectedSkip && (!expectedLimit || Number(query.limit) === expectedLimit);
    } catch { return false; }
  }, { timeout: 25000 });
  let response;
  try { [response] = await Promise.all([waiting, action()]); }
  catch { requireProof(false, "NATIVE_LIST_REQUEST_NOT_OBSERVED"); }
  const request = response.request().postDataJSON(), body = await response.json();
  const ids = (body?.result?.documents || []).map(documentId);
  await page.waitForFunction(expected => {
    const rows = [...document.querySelectorAll("#RWDtable tr")]
      .filter(row => row.getClientRects().length && row.querySelector('a[href*="view_service.html"]'));
    const actual = rows.map(row => row.id || row.getAttribute("data-document-id") || "").sort();
    return JSON.stringify(actual) === JSON.stringify([...expected].sort());
  }, ids, { timeout: 20000 }).catch(() => requireProof(false, "NATIVE_LIST_DOM_NOT_MATCHED"));
  const domRows = await page.evaluate(expectedTitles => [...document.querySelectorAll("#RWDtable tr")]
    .filter(row => row.getClientRects().length && row.querySelector('a[href*="view_service.html"]'))
    .map(row => {
      const link = row.querySelector('a[href*="view_service.html"]');
      const id = row.id || row.getAttribute("data-document-id") || "";
      const expected = expectedTitles.find(item => item.documentId === id)?.title;
      const text = String(row.innerText || "").replace(/\s+/g, " ").trim();
      return { documentId: id,
        title: typeof expected === "string" && text.includes(expected.replace(/\s+/g, " ").trim())
          ? expected : String(link.textContent || "").replace(/\s+/g, " ").trim(), href: link.getAttribute("href"),
      };
    }), body.result.documents.map(row => ({ documentId: documentId(row), title: row.title })));
  await account(page);
  const parsed = parseInventoryPage({ request, body, httpStatus: response.status(), domRows, expectedSkip,
    expectedLimit: expectedLimit || Number(request.input.query.limit) });
  parsed.proof.observedAt = new Date().toISOString();
  // Transport credentials and full list rows stay in RAM only; never attach them to evidence.
  const allHeaders = await response.request().allHeaders();
  const headers = Object.fromEntries(Object.entries(allHeaders).filter(([key]) =>
    !/^(?:host|content-length|cookie|origin|referer|connection|accept-encoding|user-agent|sec-.*|:.*)$/i.test(key)));
  parsed.transport = { url: response.url(), headers, payload: request };
  parsed.templatePath = body.result.documents.length ? nativeTemplatePath(body.result.documents, domRows) : null;
  return parsed;
}

async function replayList(page, transport, templatePath, skip, limit) {
  const payload = structuredClone(transport.payload);
  payload.input.query.skip = skip;
  payload.input.query.limit = limit;
  requireProof(inventoryRequestKind({ url: transport.url, method: "POST", payload }) === "completed_list", "REPLAY_NOT_SAME_READ_ENDPOINT");
  const response = await page.evaluate(async ({ url, headers, payload }) => {
    const result = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), credentials: "include", redirect: "error" });
    return { httpStatus: result.status, body: await result.json() };
  }, { url: transport.url, headers: transport.headers, payload });
  const parsed = parseNativeInventoryPage({ ...response, request: payload, templatePath, expectedSkip: skip, expectedLimit: limit });
  parsed.proof.observedAt = new Date().toISOString();
  await account(page);
  return parsed;
}

export async function runInventory() {
  let context, release, output;
  let stage = "INITIALIZATION";
  const evidence = { version: 1, account: ACCOUNT, templateId: ORIGINAL_TEMPLATE,
    source: "eformsign_native_completed_list", sourceWindow: { startedAt: new Date().toISOString() },
    coverage: { complete: false }, pages: [], documents: [],
    blockedRequests: {}, cleanup: { contextClosed: false, lockReleased: false },
    individualDocumentsRead: false, operationalWrites: 0 };
  let errorCode = null;
  try {
    requireProof(process.argv.length === 2, "NO_ARGUMENTS_ALLOWED");
    await mkdir(DIRECTORY, { recursive: true, mode: 0o700 });
    const directory = await lstat(DIRECTORY);
    requireProof(directory.isDirectory() && !directory.isSymbolicLink() && (directory.mode & 0o077) === 0
      && await realpath(DIRECTORY) === DIRECTORY, "PRIVATE_DIRECTORY_REQUIRED");
    output = path.join(DIRECTORY, `inventory-${Date.now()}.json`);
    stage = "LOCK";
    release = await acquireEformsignBrowserLock({ owner: "instructor-signup-enrichment-inventory-20261030",
      lockPath: LOCK, waitMs: 120000, staleMs: Number.MAX_SAFE_INTEGER });
    const { chromium } = await import("playwright");
    stage = "BROWSER";
    context = await chromium.launchPersistentContext(PROFILE, { headless: true, serviceWorkers: "block", acceptDownloads: false });
    await context.route("**/*", async route => {
      let kind = "blocked_non_read";
      try {
        const request = route.request();
        kind = inventoryRequestKind({ url: request.url(), method: request.method(),
          payload: request.method() === "POST" ? request.postDataJSON() : undefined });
      } catch { /* Unknown request structures remain blocked. */ }
      if (["read", "completed_list", "metadata"].includes(kind)) return route.continue();
      evidence.blockedRequests[kind] = (evidence.blockedRequests[kind] || 0) + 1;
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", socket => {
      evidence.blockedRequests.websocket = (evidence.blockedRequests.websocket || 0) + 1;
      socket.close();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("dialog", dialog => { void dialog.dismiss().catch(() => {}); });
    const loadFirstPage = async () => {
      // Empty-search buttons may not issue a request. Bind the native initial-list request instead.
      let first = await captureList(page, () => page.goto("https://www.eformsign.com/eform/document/document_list.html?mode=ai",
        { waitUntil: "networkidle", timeout: 60000 }), 0);
      const selects = await page.locator("select").evaluateAll(nodes => nodes.map((node, index) => ({ index,
        eligible: Boolean(node.getClientRects().length && [...node.options].some(option => option.value === "100")
          && [...node.options].some(option => option.value === "20")) })).filter(row => row.eligible));
      requireProof(selects.length <= 1, "PAGE_SIZE_SELECTOR_AMBIGUOUS");
      if (first.proof.limit !== 100 && selects.length === 1) {
        first = await captureList(page, () => page.locator("select").nth(selects[0].index).selectOption("100"), 0, 100);
      }
      return first;
    };
    stage = "FIRST_PAGE";
    const first = await loadFirstPage();
    const pages = [first], limit = first.proof.limit;
    evidence.pages.push(first.proof); evidence.documents.push(...first.documents);
    for (let skip = limit; skip < first.total; skip += limit) {
      stage = "PAGINATION";
      const next = await replayList(page, first.transport, first.templatePath, skip, limit);
      requireProof(next.total === first.total, "TOTAL_CHANGED_DURING_PAGINATION");
      pages.push(next); evidence.pages.push(next.proof); evidence.documents.push(...next.documents);
    }
    stage = "ANCHOR";
    const anchor = first.total ? await replayList(page, first.transport, first.templatePath, 0, limit) : first;
    evidence.coverage = verifyInventoryCoverage(pages, anchor);
    evidence.anchor = anchor.proof;
  } catch (error) {
    errorCode = typeof error.code === "string" && /^[A-Z_]+$/.test(error.code) ? error.code : `INVENTORY_STOPPED_${stage}`;
    evidence.errorCode = errorCode;
  } finally {
    try { await context?.close(); evidence.cleanup.contextClosed = true; }
    catch { errorCode = "CONTEXT_CLEANUP_FAILED"; }
    try { await release?.(); evidence.cleanup.lockReleased = true; }
    catch { errorCode = "LOCK_CLEANUP_FAILED"; }
    evidence.sourceWindow.finishedAt = new Date().toISOString();
    evidence.ok = !errorCode && evidence.coverage.complete && evidence.cleanup.contextClosed && evidence.cleanup.lockReleased;
    try {
      requireProof(output, "NO_PRIVATE_OUTPUT");
      const file = await open(output, "wx", 0o600);
      try { await file.writeFile(JSON.stringify(evidence, null, 2)); await file.sync(); } finally { await file.close(); }
      const saved = await lstat(output);
      requireProof(saved.isFile() && (saved.mode & 0o077) === 0, "PRIVATE_OUTPUT_MODE_INVALID");
    } catch { evidence.ok = false; errorCode = "PRIVATE_OUTPUT_FAILED"; }
    console.log(JSON.stringify({ status: evidence.ok ? "inventory_complete" : "inventory_review_required",
      ...evidence.coverage, pagesRead: evidence.pages.length,
      originalTemplateRows: evidence.documents.length, output, ...(errorCode ? { code: errorCode } : {}) }));
    if (!evidence.ok) process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runInventory();
