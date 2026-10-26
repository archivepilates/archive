import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  BASE, TARGETS, assertLessonVideoNoticeRulesScope, parseLessonVideoNoticeRulesArgs,
  releaseLessonVideoNoticeRules,
} from '../release-lesson-video-notice-rules.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const previousNote = '          <div class="rule-note" id="lesson-video-upload-notice"><strong>Synthetic notice</strong><span>Previous operating note.</span></div>\n';
const original = '<!doctype html>\n<html><head><title>Existing rules</title></head><body>\n' +
  '          <div class="rule-note" id="existing"><strong>Existing</strong><span>Keep every byte.</span></div>\n' +
  previousNote +
  '</body></html>\n';
const note = '          <div class="rule-note" id="lesson-video-upload-notice"><strong>Synthetic notice</strong><span>Synthetic operating note.</span></div>\n';
const proposed = original.replace(previousNote, note);

test('pins full baseline and exactly the two rules sites/resources', () => {
  assert.equal(BASE, '130bed1977835f2b1ffeca3060410d1a5f7e9ae6');
  assert.deepEqual(TARGETS, {
    rules: { site: 'archive-pilates', resource: '/core/rules/index.html', source: 'core/rules/index.html',
      url: 'https://archive-pilates.web.app/core/rules/' },
    'core-rules': { site: 'archive-pilates-core', resource: '/rules/index.html', source: 'core/rules/index.html',
      url: 'https://archive-pilates-core.web.app/rules/' },
  });
  assert.ok(Object.isFrozen(TARGETS) && Object.values(TARGETS).every(Object.isFrozen));
});

for (const target of ['rules', 'core-rules']) {
  test(`${target} accepts exactly one same-position note replacement, including Buffer bytes`, () => {
    assert.doesNotThrow(() => assertLessonVideoNoticeRulesScope(original, proposed, target));
    assert.doesNotThrow(() => assertLessonVideoNoticeRulesScope(Buffer.from(original), Buffer.from(proposed), target));
    assert.equal(proposed.replace(note, previousNote), original);
  });
  for (const [label, after] of [
    ['no-op', original], ['two notes', proposed.replace(note, note + note)],
    ['note deletion', original.replace(previousNote, '')],
    ['duplicate on same line', proposed.replace(note, note.trimEnd() + note.trimStart())],
    ['extra suffix', proposed + '\n'], ['extra prefix', '<!-- unrelated -->\n' + proposed],
    ['title change', proposed.replace('Existing rules', 'Other rules')],
    ['existing-note change', proposed.replace('Keep every byte.', 'Changed existing content.')],
    ['existing-note removal', proposed.replace(/^ +<div class="rule-note" id="existing">.*\n/m, '')],
    ['baseline byte deletion', proposed.slice(1)], ['line-ending changes', proposed.replaceAll('\n', '\r\n')],
    ['multiline note', proposed.replace('Synthetic operating note.', 'Synthetic\noperating note.')],
    ['sibling on same line', proposed.replace('</span></div>\n</body>', '</span></div><div>Other</div>\n</body>')],
    ['different note id', proposed.replace('lesson-video-upload-notice', 'different-note')],
    ['extra note attributes', proposed.replace('id="lesson-video-upload-notice"', 'id="lesson-video-upload-notice" onclick="bad()"')],
    ['nested markup', proposed.replace('Synthetic operating note.', '<script>unrelated()</script>')],
  ]) test(`${target} rejects ${label}`, () => {
    assert.throws(() => assertLessonVideoNoticeRulesScope(original, after, target));
  });
  test(`${target} cannot insert a note when the baseline has none`, () => {
    const withoutNote = original.replace(previousNote, '');
    assert.throws(() => assertLessonVideoNoticeRulesScope(withoutNote, proposed, target));
  });
  test(`${target} cannot relocate a replacement while preserving all other bytes`, () => {
    const withoutNote = original.replace(previousNote, '');
    for (const after of [note + withoutNote, withoutNote + note,
      withoutNote.replace('<body>\n', '<body>\n' + note)])
      assert.throws(() => assertLessonVideoNoticeRulesScope(original, after, target));
  });
  test(`${target} rejects duplicate or malformed baseline notes`, () => {
    for (const before of [original.replace(previousNote, previousNote + previousNote),
      original.replace(previousNote, previousNote.trimEnd() + previousNote.trimStart()),
      original.replace('Previous operating note.', 'Previous\noperating note.')])
      assert.throws(() => assertLessonVideoNoticeRulesScope(before, proposed, target));
  });
}

test('scope rejects invalid UTF-8 instead of collapsing distinct source bytes', () => {
  assert.throws(() => assertLessonVideoNoticeRulesScope(Buffer.from([0xff]), Buffer.from([0xfe]), 'rules'), /UTF-8/);
});

for (const target of ['classroom', 'archive-pilates-home', 'unknown', '__proto__', 'constructor', 'toString', '', undefined])
  test(`rejects other site/target ${target}`, () => {
    assert.throws(() => assertLessonVideoNoticeRulesScope(original, proposed, target), /Unexpected release target/);
  });

function fixture(options = {}) {
  const target = options.target || 'rules', selected = TARGETS[target];
  const { site, resource, url } = selected;
  const oldVersion = `sites/${site}/versions/reviewed`, newVersion = `sites/${site}/versions/replacement`;
  const releaseName = `sites/${site}/releases/reviewed`, publishedName = `sites/${site}/releases/replacement`;
  const commit = '1'.repeat(40), before = original, after = options.source || proposed;
  const config = { headers: [{ glob: '**', headers: { 'Cache-Control': 'no-cache' } }],
    redirects: [{ glob: '/old', location: '/new', statusCode: 301 }],
    rewrites: [{ glob: '/api/**', function: { functionId: 'preserved', region: 'asia-northeast3' } }],
    cleanUrls: true, trailingSlash: false };
  const baselineFiles = [{ path: resource, hash: sha(gzipSync(Buffer.from(before))) },
    ...Array.from({ length: options.large ? 1001 : 3 }, (_, i) => ({ path: `/untouched-${i}.html`, hash: 'b'.repeat(64) }))];
  let manifest = {}, lockContent, latestReads = 0, liveReads = 0, sourceDrift = false;
  const calls = [], commands = [], saved = [], locks = [];
  const counters = { auth: 0, released: 0, finalized: 0, uploaded: 0, closed: 0, unlinked: 0, created: 0 };
  const io = {
    readFileSync(file, encoding) {
      if (file === `/synthetic-repo/core/rules/index.html`) return Buffer.from(sourceDrift ? after + '\n' : after);
      assert.equal(file, `/synthetic-home/ArchiveIN/automation/locks/firebase-hosting-${site}.lock`);
      assert.equal(encoding, 'utf8');
      return options.lockOwnerChanged ? JSON.stringify({ pid: 999, token: 'other' }) : lockContent;
    },
    mkdirSync() {},
    writeFileSync(file, bytes) { saved.push({ file, evidence: JSON.parse(bytes) }); },
    openSync(file, flags, mode) {
      assert.equal(file, `/synthetic-home/ArchiveIN/automation/locks/firebase-hosting-${site}.lock`);
      assert.equal(flags, 'wx'); assert.equal(mode, 0o600);
      if (options.busy) throw Error('Synthetic lock held');
      locks.push(file); return 42;
    },
    writeSync(fd, value) { assert.equal(fd, 42); lockContent = value; },
    fsyncSync(fd) { assert.equal(fd, 42); },
    closeSync(fd) { assert.equal(fd, 42); counters.closed++; },
    unlinkSync() { counters.unlinked++; },
  };
  const exec = (binary, args) => {
    commands.push([binary, ...args]);
    if (binary === 'gcloud') {
      assert.deepEqual(args, ['auth', 'print-access-token', '--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com']);
      counters.auth++; return 'synthetic-placeholder';
    }
    assert.equal(binary, 'git');
    if (args[0] === 'show') {
      assert.ok([`${BASE}:core/rules/index.html`, 'HEAD:core/rules/index.html'].includes(args[1]));
      return Buffer.from(args[1].startsWith('HEAD:') ? options.trackedSourceDrift ? original : after : before);
    }
    const known = { 'rev-parse --show-toplevel': '/synthetic-repo', 'fetch origin main': '',
      'rev-parse HEAD': commit, 'rev-parse origin/main': options.diverged ? '2'.repeat(40) : commit,
      'branch --show-current': options.branch || 'main', 'status --porcelain': options.dirty || '' };
    assert.ok(Object.hasOwn(known, args.join(' ')), `Unexpected synthetic git command: ${args}`);
    return known[args.join(' ')];
  };
  const json = data => ({ ok: true, json: async () => structuredClone(data) });
  const paginate = (rows, name) => name.includes('pageToken=next') ? { files: rows.slice(1000) }
    : rows.length > 1000 ? { files: rows.slice(0, 1000), nextPageToken: 'next' } : { files: rows };
  const fetcher = async (input, init = {}) => {
    calls.push({ url: input, method: init.method || 'GET', body: init.body });
    if (input === url) {
      liveReads++;
      const drift = options.liveDriftAt === liveReads || (options.badReadback && counters.released);
      return { ok: true, arrayBuffer: async () => Buffer.from(drift ? 'drift' : counters.released ? after : before) };
    }
    if (input.startsWith('https://upload-firebasehosting.googleapis.com/')) {
      assert.equal(init.method, 'POST'); assert.deepEqual(init.body, gzipSync(Buffer.from(after), { level: 9 }));
      counters.uploaded++;
      if (options.sourceDriftAfterUpload) sourceDrift = true;
      return { ok: !options.uploadFailure };
    }
    const prefix = 'https://firebasehosting.googleapis.com/v1beta1/';
    assert.ok(input.startsWith(prefix)); const name = input.slice(prefix.length);
    assert.ok(name.startsWith(`sites/${site}/`), 'No other site may be requested');
    if (name === `sites/${site}/releases?pageSize=1`) {
      latestReads++;
      return json({ releases: [{ name: options.concurrentAt === latestReads ? `${releaseName}-concurrent`
        : counters.released ? publishedName : releaseName,
      version: { name: options.badInitialSite && latestReads === 1 ? 'sites/other/versions/wrong'
        : counters.released ? options.postReleaseDrift ? `${newVersion}-other` : newVersion : oldVersion } }] });
    }
    if (name === oldVersion) return json({ name: oldVersion, ...(options.noConfig ? {} : { config }) });
    if (name.startsWith(`${oldVersion}/files?`)) {
      if (options.missingFiles) return json({});
      if (options.repeatedCursor) return json({ files: baselineFiles, nextPageToken: 'again' });
      if (options.invalidCursor) return json({ files: baselineFiles, nextPageToken: false });
      if (options.duplicatePath) return json({ files: [...baselineFiles, baselineFiles[0]] });
      return json(paginate(baselineFiles, name));
    }
    if (name === `sites/${site}/versions`) {
      assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(init.body), { config });
      counters.created++;
      return json({ name: options.badCreatedSite ? 'sites/other/versions/wrong' : newVersion });
    }
    if (name === `${newVersion}:populateFiles`) {
      assert.equal(init.method, 'POST');
      manifest = { ...manifest, ...JSON.parse(init.body).files };
      return json({ uploadRequiredHashes: [options.unrelatedUpload ? 'f'.repeat(64) : sha(gzipSync(Buffer.from(after), { level: 9 }))],
        uploadUrl: options.badUploadHost ? 'https://untrusted.invalid/upload' : 'https://upload-firebasehosting.googleapis.com/upload' });
    }
    if (name.startsWith(`${newVersion}/files?`)) {
      const rows = Object.entries(manifest).map(([path, hash]) => ({ path, hash }));
      if (options.manifestDrift || options.manifestDriftAfterFinalize && counters.finalized) rows[0].hash = 'e'.repeat(64);
      return json(paginate(rows, name));
    }
    if (name === newVersion) return json({ name: newVersion,
      config: options.configDrift || options.configDriftAfterFinalize && counters.finalized ? {} : config });
    if (name === `${newVersion}?updateMask=status`) {
      assert.equal(init.method, 'PATCH'); assert.deepEqual(JSON.parse(init.body), { status: 'FINALIZED' });
      counters.finalized++; return json({});
    }
    if (name === `sites/${site}/releases?versionName=${newVersion}`) {
      assert.equal(init.method, 'POST'); assert.ok(saved.at(-1).evidence.releaseIntentAt);
      counters.released++; return json({ name: publishedName });
    }
    assert.fail(`Unexpected synthetic Hosting request: ${name}`);
  };
  const args = options.args || [`--target=${target}`, '--apply', `--expected-version=${options.expected || oldVersion}`];
  return { run: () => releaseLessonVideoNoticeRules(args, { fs: io, execFileSync: exec, fetch: fetcher,
    home: '/synthetic-home', pid: 42 }), calls, commands, saved, locks, counters, baselineFiles,
    resource, get manifest() { return manifest; } };
}

for (const target of ['rules', 'core-rules']) test(`${target} synthetic apply preserves complete manifest/config and independently verifies source/live hashes`, async () => {
  const f = fixture({ target }), evidence = await f.run();
  assert.equal(evidence.verified, true); assert.equal(evidence.baselineCommit, BASE);
  assert.deepEqual(evidence.changedPaths, [f.resource]); assert.equal(evidence.sourceSha256, sha(proposed));
  assert.equal(evidence.baselineSourceSha256, sha(original));
  assert.equal(f.counters.released, 1); assert.equal(f.counters.finalized, 1);
  assert.equal(f.counters.closed, 1); assert.equal(f.counters.unlinked, 1);
  for (const row of f.baselineFiles.filter(row => row.path !== f.resource)) assert.equal(f.manifest[row.path], row.hash);
  assert.ok(f.saved.every(row => row.file.startsWith('/synthetic-repo/artifacts/lesson-video-notice-rules/')));
});

test('large live snapshot paginates completely and populates only preserved plus one changed hash', async () => {
  const f = fixture({ large: true }); await f.run();
  assert.equal(Object.keys(f.manifest).length, 1002);
  assert.equal(f.calls.filter(row => row.url.includes(':populateFiles')).length, 2);
  assert.equal(f.calls.filter(row => row.url.includes('pageToken=next')).length, 4);
});

test('default plan uses only synthetic GETs; no release lock or evidence writes', async () => {
  const f = fixture({ args: ['--target=rules'] });
  assert.equal((await f.run()).mode, 'plan');
  assert.ok(f.calls.every(row => row.method === 'GET')); assert.equal(f.saved.length, 0); assert.equal(f.locks.length, 0);
});

for (const args of [[], ['--target=classroom'], ['--target=__proto__'], ['--target=constructor'],
  ['--target=rules', '--site=archive-pilates-home'], ['--target=rules', '--resource=/index.html'],
  ['--target=rules', '--config=other.json'], ['--target=rules', '--force'],
  ['--target=rules', '--target=core-rules'], ['--target=rules', '--target=rules'],
  ['--target=rules', '--apply', '--apply'], ['--target=rules', '--plan', '--apply'],
  ['--target=rules', '--apply'], ['--target=rules', '--expected-version=sites/other/versions/wrong']])
  test(`invalid CLI scope rejected before auth: ${args.join(' ')}`, async () => {
    assert.throws(() => parseLessonVideoNoticeRulesArgs(args));
    const f = fixture({ args }); await assert.rejects(f.run());
    assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
  });

for (const options of [{ branch: 'codex/mini/lesson-video-notices-261026' }, { dirty: ' M unrelated' },
  { diverged: true }, { trackedSourceDrift: true }, { source: proposed + '\n' }])
  test('non-main, dirty, divergent, untracked-source or out-of-scope edits block before auth', async () => {
    const f = fixture(options); await assert.rejects(f.run());
    assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
  });

for (const options of [{ expected: 'sites/archive-pilates/versions/stale' }, { badInitialSite: true },
  { liveDriftAt: 1 }, { noConfig: true }, { missingFiles: true }, { repeatedCursor: true },
  { invalidCursor: true }, { duplicatePath: true }])
  test('live baseline/version/config/manifest uncertainty blocks all mutations', async () => {
    const f = fixture(options); await assert.rejects(f.run());
    assert.ok(f.calls.every(row => row.method === 'GET')); assert.equal(f.counters.created, 0);
  });

for (const concurrentAt of [2, 3, 4]) test(`concurrent release at recheck ${concurrentAt} blocks publication and cleans owned lock`, async () => {
  const f = fixture({ concurrentAt }); await assert.rejects(f.run(), /Concurrent/);
  assert.equal(f.counters.released, 0); assert.equal(f.counters.closed, 1); assert.equal(f.counters.unlinked, 1);
});

for (const options of [{ liveDriftAt: 2 }, { liveDriftAt: 3 }, { badCreatedSite: true },
  { unrelatedUpload: true }, { badUploadHost: true }, { uploadFailure: true },
  { manifestDrift: true }, { configDrift: true }, { manifestDriftAfterFinalize: true },
  { configDriftAfterFinalize: true }, { sourceDriftAfterUpload: true }])
  test('upload, source, manifest/config or late live drift blocks publication and cleans lock', async () => {
    const f = fixture(options); await assert.rejects(f.run());
    assert.equal(f.counters.released, 0); assert.equal(f.counters.closed, 1); assert.equal(f.counters.unlinked, 1);
  });

for (const options of [{ badReadback: true }, { postReleaseDrift: true }])
  test('ambiguous live readback cannot report verified or automatically repeat release', async () => {
    const f = fixture(options); await assert.rejects(f.run(), /do not repeat release/);
    assert.equal(f.counters.released, 1); assert.equal(f.saved.at(-1).evidence.verified, undefined);
    assert.equal(f.counters.closed, 1); assert.equal(f.counters.unlinked, 1);
  });

test('held shared per-site lock prevents every mutation', async () => {
  const f = fixture({ busy: true }); await assert.rejects(f.run(), /lock held/);
  assert.ok(f.calls.every(row => row.method === 'GET')); assert.equal(f.counters.closed, 0); assert.equal(f.counters.unlinked, 0);
});

test('changed lock ownership is preserved, never deleted as task-owned state', async () => {
  const f = fixture({ lockOwnerChanged: true }); await assert.rejects(f.run(), /Lock owner changed/);
  assert.equal(f.counters.closed, 1); assert.equal(f.counters.unlinked, 0);
});
