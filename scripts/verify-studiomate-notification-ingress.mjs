#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createLiveReader } from '../services/archivepilates-mcp/src/live-browser.mjs';
import { notificationHint, observeNotificationHints, planNotificationRefresh,
  enqueueNotificationRefresh } from './lib/studiomate-notification-ingress.mjs';

// Exact source sample replay into an unwatched verification collection, never live jobs.
const require = createRequire(import.meta.url);
const admin = require('../firebase/kangsain-functions/functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'archive-pilates' });
const db = admin.firestore();
const reader = createLiveReader();
try {
  const source = await reader.getNotifications();
  const hints = source.rows.map(notificationHint);
  const baseline = observeNotificationHints(null, hints);
  const repeated = observeNotificationHints(baseline.state, hints);
  assert.equal(repeated.newHints, 0);
  assert.equal(repeated.state.pending.length, 0);
  const selected = hints.find(hint => hint.kind !== 'ignored');
  assert.ok(selected);
  const prior = hints.filter(hint => hint.key !== selected.key);
  assert.ok(prior.length);
  const replay = observeNotificationHints(observeNotificationHints(null, prior).state, [selected, ...prior]);
  const plan = planNotificationRefresh(replay.state);
  assert.equal(plan.status, 'ready');
  const sandboxRoot = 'workLanes/studiomate-notification-ingress/verificationRequests';
  const scopedDb = {
    doc: logicalPath => db.doc(`${sandboxRoot}/${logicalPath.split('/').at(-1)}`),
    runTransaction: operation => db.runTransaction(async tx => operation({
      get: ref => tx.get(ref),
      create: (ref, data) => tx.create(ref, { ...data, status: 'verification_only', verificationOnly: true }),
    })),
  };
  const beforeCanonical = await db.doc(`adminSyncRequests/${plan.requestId}`).get();
  assert.equal(beforeCanonical.exists, false);
  const first = await enqueueNotificationRefresh({ db: scopedDb, plan, timestamp: new Date() });
  const duplicate = await enqueueNotificationRefresh({ db: scopedDb, plan, timestamp: new Date() });
  assert.equal(duplicate.status, 'duplicate');
  const proof = await scopedDb.doc(`adminSyncRequests/${plan.requestId}`).get();
  assert.equal(proof.data().verificationOnly, true);
  assert.equal(proof.data().status, 'verification_only');
  assert.equal((await db.doc(`adminSyncRequests/${plan.requestId}`).get()).exists, false);
  const result = { ok: true, sourceCheckedAt: source.checkedAt, received: hints.length,
    repeatNewHints: repeated.newHints, firstReceipt: first.status, secondReceipt: duplicate.status,
    verificationPath: proof.ref.path, canonicalRequestsCreated: 0, memberActions: 0,
    testMode: 'replay_real_source_sample_not_natural_arrival', livePushVerified: false,
    firestoreDuplicateProtection: true, checkedAt: new Date().toISOString() };
  await mkdir('artifacts/studiomate-notification-ingress', { recursive: true });
  await writeFile('artifacts/studiomate-notification-ingress/live-source-replay.json', `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally { await reader.close(); await admin.app().delete(); }
