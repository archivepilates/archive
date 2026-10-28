import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { staffVideoRecoveryRulesTarget, assertStaffVideoRecoveryRulesScope, makeStaffVideoRecoveryRulesManifest,
  assertStaffVideoRecoveryRulesManifest, runStaffVideoRecoveryRulesRelease } from '../release-staff-video-recovery-rules.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const selections = Object.fromEntries(['core-rules'].map(target => [target, staffVideoRecoveryRulesTarget(target)]));
const commits = Object.fromEntries(['4bb5c468fbc60285f780b592eb05e0bf8e2e887d'].map(base => [base, git(['rev-parse', `${base}^{commit}`])]));
const baselines = new Map(Object.values(selections).flatMap(selected => selected.files.map(file =>
  [file.source, execFileSync('git', ['show', `${selected.base}:${file.source}`], { cwd: root })])));
const BASE = '4bb5c468fbc60285f780b592eb05e0bf8e2e887d';
const HASH = 'de3dafd0f7d59cc3d0caede9e995da92ed2e87bcb103d275b06937b687175629';
const note = '          <div class="rule-note" id="imweb-staff-video-policy"><strong>Staff video recovery</strong><span>Preserve uncertainty and ownership; verify native completion independently.</span></div>\n';
const notePattern = /^          <div class="rule-note" id="imweb-staff-video-policy">[^\n]+\n/gm;
const proposed = file => Buffer.from(baselines.get(file.source).toString().replace(notePattern, () => note));
function manifestFixture(target = 'core-rules') {
  const selected = selections[target];
  const files = [{ path: selected.files[0].resource, hash: sha(gzipSync(baselines.get(selected.files[0].source), { level: 9 })) },
    ...Array.from({ length: 4 }, (_, i) => ({ path: '/preserved-' + i + '.js', hash: sha('current-live-' + i) }))];
  const replacements = Object.fromEntries(selected.files.map(file => [file.resource, sha(gzipSync(proposed(file), { level: 9 }))]));
  return { files, replacements };
}

test('pins the full reachable baseline commit/hash and only canonical CORE resource', () => {
  const selected = staffVideoRecoveryRulesTarget();
  assert.equal(selected.base, BASE);
  assert.equal(commits[BASE], BASE);
  assert.ok(git(['branch', '--all', '--contains', BASE]));
  assert.equal(selected.site, 'archive-pilates-core');
  assert.deepEqual(selected.files, [{ resource: '/rules/index.html', source: 'core/rules/index.html',
    url: 'https://archive-pilates-core.web.app/rules/', baselineSha256: HASH }]);
  assert.equal(sha(baselines.get(selected.files[0].source)), HASH);
});

test('accepts replacement of the one real Git staff note and preserves every other byte', () => {
  const file = selections['core-rules'].files[0], before = baselines.get(file.source).toString();
  const after = proposed(file).toString();
  assert.doesNotThrow(() => assertStaffVideoRecoveryRulesScope(before, after));
  assert.equal(before.replace(notePattern, ''), after.replace(notePattern, ''));
});

test('scope rejects no-op, new/duplicate notes, changed neighbors, IDs and whitespace', () => {
  const file = selections['core-rules'].files[0], before = baselines.get(file.source).toString(), after = proposed(file).toString();
  for (const candidate of [before, before + note, after + '\n', after.replace(note, note + note),
    after.replace('id="imweb-staff-video-policy"', 'id="another-policy"'),
    after.replace('id="imweb-local-quota-native-continuation"', 'id="changed-neighbor"'),
    after.replace('<html', '<html data-other="changed"')]) {
    assert.notEqual(candidate, after);
    assert.throws(() => assertStaffVideoRecoveryRulesScope(before, candidate));
  }
});

test('scope rejects malformed baseline and nested, attributed or multiline replacement content', () => {
  const file = selections['core-rules'].files[0], before = baselines.get(file.source).toString(), after = proposed(file).toString();
  for (const candidate of [after.replace('Staff video recovery', '<b>Staff</b>'), after.replace('Staff video recovery', 'Staff\nvideo'),
    after.replace('Staff video recovery', 'Staff\u2028video'), after.replace('<span>Preserve', '<span hidden>Preserve'),
    after.replace('Staff video recovery', '')]) assert.throws(() => assertStaffVideoRecoveryRulesScope(before, candidate));
  for (const invalid of [before.replace(notePattern, ''), before + before.match(notePattern)[0]]) {
    assert.throws(() => assertStaffVideoRecoveryRulesScope(invalid, after));
  }
});

test('legacy mirror, home and inherited targets/resources are rejected', () => {
  for (const target of ['rules', 'home', 'archive-pilates', '__proto__', 'constructor']) {
    assert.throws(() => staffVideoRecoveryRulesTarget(target));
    assert.throws(() => assertStaffVideoRecoveryRulesScope('a', 'b', target));
  }
  assert.throws(() => assertStaffVideoRecoveryRulesScope('a', 'b', 'core-rules', '/core/rules/index.html'));
});

test('manifest replaces only canonical rules while preserving every other current live hash', () => {
  const { files, replacements } = manifestFixture(), original = structuredClone(files);
  const manifest = makeStaffVideoRecoveryRulesManifest(files, replacements['/rules/index.html']);
  assert.deepEqual(files, original);
  assert.deepEqual(files.filter(file => manifest[file.path] !== file.hash).map(file => file.path), ['/rules/index.html']);
  assert.equal(Object.keys(manifest).length, files.length);
  assertStaffVideoRecoveryRulesManifest(Object.entries(manifest).map(([path, hash]) => ({ path, hash })), manifest);
});

test('manifest rejects missing target, duplicate paths, invalid hashes and no-op replacement', () => {
  const { files, replacements } = manifestFixture(), hash = replacements['/rules/index.html'];
  for (const invalid of [files.slice(1), [...files, files[0]], files.map((file, i) => i === 1 ? { ...file, hash: 'invalid' } : file)]) {
    assert.throws(() => makeStaffVideoRecoveryRulesManifest(invalid, hash));
  }
  for (const invalid of ['invalid', files[0].hash]) assert.throws(() => makeStaffVideoRecoveryRulesManifest(files, invalid));
});

test('full manifest readback rejects drift, omissions and duplicate/extra paths', () => {
  const { files, replacements } = manifestFixture();
  const manifest = makeStaffVideoRecoveryRulesManifest(files, replacements['/rules/index.html']);
  const rows = Object.entries(manifest).map(([path, hash]) => ({ path, hash }));
  for (const invalid of [rows.slice(1), [...rows, rows[0]], rows.map((file, i) => i === 1 ? { ...file, hash: sha('drift') } : file)]) {
    assert.throws(() => assertStaffVideoRecoveryRulesManifest(invalid, manifest));
  }
});

function releaseFixture(options = {}) {
  const target = options.target || 'core-rules', selected = selections[target], { files, replacements } = manifestFixture(target);
  const oldVersion = `sites/${selected.site}/versions/reviewed`, newVersion = `sites/${selected.site}/versions/replacement`;
  const oldRelease = `sites/${selected.site}/releases/reviewed`, newRelease = `sites/${selected.site}/releases/replacement`;
  const config = { headers: [{ glob: '**', headers: { 'Cache-Control': 'no-cache' } }], rewrites: [{ glob: '**', path: '/index.html' }] };
  let manifest, released = false, latestReads = 0;
  let receipt = options.priorIntent ? { releaseIntentAt: 'synthetic-prior' } : options.existingReceipt || null;
  const calls = [], commands = [], saves = [], counters = { locks: 0, closed: 0, unlinked: 0, created: 0, finalized: 0, uploads: 0, releases: 0 };
  const execute = (binary, args) => {
    commands.push([binary, ...args]);
    if (binary === 'gcloud') return 'synthetic-placeholder';
    if (args[0] === 'show') return baselines.get(args[1].slice(args[1].indexOf(':') + 1));
    if (args[0] === 'branch' && args[1] === '--all') return 'origin/synthetic-baseline';
    if (args[0] === 'ls-files') return selected.files.map(file => file.source).join('\n');
    if (args[1] === '--verify') return commits[selected.base];
    return ({ 'rev-parse --show-toplevel': '/synthetic-repo', 'fetch origin main': '',
      'rev-parse HEAD': 'f'.repeat(40), 'rev-parse origin/main': options.diverged ? 'e'.repeat(40) : 'f'.repeat(40),
      'branch --show-current': options.branch || 'main', 'status --porcelain': options.dirty || '' })[args.join(' ')] ?? assert.fail(args.join(' '));
  };
  const io = {
    readFileSync(filename) {
      const file = selected.files.find(file => filename === `/synthetic-repo/${file.source}`);
      if (file) return proposed(file, target);
      if (receipt) return JSON.stringify(receipt);
      assert.fail(`Unexpected synthetic read: ${filename}`);
    }, existsSync: () => receipt !== null, mkdirSync() {},
    writeFileSync(filename, value) { assert.equal(filename, '/synthetic-repo/artifacts/staff-video-recovery-20261029/rules-release.json'); receipt = JSON.parse(value); saves.push(structuredClone(receipt)); },
    openSync(filename, flags, mode) { assert.ok(filename.endsWith(`firebase-hosting-${selected.site}.lock`));
      assert.equal(flags, 'wx'); assert.equal(mode, 0o600);
      if (options.concurrentMarker) receipt = { releaseIntentAt: 'synthetic-concurrent-intent' };
      if (options.busy) throw Error('Synthetic busy'); counters.locks++; return 42; },
    writeSync() {}, closeSync() { counters.closed++; }, unlinkSync() { counters.unlinked++; },
  };
  const json = value => ({ ok: true, json: async () => structuredClone(value) });
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url.startsWith('https://upload-firebasehosting.googleapis.com/')) {
      const hash = url.split('/').at(-1); assert.equal(sha(init.body), hash); assert.ok(Object.values(replacements).includes(hash));
      counters.uploads++; return { ok: true };
    }
    if (!url.startsWith('https://firebasehosting.googleapis.com/v1beta1/')) {
      const file = selected.files.find(file => file.url === url); assert.ok(file); assert.equal(init.cache, 'no-store');
      const content = released ? options.badReadback ? Buffer.from('drift') : proposed(file, target) : baselines.get(file.source);
      return { ok: true, arrayBuffer: async () => content };
    }
    const name = url.slice('https://firebasehosting.googleapis.com/v1beta1/'.length);
    if (name.endsWith('/releases?pageSize=1')) {
      latestReads++;
      return json({ releases: [{ name: options.concurrentAt === latestReads ? `${oldRelease}-other` : released ? newRelease : oldRelease,
        version: { name: released ? newVersion : oldVersion } }] });
    }
    if (name === oldVersion) return json({ name, config });
    if (name.startsWith(`${oldVersion}/files?`)) return json({ files });
    if (name === `sites/${selected.site}/versions`) { counters.created++; assert.deepEqual(JSON.parse(init.body), { config }); return json({ name: newVersion }); }
    if (name === `${newVersion}:populateFiles`) {
      manifest = JSON.parse(init.body).files;
      return json({ uploadRequiredHashes: options.unrelatedUpload ? [sha('unrelated')] : Object.values(replacements),
        uploadUrl: 'https://upload-firebasehosting.googleapis.com/upload' });
    }
    if (name.startsWith(`${newVersion}/files?`)) return json({ files: Object.entries(manifest).map(([path, hash]) => ({ path, hash })) });
    if (name === newVersion) return json({ name, config: options.configDrift ? {} : config });
    if (name === `${newVersion}?updateMask=status`) { counters.finalized++; return json({}); }
    if (name.startsWith(`sites/${selected.site}/releases?versionName=`)) {
      assert.ok(saves.at(-1).releaseIntentAt); counters.releases++; released = true; return json({ name: newRelease });
    }
    assert.fail(`Unexpected synthetic request: ${name}`);
  };
  return { calls, commands, saves, counters, files, get manifest() { return manifest; }, get receipt() { return receipt; },
    run: (apply = true, args) => runStaffVideoRecoveryRulesRelease(args ?? [`--target=${target}`, ...(apply ? ['--apply', `--expected-version=${oldVersion}`] : [])],
      { io, execute, fetcher, home: '/synthetic-home', clock: () => '2026-10-28T05:00:00Z' }) };
}

test('synthetic plan is GET-only and cannot overwrite any existing apply receipt', async () => {
  const original = { releaseIntentAt: 'synthetic-previous-apply' }, f = releaseFixture({ existingReceipt: original });
  const result = await f.run(false);
  assert.equal(result.mode, 'plan'); assert.equal(result.changedPaths.length, 1);
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.equal(f.counters.locks, 0); assert.equal(f.saves.length, 0);
  assert.deepEqual(f.receipt, original);
});

test('synthetic apply preserves config/manifest and saves intent inside the lock before one publish', async () => {
  const f = releaseFixture(); const result = await f.run();
  assert.equal(result.verified, true); assert.equal(result.sourceBaseline, BASE);
  assert.deepEqual(result.changedPaths, ['/rules/index.html']);
  assert.equal(f.counters.uploads, 1); assert.equal(f.counters.releases, 1);
  assert.equal(f.counters.closed, 1); assert.equal(f.counters.unlinked, 1);
  assert.equal(f.files.filter(file => f.manifest[file.path] === file.hash).length, 4);
  assert.ok(f.commands.findIndex(call => call.join(' ') === 'git fetch origin main') < f.commands.findIndex(call => call[0] === 'gcloud'));
});

test('apply requires the exact reviewed canonical version and rejects unsupported CLI scope', async () => {
  for (const args of [['--apply'], ['--apply', '--expected-version=sites/archive-pilates/versions/wrong'],
    ['--apply', '--expected-version=sites/archive-pilates-core/versions/stale'],
    ['--target=rules'], ['--target=home'], ['--apply', '--apply'], ['--unknown']]) {
    const f = releaseFixture(); await assert.rejects(() => f.run(true, args));
    assert.equal(f.counters.created, 0); assert.equal(f.counters.releases, 0); assert.equal(f.saves.length, 0);
  }
});

test('dirty, non-main, divergent or previously attempted sources stop before authentication or production calls', async () => {
  for (const options of [{ dirty: ' M unrelated' }, { branch: 'codex/test' }, { diverged: true }, { priorIntent: true }]) {
    const f = releaseFixture(options); await assert.rejects(() => f.run());
    assert.equal(f.calls.length, 0); assert.ok(f.commands.every(call => call[0] !== 'gcloud'));
  }
});

test('lock conflict, concurrent version, unrelated upload and config drift cannot publish', async () => {
  for (const options of [{ busy: true }, { concurrentAt: 2 }, { concurrentAt: 3 }, { concurrentAt: 4 },
    { unrelatedUpload: true }, { configDrift: true }]) {
    const f = releaseFixture(options); await assert.rejects(() => f.run());
    assert.equal(f.counters.releases, 0); assert.equal(f.counters.closed, f.counters.locks); assert.equal(f.counters.unlinked, f.counters.locks);
  }
});

test('failed live readback retains the single release intent and never reports verification', async () => {
  const f = releaseFixture({ badReadback: true }); await assert.rejects(() => f.run());
  assert.equal(f.counters.releases, 1); assert.ok(f.saves.at(-1).releaseIntentAt);
  assert.equal(f.saves.at(-1).verified, undefined); assert.equal(f.counters.unlinked, 1);
});

test('apply never overwrites a receipt before locking and rechecks concurrent intent inside the lock', async () => {
  for (const options of [
    { busy: true, existingReceipt: { createdVersion: 'synthetic-existing' } },
    { busy: true, concurrentMarker: true }, { concurrentMarker: true },
  ]) {
    const f = releaseFixture(options); await assert.rejects(() => f.run());
    assert.equal(f.saves.length, 0); assert.equal(f.counters.created, 0); assert.equal(f.counters.releases, 0);
    assert.deepEqual(f.receipt, options.concurrentMarker ? { releaseIntentAt: 'synthetic-concurrent-intent' } : options.existingReceipt);
    assert.equal(f.counters.closed, f.counters.locks); assert.equal(f.counters.unlinked, f.counters.locks);
  }
});
