import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const phase = process.argv[2];
assert.ok(['before', 'after'].includes(phase) && process.argv.length === 3);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'archive-pilates');
const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const { GoogleAuth } = require('google-auth-library');
const admin = require('firebase-admin');
const app = admin.initializeApp({ projectId: 'archive-pilates' }, 'chart-release-evidence');
const db = app.firestore();
const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
const names = ['syncPrivateLessonNotionFromRecord', 'syncPrivateLessonNotionFromRequest', 'scheduledSyncPrivateLessonNotionProjections'];
const dir = path.join(os.homedir(), 'ArchiveIN/operations/2026-11-14-private-chart-release');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const sha = data => createHash('sha256').update(data).digest('hex');
const hash = data => sha(JSON.stringify(data));
const get = async url => (await client.request({ url, method: 'GET', timeout: 60000 })).data;
try {
  const rows = [];
  let cursor;
  do {
    const page = await get('https://cloudfunctions.googleapis.com/v2/projects/archive-pilates/locations/asia-northeast3/functions?pageSize=1000' + (cursor ? '&pageToken=' + encodeURIComponent(cursor) : ''));
    assert.ok(!page.unreachable?.length);
    rows.push(...page.functions); cursor = page.nextPageToken;
  } while (cursor);
  const functions = rows.map(f => ({ name: f.name.split('/').at(-1), state: f.state, updateTime: f.updateTime,
    revision: f.serviceConfig.revision, service: f.serviceConfig.service, source: f.buildConfig.source,
    deploymentHash: f.labels?.['firebase-functions-hash'],
    configurationHash: hash({ eventTrigger: f.eventTrigger, serviceAccountEmail: f.serviceConfig.serviceAccountEmail,
      secrets: f.serviceConfig.secretEnvironmentVariables, environment: f.serviceConfig.environmentVariables,
      timeout: f.serviceConfig.timeoutSeconds, memory: f.serviceConfig.availableMemory,
      maxInstances: f.serviceConfig.maxInstanceCount, concurrency: f.serviceConfig.maxInstanceRequestConcurrency,
      ingressSettings: f.serviceConfig.ingressSettings }) })).sort((a, b) => a.name.localeCompare(b.name));
  const targets = names.map(name => { const row = functions.find(f => f.name === name); assert.ok(row); return row; });
  const chartIds = ['plc_283112173', 'plc_283112178'];
  const records = [];
  for (const id of chartIds) {
    const snaps = await db.getAll(db.doc(`privateLessonChartRecords/${id}`), db.doc(`privateLessonChartRequests/${id}`), db.doc(`bookings/${id.slice(4)}`));
    const r = snaps[0].data();
    assert.equal(r.notionSync.status, 'pending'); assert.equal(r.notionSync.deferredReason, 'awaiting_submission');
    assert.ok(!r.notionSync.error && !r.preSubmittedAt && !r.postSubmittedAt && !r.notionSync.instructorPageId && !r.notionProjectionLease?.token);
    records.push({ id, hashes: snaps.map(s => hash(s.data())), status: 'awaiting_submission', failedAt: r.notionSync.failedAt });
  }
  const scheduler = await get('https://cloudscheduler.googleapis.com/v1/projects/archive-pilates/locations/asia-northeast3/jobs/firebase-schedule-scheduledSyncPrivateLessonNotionProjections-asia-northeast3');
  const schedulerState = { name: scheduler.name, schedule: scheduler.schedule, timeZone: scheduler.timeZone,
    state: scheduler.state, targetHash: hash(scheduler.httpTarget) };
  const result = { phase, observedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    targets, functions, records, scheduler: schedulerState };
  if (phase === 'after') {
    const before = JSON.parse(fs.readFileSync(path.join(dir, 'before.json'), 'utf8'));
    assert.equal(hash(records), hash(before.records), 'Chart/request/booking changed during deployment');
    assert.equal(hash(schedulerState), hash(before.scheduler), 'Scheduler settings changed');
    assert.deepEqual(functions.filter(f => !names.includes(f.name)), before.functions.filter(f => !names.includes(f.name)), 'Unrelated function changed');
    for (const target of targets) {
      const old = before.targets.find(f => f.name === target.name);
      assert.equal(target.state, 'ACTIVE'); assert.notEqual(target.revision, old.revision);
      assert.equal(target.configurationHash, old.configurationHash, 'Function settings changed');
      const service = await get('https://run.googleapis.com/v2/' + target.service);
      assert.ok(service.latestReadyRevision.endsWith('/' + target.revision), 'Serving revision not ready');
      assert.ok(service.trafficStatuses?.some(t => t.revision.endsWith('/' + target.revision) && t.percent === 100), 'Serving revision traffic mismatch');
    }
    result.deployedSources = [];
    for (const target of targets) {
      const storage = target.source.storageSource;
      const blob = await client.request({ url: `https://storage.googleapis.com/storage/v1/b/${storage.bucket}/o/${encodeURIComponent(storage.object)}?alt=media&generation=${storage.generation}`, method: 'GET', responseType: 'arraybuffer', timeout: 120000 });
      const archive = path.join(dir, target.name + '-source.zip');
      fs.writeFileSync(archive, Buffer.from(blob.data), { flag: 'wx', mode: 0o600 });
      const sourceHashes = {};
      for (const name of ['privateLessonChart.ts', 'privateLessonNotionSync.ts']) {
        const content = execFileSync('unzip', ['-p', archive, `src/privateLessonChart/${name}`], { maxBuffer: 5 * 1024 * 1024 });
        const expected = fs.readFileSync(`firebase/kangsain-functions/functions/src/privateLessonChart/${name}`);
        assert.equal(sha(content), sha(expected), 'Deployed source mismatch: ' + name);
        sourceHashes[name] = sha(content);
      }
      result.deployedSources.push({ name: target.name, sourceHashes, path: archive, bytes: fs.statSync(archive).size, sha256: sha(fs.readFileSync(archive)) });
    }
    result.unrelatedFunctionsUnchanged = true; result.chartSourcesUnchanged = true; result.schedulerUnchanged = true;
  }
  fs.writeFileSync(path.join(dir, phase + '.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...result, functions: undefined }));
} finally { await app.delete(); }
