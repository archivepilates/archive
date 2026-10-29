import { createHash, randomUUID } from "node:crypto";
import { readFile, lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { acquireEformsignBrowserLock } from "./lib/eformsign-browser-lock.mjs";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { captureStudioMateNativeApiClient, readExactStudioMateMember } from "./lib/studiomate-native-contract-source.mjs";
import { parseCompletedRecipientStatus } from "./lib/instructor-signup-order-identity.mjs";
import { readCompletedSignupProfileV2, signupV2Projection } from "./lib/instructor-signup-profile-v2.mjs";
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE, isInstructorMemberGrade,
  normalizeInstructorLessonName as name, normalizeInstructorLessonPhone as phone } from "./lib/instructor-lesson-registration-contract.mjs";

const ACCOUNT = "archivepilates@gmail.com";
const COMPANY = "848f6dc7fa024a6cb28a2994c0835e53";
const WEB = "https://www.eformsign.com";
const API = "https://kr-service.eformsign.com";
const LIST = `/v1.0/companies/${COMPANY}/documents`;
const LIST_URL = `${WEB}/eform/document/document_list.html?mode=ai`;
const VIEW_FLAGS = Object.freeze({ mode: "ai", viewFlag: "true", is_preview: "true" });
const DIRECTORY = "/Users/archivepilates/ArchiveIN/operations/instructor-signup-enrichment-20261030";
const AUTOMATION = "/Users/archivepilates/ArchiveIN/automation";
const digest = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const idValid = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const hashValid = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const stop = code => { throw Object.assign(new Error(code), { auditCode: code }); };
const requireProof = (value, code) => { if (!value) stop(code); };
const securityCode = error => ["LOGIN_OR_SECURITY_STOP", "CONTEXT_CLOSE_FAILED", "LOCK_RELEASE_FAILED"].includes(error?.auditCode);

export function parseSourceArgs(args) {
  requireProof(args.length >= 1 && args.length <= 2, "ARGUMENTS_INVALID");
  const inventory = args.filter(arg => arg.startsWith("--inventory="));
  const limits = args.filter(arg => arg.startsWith("--limit="));
  requireProof(inventory.length === 1 && limits.length <= 1 && inventory.length + limits.length === args.length, "ARGUMENTS_INVALID");
  const file = inventory[0].slice(12), rawLimit = limits[0]?.slice(8) ?? "200";
  requireProof(path.isAbsolute(file) && path.resolve(file) === file && file.startsWith(`${DIRECTORY}/`)
    && /^[1-9]\d{0,2}$/.test(rawLimit) && Number(rawLimit) <= 200, "ARGUMENTS_INVALID");
  return { inventoryPath: file, limit: Number(rawLimit) };
}

export function validateSourceInventory(inventory, limit = 200) {
  requireProof(Number.isInteger(limit) && limit > 0 && limit <= 200, "LIMIT_INVALID");
  const coverage = inventory?.coverage;
  requireProof(inventory?.ok === true && coverage?.complete === true
    && inventory.source === "eformsign_native_completed_list" && inventory.account === ACCOUNT
    && inventory.templateId === TEMPLATE && inventory.cleanup?.contextClosed === true
    && inventory.cleanup?.lockReleased === true && coverage.firstPageRevalidated === true
    && Number.isInteger(coverage.totalAllTemplates) && coverage.totalAllTemplates >= 0
    && coverage.totalAllTemplates === coverage.uniqueAllTemplates
    && Number.isInteger(coverage.pagesExpected) && coverage.pagesExpected >= 1
    && coverage.pagesExpected === coverage.pagesVerified
    && Array.isArray(inventory.pages) && inventory.pages.length === coverage.pagesVerified
    && Array.isArray(inventory.documents) && inventory.documents.length === coverage.matchedOriginalTemplate,
  "INVENTORY_INCOMPLETE_OR_UNVERIFIED");
  requireProof([20, 100].includes(coverage.pageSize)
    && coverage.pagesExpected === Math.max(1, Math.ceil(coverage.totalAllTemplates / coverage.pageSize)), "INVENTORY_PAGE_COVERAGE_INVALID");
  const windowStart = Date.parse(inventory.sourceWindow?.startedAt), windowEnd = Date.parse(inventory.sourceWindow?.finishedAt);
  requireProof(Number.isFinite(windowStart) && Number.isFinite(windowEnd) && windowStart <= windowEnd, "INVENTORY_WINDOW_INVALID");
  inventory.pages.forEach((page, index) => requireProof(page.skip === index * coverage.pageSize
    && page.limit === coverage.pageSize && page.totalRows === coverage.totalAllTemplates
    && page.rowCount === Math.max(0, Math.min(coverage.pageSize, coverage.totalAllTemplates - page.skip))
    && hashValid(page.queryHash) && hashValid(page.responseHash) && hashValid(page.documentIdsHash), "INVENTORY_PAGE_PROOF_INVALID"));
  const documents = inventory.documents.map(doc => {
    requireProof(idValid(doc.documentId) && doc.templateId === TEMPLATE && doc.status === "completed_list_only"
      && typeof doc.title === "string" && doc.title.trim().length > 0 && doc.title.length <= 1000
      && hashValid(doc.listProofHash) && Number.isInteger(doc.sourceSkip)
      && inventory.pages.some(page => page.skip === doc.sourceSkip && page.responseHash === doc.listProofHash), "INVENTORY_DOCUMENT_INVALID");
    return { documentId: doc.documentId, title: doc.title, templateId: TEMPLATE,
      listProofHash: doc.listProofHash, sourceSkip: doc.sourceSkip };
  });
  requireProof(new Set(documents.map(doc => doc.documentId)).size === documents.length, "INVENTORY_DOCUMENT_DUPLICATE");
  return { documents: documents.slice(0, limit), inventoryCount: documents.length, scopeComplete: documents.length <= limit };
}

export function verifiedDocumentHref(doc, href) {
  requireProof(idValid(doc.documentId) && doc.templateId === TEMPLATE, "DOCUMENT_IDENTITY_INVALID");
  const url = new URL(href || `${WEB}/eform/document/view_service.html?document_id=${doc.documentId}&form_id=${TEMPLATE}&mode=ai&viewFlag=true&is_preview=true`, WEB);
  const keys = [...url.searchParams.keys()];
  const flags = keys.filter(key => Object.hasOwn(VIEW_FLAGS, key));
  const valid = url.origin === WEB && url.pathname === "/eform/document/view_service.html"
    && url.searchParams.get("document_id") === doc.documentId && url.searchParams.get("form_id") === TEMPLATE
    && keys.length === new Set(keys).size
    && keys.every(key => ["document_id", "form_id"].includes(key) || Object.hasOwn(VIEW_FLAGS, key))
    && (flags.length === 0 || flags.length === 3) && flags.every(key => url.searchParams.get(key) === VIEW_FLAGS[key]) && !url.hash;
  if (!valid) throw Object.assign(new Error("DOCUMENT_LINK_INVALID"), { auditCode: "DOCUMENT_LINK_INVALID",
    auditShape: { origin: url.origin, path: url.pathname, queryKeys: [...url.searchParams.keys()],
      documentIdMatches: url.searchParams.get("document_id") === doc.documentId,
      templateIdMatches: url.searchParams.get("form_id") === TEMPLATE, hasHash: Boolean(url.hash) } });
  return url.href;
}

export function sourceRequestKind({ url: value, method, payload, documentIds, titles, viewerDocumentId = null }) {
  const url = new URL(value), read = ["GET", "HEAD", "OPTIONS"].includes(method);
  const status = url.pathname.match(/^\/v1\.0\/companies\/([^/]+)\/documents\/([^/]+)\/status$/);
  if (status) return method === "GET" && url.origin === API && status[1] === COMPANY
    && documentIds.has(status[2]) ? "status_read" : "blocked_status";
  const history = url.pathname.match(/^\/v1\.0\/companies\/([^/]+)\/documents\/([^/]+)\/histories$/);
  if (history) return method === "GET" && url.origin === API && history[1] === COMPANY
    && documentIds.has(history[2]) ? "history_read" : "blocked_document";
  if (url.pathname === "/eform/document/view_service.html") {
    try { verifiedDocumentHref({ documentId: viewerDocumentId, templateId: TEMPLATE }, url.href); }
    catch { return "blocked_viewer"; }
    return method === "GET" && documentIds.has(viewerDocumentId) ? "viewer_read" : "blocked_viewer";
  }
  const detail = url.pathname.match(/^\/v1\.0\/companies\/([^/]+)\/documents\/([^/]+)(?:\/|$)/);
  if (detail && (url.origin !== API || detail[1] !== COMPANY || detail[2] !== viewerDocumentId
    || !documentIds.has(detail[2]))) return "blocked_document";
  if (/\.pdf(?:$|\/)|\/download(?:\/|$)/i.test(url.pathname)) return "blocked_download";
  if (read) return "read";
  const query = payload?.input?.query;
  if (method === "POST" && [WEB, API].includes(url.origin) && url.pathname === LIST
    && query?.type === "ai" && (query.search == null || query.search === "" || titles.has(query.search))
    && Number(query.skip) === 0 && [20, 100].includes(Number(query.limit))
    && query.sort === "update_date" && query.sort_type === "desc"
    && Object.keys(query).every(key => ["skip", "limit", "type", "search", "sort", "sort_type"].includes(key))) return "completed_list";
  if (method === "POST" && url.origin === API && [`/v1.0/companies/${COMPANY}/members/${ACCOUNT}/unstructured_forms`,
    `/v1.0/companies/${COMPANY}/multi_category_by_permission`].includes(url.pathname)) return "metadata";
  return "blocked_non_read";
}

export function selectLatestCompleted(rows) {
  const groups = new Map(), selected = [], excluded = [];
  for (const row of rows) {
    const completion = row.completionProof, recipient = completion?.recipients?.[0];
    requireProof(completion?.status === "completed" && completion.documentId === row.documentId
      && completion.templateId === TEMPLATE && completion.recipients.length === 1 && name(recipient?.name)
      && /^010\d{8}$/.test(phone(recipient?.phone)) && Number.isFinite(Date.parse(completion.providerCompletedAt)), "COMPLETION_IDENTITY_INVALID");
    const key = phone(recipient.phone);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => Date.parse(b.completionProof.providerCompletedAt) - Date.parse(a.completionProof.providerCompletedAt));
    const names = new Set(ordered.map(row => name(row.completionProof.recipients[0].name)));
    const tied = ordered.length > 1 && Date.parse(ordered[0].completionProof.providerCompletedAt) === Date.parse(ordered[1].completionProof.providerCompletedAt);
    if (names.size !== 1 || tied) {
      for (const row of ordered) excluded.push({ documentId: row.documentId, reason: names.size !== 1 ? "recipient_name_conflict" : "equal_completion_time_hold" });
      continue;
    }
    selected.push(ordered[0]);
    for (const row of ordered.slice(1)) excluded.push({ documentId: row.documentId, reason: "older_completed_document" });
  }
  return { selected, excluded };
}

export function baselineSourceJob(doc, member) {
  const recipient = doc.completionProof?.recipients?.[0];
  requireProof(doc.completionProof?.recipients?.length === 1 && doc.completionProof.documentId === doc.documentId
    && doc.completionProof.templateId === TEMPLATE && doc.completionProof.status === "completed"
    && member?.inactive === false && isInstructorMemberGrade(member.memberGrade)
    && /^[1-9]\d*$/.test(String(member.memberId)) && name(member.name) === name(recipient?.name)
    && phone(member.phone) === phone(recipient?.phone), "NATIVE_MEMBER_IDENTITY_UNVERIFIED");
  return { studioId: "5330", studiomateMemberId: String(member.memberId), memberName: name(member.name), memberPhone: phone(member.phone),
    documentId: doc.documentId, documentName: doc.title, baselineOnly: true, status: "done",
    source: "completed_signup_profile_baseline_v2", sendAllowed: false, registrationId: "" };
}

export function verifiedSourceRow(doc, member, profile, completionProof, nativeCheckedAt) {
  const job = baselineSourceJob({ ...doc, completionProof }, member);
  const projection = signupV2Projection({ job, profile, completion: completionProof, memberId: member.memberId, registrationId: "" });
  const fields = ["version", "documentId", "templateId", "memberName", "memberPhone", "birthDateRaw", "addressRaw", "career", "affiliation"];
  return { status: "verified", documentId: doc.documentId, documentName: doc.title, baselineOnly: true, sendAllowed: false,
    member: { memberId: member.memberId, name: name(member.name), phone: phone(member.phone), memberGrade: member.memberGrade, inactive: false },
    profile: Object.fromEntries(fields.map(key => [key, profile[key]])), completionProof,
    profileMemoJobId: projection.memoId, nativeCheckedAt, checkedAt: new Date().toISOString(), eligibleForBaseline: false };
}

async function privateDirectory() {
  await mkdir(DIRECTORY, { recursive: true, mode: 0o700 });
  const stat = await lstat(DIRECTORY);
  requireProof(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0
    && await realpath(DIRECTORY) === DIRECTORY, "PRIVATE_DIRECTORY_REQUIRED");
}

async function browserPhase(kind, report, callback) {
  let context, release;
  const cleanup = { phase: kind, contextClosed: false, lockReleased: false };
  report.cleanup.push(cleanup);
  try {
    const eform = kind !== "native_members";
    release = await (eform ? acquireEformsignBrowserLock : acquireStudioMateBrowserLock)({
      owner: `instructor-signup-source-${kind}`, lockPath: `${AUTOMATION}/locks/${eform ? "eformsign" : "studiomate"}-browser-profile.lock`,
      waitMs: 120000, staleMs: Number.MAX_SAFE_INTEGER });
    const { chromium } = await import("playwright");
    context = await chromium.launchPersistentContext(`${AUTOMATION}/${eform ? "eformsign-browser-profile" : "browser-profile"}`,
      { headless: true, serviceWorkers: "block", acceptDownloads: false });
    await context.routeWebSocket("**/*", socket => { report.blockedRequests.websocket = (report.blockedRequests.websocket || 0) + 1; socket.close(); });
    await callback(context);
  } finally {
    let failure;
    try { if (context) await context.close(); cleanup.contextClosed = true; }
    catch { failure = "CONTEXT_CLOSE_FAILED"; }
    // Do not release a profile whose owning context failed to close.
    if (cleanup.contextClosed) {
      try { await release?.(); cleanup.lockReleased = true; }
      catch { failure = "LOCK_RELEASE_FAILED"; }
    }
    if (failure) stop(failure);
  }
}

async function securityCheck(page, state, eform = true) {
  if (state.securityStop || /(?:login|signin|captcha|two.factor|\/auth\/)/i.test(new URL(page.url()).pathname)
    || await page.locator('input[type="password"]:visible').count()) stop("LOGIN_OR_SECURITY_STOP");
  const text = await page.locator("body").innerText();
  if (/보안 확인|자동입력 방지|비정상적인 접근|security verification|verify you are human|captcha/i.test(text)) stop("LOGIN_OR_SECURITY_STOP");
  if (eform) requireProof(new URL(page.url()).origin === WEB && text.includes(ACCOUNT), "EFORMSIGN_ACCOUNT_UNVERIFIED");
}

async function eformSession(context, report, documents) {
  const state = { documentIds: new Set(documents.map(doc => doc.documentId)), titles: new Set(documents.map(doc => doc.title)), viewerDocumentId: null, securityStop: false };
  await context.route("**/*", async route => {
    let kind = "blocked_non_read";
    try {
      const request = route.request();
      kind = sourceRequestKind({ ...state, url: request.url(), method: request.method(),
        payload: request.method() === "POST" ? request.postDataJSON() : undefined });
    } catch { /* Unknown shapes remain blocked. */ }
    if (["read", "status_read", "history_read", "viewer_read", "completed_list", "metadata"].includes(kind)) return route.continue();
    report.blockedRequests[kind] = (report.blockedRequests[kind] || 0) + 1;
    if (report.blockedRoutes.length < 20) {
      const url = new URL(route.request().url());
      const shape = { kind, method: route.request().method(), origin: url.origin,
        path: url.pathname.replace(/[^/]{65,}/g, ":opaque"), queryKeys: [...url.searchParams.keys()] };
      if (!report.blockedRoutes.some(row => JSON.stringify(row) === JSON.stringify(shape))) report.blockedRoutes.push(shape);
    }
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("dialog", dialog => {
    if (/log.?in|sign.?in|captcha|security|인증|로그인|보안/i.test(dialog.message())) state.securityStop = true;
    void dialog.dismiss().catch(() => {});
  });
  return { page, state };
}

async function bootstrapStatus(context, page, state, doc) {
  let stage = "LIST_NAVIGATION";
  let captured;
  const observe = response => {
    const url = new URL(response.url());
    if (response.request().method() === "GET" && url.origin === API && url.pathname === `${LIST}/${doc.documentId}/status`) captured = response;
  };
  page.on("response", observe);
  try {
  await page.goto(LIST_URL, { waitUntil: "networkidle", timeout: 60000 });
  stage = "ACCOUNT_CHECK";
  await securityCheck(page, state);
  const row = page.locator(`#RWDtable tr[id="${doc.documentId}"]`);
  if (!await row.isVisible()) {
  stage = "SEARCH_INPUT";
  await page.locator("#simpleSearchKey").fill(doc.title);
  const waiting = page.waitForResponse(response => {
    try {
      const request = response.request(), url = new URL(response.url()), query = request.postDataJSON()?.input?.query;
      return request.method() === "POST" && [WEB, API].includes(url.origin) && url.pathname === LIST
        && query?.type === "ai" && query.search === doc.title && Number(query.skip) === 0;
    } catch { return false; }
  }, { timeout: 25000 });
  stage = "SEARCH_RESPONSE";
  const [listResponse] = await Promise.all([waiting, page.locator("#simpleSearchButton").click()]);
  stage = "SEARCH_BODY";
  const body = await listResponse.json(), list = body?.result?.documents;
  requireProof(listResponse.status() === 200 && body?.code === "-1" && body?.status === "200"
    && Array.isArray(list) && Number.isInteger(body.result.total_rows) && body.result.total_rows === list.length
    && list.length <= 100, "BOOTSTRAP_SEARCH_INCOMPLETE");
  const matches = list.filter(row => [row.document_id, row.id, row.documentId].filter(Boolean).every(id => id === doc.documentId)
    && [row.document_id, row.id, row.documentId].includes(doc.documentId) && row.title === doc.title);
  requireProof(matches.length === 1, "BOOTSTRAP_LIST_BINDING_UNVERIFIED");
  }
  stage = "ROW_BINDING";
  await page.waitForFunction(id => [...document.querySelectorAll("#RWDtable tr")]
    .some(row => row.id === id && row.getClientRects().length), doc.documentId, { timeout: 20000 });
  requireProof(await row.count() === 1 && (await row.innerText()).replace(/\s+/g, " ").includes(doc.title.replace(/\s+/g, " ")), "BOOTSTRAP_DOM_BINDING_UNVERIFIED");
  const href = verifiedDocumentHref(doc, await row.locator('a[href*="view_service.html"]').getAttribute("href"));
  stage = "SELECTED_STATUS_RESPONSE";
  let response = await row.getAttribute("aria-selected") === "true" ? captured : null;
  if (!response) {
  const statusWaiting = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.origin === API && url.pathname === `${LIST}/${doc.documentId}/status`;
  }, { timeout: 20000 });
  [response] = await Promise.all([statusWaiting, row.click({ position: { x: 15, y: 15 } })]);
  }
  await response.finished();
  await page.waitForFunction(id => document.querySelector('#RWDtable tr[aria-selected="true"]')?.id === id, doc.documentId);
  await securityCheck(page, state);
  stage = "SELECTED_STATUS_BODY";
  const request = response.request(), observed = new URL(request.url());
  const data = await response.json();
  const proof = parseCompletedRecipientStatus({ responseUrl: response.url(), method: request.method(), httpStatus: response.status(),
    body: data, selectedDocumentId: doc.documentId, templateId: TEMPLATE,
    job: { documentId: doc.documentId, documentName: doc.title } });
  // Session headers never enter the result, report, error or console surfaces.
  let headers = await request.allHeaders();
  headers = Object.fromEntries(Object.entries(headers).filter(([key]) => !["host", "content-length", "connection", "accept-encoding"].includes(key.toLowerCase())));
  const read = async target => {
    requireProof(state.documentIds.has(target.documentId) && idValid(target.documentId), "STATUS_REPLAY_SCOPE_INVALID");
    await securityCheck(page, state, new URL(page.url()).pathname !== "/eform/document/view_service.html");
    const url = new URL(observed.href);
    url.pathname = `${LIST}/${target.documentId}/status`;
    requireProof(url.origin === observed.origin && url.origin === API && state.documentIds.has(target.documentId), "STATUS_REPLAY_SCOPE_INVALID");
    const response = await context.request.get(url.href, { headers, maxRedirects: 0, timeout: 20000, failOnStatusCode: false });
    try {
      if ([301, 302, 303, 307, 308, 401, 403, 429].includes(response.status())) stop("LOGIN_OR_SECURITY_STOP");
      const body = await response.json();
      const completionProof = parseCompletedRecipientStatus({ responseUrl: response.url(), method: "GET", httpStatus: response.status(), body,
        selectedDocumentId: target.documentId, templateId: TEMPLATE,
        job: { documentId: target.documentId, documentName: target.title } });
      return { completionProof, statusResponseHash: digest(body) };
    } finally { await response.dispose(); }
  };
  return { read, proof, href, statusResponseHash: digest(data), dispose: () => { headers = {}; } };
  } catch (error) {
    if (error.auditCode) throw error;
    stop(`BOOTSTRAP_${stage}_READ_INCOMPLETE`);
  } finally { page.off("response", observe); }
}

async function nativeMembers(context, documents, report) {
  await context.route("**/*", route => {
    if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.continue();
    report.blockedRequests.native_non_read = (report.blockedRequests.native_non_read || 0) + 1;
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage(), state = { securityStop: false };
  page.on("dialog", dialog => { state.securityStop = true; void dialog.dismiss().catch(() => {}); });
  let nativeOrigin;
  const scopedPhones = new Set(documents.map(doc => phone(doc.completionProof.recipients[0].phone)));
  const detailIds = new Set();
  const client = await captureStudioMateNativeApiClient(page, { fetchImpl: async (value, options) => {
    const url = new URL(value);
    requireProof(options.method === "GET" && url.protocol === "https:"
      && (url.hostname === "studiomate.kr" || url.hostname.endsWith(".studiomate.kr"))
      && (!nativeOrigin || nativeOrigin === url.origin), "NATIVE_GET_SCOPE_INVALID");
    nativeOrigin = url.origin;
    if (url.pathname === "/v2/staff/contract/member-list") {
      requireProof([...url.searchParams.keys()].length === 1 && scopedPhones.has(url.searchParams.get("search_word")), "NATIVE_GET_SCOPE_INVALID");
    } else requireProof(/^\/staff\/member\/[1-9]\d*$/.test(url.pathname) && detailIds.has(url.pathname.split("/").at(-1)) && !url.search, "NATIVE_GET_SCOPE_INVALID");
    const response = await fetch(url, { ...options, redirect: "error" });
    if ([401, 403, 429].includes(response.status)) { state.securityStop = true; stop("LOGIN_OR_SECURITY_STOP"); }
    return response;
  } });
  await securityCheck(page, state, false);
  requireProof(new URL(page.url()).origin === "https://arcpilates.studiomate.kr", "NATIVE_STUDIO_UNVERIFIED");
  const api = { get: async pathname => {
    const body = await client.get(pathname);
    if (pathname.startsWith("/v2/staff/contract/member-list?")) {
      const rows = Array.isArray(body) ? body : ["data", "items", "list", "rows", "results", "members"].map(key => body?.[key]).find(Array.isArray);
      requireProof(Array.isArray(rows) && (!body?.meta || (body.meta.last_page === 1 && body.meta.total === rows.length)), "NATIVE_SEARCH_COVERAGE_UNVERIFIED");
      for (const row of rows) if (/^[1-9]\d*$/.test(String(row?.id))) detailIds.add(String(row.id));
    }
    return body;
  } };
  for (const doc of documents) {
    try {
      await securityCheck(page, state, false);
      const recipient = doc.completionProof.recipients[0], result = await readExactStudioMateMember(api, recipient.phone);
      report.coverage.nativeMembers.attempted++;
      if (result.status !== "verified" || result.matchCount !== 1) {
        report.exclusions.push({ documentId: doc.documentId, reason: "native_exact_member_unverified" });
        continue;
      }
      const member = result.member;
      if (name(member.name) !== name(recipient.name) || phone(member.phone) !== phone(recipient.phone)
        || member.inactive !== false || !isInstructorMemberGrade(member.memberGrade)) {
        report.exclusions.push({ documentId: doc.documentId, reason: "native_identity_grade_or_active_mismatch" });
        continue;
      }
      const job = baselineSourceJob(doc, member);
      report.members.push({ documentId: doc.documentId, memberId: member.memberId, memberName: member.name,
        memberPhone: member.phone, memberGrade: member.memberGrade, inactive: member.inactive,
        birthday: member.birthday || "", checkedAt: new Date().toISOString(), job });
      report.coverage.nativeMembers.verified++;
    } catch (error) {
      if (state.securityStop) stop("LOGIN_OR_SECURITY_STOP");
      if (securityCode(error)) throw error;
      report.errors.push({ phase: "native_members", documentId: doc.documentId, code: "NATIVE_SOURCE_READ_INCOMPLETE" });
    }
  }
}

export async function runSourceAudit(args = process.argv.slice(2)) {
  const report = { version: 1, source: "instructor_signup_enrichment_native_sources_v2", studioId: "5330", templateId: TEMPLATE,
    account: ACCOUNT, startedAt: new Date().toISOString(), ok: false, sendAllowed: false, operationalWrites: 0,
    coverage: { complete: false, inventoryComplete: false, scopeComplete: false,
      documentStatus: { attempted: 0, verified: 0 }, nativeMembers: { attempted: 0, verified: 0 }, profiles: { attempted: 0, verified: 0 } },
    documents: [], members: [], rows: [], exclusions: [], errors: [], blockedRequests: {}, blockedRoutes: [], cleanup: [] };
  let output, file;
  try {
    const options = parseSourceArgs(args);
    await privateDirectory();
    output = path.join(DIRECTORY, `sources-${Date.now()}-${randomUUID()}.json`);
    file = await open(output, "wx", 0o600);
    const stat = await lstat(options.inventoryPath);
    requireProof(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0
      && await realpath(options.inventoryPath) === options.inventoryPath, "PRIVATE_INVENTORY_REQUIRED");
    const raw = await readFile(options.inventoryPath, "utf8"), inventory = JSON.parse(raw);
    const scope = validateSourceInventory(inventory, options.limit);
    report.inventory = { path: options.inventoryPath, sha256: digest(raw), count: scope.inventoryCount, limit: options.limit };
    report.coverage.inventoryComplete = true;
    report.coverage.scopeComplete = scope.scopeComplete;
    report.coverage.documentStatus.expected = scope.documents.length;
    if (scope.documents.length) await browserPhase("document_status", report, async context => {
      const { page, state } = await eformSession(context, report, scope.documents);
      const session = await bootstrapStatus(context, page, state, scope.documents[0]);
      try {
        for (const doc of scope.documents) {
          report.coverage.documentStatus.attempted++;
          try {
            const proof = doc.documentId === scope.documents[0].documentId
              ? { completionProof: session.proof, statusResponseHash: session.statusResponseHash } : await session.read(doc);
            report.documents.push({ ...doc, ...proof });
            report.coverage.documentStatus.verified++;
          } catch (error) {
            if (securityCode(error)) throw error;
            report.errors.push({ phase: "document_status", documentId: doc.documentId, code: "DOCUMENT_STATUS_READ_INCOMPLETE" });
          }
        }
      } finally { session.dispose(); }
    });
    const selection = selectLatestCompleted(report.documents);
    report.exclusions.push(...selection.excluded);
    report.coverage.nativeMembers.expected = selection.selected.length;
    if (selection.selected.length) await browserPhase("native_members", report, context => nativeMembers(context, selection.selected, report));
    const selected = selection.selected.filter(doc => report.members.some(member => member.documentId === doc.documentId));
    report.coverage.profiles.expected = selected.length;
    if (selected.length) await browserPhase("completed_profiles", report, async context => {
      const { page, state } = await eformSession(context, report, scope.documents);
      const session = await bootstrapStatus(context, page, state, scope.documents[0]);
      try {
        for (const doc of selected) {
          report.coverage.profiles.attempted++;
          try {
            const refreshed = await session.read(doc), previous = doc.completionProof, completionProof = refreshed.completionProof;
            requireProof(completionProof.providerCompletedAt === previous.providerCompletedAt
              && JSON.stringify(completionProof.recipients) === JSON.stringify(previous.recipients), "COMPLETION_CHANGED_DURING_AUDIT");
            const member = report.members.find(row => row.documentId === doc.documentId), job = member.job;
            state.viewerDocumentId = doc.documentId;
            const profile = await readCompletedSignupProfileV2(page, job, { found: true, text: `완료 ${doc.title}`,
              href: verifiedDocumentHref(doc), documentId: doc.documentId });
            await securityCheck(page, state, false);
            const row = verifiedSourceRow(doc, { memberId: member.memberId, name: member.memberName, phone: member.memberPhone,
              memberGrade: member.memberGrade, inactive: false }, profile, completionProof, member.checkedAt);
            report.rows.push({ ...row, statusResponseHash: refreshed.statusResponseHash });
            report.coverage.profiles.verified++;
          } catch (error) {
            if (securityCode(error)) throw error;
            report.errors.push({ phase: "completed_profiles", documentId: doc.documentId, code: "COMPLETED_PROFILE_READ_INCOMPLETE" });
          } finally { state.viewerDocumentId = null; }
        }
      } finally { session.dispose(); }
    });
    report.coverage.complete = scope.scopeComplete && report.coverage.documentStatus.verified === scope.documents.length
      && report.coverage.nativeMembers.attempted === selection.selected.length
      && report.coverage.profiles.verified === selected.length && report.errors.length === 0;
    report.ok = report.coverage.complete;
    for (const row of report.rows) row.eligibleForBaseline = report.ok;
  } catch (error) {
    report.errors.push({ phase: "audit", code: /^[A-Z_]+$/.test(error?.auditCode || "") ? error.auditCode : "SOURCE_AUDIT_READ_INCOMPLETE",
      ...(error.auditCode === "DOCUMENT_LINK_INVALID" && error.auditShape ? { nativeLinkShape: error.auditShape } : {}) });
    report.ok = false;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.coverage.complete = report.ok && report.cleanup.every(row => row.contextClosed && row.lockReleased);
    report.ok = report.coverage.complete;
    if (!report.ok) for (const row of report.rows) row.eligibleForBaseline = false;
    try {
      requireProof(file, "PRIVATE_OUTPUT_UNAVAILABLE");
      await file.writeFile(JSON.stringify(report, null, 2));
      await file.sync();
    } catch { report.ok = false; }
    try { await file?.close(); } catch { report.ok = false; }
    const exclusions = {};
    for (const row of report.exclusions) exclusions[row.reason] = (exclusions[row.reason] || 0) + 1;
    console.log(JSON.stringify({ status: report.ok ? "source_audit_complete" : "source_audit_read_incomplete", coverage: report.coverage,
      rows: report.rows.length, exclusions, errors: report.errors.map(row => ({ phase: row.phase, code: row.code })), output }));
    if (!report.ok) process.exitCode = 1;
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runSourceAudit();
