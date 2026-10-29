import { readFile, mkdir, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assert, hash } from '../src/safety.mjs';

assert(process.argv.length === 3 && process.argv[2] === '--apply', 'EXPLICIT_TEST_REQUIRED', 'Use --apply for the approved isolated internal test.');
const noteId = 'core_mcp_connection_test_20261029';
const mealId = 'meal-test-20261029-3minute-v2';
const app = initializeApp({ credential: cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'))), projectId: 'archive-pilates' });
const db = getFirestore(app);
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, ARCHIVE_CORE_MCP_STAFF_ID: '1979746' }, stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const client = new Client({ name: 'archive-core-mcp-isolated-write-test', version: '1.0.0' });
const audit = { testId: 'core-mcp-live-20261029', startedAt: new Date().toISOString(), actions: [], memberMessages: 0, published: false };
let auditFile;
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, result.structuredContent?.error?.code || 'MCP_TEST_FAILED', 'MCP live test stopped; inspect private receipt before retry.');
  return result.structuredContent;
}
async function execute(operation, params, suffix) {
  const prepared = (await call('core_action_prepare', { operation, params, actionKey: `core-mcp-live-20261029-${suffix}` })).result;
  audit.actions.push({ operation, intentId: prepared.intentId, planId: prepared.planId, planHash: prepared.planHash });
  const result = await call('core_action_execute', { planId: prepared.planId, planHash: prepared.planHash, confirmation: prepared.requiredConfirmation });
  return { result, prepared };
}
async function mealEvidence() {
  const evidence = {};
  for (const collection of ['recommendedMealProgramRequests', 'recommendedMealProgramResponses', 'recommendedMealProgramDrafts', 'recommendedMealProgramReports'])
    evidence[collection] = hash((await db.collection(collection).doc(mealId).get()).data() || null);
  const revisions = await db.collection('recommendedMealProgramDrafts').doc(mealId).collection('revisions').get();
  evidence.revisions = hash(revisions.docs.map(s => ({ id: s.id, data: s.data() })));
  for (const collection of ['alimtalkCandidates', 'alimtalkSends'])
    for (const id of [`${mealId}-invite`, `${mealId}-report`]) evidence[`${collection}/${id}`] = hash((await db.collection(collection).doc(id).get()).data() || null);
  return evidence;
}
try {
  const dir = path.join(os.homedir(), 'ArchiveIN/operations/core-mcp');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  auditFile = await open(path.join(dir, 'live-test-20261029.json'), 'wx', 0o600);
  assert(!(await db.collection('sequenceNotes').doc(noteId).get()).exists, 'TEST_SOURCE_EXISTS', 'Do not overwrite or replay an existing test note.');
  const actor = (await db.collection('staffs').doc('1979746').get()).data();
  await client.connect(transport);
  const review = await call('core_meal_review', { requestId: mealId });
  const draft = (await db.collection('recommendedMealProgramDrafts').doc(mealId).get()).data();
  const report = (await db.collection('recommendedMealProgramReports').doc(mealId).get()).data();
  assert(draft?.revision === review.draft?.revision && report?.publicationStatus === 'draft'
    && report.approvalStatus === 'draft' && !draft.reviewAcknowledgedAt, 'SOURCE_CHANGED', 'Only the current unpublished operator test draft is allowed.');
  const mealBefore = await mealEvidence();
  const saved = await execute('saveRecommendedMealProgramDraft', { requestId: mealId, expectedRevision: draft.revision,
    expectedResponseHash: review.responseHash, publicContent: draft.publicContent,
    reviewAcknowledged: false, authoringMode: 'codex_operator' }, 'same-meal');
  assert(saved.result.result.result?.reused === true || saved.result.result.receipt?.result?.reused === true,
    'TEST_SAVE_UNEXPECTED', 'The identical draft should be reused, not rewritten.');
  audit.mealPreserved = hash(mealBefore) === hash(await mealEvidence());
  assert(audit.mealPreserved, 'READBACK_MISMATCH', 'Existing meal evidence changed; do not replay.');
  const state = { schema: 'archive.sequence.v1', id: noteId, title: 'MCP connection verification', teacher: 'ARCHIVE PILATES OPS',
    equipment: '기타', equipmentOther: 'test', date: '2026-10-29', duration: '10', audience: 'internal',
    goal: 'Internal connection test only', memo: '', source: 'approved CORE MCP connection test', cues: ['', '', ''],
    sketchSpace: false, moves: { warm: [], main: [], cool: [] } };
  await execute('coreSequenceSave', { state, expectedRevision: 0 }, 'note-create');
  let note = (await db.collection('sequenceNotes').doc(noteId).get()).data();
  assert(note?.ownerUid === actor.uid && note.revision === 1 && note.title === state.title && !note.deleted,
    'READBACK_MISMATCH', 'Created note readback mismatch.');
  state.title = 'MCP modification verified';
  const updated = await execute('coreSequenceSave', { state, expectedRevision: 1 }, 'note-update');
  note = (await db.collection('sequenceNotes').doc(noteId).get()).data();
  assert(note?.revision === 2 && JSON.parse(note.payload).title === state.title, 'READBACK_MISMATCH', 'Updated note readback mismatch.');
  const replay = await call('core_action_execute', { planId: updated.prepared.planId, planHash: updated.prepared.planHash,
    confirmation: updated.prepared.requiredConfirmation });
  assert(replay.result.replayed === false && (await db.collection('sequenceNotes').doc(noteId).get()).data().revision === 2,
    'REPLAY_TEST_FAILED', 'The repeated request must not execute twice.');
  audit.created = true; audit.updated = true; audit.duplicateBlocked = true;
  await execute('coreSequenceRemove', { noteId, expectedRevision: 2 }, 'note-cleanup');
  note = (await db.collection('sequenceNotes').doc(noteId).get()).data();
  assert(note?.deleted === true && note.revision === 3 && note.payload === '{}', 'CLEANUP_FAILED', 'Test tombstone must remain and prevent recreation.');
  audit.testNoteTombstoned = true;
  assert(hash(mealBefore) === hash(await mealEvidence()), 'READBACK_MISMATCH', 'Member meal records must remain unchanged.');
  audit.verified = true; audit.completedAt = new Date().toISOString();
  console.log(JSON.stringify({ ok: true, authenticatedRead: true, identicalMealSaveReused: true,
    existingResponseAndDraftPreserved: true, ownTestNoteCreatedUpdated: true,
    duplicateExecutionBlocked: true, testNoteTombstoned: true, published: false, memberMessages: 0 }));
} catch (error) {
  audit.errorCode = error?.safe ? error.code : 'TEST_STOPPED';
  process.stderr.write(JSON.stringify({ ok: false, code: audit.errorCode, privateAudit: 'core-mcp/live-test-20261029.json', replay: false }) + '\n');
  process.exitCode = 1;
} finally {
  audit.finishedAt = new Date().toISOString();
  if (auditFile) { await auditFile.writeFile(JSON.stringify(audit, null, 2)); await auditFile.sync(); await auditFile.close(); }
  await client.close(); await transport.close(); await deleteApp(app);
}
