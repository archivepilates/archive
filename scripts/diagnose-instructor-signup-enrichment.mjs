import { createHash, randomUUID } from "node:crypto";
import { readFile, lstat, realpath, open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { browserPhase, eformSession, bootstrapStatus, validateSourceInventory, verifiedDocumentHref }
  from "./read-instructor-signup-enrichment-sources.mjs";
import { parseCompletedRecipientStatus } from "./lib/instructor-signup-order-identity.mjs";
import { SIGNUP_PROFILE_FIELDS } from "./lib/instructor-signup-profile.mjs";
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE, normalizeInstructorLessonName as name,
  normalizeInstructorLessonPhone as phone } from "./lib/instructor-lesson-registration-contract.mjs";

const DIRECTORY = "/Users/archivepilates/ArchiveIN/operations/instructor-signup-enrichment-20261030";
const SOURCE = `${DIRECTORY}/sources-1793289967373-16a8e894-caed-4330-960b-dbbac5dc1ba1.json`;
const API = "https://kr-service.eformsign.com";
const LIST = "/v1.0/companies/848f6dc7fa024a6cb28a2994c0835e53/documents";
const sha = value => createHash("sha256").update(value).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { auditCode: code }); };
const requireProof = (value, code) => { if (!value) fail(code); };
const empty = value => value == null || (Array.isArray(value) && value.length === 0);
const count = value => Array.isArray(value) ? value.length : null;
const numeric = value => value != null && value !== "" && Number.isSafeInteger(Number(value)) ? Number(value) : null;

export function diagnosticScope(source, inventory) {
  const scope = validateSourceInventory(inventory);
  requireProof(source?.source === "instructor_signup_enrichment_native_sources_v2" && source.templateId === TEMPLATE
    && source.coverage?.inventoryComplete === true && source.coverage.scopeComplete === true
    && source.coverage.documentStatus.attempted === 103 && scope.documents.length === 103
    && Array.isArray(source.errors) && Array.isArray(source.members)
    && source.cleanup?.length === 3 && source.cleanup.every(row => row.contextClosed && row.lockReleased), "SOURCE_SCOPE_INVALID");
  const statusIds = source.errors.filter(row => row.phase === "document_status" && row.code === "DOCUMENT_STATUS_READ_INCOMPLETE").map(row => row.documentId);
  const profileIds = source.errors.filter(row => row.phase === "completed_profiles" && row.code === "COMPLETED_PROFILE_READ_INCOMPLETE").slice(0, 2).map(row => row.documentId);
  requireProof(statusIds.length === 12 && new Set(statusIds).size === 12 && profileIds.length === 2
    && new Set(profileIds).size === 2 && [...statusIds, ...profileIds].every(id => scope.documents.some(doc => doc.documentId === id)), "DIAGNOSTIC_IDS_INVALID");
  return { documents: scope.documents, statusDocuments: statusIds.map(id => scope.documents.find(doc => doc.documentId === id)),
    profileDocuments: profileIds.map(id => scope.documents.find(doc => doc.documentId === id)) };
}

export function payloadShape(value, depth = 0) {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", count: value.length };
  if (typeof value !== "object") return { type: typeof value };
  const keys = Object.keys(value);
  if (depth >= 4) return { type: "object", keyCount: keys.length, truncated: true };
  return { type: "object", keyCount: keys.length, truncated: keys.length > 40,
    fields: Object.fromEntries(keys.slice(0, 40).map(key => [key.length <= 80 ? key : "<long-key>", payloadShape(value[key], depth + 1)])) };
}

export function phoneValueFlags(value, recipientPhone) {
  const raw = String(value ?? ""), trimmed = raw.trim(), digits = raw.replace(/\D/g, "");
  const recipient = phone(recipientPhone);
  return { empty: trimmed === "", rawLength: raw.length, digitCount: digits.length,
    starts010: digits.startsWith("010"), starts10: digits.startsWith("10"), starts8210: digits.startsWith("8210"),
    masked: /[*\u2022\u25cf\u25cb\u00d7#]|[xX]{2,}/.test(raw), containsHangul: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(raw),
    normalizedEqualsRecipient: /^010\d{8}$/.test(recipient) && phone(raw) === recipient,
    suffixLast8EqualsRecipient: digits.length >= 8 && /^010\d{8}$/.test(recipient) && digits.slice(-8) === recipient.slice(-8),
    valueIsDate: /^\d{6}$|^\d{8}$|^\d{4}[-./]\d{1,2}[-./]\d{1,2}$|^\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?$/.test(trimmed),
    valueIsEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) };
}

export function recipientFormatFlags(value) {
  const raw = typeof value === "string" ? value : "";
  return { memberItemType: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    rawLength: typeof value === "string" ? raw.length : null,
    looksEmail: /[^\s()<>@]+@[^\s()<>@]+\.[^\s()<>@]+/.test(raw),
    includesFullPhoneAnywhere: /(?<!\d)(?:\+?82[\s.-]*10|010)(?:[\s.-]*\d){8}(?!\d)/.test(raw),
    parenCount: { open: (raw.match(/\(/g) || []).length, close: (raw.match(/\)/g) || []).length } };
}

export function statusConditions({ body, httpStatus, responseUrl, doc, observedAt = new Date().toISOString() }) {
  const state = body?.result?.status, steps = Array.isArray(state?.steps) ? state.steps : [];
  const [start, participant, complete] = steps;
  const current = state?.current_infos?.[0];
  const observed = Date.parse(observedAt), accepted = Number(participant?.execute_date), completed = Number(complete?.execute_date);
  const recipient = typeof participant?.owner?.members?.[0] === "string"
    ? participant.owner.members[0].match(/^(.+?)\s*\((\+?[\d\s-]+)\)$/) : null;
  const providerTemplate = state?.form_id ?? state?.template_id;
  const conditions = {
    exactStatusPath: new URL(responseUrl).origin === API && new URL(responseUrl).pathname === `${LIST}/${doc.documentId}/status`,
    http200: httpStatus === 200, envelopeCode: String(body?.code) === "-1", envelopeStatus: String(body?.status) === "200",
    titleMatchesInventory: state?.document_title === doc.title, inventoryTemplateMatches: doc.templateId === TEMPLATE,
    threeSteps: steps.length === 3, oneCurrentInfo: Array.isArray(state?.current_infos) && state.current_infos.length === 1,
    createAction: start?.action === "doc_create", participantAction: participant?.action === "doc_accept_participant", completeAction: complete?.action === "doc_complete",
    createSeqOne: Number(start?.seq) === 1, participantSeqTwo: Number(participant?.seq) === 2, completeSeqThree: Number(complete?.seq) === 3,
    currentSeqMatchesComplete: Number(current?.step_seq) === Number(complete?.seq), currentWriterNull: current?.current_writer === null,
    noPendingExternalApproval: current?.waitingExternalApproval === false,
    participantTimePositive: Number.isFinite(accepted) && accepted > 0, completionTimePositive: Number.isFinite(completed) && completed > 0,
    completionTimeSafeInteger: Number.isSafeInteger(completed), completionTimeSince2000: completed >= 946684800000,
    completionNotBeforeParticipant: completed >= accepted, completionNotAfterObservation: completed <= observed,
    observationTimeValid: Number.isFinite(observed), oneRecipientMember: count(participant?.owner?.members) === 1,
    noRecipientGroups: empty(participant?.owner?.groups), noExternalCreators: empty(participant?.owner?.external_creators),
    recipientFormatRecognized: Boolean(recipient), recipientFullPhoneRecognized: Boolean(recipient && /^010\d{8}$/.test(phone(recipient[2]))),
  };
  let parserAccepted = false;
  try { parseCompletedRecipientStatus({ body, httpStatus, responseUrl, selectedDocumentId: doc.documentId,
    templateId: doc.templateId, method: "GET", job: { documentId: doc.documentId, documentName: doc.title }, observedAt }); parserAccepted = true; }
  catch { /* Only structural conditions are retained, never the provider body. */ }
  return { documentId: doc.documentId, parserAccepted, stepCount: count(state?.steps), currentInfoCount: count(state?.current_infos),
    titleMatchesInventory: conditions.titleMatchesInventory, template: { inventoryMatches: doc.templateId === TEMPLATE,
      providerIdPresent: providerTemplate != null, providerIdMatches: providerTemplate == null ? null : providerTemplate === TEMPLATE },
    steps: steps.slice(0, 12).map(step => ({ action: /^doc_[a-z_]{1,60}$/.test(step?.action || "") ? step.action : "other_or_missing",
      seq: numeric(step?.seq), executeDateType: typeof step?.execute_date, executeDatePresent: step?.execute_date != null,
      executeDatePositive: Number.isFinite(Number(step?.execute_date)) && Number(step?.execute_date) > 0,
      memberCount: count(step?.owner?.members), groupCount: count(step?.owner?.groups), externalCreatorCount: count(step?.owner?.external_creators) })),
    current: { seq: numeric(current?.step_seq), writerPresent: current?.current_writer != null,
      waitingExternalApproval: typeof current?.waitingExternalApproval === "boolean" ? current.waitingExternalApproval : null },
    conditions, failedConditions: Object.entries(conditions).filter(([, valid]) => !valid).map(([key]) => key) };
}

async function privateJson(file) {
  requireProof(path.dirname(file) === DIRECTORY && await realpath(file) === file, "PRIVATE_INPUT_REQUIRED");
  const stat = await lstat(file);
  requireProof(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, "PRIVATE_INPUT_REQUIRED");
  const raw = await readFile(file, "utf8");
  return { value: JSON.parse(raw), hash: sha(raw) };
}

async function checkSecurity(page, state) {
  if (state.securityStop || /login|signin|captcha|\/auth\//i.test(new URL(page.url()).pathname)
    || await page.locator('input[type="password"]:visible').count()) fail("LOGIN_OR_SECURITY_STOP");
}

async function inspectFields(page, state, doc, job) {
  const result = { documentId: doc.documentId, fields: {}, stage: "viewer_navigation", completed: false };
  state.viewerDocumentId = doc.documentId;
  try {
    await page.goto(verifiedDocumentHref(doc), { waitUntil: "domcontentloaded", timeout: 15000 });
    await checkSecurity(page, state);
    result.stage = "viewer_frame_attached";
    const iframe = page.locator("#viewer_frame");
    try { await iframe.waitFor({ state: "attached", timeout: 2000 }); } catch { /* Record a bounded missing-frame result. */ }
    result.frameCount = await iframe.count();
    if (result.frameCount !== 1) return result;
    const frame = await (await iframe.elementHandle()).contentFrame();
    if (!frame) return result;
    let failedStage;
    for (const [key, id] of Object.entries(SIGNUP_PROFILE_FIELDS)) {
      result.stage = `${key}_attached`;
      const field = frame.locator(`#${id}`);
      try { await field.first().waitFor({ state: "attached", timeout: 2000 }); } catch { /* No long per-field retry. */ }
      const shape = await field.evaluateAll(nodes => ({ attached: nodes.length,
        visible: nodes.filter(node => Boolean(node.getClientRects().length) && getComputedStyle(node).visibility !== "hidden").length }));
      if (key === "memberName" && shape.attached === 1) shape.matchesCanonical = await field.evaluate((node, expected) =>
        String(node.value || "").replace(/\s+/g, "").trim() === expected, name(job.memberName).replace(/\s+/g, ""));
      if (key === "memberPhone" && shape.attached === 1) shape.matchesCanonical = await field.evaluate((node, expected) => {
        let value = String(node.value || "").replace(/\D/g, "");
        if (value.startsWith("82")) value = "0" + value.slice(2);
        return value === expected;
      }, phone(job.memberPhone));
      result.fields[key] = shape;
      if (!failedStage && (shape.attached !== 1 || shape.visible !== 1)) failedStage = `${key}_${shape.attached !== 1 ? "attached" : "visible"}`;
      if (!failedStage && shape.matchesCanonical === false) failedStage = `${key}_canonical_match`;
    }
    result.stage = failedStage || "all_fields_present_identity_matches";
    result.completed = !failedStage;
    await checkSecurity(page, state);
    return result;
  } catch (error) {
    if (error.auditCode === "LOGIN_OR_SECURITY_STOP") throw error;
    result.errorCode = "BOUNDED_VIEWER_DIAGNOSTIC_INCOMPLETE";
    return result;
  } finally { state.viewerDocumentId = null; }
}

async function inspectPhoneField(page, state, doc, recipientPhone) {
  const result = { documentId: doc.documentId, stage: "viewer_navigation", completed: false };
  state.viewerDocumentId = doc.documentId;
  try {
    await page.goto(verifiedDocumentHref(doc), { waitUntil: "domcontentloaded", timeout: 15000 });
    await checkSecurity(page, state);
    result.stage = "viewer_frame_attached";
    const iframe = page.locator("#viewer_frame");
    try { await iframe.waitFor({ state: "attached", timeout: 2000 }); } catch { /* Bounded diagnostic only. */ }
    if (await iframe.count() !== 1) return result;
    const frame = await (await iframe.elementHandle()).contentFrame();
    if (!frame) return result;
    const field = frame.locator(`#${SIGNUP_PROFILE_FIELDS.memberPhone}`);
    result.stage = "memberPhone_attached";
    try { await field.first().waitFor({ state: "attached", timeout: 2000 }); } catch { /* Bounded diagnostic only. */ }
    result.field = await field.evaluateAll(nodes => ({ attached: nodes.length,
      visible: nodes.filter(node => Boolean(node.getClientRects().length) && getComputedStyle(node).visibility !== "hidden").length }));
    if (result.field.attached !== 1 || result.field.visible !== 1) return result;
    result.flags = phoneValueFlags(await field.inputValue({ timeout: 2000 }), recipientPhone);
    result.stage = "phone_format_flags_recorded";
    result.completed = true;
    await checkSecurity(page, state);
    return result;
  } catch (error) {
    if (error.auditCode === "LOGIN_OR_SECURITY_STOP") throw error;
    result.errorCode = "BOUNDED_PHONE_DIAGNOSTIC_INCOMPLETE";
    return result;
  } finally { state.viewerDocumentId = null; }
}

export async function runDiagnostic(args = process.argv.slice(2)) {
  const report = { version: 1, source: "instructor_signup_incremental_diagnostic", startedAt: new Date().toISOString(),
    diagnosticComplete: false, operationalWrites: 0, sendAllowed: false, statusChecks: [], profileChecks: [], openPosts: [],
    errors: [], blockedRequests: {}, blockedRoutes: [], cleanup: [] };
  let output, file, nativeRequest, headers, activeProfileId = null;
  try {
    requireProof(args.length <= 2 && new Set(args).size === args.length
      && args.every(arg => ["--format-flags-only", `--sources=${SOURCE}`].includes(arg)), "EXACT_SOURCE_ARGUMENT_REQUIRED");
    const flagsOnly = args.includes("--format-flags-only");
    report.mode = flagsOnly ? "phone_and_recipient_format_flags_only" : "status_and_viewer_structure";
    const source = await privateJson(SOURCE), inventory = await privateJson(source.value.inventory?.path);
    requireProof(inventory.hash === source.value.inventory.sha256, "INVENTORY_HASH_CHANGED");
    const scope = diagnosticScope(source.value, inventory.value);
    report.input = { path: SOURCE, hash: source.hash, inventoryHash: inventory.hash };
    const directory = await lstat(DIRECTORY);
    requireProof(directory.isDirectory() && (directory.mode & 0o077) === 0 && await realpath(DIRECTORY) === DIRECTORY, "PRIVATE_DIRECTORY_REQUIRED");
    output = `${DIRECTORY}/diagnostic-${Date.now()}-${randomUUID()}.json`;
    file = await open(output, "wx", 0o600);
    await browserPhase("incremental_diagnostic", report, async context => {
      const { page, state } = await eformSession(context, report, scope.documents);
      page.setDefaultTimeout(2000);
      const anchor = scope.documents[0];
      const capture = request => {
        const url = new URL(request.url());
        if (request.method() === "GET" && url.origin === API && url.pathname === `${LIST}/${anchor.documentId}/status`) nativeRequest = request;
      };
      page.on("request", capture);
      const bootstrap = await bootstrapStatus(context, page, state, anchor);
      page.off("request", capture);
      requireProof(nativeRequest, "NATIVE_STATUS_CAPTURE_MISSING");
      headers = await nativeRequest.allHeaders();
      const observedUrl = new URL(nativeRequest.url());
      const allowed = new Set([...scope.statusDocuments, ...scope.profileDocuments].map(doc => doc.documentId));
      const profileIds = new Set(scope.profileDocuments.map(doc => doc.documentId));
      const nativeRecipients = new Map();
      const read = async doc => {
        requireProof(allowed.has(doc.documentId), "DIAGNOSTIC_READ_SCOPE_INVALID");
        await checkSecurity(page, state);
        const url = new URL(observedUrl.href); url.pathname = `${LIST}/${doc.documentId}/status`;
        const response = await context.request.get(url.href, { headers, timeout: 15000, maxRedirects: 0, failOnStatusCode: false });
        try {
          if ([301, 302, 303, 307, 308, 401, 403, 429].includes(response.status())) fail("LOGIN_OR_SECURITY_STOP");
          const body = await response.json();
          const status = statusConditions({ body, httpStatus: response.status(), responseUrl: response.url(), doc });
          if (profileIds.has(doc.documentId) && status.parserAccepted) {
            const proof = parseCompletedRecipientStatus({ body, httpStatus: response.status(), responseUrl: response.url(),
              selectedDocumentId: doc.documentId, templateId: doc.templateId, method: "GET", job: { documentId: doc.documentId, documentName: doc.title } });
            nativeRecipients.set(doc.documentId, proof.recipients[0].phone);
          }
          if (!flagsOnly) return status;
          const members = body?.result?.status?.steps?.[1]?.owner?.members;
          return { documentId: doc.documentId, parserAccepted: status.parserAccepted,
            titleMatchesInventory: status.titleMatchesInventory, memberCount: count(members),
            memberItems: Array.isArray(members) ? members.slice(0, 8).map(recipientFormatFlags) : [],
            truncated: Array.isArray(members) && members.length > 8 };
        } finally { await response.dispose(); }
      };
      try {
        for (const doc of scope.statusDocuments) {
          try { report.statusChecks.push(await read(doc)); }
          catch (error) {
            if (error.auditCode === "LOGIN_OR_SECURITY_STOP") throw error;
            report.statusChecks.push({ documentId: doc.documentId, errorCode: "STATUS_TRANSPORT_OR_JSON_INCOMPLETE" });
          }
        }
        await context.route("**/*", async route => {
          const request = route.request(), url = new URL(request.url());
          if (request.method() !== "POST" || url.origin !== API || !activeProfileId
            || url.pathname !== `${LIST}/${activeProfileId}/open`) return route.fallback();
          let shape;
          try { shape = payloadShape(request.postDataJSON()); } catch { shape = { type: "not_json_or_empty" }; }
          report.openPosts.push({ documentId: activeProfileId, method: "POST", origin: API,
            path: `${LIST}/${activeProfileId}/open`, queryKeys: [...url.searchParams.keys()], bodyShape: shape, abortedBeforeDispatch: true });
          return route.abort("blockedbyclient");
        });
        for (const doc of scope.profileDocuments) {
          const status = await read(doc);
          if (!status.parserAccepted) { report.profileChecks.push({ documentId: doc.documentId, stage: "current_status_not_verified", status }); continue; }
          const job = source.value.members.find(member => member.documentId === doc.documentId)?.job;
          requireProof(job?.documentId === doc.documentId && job.studioId === "5330", "PROFILE_MEMBER_BINDING_MISSING");
          requireProof(/^010\d{8}$/.test(nativeRecipients.get(doc.documentId) || "")
            && nativeRecipients.get(doc.documentId) === phone(job.memberPhone), "PROFILE_NATIVE_RECIPIENT_CHANGED");
          activeProfileId = doc.documentId;
          report.profileChecks.push(flagsOnly ? await inspectPhoneField(page, state, doc, nativeRecipients.get(doc.documentId))
            : await inspectFields(page, state, doc, job));
          activeProfileId = null;
        }
        report.diagnosticComplete = report.statusChecks.length === 12 && report.profileChecks.length === 2;
      } finally { headers = null; nativeRequest = null; bootstrap.dispose(); }
    });
  } catch (error) {
    report.errors.push({ code: /^[A-Z_]+$/.test(error.auditCode || "") ? error.auditCode : "INCREMENTAL_DIAGNOSTIC_INCOMPLETE" });
    report.diagnosticComplete = false;
  } finally {
    headers = null; nativeRequest = null;
    report.finishedAt = new Date().toISOString();
    report.diagnosticComplete &&= report.cleanup.every(row => row.contextClosed && row.lockReleased);
    try { requireProof(file, "PRIVATE_OUTPUT_UNAVAILABLE"); await file.writeFile(JSON.stringify(report, null, 2)); await file.sync(); }
    catch { report.diagnosticComplete = false; }
    try { await file?.close(); } catch { report.diagnosticComplete = false; }
    console.log(JSON.stringify({ status: report.diagnosticComplete ? "diagnostic_complete" : "diagnostic_incomplete",
      statusesInspected: report.statusChecks.length, statusParserAccepted: report.statusChecks.filter(row => row.parserAccepted).length,
      profilesInspected: report.profileChecks.length, blockedOpenPosts: report.openPosts.length,
      profileStages: report.profileChecks.map(row => row.stage), errors: report.errors, cleanup: report.cleanup, output }));
    if (!report.diagnosticComplete) process.exitCode = 1;
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runDiagnostic();
