#!/usr/bin/env node
// Operator-run only. Importing this module performs no I/O or authentication.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUEST_ID = 'meal-test-20261029-3minute-v2';
export const OPERATION = 'saveRecommendedMealProgramDraft';
export const ACTION_KEYS = Object.freeze({
  stage: `${REQUEST_ID}-mcp-stage-v1`,
  restore: `${REQUEST_ID}-mcp-restore-v1`,
});
export const COLLECTIONS = Object.freeze({
  request: 'recommendedMealProgramRequests', response: 'recommendedMealProgramResponses',
  draft: 'recommendedMealProgramDrafts', report: 'recommendedMealProgramReports',
});
export const SUFFIX = ' [MCP draft test]';
export const RUNTIME_PACKAGE = '/Users/archivepilates/dev/archive-in-runtime/services/archive-core-mcp/package.json';
const HASH = /^[a-f0-9]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (condition, code) => { if (!condition) fail(code); };
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const same = (a, b, code) => check(a !== undefined && b !== undefined && digest(a) === digest(b), code);
export const revisionFor = (sourceHash, content) => digest({ sourceHash, content });

export function responseHash(response) {
  return digest({ answers: response.answers && typeof response.answers === 'object' && !Array.isArray(response.answers)
    ? response.answers : {},
  reviewReasons: Array.isArray(response.reviewReasons)
    ? response.reviewReasons.map(v => String(v ?? '').trim().slice(0, 80)).filter(Boolean).slice(0, 20) : [],
  submittedAt: typeof response.submittedAt?.toDate === 'function' ? response.submittedAt.toDate().toISOString() : '' });
}

// Reject anything the native normalizer would drop, coerce, trim or truncate.
export function validateContent(content) {
  const limits = { title: 120, summary: 800, goal: 300, metricsSummary: 800,
    hydration: 600, exerciseNutrition: 600, weekendStrategy: 600, caution: 800 };
  const exactKeys = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|'), 'PUBLIC_SCHEMA_CHANGED');
  const text = (value, max, required = false) => check(typeof value === 'string'
    && value === value.trim() && value.length <= max && (!required || value.length > 0), 'PUBLIC_TEXT_INVALID');
  exactKeys(content, [...Object.keys(limits), 'principles', 'days']);
  for (const [key, max] of Object.entries(limits)) text(content[key], max, ['title', 'summary', 'goal', 'caution'].includes(key));
  check(Array.isArray(content.principles) && content.principles.length <= 6, 'PUBLIC_PRINCIPLES_INVALID');
  content.principles.forEach(v => text(v, 300, true));
  check(Array.isArray(content.days) && content.days.length === 7, 'PUBLIC_DAYS_INVALID');
  content.days.forEach((day, index) => {
    const fields = { label: 30, breakfast: 500, lunch: 500, dinner: 500, snack: 400, timingTip: 400 };
    exactKeys(day, ['day', ...Object.keys(fields)]);
    check(day.day === index + 1, 'PUBLIC_DAY_INVALID');
    for (const [key, max] of Object.entries(fields)) text(day[key], max, !['snack', 'timingTip'].includes(key));
  });
  return content;
}

export function buildParams(bundle, publicContent) {
  validateContent(publicContent);
  return { requestId: REQUEST_ID, expectedRevision: bundle.draft.revision,
    expectedResponseHash: responseHash(bundle.response), publicContent: structuredClone(publicContent),
    authoringMode: 'codex_operator', reviewAcknowledged: !!bundle.draft.reviewAcknowledgedAt };
}

export function stagedContent(original) {
  validateContent(original);
  check(!original.weekendStrategy.includes(SUFFIX.trim()), 'TEST_SUFFIX_ALREADY_PRESENT');
  const next = structuredClone(original);
  next.weekendStrategy += SUFFIX;
  check(next.weekendStrategy.length < 600, 'NO_NATIVE_FIELD_HEADROOM');
  return validateContent(next);
}

export function assertNative(bundle) {
  for (const key of Object.keys(COLLECTIONS)) {
    check(bundle[key] && bundle[key].requestId === REQUEST_ID, 'EXACT_SOURCE_REQUIRED');
    check(String(bundle[key].studioId) === '5330', 'STUDIO_CHANGED');
    check(bundle[key].memberId === bundle.request.memberId && !!bundle.request.memberId, 'IDENTITY_CHANGED');
  }
  check(bundle.request.status === 'submitted', 'SOURCE_NOT_SUBMITTED');
  check(bundle.draft.provider === 'operator_assisted' && bundle.draft.model === 'codex-chat', 'AUTHORING_MODE_CHANGED');
  check(bundle.report.approvalStatus === 'draft' && bundle.report.publicationStatus === 'draft', 'REPORT_NOT_DRAFT');
  check(!['candidateId', 'approvedSnapshot', 'publishedSnapshot', 'sentSnapshot', 'approvedAt', 'publishedAt',
    'sentAt', 'sentRevision', 'approvedRevision'].some(key => bundle.report[key]), 'PUBLICATION_OR_SEND_PRESENT');
  check(Array.isArray(bundle.response.reviewReasons) && bundle.response.reviewReasons.length === 0
    && !bundle.draft.reviewAcknowledgedAt && !(bundle.draft.reviewReasons || []).length, 'REVIEW_STATE_CHANGED');
  validateContent(bundle.draft.publicContent);
  const source = responseHash(bundle.response);
  check(bundle.draft.sourceResponseHash === source && HASH.test(bundle.draft.revision)
    && bundle.draft.revision === revisionFor(source, bundle.draft.publicContent), 'NATIVE_REVISION_MISMATCH');
  check(bundle.request.draftRevision === bundle.draft.revision
    && bundle.report.reportRevision === bundle.draft.revision, 'LINKED_REVISION_MISMATCH');
}

export function assertReview(review, bundle) {
  assertNative(bundle);
  check(review.ok === true && review.requestId === REQUEST_ID && review.responseHash === responseHash(bundle.response)
    && review.draft?.revision === bundle.draft.revision && review.draft.provider === 'operator_assisted'
    && review.draft.model === 'codex-chat' && review.report?.approvalStatus === 'draft'
    && review.report?.publicationStatus === 'draft', 'MCP_NATIVE_REVIEW_MISMATCH');
  same(review.draft.publicContent, bundle.draft.publicContent, 'MCP_PUBLIC_CONTENT_MISMATCH');
}

export function assertSourceUnchanged(before, current) {
  assertNative(current);
  same(before.response, current.response, 'RESPONSE_CHANGED');
  same(omit(before.request, ['updatedAt', 'draftRevision', 'recommendationStatus']),
    omit(current.request, ['updatedAt', 'draftRevision', 'recommendationStatus']), 'REQUEST_SOURCE_CHANGED');
  check(current.request.recommendationStatus === 'awaiting_operator_review', 'REQUEST_WORKFLOW_CHANGED');
  check(current.draft.status === 'operator_edited', 'DRAFT_WORKFLOW_CHANGED');
  same(omit(before.report, ['updatedAt', 'reportRevision']), omit(current.report, ['updatedAt', 'reportRevision']), 'REPORT_SOURCE_CHANGED');
  same(omit(before.draft, ['publicContent', 'revision', 'status', 'editedAt', 'updatedAt', 'editedByUid', 'editedByName']),
    omit(current.draft, ['publicContent', 'revision', 'status', 'editedAt', 'updatedAt', 'editedByUid', 'editedByName']), 'DRAFT_SOURCE_CHANGED');
  for (const [id, record] of Object.entries(before.revisions)) same(record, current.revisions[id], 'PRIOR_HISTORY_CHANGED');
}

export function assertTransition(before, current, content, priorDraft) {
  assertSourceUnchanged(before, current);
  same(current.draft.publicContent, content, 'CURRENT_CONTENT_NOT_EXACT_TEST');
  check(current.draft.revision === revisionFor(responseHash(before.response), content), 'CURRENT_REVISION_NOT_EXACT_TEST');
  const archived = current.revisions[priorDraft.revision];
  check(!!archived, 'PRIOR_REVISION_NOT_ARCHIVED');
  if (before.revisions[priorDraft.revision]) {
    // Native history is immutable even when a content-derived revision is revisited.
    same(archived.publicContent, priorDraft.publicContent, 'ARCHIVED_CONTENT_MISMATCH');
    check(archived.revision === priorDraft.revision && archived.sourceResponseHash === priorDraft.sourceResponseHash,
      'ARCHIVED_SOURCE_MISMATCH');
  } else {
    same(omit(archived, ['preservedAt', 'supersededByRevision']), priorDraft, 'ARCHIVED_DRAFT_MISMATCH');
    check(archived.supersededByRevision === current.draft.revision, 'ARCHIVE_LINK_MISMATCH');
  }
  const allowed = new Set([...Object.keys(before.revisions), priorDraft.revision]);
  check(Object.keys(current.revisions).every(id => allowed.has(id)), 'UNEXPECTED_REVISION');
}

export function proof(bundle) {
  return { documents: Object.fromEntries(Object.keys(COLLECTIONS).map(key => [key, {
    path: `${COLLECTIONS[key]}/${REQUEST_ID}`, hash: digest(bundle[key]), updateTime: bundle.updateTimes?.[key] ?? null,
  }])), revision: bundle.draft.revision, publicContentHash: digest(bundle.draft.publicContent),
  responseHash: responseHash(bundle.response), revisions: Object.fromEntries(Object.entries(bundle.revisions)
    .map(([id, record]) => [id, digest(record)])) };
}

// write() is an append-only private audit sink; canonical reads never use MCP projections.
export async function runMealTest({ apply = false, review, readCanonical, callTool, write }) {
  let writeAttempted = false;
  try {
    const before = await readCanonical();
    assertReview(await review(), before);
    check(before.draft.revision.startsWith('0b5e'), 'APPROVED_BASELINE_CHANGED');
    const content = stagedContent(before.draft.publicContent);
    await write('baseline', { ...proof(before), originalPublicContent: before.draft.publicContent,
      provider: before.draft.provider, model: before.draft.model, actionKeys: ACTION_KEYS });
    if (!apply) return { ok: true, mode: 'read-only', requestId: REQUEST_ID,
      revision: before.draft.revision, responseHash: responseHash(before.response), modelApiCalled: false,
      writesAttempted: false, published: false, sent: false };

    async function change(phase, expected, nextContent, guard) {
      const params = buildParams(expected, nextContent);
      await write(`${phase}-prepare-intent`, { actionKey: ACTION_KEYS[phase], operation: OPERATION, paramsHash: digest(params) });
      const prepared = await callTool('core_action_prepare', { operation: OPERATION, params, actionKey: ACTION_KEYS[phase] });
      const plan = prepared.result;
      check(prepared.ok === true && plan?.operation === OPERATION && HASH.test(plan.planHash)
        && typeof plan.planId === 'string' && plan.planId.length > 0
        && plan.requiredConfirmation === `${OPERATION}:${plan.planHash}`, 'INVALID_PREPARED_PLAN');
      // Independently recheck the exact native state AFTER prepare, immediately BEFORE execute.
      const fresh = await readCanonical();
      guard(fresh);
      same(proof(expected), proof(fresh), 'NATIVE_CHANGED_BEFORE_EXECUTE');
      assertReview(await review(), fresh);
      await write(`${phase}-execute-intent`, { planId: plan.planId, planHash: plan.planHash,
        intentId: plan.intentId, actionKey: ACTION_KEYS[phase], before: proof(fresh),
        expectedContentHash: digest(nextContent), expectedRevision: revisionFor(responseHash(fresh.response), nextContent) });
      let returned = false;
      writeAttempted = true;
      try {
        const result = await callTool('core_action_execute', { planId: plan.planId, planHash: plan.planHash,
          confirmation: plan.requiredConfirmation });
        returned = result.ok === true && result.result?.requestCompleted === true;
      } catch { /* Canonical readback, never a second execute, determines the next step. */ }
      await write(`${phase}-transport`, { handlerReturned: returned, outcome: returned ? 'readback_required' : 'uncertain_no_retry' });
      const after = await readCanonical();
      await write(`${phase}-readback`, proof(after));
      assertTransition(expected, after, nextContent, expected.draft);
      // A confirmed native mutation may still have an unresolved MCP scope. The existing
      // MCP guards remain authoritative; restoration must not bypass an uncertain intent.
      return after;
    }

    const staged = await change('stage', before, content, fresh => {
      assertNative(fresh);
      same(proof(before), proof(fresh), 'BASELINE_CHANGED');
    });
    await write('stage-verified', { ...proof(staged), responsePreserved: true, restoreRequired: true });
    const restored = await change('restore', staged, before.draft.publicContent,
      fresh => assertTransition(before, fresh, content, before.draft));
    assertSourceUnchanged(before, restored);
    same(restored.draft.publicContent, before.draft.publicContent, 'RESTORE_CONTENT_MISMATCH');
    check(restored.draft.revision === before.draft.revision, 'RESTORE_REVISION_MISMATCH');
    await write('complete', { ...proof(restored), restored: true, responsePreserved: true,
      approvalStatus: 'draft', publicationStatus: 'draft', published: false, sent: false });
    return { ok: true, mode: 'apply', requestId: REQUEST_ID, restored: true,
      responsePreserved: true, published: false, sent: false, modelApiCalled: false };
  } catch (error) {
    // Never serialize provider errors, params, raw answers, phones or credentials.
    const code = /^[A-Z_]{3,80}$/.test(error?.code || '') ? error.code : 'CHECK_STOPPED';
    await write('blocked', { code, writeAttempted, automaticRetry: false, automaticRestore: false,
      nextAction: 'Inspect private canonical proof and MCP intent; do not replay either action key.' });
    fail(code);
  }
}

export async function createAudit(directory) {
  check(path.isAbsolute(directory), 'PRIVATE_AUDIT_PATH_REQUIRED');
  // Reject symlinked ancestors, permissive audit directories and reused apply runs.
  let parent = path.parse(directory).root;
  for (const part of path.relative(parent, directory).split(path.sep)) {
    parent = path.join(parent, part);
    try { await mkdir(parent, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await lstat(parent);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'AUDIT_SYMLINK_BLOCKED');
  }
  const stat = await lstat(directory);
  check(stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700, 'PRIVATE_AUDIT_PERMISSIONS_REQUIRED');
  let index = 0;
  async function write(event, data) {
    check(/^[a-z-]+$/.test(event), 'INVALID_AUDIT_EVENT');
    const handle = await open(path.join(directory, `${String(index++).padStart(3, '0')}-${event}.json`),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify({ event, at: new Date().toISOString(), requestId: REQUEST_ID, ...data }, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
  }
  // This exclusive immutable marker blocks reruns even if a previous process stopped.
  await write('run', { replayAllowed: false });
  return write;
}

export async function main(args = process.argv.slice(2)) {
  check(args.length <= 1 && args.every(arg => arg === '--apply'), 'ONLY_EXPLICIT_APPLY_ALLOWED');
  const apply = args.includes('--apply');
  const directory = path.join(os.homedir(), 'ArchiveIN/operations/core-mcp-meal-test', REQUEST_ID,
    apply ? 'apply-v1' : `read-${randomUUID()}`);
  const write = await createAudit(directory);
  let client, transport, app, deleteApp;
  try {
    // Use the dependencies of the registered runtime package, not worktree node_modules.
    const require = createRequire(pathToFileURL(RUNTIME_PACKAGE));
    const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
    const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
    const firebaseApp = require('firebase-admin/app');
    deleteApp = firebaseApp.deleteApp;
    const { getFirestore } = require('firebase-admin/firestore');
    const key = JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'));
    check(key.project_id === 'archive-pilates'
      && key.client_email === 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com', 'WRONG_OPERATOR_ACCOUNT');
    check(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, 'EMULATOR_NOT_CANONICAL');
    app = firebaseApp.initializeApp({ credential: firebaseApp.cert(key), projectId: 'archive-pilates' }, `meal-proof-${randomUUID()}`);
    const db = getFirestore(app);
    const readCanonical = () => db.runTransaction(async tx => {
      const bundle = { revisions: {}, updateTimes: {} };
      for (const [key, collection] of Object.entries(COLLECTIONS)) {
        const snap = await tx.get(db.collection(collection).doc(REQUEST_ID));
        check(snap.exists, 'CANONICAL_DOCUMENT_MISSING');
        bundle[key] = snap.data();
        bundle.updateTimes[key] = { seconds: snap.updateTime.seconds, nanoseconds: snap.updateTime.nanoseconds };
      }
      const history = await tx.get(db.collection(COLLECTIONS.draft).doc(REQUEST_ID).collection('revisions'));
      for (const snap of history.docs) bundle.revisions[snap.id] = snap.data();
      return bundle;
    }, { readOnly: true });
    const runtimeRoot = fileURLToPath(new URL('../../', pathToFileURL(RUNTIME_PACKAGE)));
    transport = new StdioClientTransport({ command: '/opt/homebrew/bin/node',
      args: [fileURLToPath(new URL('./src/index.mjs', pathToFileURL(RUNTIME_PACKAGE)))], cwd: runtimeRoot,
      env: { PATH: process.env.PATH || '', HOME: os.homedir(), ARCHIVE_CORE_MCP_STAFF_ID: '1979746' }, stderr: 'pipe' });
    // Do not relay server stderr: even a dependency error can contain private paths/values.
    transport.stderr?.on('data', () => {});
    client = new Client({ name: 'archive-core-meal-mcp-test', version: '1.0.0' });
    console.log(JSON.stringify({ target: 'archive-pilates', account: key.client_email,
      mode: apply ? 'apply-draft-and-restore' : 'read-only', requestId: REQUEST_ID }));
    await client.connect(transport);
    const catalog = await client.listTools();
    check(['core_meal_review', 'core_action_prepare', 'core_action_execute'].every(name => catalog.tools.some(t => t.name === name)), 'REGISTERED_TOOLS_MISSING');
    const callTool = async (name, params) => {
      check(['core_meal_review', 'core_action_prepare', 'core_action_execute'].includes(name), 'TOOL_NOT_ALLOWED');
      check(apply || name === 'core_meal_review', 'READ_ONLY_MODE');
      const result = await client.callTool({ name, arguments: params }, undefined, { timeout: 180000 });
      check(!result.isError && result.structuredContent?.ok === true, 'MCP_TOOL_FAILED');
      return result.structuredContent;
    };
    const result = await runMealTest({ apply, readCanonical, callTool, write,
      review: () => callTool('core_meal_review', { requestId: REQUEST_ID }) });
    console.log(JSON.stringify({ ...result, auditDirectory: directory }));
    return result;
  } catch {
    await write('execution-blocked', { automaticRetry: false, nextAction: 'Inspect audit before any follow-up; no action-key replay.' });
    fail('MEAL_MCP_TEST_BLOCKED');
  } finally {
    try { await client?.close(); }
    finally { try { await transport?.close(); } finally { if (app) await deleteApp(app); } }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('Meal MCP test blocked. Inspect private audit; do not replay.'); process.exitCode = 1; });
}
