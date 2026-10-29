import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { staffCommonRulesTarget, assertStaffCommonRulesScope, makeStaffCommonRulesManifest,
  assertStaffCommonRulesManifest, runStaffCommonRulesRelease } from '../release-staff-common-rules.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const selections = Object.fromEntries(['core-rules'].map(target => [target, staffCommonRulesTarget(target)]));
const commits = Object.fromEntries(['6f3c97c3c1736d95e3d1a5e54dfaa3fe7b3f44d7'].map(base => [base, git(['rev-parse', `${base}^{commit}`])]));
const baselines = new Map(Object.values(selections).flatMap(selected => selected.files.map(file =>
  [file.source, execFileSync('git', ['show', `${selected.base}:${file.source}`], { cwd: root })])));
const BASE = '6f3c97c3c1736d95e3d1a5e54dfaa3fe7b3f44d7';
const HASH = '9f2d5706f5c90a8b5b4bc3788a207321ae3ec0b82143a2aababb363cc5a24f93';
const note = '          <div class="rule-note" id="imweb-staff-video-policy"><strong>Staff common access</strong><span>Preserve uncertainty and ownership; verify native completion independently.</span></div>\n';
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
  const selected = staffCommonRulesTarget();
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
  assert.doesNotThrow(() => assertStaffCommonRulesScope(before, after));
  assert.equal(before.replace(notePattern, ''), after.replace(notePattern, ''));
});

test('scope rejects no-op, new/duplicate notes, changed neighbors, IDs and whitespace', () => {
  const file = selections['core-rules'].files[0], before = baselines.get(file.source).toString(), after = proposed(file).toString();
  for (const candidate of [before, before + note, after + '\n', after.replace(note, note + note),
    after.replace('id="imweb-staff-video-policy"', 'id="another-policy"'),
    after.replace('id="imweb-local-quota-native-continuation"', 'id="changed-neighbor"'),
    after.replace('<html', '<html data-other="changed"')]) {
    assert.notEqual(candidate, after);
    assert.throws(() => assertStaffCommonRulesScope(before, candidate));
  }
});

test('scope rejects malformed baseline and nested, attributed or multiline replacement content', () => {
  const file = selections['core-rules'].files[0], before = baselines.get(file.source).toString(), after = proposed(file).toString();
  for (const candidate of [after.replace('Staff common access', '<b>Staff</b>'), after.replace('Staff common access', 'Staff\nvideo'),
    after.replace('Staff common access', 'Staff\u2028video'), after.replace('<span>Preserve', '<span hidden>Preserve'),
    after.replace('Staff common access', '')]) assert.throws(() => assertStaffCommonRulesScope(before, candidate));
  for (const invalid of [before.replace(notePattern, ''), before + before.match(notePattern)[0]]) {
    assert.throws(() => assertStaffCommonRulesScope(invalid, after));
  }
});

test('legacy mirror, home and inherited targets/resources are rejected', () => {
  for (const target of ['rules', 'home', 'archive-pilates', '__proto__', 'constructor']) {
    assert.throws(() => staffCommonRulesTarget(target));
    assert.throws(() => assertStaffCommonRulesScope('a', 'b', target));
  }
  assert.throws(() => assertStaffCommonRulesScope('a', 'b', 'core-rules', '/core/rules/index.html'));
});

test('manifest replaces only canonical rules while preserving every other current live hash', () => {
  const { files, replacements } = manifestFixture(), original = structuredClone(files);
  const manifest = makeStaffCommonRulesManifest(files, replacements['/rules/index.html']);
  assert.deepEqual(files, original);
  assert.deepEqual(files.filter(file => manifest[file.path] !== file.hash).map(file => file.path), ['/rules/index.html']);
  assert.equal(Object.keys(manifest).length, files.length);
  assertStaffCommonRulesManifest(Object.entries(manifest).map(([path, hash]) => ({ path, hash })), manifest);
});

test('manifest rejects missing target, duplicate paths, invalid hashes and no-op replacement', () => {
  const { files, replacements } = manifestFixture(), hash = replacements['/rules/index.html'];
  for (const invalid of [files.slice(1), [...files, files[0]], files.map((file, i) => i === 1 ? { ...file, hash: 'invalid' } : file)]) {
    assert.throws(() => makeStaffCommonRulesManifest(invalid, hash));
  }
  for (const invalid of ['invalid', files[0].hash]) assert.throws(() => makeStaffCommonRulesManifest(files, invalid));
});

test('full manifest readback rejects drift, omissions and duplicate/extra paths', () => {
  const { files, replacements } = manifestFixture();
  const manifest = makeStaffCommonRulesManifest(files, replacements['/rules/index.html']);
  const rows = Object.entries(manifest).map(([path, hash]) => ({ path, hash }));
  for (const invalid of [rows.slice(1), [...rows, rows[0]], rows.map((file, i) => i === 1 ? { ...file, hash: sha('drift') } : file)]) {
    assert.throws(() => assertStaffCommonRulesManifest(invalid, manifest));
  }
});

function releaseFixture(options = {}) {
  const target = options.target || 'core-rules', selected = selections[target], { files, replacements } = manifestFixture(target);
  const oldVersion = `sites/${selected.site}/versions/reviewed`, newVersion = `sites/${selected.site}/versions/replacement`;
  const oldRelease = `sites/${selected.site}/releases/reviewed`, newRelease = `sites/${selected.site}/releases/replacement`;
  const config = { headers: [{ glob: '**', headers: { 'Cache-Control': 'no-cache' } }], rewrites: [{ glob: '**', path: '/index.html' }] };
  let manifest, released = false, latestReads = 0;
  let receipt = options.priorIntent ? { releaseIntentAt: 'synthetic-prior' } : options.existingReceipt || null;
  const calls = [], commands = [], saves = [], counters = { locks: 0, closed: 0, unlinked: 0, created: 0, finalized: 0, uploads: 0, releases: 0, synced: 0 };
  const evidencePath = '/synthetic-repo/artifacts/staff-common-access-20261029/rules-release.json';
  const temporaryFiles = new Map(), descriptors = new Map(); let nextDescriptor = 100;
  const execute = (binary, args) => {
    commands.push([binary, ...args]);
    if (binary === 'gcloud') return 'synthetic-placeholder';
    if (args[0] === 'show') return baselines.get(args[1].slice(args[1].indexOf(':') + 1));
    if (args[0] === 'branch' && args[1] === '--all') return 'origin/synthetic-baseline';
    if (args[0] === 'merge-base') {
      assert.deepEqual(args.slice(0, 2), ['merge-base', '--is-ancestor']);
      assert.equal(args[3], 'f'.repeat(40));
      assert.ok([BASE, 'origin/main'].includes(args[2]));
      if (args[2] === 'origin/main' && (options.diverged || options.behind)) throw Error('Synthetic non-ancestor remote');
      return '';
    }
    if (args[0] === 'ls-files') return selected.files.map(file => file.source).join('\n');
    if (args[1] === '--verify') return commits[selected.base];
    return ({ 'rev-parse --show-toplevel': '/synthetic-repo', 'fetch origin main': '',
      'rev-parse HEAD': 'f'.repeat(40), 'rev-parse origin/main': options.diverged || options.behind || options.ahead ? 'e'.repeat(40) : 'f'.repeat(40),
      'branch --show-current': options.branch || 'main', 'status --porcelain': options.dirty || '' })[args.join(' ')] ?? assert.fail(args.join(' '));
  };
  const io = {
    readFileSync(filename) {
      const file = selected.files.find(file => filename === `/synthetic-repo/${file.source}`);
      if (file) return proposed(file, target);
      if (receipt) return JSON.stringify(receipt);
      assert.fail(`Unexpected synthetic read: ${filename}`);
    }, existsSync: () => receipt !== null, mkdirSync() {},
    writeFileSync(descriptor, value) {
      assert.ok(descriptors.has(descriptor));
      temporaryFiles.set(descriptors.get(descriptor), { value, synced: false });
    },
    fsyncSync(descriptor) {
      const filename = descriptors.get(descriptor);
      assert.ok(filename);
      if (options.syncFailure && filename.startsWith(evidencePath)) throw Error('Synthetic evidence sync failure');
      if (temporaryFiles.has(filename)) temporaryFiles.get(filename).synced = true;
      counters.synced++;
    },
    renameSync(from, to) {
      assert.equal(to, evidencePath);
      assert.equal(temporaryFiles.get(from)?.synced, true, 'Evidence must be synced before rename');
      receipt = JSON.parse(temporaryFiles.get(from).value); saves.push(structuredClone(receipt));
      temporaryFiles.delete(from);
    },
    openSync(filename, flags, mode) {
      if (filename.startsWith(evidencePath) || filename === evidencePath.slice(0, evidencePath.lastIndexOf('/'))) {
        assert.equal(flags, filename.startsWith(evidencePath) ? 'wx' : 'r');
        if (flags === 'wx') assert.equal(mode, 0o600);
        descriptors.set(nextDescriptor, filename); return nextDescriptor++;
      }
      assert.ok(filename.endsWith(`firebase-hosting-${selected.site}.lock`));
      assert.equal(flags, 'wx'); assert.equal(mode, 0o600);
      if (options.concurrentMarker) receipt = { releaseIntentAt: 'synthetic-concurrent-intent' };
      if (options.busy) throw Error('Synthetic busy'); counters.locks++; return 42; },
    writeSync() {}, closeSync(descriptor) { if (descriptor === 42) counters.closed++; else descriptors.delete(descriptor); },
    unlinkSync(filename) {
      if (filename.startsWith(evidencePath)) {
        if (!temporaryFiles.delete(filename)) throw Object.assign(Error('Missing temporary evidence'), { code: 'ENOENT' });
      } else counters.unlinked++;
    },
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
    run: (apply = true, args) => runStaffCommonRulesRelease(args ?? [`--target=${target}`, ...(apply ? ['--apply', `--expected-version=${oldVersion}`] : [])],
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
  for (const options of [{ dirty: ' M unrelated' }, { branch: 'codex/test' }, { diverged: true }, { behind: true }, { priorIntent: true }]) {
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

test('apply permits unpushed clean-main commits only when fresh origin/main is an ancestor', async () => {
  const f = releaseFixture({ ahead: true });
  const result = await f.run();
  assert.equal(result.verified, true);
  const commands = f.commands.map(call => call.join(' '));
  const fetchIndex = commands.indexOf('git fetch origin main');
  const ancestryIndex = commands.indexOf('git merge-base --is-ancestor origin/main ' + 'f'.repeat(40));
  assert.ok(fetchIndex >= 0 && ancestryIndex > fetchIndex);
  assert.equal(commands.filter(command => command.startsWith('git fetch ')).length, 1);
  assert.ok(commands.filter(command => command.startsWith('git merge-base --is-ancestor origin/main ')).length >= 4);
  assert.ok(commands.includes('git merge-base --is-ancestor ' + BASE + ' ' + 'f'.repeat(40)));
  assert.ok(commands.every(command => !/^git (push|merge |reset|clean)/.test(command)));
  assert.equal(f.counters.releases, 1);
});

test('plan never fetches, publishes or writes artifacts even with local-only commits', async () => {
  const f = releaseFixture({ branch: 'codex/mini/review', ahead: true });
  const result = await f.run(false);
  assert.equal(result.mode, 'plan');
  assert.ok(f.commands.every(call => call.join(' ') !== 'git fetch origin main'));
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.equal(f.saves.length, 0);
});

test('failed post-release readback preserves the replay guard for the next invocation', async () => {
  const f = releaseFixture({ badReadback: true });
  await assert.rejects(() => f.run());
  const before = structuredClone(f.receipt), calls = f.calls.length;
  await assert.rejects(() => f.run(), /Prior release intent/);
  assert.deepEqual(f.receipt, before);
  assert.equal(f.calls.length, calls);
  assert.equal(f.counters.releases, 1);
});

test('atomic evidence saves sync file and directory before publishing and retain mode 0600', async () => {
  const f = releaseFixture();
  await f.run();
  assert.equal(f.counters.synced, f.saves.length * 2);
  assert.ok(f.receipt.releaseIntentAt);
  assert.equal(f.receipt.verified, true);
});

test('evidence fsync failure stops before any Hosting mutation and preserves prior receipt', async () => {
  const original = { createdVersion: 'synthetic-existing' };
  const f = releaseFixture({ syncFailure: true, existingReceipt: original });
  await assert.rejects(() => f.run(), /evidence sync failure/);
  assert.deepEqual(f.receipt, original);
  assert.equal(f.counters.created, 0);
  assert.equal(f.counters.releases, 0);
  assert.equal(f.counters.closed, 1);
  assert.equal(f.counters.unlinked, 1);
});
