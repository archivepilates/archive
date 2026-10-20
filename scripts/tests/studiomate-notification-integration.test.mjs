import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { acquireStudioMateBrowserLock } from '../lib/studiomate-browser-lock.mjs';

const source = await readFile(new URL('../run-studiomate-excel-emergency-mode.mjs', import.meta.url), 'utf8');
const runner = await readFile(new URL('../process-admin-emergency-sync-requests.mjs', import.meta.url), 'utf8');

test('notification refresh cannot forward holding, contract or contact hooks even with enabled environment', () => {
  assert.match(source, /contractSourceDownloadedAt && !notificationRefresh \? \["--holding-source-downloaded-at"/);
  assert.match(source, /contractSourceDownloadedAt && !notificationRefresh \? \["--contract-source-downloaded-at"/);
  assert.match(source, /!notificationRefresh \? \["--queue-contact-sync"\]/);
  assert.match(source, /notificationRefresh \? \['--preserve-contact-sync'\]/);
  assert.match(source, /if \(!notificationRefresh && apply && download/);
  assert.match(source, /if \(apply && download && !downloadFailedWithoutMember && !notificationRefresh\)/);
});

test('normal hourly source evidence and status are not overwritten by notification refresh reports', () => {
  assert.match(source, /loadSyncRunEvidence\(normalReportDir/);
  assert.match(source, /automationId: notificationRefresh \? "studiomate-notification-refresh" : "studiomate-excel-sync"/);
  assert.match(source, /notification-refresh"\) : normalReportDir/);
});

test('request worker defers busy run and refuses malformed or terminated child success', () => {
  assert.match(runner, /skipped === 'excel_sync_already_running'/);
  assert.match(runner, /status: 'pending', progressPercent: 0/);
  assert.match(runner, /result\.stdout\?\.ok !== true/);
  assert.match(runner, /result\.error \|\| result\.signal \? 1 : result\.status \?\? 1/);
  assert.match(runner, /status: result\.stdout\.status === 'partial' \? 'error' : 'success'/);
  assert.match(source, /result\.error \|\| result\.signal \? 1 : result\.status \?\? 1/);
  assert.match(source, /downloadStep\.stdout\?\.ok !== true/);
  assert.match(source, /!downloadedMemberFile \|\| !downloadedReservationFile/);
  assert.match(runner, /catch \{ notificationIngress = \{ ok: false, status: 'review', code: 'NOTIFICATION_OBSERVER_CLEANUP_FAILED'/);
});

test('a competing Excel process returns deferred before any source download or Firestore operation', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'notification-sync-run-'));
  const lockPath = path.join(home, 'ArchiveIN/automation/locks/studiomate-excel-sync-run.lock');
  const release = await acquireStudioMateBrowserLock({ lockPath, owner: 'fixture-existing-run', waitMs: 0 });
  try {
    const result = spawnSync(process.execPath, ['scripts/run-studiomate-excel-emergency-mode.mjs', '--download', '--apply', '--notification-refresh'], {
      cwd: new URL('../../', import.meta.url), env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).skipped, 'excel_sync_already_running');
    assert.equal(JSON.parse(result.stdout).status, 'deferred');
    const owner = JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8'));
    assert.equal(owner.owner, 'fixture-existing-run');
  } finally { await release(); await rm(home, { recursive: true, force: true }); }
});
