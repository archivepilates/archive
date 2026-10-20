#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLiveReader } from '../services/archivepilates-mcp/src/live-browser.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { notificationHint, observeNotificationHints, planNotificationRefresh,
  enqueueNotificationRefresh, acknowledgeNotificationRefresh } from './lib/studiomate-notification-ingress.mjs';

const stateDir = path.join(os.homedir(), 'ArchiveIN/automation/state');
const statePath = path.join(stateDir, 'studiomate-notification-ingress.json');
const require = createRequire(import.meta.url);

export async function observeStudioMateNotifications({ apply = false, forceRead = false,
  readOnly = false, now = Date.now(), read = null, db = null } = {}) {
  let release, reader;
  try {
    try { release = await acquireStudioMateBrowserLock({ owner: 'notification-ingress-state',
      lockPath: '~/ArchiveIN/automation/locks/studiomate-notification-ingress.lock', waitMs: 0 }); }
    catch (error) {
      if (String(error?.message).includes('profile is locked by')) return { ok: true, status: 'busy' };
      throw error;
    }
    const previous = await readState();
    if (!forceRead && previous?.nextPollAt > now) return { ok: true, status: 'not_due' };
    reader = read ? null : createLiveReader({ budgetMs: 20_000,
      acquire: () => acquireStudioMateBrowserLock({ owner: 'notification-ingress-read', waitMs: 0 }) });
    const source = await (read ? read() : reader.getNotifications());
    const observed = observeNotificationHints(previous, source.rows.map(notificationHint), now);
    // Never emit names, message bodies, credentials, or raw browser errors.
    if (readOnly) return { ok: true, status: 'read_only', received: observed.received,
      hints: source.rows.map(notificationHint), checkedAt: source.checkedAt,
      coverage: source.coverage, livePushVerified: false, externalActions: 0 };
    let next = observed.state;
    const plan = planNotificationRefresh(next, now);
    let routing = { status: apply ? plan.status : 'shadow' };
    if (apply && plan.status === 'ready') {
      if (!db) {
        const admin = require('../firebase/kangsain-functions/functions/node_modules/firebase-admin');
        const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'archive-pilates';
        if (projectId !== 'archive-pilates') throw new Error('notification_project_mismatch');
        if (!admin.apps.length) admin.initializeApp({ projectId });
        db = admin.firestore();
      }
      routing = await enqueueNotificationRefresh({ db, plan, timestamp: new Date(now) });
      if (['queued', 'duplicate', 'coalesced'].includes(routing.status)) {
        next = acknowledgeNotificationRefresh(next, plan, now);
        next.lastRequestId = routing.requestId;
      }
    }
    await saveState(next);
    return { ok: true, status: observed.baseline ? 'baseline' : 'observed',
      received: observed.received, newHints: observed.newHints, actionable: observed.actionable,
      kinds: observed.kinds, continuityLost: observed.continuityLost, routing,
      transport: next.transport, livePushVerified: false, checkedAt: source.checkedAt,
      externalActions: 0 };
  } catch (error) {
    if (error?.code === 'LIVE_BUSY') return { ok: true, status: 'browser_busy', externalActions: 0 };
    return { ok: false, status: 'review', code: /^LIVE_[A-Z_]+$/.test(error?.code || '') ? error.code : 'NOTIFICATION_INGRESS_FAILED',
      externalActions: 0 };
  } finally {
    try {
      await reader?.close();
    } catch {
      return { ok: false, status: 'review', code: 'LIVE_CLEANUP_REQUIRED', externalActions: 0 };
    } finally {
      await release?.();
    }
  }
}

async function readState() {
  try { return JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
async function saveState(value) {
  await mkdir(stateDir, { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, statePath);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = new Set(process.argv.slice(2));
  if ([...args].some(arg => !['--apply', '--force-read', '--read-only'].includes(arg)) || (args.has('--apply') && args.has('--read-only')))
    throw new Error('Use --apply, --force-read, or --read-only');
  const result = await observeStudioMateNotifications({ apply: args.has('--apply'), forceRead: args.has('--force-read'), readOnly: args.has('--read-only') });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
