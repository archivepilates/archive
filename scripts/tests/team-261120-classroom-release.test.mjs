import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { releaseArguments, RELEASE_TARGETS, PRIVATE_ROOT, oneFileManifest,
  privateReleaseStore, releaseTeamClassroom } from '../release-team-261120-classroom.mjs';

const BASE = 'a'.repeat(40), HEAD = 'b'.repeat(40);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const compressedHash = bytes => sha(gzipSync(bytes, { level: 9 }));
const clone = value => structuredClone(value);

// Every runtime boundary is replaced. These tests never authenticate, fetch, or write to disk.
function fixture(options = {}) {
  const target = options.target || 'classroom', spec = RELEASE_TARGETS[target];
  const oldVersion = `sites/${spec.site}/versions/old`, newVersion = `sites/${spec.site}/versions/new`;
  const oldRelease = `sites/${spec.site}/releases/old`, newRelease = `sites/${spec.site}/releases/new`;
  const before = Buffer.from('synthetic baseline\r\n\n'), after = Buffer.from('synthetic replacement\r\n\n');
  const files = [{ path: spec.resource, hash: compressedHash(before) },
    ...Array.from({ length: options.large ? 2002 : 3 }, (_, n) => ({ path: `/untouched/${n}.js`, hash: sha(String(n)) }))];
  const config = { headers: [{ glob: '**', headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }],
    rewrites: [{ glob: '/api/**', function: 'untouched' }, { glob: '**', path: '/index.html' }],
    redirects: [{ glob: '/legacy', location: '/kept', statusCode: 302 }], cleanUrls: false,
    trailingSlash: false, i18n: { root: '/translations' }, unknownFutureOption: { preserve: ['exact', true] } };
  const calls = [], gitCalls = [], records = [], trace = [];
  const counts = { auth: 0, guard: 0, acquire: 0, unlock: 0, create: 0, close: 0, releases: 0, uploads: 0 };
  let record = null, active = oldVersion, manifest = {}, finalized = false, latestReads = 0;
  const store = {
    acquire() {
      counts.acquire++;
      if (options.busy) throw Error('Site lock busy');
      return () => { counts.unlock++; };
    },
    read() { return clone(record); },
    create(value) {
      assert.equal(record, null, 'exclusive intent creation');
      counts.create++; record = clone(value); records.push(clone(record)); trace.push('intent');
      return { save(value) { record = clone(value); records.push(clone(record)); trace.push(value.state); },
        close() { counts.close++; } };
    },
  };
  const git = args => {
    gitCalls.push(args);
    switch (args.join(' ')) {
      case 'rev-parse HEAD': return options.changedHead ? 'c'.repeat(40) : HEAD;
      case `rev-parse --verify ${BASE}^{commit}`:
        if (options.missingBase) throw Error('Missing local base');
        return BASE;
      case `merge-base --is-ancestor ${BASE} HEAD`:
        if (options.nonAncestor) throw Error('Base is not an ancestor');
        return '';
      case 'branch --show-current': return options.branch || 'main';
      case 'status --porcelain': return options.dirty || '';
      case 'rev-parse origin/main': return options.unpromoted ? BASE : HEAD;
      default: assert.fail(`Unexpected Git command: ${args}`);
    }
  };
  const response = data => ({ ok: true, json: async () => clone(data) });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body }); trace.push(method + ' ' + url);
    assert.equal(init.redirect, 'error');
    if (url.startsWith('https://upload-firebasehosting.googleapis.com/')) {
      assert.equal(method, 'POST'); assert.deepEqual(init.body, gzipSync(after, { level: 9 }));
      counts.uploads++;
      return { ok: !options.uploadFailure, status: 429 };
    }
    if (url === `https://${spec.site}.web.app${spec.resource}`) {
      assert.equal(method, 'GET'); assert.equal(init.cache, 'no-store');
      const bytes = active === newVersion ? options.badReadback ? Buffer.from('wrong new bytes') : after
        : options.liveDrift ? Buffer.from('wrong baseline bytes') : before;
      return { ok: true, arrayBuffer: async () => bytes };
    }
    assert.ok(url.startsWith('https://firebasehosting.googleapis.com/v1beta1/'));
    const route = url.slice('https://firebasehosting.googleapis.com/v1beta1/'.length);
    if (route === `sites/${spec.site}/releases?pageSize=1`) {
      latestReads++;
      if (options.readbackUnavailable && counts.releases) throw Error('Readback unavailable');
      const changed = options.staleAt === latestReads;
      return response({ releases: [{ name: changed ? oldRelease + '-concurrent' : active === newVersion ? newRelease : oldRelease,
        version: { name: changed ? oldVersion + '-concurrent' : active } }] });
    }
    if (route === oldVersion) return response({ name: oldVersion, status: 'FINALIZED', config });
    if (route === newVersion && method === 'GET') return response({ name: newVersion,
      status: finalized ? 'FINALIZED' : 'CREATED', config: options.configDrift ? { ...config, rewrites: [] } : config });
    if (route.startsWith(oldVersion + '/files?') || route.startsWith(newVersion + '/files?')) {
      const isOld = route.startsWith(oldVersion + '/');
      const values = isOld ? clone(files) : Object.entries(manifest).map(([path, hash]) => ({ path, hash }));
      if (isOld && options.gzipDrift) values[0].hash = 'd'.repeat(64);
      if (!isOld && options.manifestDrift) values[1].hash = 'e'.repeat(64);
      if (options.duplicateFiles) values.push(values[0]);
      const cursor = new URL(url).searchParams.get('pageToken'), offset = Number(cursor || 0);
      if (options.invalidPage) return response({ files: values.slice(0, 1), nextPageToken: 'loop' });
      if (options.incompletePage) return response({});
      return response({ files: values.slice(offset, offset + 1000),
        ...(offset + 1000 < values.length ? { nextPageToken: String(offset + 1000) } : {}) });
    }
    if (method !== 'GET') assert.ok(record?.versionIntentAt, 'durable intent before any provider mutation');
    if (route === `sites/${spec.site}/versions` && method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), { config });
      if (options.createUnknown) throw Error('Version creation response lost');
      return response({ name: options.wrongVersion ? 'sites/other/versions/new' : newVersion });
    }
    if (route === newVersion + ':populateFiles' && method === 'POST') {
      const batch = JSON.parse(init.body).files;
      assert.ok(Object.keys(batch).length <= 1000);
      Object.assign(manifest, batch);
      return response({ uploadRequiredHashes: options.unrelatedUpload ? ['f'.repeat(64)]
        : Object.hasOwn(batch, spec.resource) ? [compressedHash(after)] : [],
      uploadUrl: options.badUploadHost ? 'https://untrusted.invalid/upload' : 'https://upload-firebasehosting.googleapis.com/upload' });
    }
    if (route === newVersion + '?updateMask=status' && method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), { status: 'FINALIZED' }); finalized = true;
      return response({});
    }
    if (route === `sites/${spec.site}/releases?versionName=${newVersion}` && method === 'POST') {
      assert.ok(record.releaseIntentAt); assert.equal(record.state, 'release_intent');
      assert.match(trace.at(-2), /GET .*releases\?pageSize=1$/, 'production pin is the immediately preceding request');
      counts.releases++;
      if (!options.notAccepted) active = newVersion;
      if (options.releaseUnknown) throw Error('Release response lost');
      if (options.releaseDenied) return { ok: false, status: 403 };
      return response({ name: newRelease });
    }
    assert.fail(`Unexpected request: ${method} ${route}`);
  };
  const args = apply => [`--target=${target}`, `--base-commit=${BASE}`, `--expected-version=${oldVersion}`, ...(apply ? ['--apply'] : [])];
  const run = (apply = true, override = {}) => releaseTeamClassroom({
    args: args(apply), root: '/offline-repo', git,
    gitBytes(a) {
      assert.equal(a[0], 'show');
      assert.ok([`${BASE}:${spec.source}`, `HEAD:${spec.source}`].includes(a[1]));
      return a[1].startsWith(BASE) ? before : options.untrackedSource ? before : after;
    },
    readSource(file) { assert.equal(file, spec.source); return after; },
    promotedGuard() { counts.guard++; if (options.guardFailure) throw Error('Promoted guard rejected'); },
    getToken() { counts.auth++; if (options.authFailure) throw Error('Authentication failed'); return 'offline-placeholder'; },
    fetchImpl, store, ...override,
  });
  return { run, options, args, files, config, calls, gitCalls, records, counts, spec, oldVersion, newVersion, trace,
    get record() { return record; }, get manifest() { return manifest; },
    setRecord(value) { record = value; }, setActive(value) { active = value; } };
}

test('strict allowlist contains only the three exact site/resource/source pairs', () => {
  assert.deepEqual(RELEASE_TARGETS, {
    classroom: { site: 'archive-pilates-home', resource: '/assets/imweb-my-classroom-20260723a.js', source: 'official-home/assets/imweb-my-classroom-20260723a.js' },
    'core-rules': { site: 'archive-pilates-core', resource: '/rules/index.html', source: 'core/rules/index.html' },
    rules: { site: 'archive-pilates', resource: '/core/rules/index.html', source: 'core/rules/index.html' },
  });
  assert.equal(PRIVATE_ROOT, '/Users/archivepilates/archive-automation/operations/team-lesson-videos-261120');
});

test('arguments require an explicit full SHA and reject unknown/duplicate options and sites', () => {
  assert.equal(releaseArguments([`--base-commit=${BASE}`, '--target=classroom']).apply, false);
  for (const args of [[], ['--target=classroom', '--base-commit=abc123'], ['--target=constructor', `--base-commit=${BASE}`],
    ['--target=classroom', `--base-commit=${BASE}`, '--apply'], ['--target=classroom', `--base-commit=${BASE}`, '--force'],
    ['--target=classroom', '--target=rules', `--base-commit=${BASE}`],
    ['--target=classroom', `--base-commit=${BASE}`, '--expected-version=sites/other/versions/old']]) {
    assert.throws(() => releaseArguments(args));
  }
});

test('manifest helper requires exactly one existing-file delta with a proved gzip baseline', () => {
  const files = [{ path: '/target', hash: 'a'.repeat(64) }, { path: '/kept', hash: 'b'.repeat(64) }];
  assert.deepEqual(oneFileManifest(files, '/target', 'a'.repeat(64), 'c'.repeat(64)),
    { '/target': 'c'.repeat(64), '/kept': 'b'.repeat(64) });
  for (const [input, resource, old, next] of [[files, '/missing', 'a', 'c'], [files, '/target', 'd', 'c'],
    [files, '/target', 'a', 'a'], [[...files, files[0]], '/target', 'a', 'c']]) {
    assert.throws(() => oneFileManifest(input, resource, old.repeat(64), next.repeat(64)));
  }
});

for (const target of Object.keys(RELEASE_TARGETS)) test(`${target}: prepare is read-only; apply preserves the complete paginated manifest and exact config`, async () => {
  const f = fixture({ target, large: true });
  const prepare = await f.run(false);
  assert.equal(prepare.mode, 'prepare'); assert.equal(prepare.verified, undefined);
  assert.ok(f.calls.every(c => c.method === 'GET'));
  assert.equal(f.counts.guard, 0); assert.equal(f.counts.acquire, 0); assert.equal(f.counts.create, 0);
  const result = await f.run();
  assert.equal(result.verified, true); assert.equal(result.state, 'verified');
  assert.deepEqual(result.config, f.config); assert.deepEqual(result.baselineFiles, f.files);
  assert.deepEqual(result.changedPaths, [f.spec.resource]);
  assert.equal(Object.keys(f.manifest).length, f.files.length);
  assert.deepEqual(f.files.filter(row => row.hash !== f.manifest[row.path]).map(row => row.path), [f.spec.resource]);
  assert.equal(f.calls.filter(c => c.url.endsWith(':populateFiles')).length, 3);
  assert.equal(f.counts.guard, 3); assert.equal(f.counts.releases, 1); assert.equal(f.counts.uploads, 1);
  assert.equal(f.counts.close, 1); assert.equal(f.counts.unlock, 1);
});

test('successful rerun is readback-only and does not recreate any version or intent', async () => {
  const f = fixture(); await f.run(); const start = f.calls.length;
  const reread = await f.run();
  assert.equal(reread.reconciled, true); assert.equal(reread.state, 'verified_readback');
  assert.ok(f.calls.slice(start).every(c => c.method === 'GET'));
  assert.equal(f.counts.create, 1); assert.equal(f.counts.releases, 1);
});

test('an ambiguous attempt can later be verified read-only without changing the original intent', async () => {
  const f = fixture({ readbackUnavailable: true }); await assert.rejects(f.run());
  const original = clone(f.record), start = f.calls.length;
  f.options.readbackUnavailable = false;
  const observed = await f.run(false);
  assert.equal(observed.verified, true); assert.equal(observed.mode, 'prepare');
  assert.equal(observed.state, 'verified_readback'); assert.equal(observed.persistedState, 'unknown');
  assert.deepEqual(f.record, original); assert.ok(f.calls.slice(start).every(c => c.method === 'GET'));
  assert.equal(f.counts.releases, 1);
});

test('lost release response is resolved by independent live bytes, config and manifest, never a second POST', async () => {
  const f = fixture({ releaseUnknown: true });
  const result = await f.run();
  assert.equal(result.transportOutcome, 'ambiguous_reconciled_by_readback');
  assert.equal(result.verified, true); await f.run(); assert.equal(f.counts.releases, 1);
});

test('unknown nonaccepted release remains blocked across retries, even when the baseline still appears active', async () => {
  const f = fixture({ releaseUnknown: true, notAccepted: true });
  await assert.rejects(f.run(), /response lost/); assert.equal(f.record.state, 'unknown');
  const start = f.calls.length;
  await assert.rejects(f.run(), /unknown; no replay/);
  assert.ok(f.calls.slice(start).every(c => c.method === 'GET')); assert.equal(f.counts.releases, 1);
});

test('unknown version creation leaves a consumed intent that cannot create another version', async () => {
  const f = fixture({ createUnknown: true }); await assert.rejects(f.run(), /response lost/);
  const start = f.calls.length; await assert.rejects(f.run(), /Uncertain intent/);
  assert.ok(f.calls.slice(start).every(c => c.method === 'GET')); assert.equal(f.counts.create, 1);
});

for (const options of [{ dirty: ' M unrelated' }, { branch: 'codex/mini/unpromoted' }, { unpromoted: true },
  { guardFailure: true }, { untrackedSource: true }, { missingBase: true }, { nonAncestor: true }]) {
  test(`source gate blocks before authentication: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.run());
    assert.equal(f.counts.auth, 0); assert.equal(f.calls.length, 0); assert.equal(f.counts.create, 0);
  });
}

for (const staleAt of [1, 2, 3, 4, 5]) test(`stale production check ${staleAt} cannot publish`, async () => {
  const f = fixture({ staleAt }); await assert.rejects(f.run(), /[Ss]tale/);
  assert.equal(f.counts.releases, 0); assert.equal(f.counts.unlock, 1);
});

for (const options of [{ gzipDrift: true }, { liveDrift: true }, { duplicateFiles: true }, { invalidPage: true }, { incompletePage: true }]) {
  test(`baseline drift/incomplete pagination stops before any writes: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.run());
    assert.ok(f.calls.every(c => c.method === 'GET')); assert.equal(f.counts.create, 0);
    assert.equal(f.counts.unlock, 1);
  });
}

for (const options of [{ configDrift: true }, { manifestDrift: true }, { unrelatedUpload: true },
  { badUploadHost: true }, { uploadFailure: true }, { wrongVersion: true }]) {
  test(`new-version mismatch blocks publication: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.run());
    assert.equal(f.counts.releases, 0); assert.equal(f.counts.close, 1); assert.equal(f.counts.unlock, 1);
    const start = f.calls.length; await assert.rejects(f.run());
    assert.ok(f.calls.slice(start).every(c => c.method === 'GET'));
  });
}

for (const options of [{ badReadback: true }, { readbackUnavailable: true }]) test(`post-release uncertainty never replays: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); await assert.rejects(f.run());
  assert.equal(f.record.state, 'unknown'); assert.notEqual(f.record.verified, true);
  const start = f.calls.length; await assert.rejects(f.run());
  assert.ok(f.calls.slice(start).every(c => c.method === 'GET')); assert.equal(f.counts.releases, 1);
});

test('existing intent cannot be reused for a different source or expected production version', async () => {
  const f = fixture(); await f.run();
  const record = clone(f.record); record.binding.baseCommit = 'c'.repeat(40); f.setRecord(record);
  const start = f.calls.length; await assert.rejects(f.run(), /binding differs/);
  assert.equal(f.calls.length, start);
});

test('late source drift blocks release after finalization', async () => {
  const f = fixture();
  await assert.rejects(f.run(true, { promotedGuard() { if (++f.counts.guard === 3) f.options.dirty = ' M late'; } }), /clean main/);
  assert.equal(f.counts.releases, 0);
});

test('held shared lock and auth failures do not get alternate routes', async () => {
  const busy = fixture({ busy: true }); await assert.rejects(busy.run(), /lock busy/);
  assert.equal(busy.counts.auth, 0); assert.equal(busy.calls.length, 0);
  const auth = fixture({ authFailure: true }); await assert.rejects(auth.run(), /Authentication/);
  assert.equal(auth.counts.auth, 1); assert.equal(auth.counts.unlock, 1); assert.equal(auth.calls.length, 0);
  const denied = fixture({ releaseDenied: true, notAccepted: true }); await assert.rejects(denied.run(), /403/);
  assert.equal(denied.record.releaseErrorStatus, 403);
  await assert.rejects(denied.run(), /no replay/); assert.equal(denied.counts.releases, 1);
});

test('auth/quota HTTP errors remain errors even if independent readback finds the intended version active', async () => {
  const f = fixture({ releaseDenied: true }); await assert.rejects(f.run(), /403/);
  assert.equal(f.record.releaseErrorStatus, 403); assert.equal(f.record.verified, true);
  assert.equal(f.record.transportOutcome, 'provider_error_with_verified_readback');
  const start = f.calls.length;
  assert.equal((await f.run()).releaseErrorStatus, 403);
  assert.ok(f.calls.slice(start).every(c => c.method === 'GET')); assert.equal(f.counts.releases, 1);
});

test('production implementation uses the existing promoted-main guard and raw Git bytes', () => {
  const code = fs.readFileSync(new URL('../release-team-261120-classroom.mjs', import.meta.url), 'utf8');
  assert.match(code, /scripts\/validate-release-branch-state\.mjs/);
  assert.match(code, /'--require-origin-main', '--require-main-branch'/);
  assert.match(code, /import \{ makeManifest, assertManifest \} from '\.\/release-e261017-classroom\.mjs'/);
  assert.doesNotMatch(code, /youtube|youtu\.be|videoId|memberName|memberPhone/);
});

function virtualFs() {
  let inode = 1, nextFd = 10;
  const nodes = new Map(), handles = new Map(), opened = [], removed = [];
  const node = (directory, mode) => ({ directory, mode, ino: inode++, dev: 1, uid: process.getuid(), nlink: 1,
    data: Buffer.alloc(0), symlink: false,
    isDirectory() { return this.directory; }, isFile() { return !this.directory; }, isSymbolicLink() { return this.symlink; } });
  for (const name of ['/Users/archivepilates', '/Users/archivepilates/archive-automation']) nodes.set(name, node(true, 0o700));
  const io = {
    lstatSync(name) { return nodes.get(name); },
    mkdirSync(name, { mode }) { assert.ok(!nodes.has(name)); nodes.set(name, node(true, mode)); },
    openSync(name, flags, mode) {
      opened.push({ name, flags, mode });
      if (flags === 'wx') {
        if (nodes.has(name)) throw Error('EEXIST'); nodes.set(name, node(false, mode));
      }
      const value = nodes.get(name); assert.ok(value);
      if (value.symlink) throw Error('ELOOP');
      handles.set(nextFd, value); return nextFd++;
    },
    fstatSync(fd) { return handles.get(fd); },
    writeSync(fd, data, offset, length, position) {
      const n = handles.get(fd);
      if (typeof data === 'string') { n.data = Buffer.from(data); return n.data.length; }
      const bytes = data.subarray(offset, offset + length);
      n.data = Buffer.concat([n.data.subarray(0, position), bytes]); return bytes.length;
    },
    readFileSync(fd) { return handles.get(fd).data.toString(); },
    ftruncateSync(fd) { handles.get(fd).data = Buffer.alloc(0); },
    fsyncSync(fd) { assert.ok(handles.has(fd)); },
    closeSync(fd) { assert.equal(handles.delete(fd), true); },
    unlinkSync(name) { assert.equal(nodes.delete(name), true); removed.push(name); },
  };
  return { io, nodes, handles, opened, removed };
}

test('private store uses canonical shared lock, durable exclusive 0600 intent, no prepare writes, and preserves intent on close', () => {
  const v = virtualFs(), store = privateReleaseStore('classroom', v.io);
  assert.equal(store.read(), null); assert.equal(v.opened.length, 0); assert.equal(v.nodes.size, 2);
  const unlock = store.acquire();
  assert.equal(store.lock, '/Users/archivepilates/archive-automation/automation/locks/firebase-hosting-archive-pilates-home.lock');
  assert.throws(() => store.acquire(), /EEXIST/);
  const journal = store.create({ state: 'intent' }); journal.save({ state: 'unknown' });
  assert.deepEqual(store.read(), { state: 'unknown' });
  assert.throws(() => store.create({}), /EEXIST/);
  assert.ok(v.opened.filter(row => row.flags === 'wx').every(row => row.mode === 0o600));
  assert.equal(v.nodes.get(PRIVATE_ROOT).mode, 0o700);
  journal.close(); unlock();
  assert.ok(v.nodes.has(store.file)); assert.ok(!v.nodes.has(store.lock)); assert.equal(v.handles.size, 0);
});

test('private store rejects nested symlinks, nonprivate records and changed lock ownership', () => {
  const v = virtualFs(), store = privateReleaseStore('rules', v.io), unlock = store.acquire();
  const journal = store.create({ state: 'intent' }); journal.close();
  v.nodes.get(store.file).mode = 0o644; assert.throws(() => store.read(), /Unsafe release intent/);
  v.nodes.get(store.file).mode = 0o600;
  v.nodes.get(PRIVATE_ROOT).symlink = true; assert.throws(() => store.read(), /Unsafe private directory/);
  v.nodes.get(PRIVATE_ROOT).symlink = false;
  v.nodes.get(store.lock).ino++; assert.throws(unlock, /ownership changed/);
  assert.ok(v.nodes.has(store.lock)); assert.equal(v.handles.size, 0);
});
