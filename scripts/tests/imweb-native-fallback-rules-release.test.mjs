import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { assertNativeFallbackRulesScope } from '../release-imweb-native-fallback-rules.mjs';
import { makeManifest, assertManifest } from '../release-e261017-classroom.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const releaseSource = readFileSync(new URL('../release-imweb-native-fallback-rules.mjs', import.meta.url), 'utf8');
const baseline = execFileSync('git', ['show', 'd6f864fd:core/rules/index.html'], { cwd: root, encoding: 'utf8' });
const baselineHash = '05e91569ef34b4501607ed13b2a1851a86b7be275bba22af62a180d2d85c25bc';
const oldId = 'method9-c-sale-20261028', newId = 'imweb-local-quota-native-continuation';
const note = (id, title, text) => `          <div class="rule-note" id="${id}"><strong>${title}</strong><span>${text}</span></div>\n`;
const previous = note(oldId, 'Old paid video status', 'Catalog deployed; ordinary-account verification pending.');
const replacement = note(oldId, 'Updated paid video status', 'Native continuation permitted within existing approval; no sale claimed.');
const addition = note(newId, 'Local quota native continuation', 'Only confirmed pre-dispatch local quota rejection is eligible; preserve scope and readback.');
const before = '<main>Preserved header</main>\n' + previous + '<footer>Preserved footer</footer>\n';
const after = before.replace(previous, () => addition + replacement);
const baselineNotes = baseline.match(/^          <div class="rule-note" id="method9-c-sale-20261028">[^\n]+\n/gm);
assert.equal(baselineNotes.length, 1);
const proposed = baseline.replace(baselineNotes[0], () => addition + replacement);
const sha = value => createHash('sha256').update(value).digest('hex');

test('baseline source hash and only two site/resource mappings are pinned', () => {
  assert.equal(sha(baseline), baselineHash);
  assert.match(releaseSource, /const BASE = 'd6f864fd';/);
  assert.ok(releaseSource.includes(`const BASELINE_SHA256 = '${baselineHash}';`));
  const start = releaseSource.indexOf('const targets = {'), end = releaseSource.indexOf('\n};', start);
  assert.deepEqual(structuredClone(runInNewContext(`${releaseSource.slice(start, end + 3)}\ntargets;`)), {
    rules: { site: 'archive-pilates', resource: '/core/rules/index.html', source: 'core/rules/index.html', url: 'https://archive-pilates.web.app/core/rules/' },
    'core-rules': { site: 'archive-pilates-core', resource: '/rules/index.html', source: 'core/rules/index.html', url: 'https://archive-pilates-core.web.app/rules/' },
  });
  assert.match(releaseSource, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
});

for (const target of ['rules', 'core-rules']) {
  test(`${target}: accepts exactly replacement plus immediately preceding addition`, () => {
    assert.doesNotThrow(() => assertNativeFallbackRulesScope(before, after, target));
    assert.doesNotThrow(() => assertNativeFallbackRulesScope(baseline, proposed, target));
    assert.equal(after.replace(addition + replacement, previous), before);
  });
  test(`${target}: entity-escaped plain text remains allowed`, () => {
    assert.doesNotThrow(() => assertNativeFallbackRulesScope(before,
      after.replace('preserve scope', 'preserve &lt;scope&gt; &amp; approvals'), target));
  });
  for (const [name, candidate] of [
    ['no-op', before], ['addition only', before.replace(previous, addition + previous)],
    ['replacement only', before.replace(previous, replacement)], ['missing old note', before.replace(previous, addition)],
    ['duplicate old note', after.replace(replacement, replacement + replacement)],
    ['duplicate new note', after.replace(addition, addition + addition)],
    ['wrong new ID', after.replace(`id="${newId}"`, 'id="other"')],
    ['wrong old ID', after.replace(`id="${oldId}"`, 'id="other"')],
    ['reversed order', after.replace(addition + replacement, replacement + addition)],
    ['added note at end', before.replace(previous, replacement) + addition],
    ['moved pair', before.replace(previous, '') + addition + replacement],
    ['unrelated header', after.replace('Preserved header', 'Changed header')],
    ['unrelated footer', after.replace('Preserved footer', 'Changed footer')],
    ['extra newline', after + '\n'], ['comment', after.replace(addition, addition + '<!-- extra -->\n')],
    ['same-line sibling', after.replace('</span></div>\n', '</span></div><p>Other</p>\n')],
    ['nested span HTML', after.replace('Only confirmed', '<b>Only</b> confirmed')],
    ['nested heading HTML', after.replace('Updated paid video status', '<em>Updated</em> paid video status')],
    ['multiline span', after.replace('Only confirmed', 'Only\nconfirmed')],
    ['CR span', after.replace('Only confirmed', 'Only\rconfirmed')],
    ['Unicode line separator', after.replace('Only confirmed', 'Only\u2028confirmed')],
    ['Unicode paragraph separator', after.replace('Only confirmed', 'Only\u2029confirmed')],
    ['multiline heading', after.replace('Updated paid video status', 'Updated\npaid video status')],
    ['span attributes', after.replace('<span>Only', '<span onclick="other()">Only')],
    ['div attributes', after.replace(`id="${newId}">`, `id="${newId}" hidden>`) ],
    ['empty heading', after.replace('Updated paid video status', '')],
    ['empty span', after.replace(/<span>Only[^<]+<\/span>/, '<span></span>')],
  ]) test(`${target}: rejects ${name}`, () => {
    assert.notEqual(candidate, after);
    assert.throws(() => assertNativeFallbackRulesScope(before, candidate, target));
  });
  for (const [name, source] of [
    ['missing old note', before.replace(previous, '')], ['duplicate old note', before + previous],
    ['new note already exists', addition + before],
    ['malformed baseline old note', before.replace('<strong>Old', '<strong><b>Old</b>')],
  ]) test(`${target}: rejects invalid baseline ${name}`, () => {
    assert.throws(() => assertNativeFallbackRulesScope(source, after, target));
  });
}

test('scope rejects classroom and all unknown or inherited targets', () => {
  for (const target of [undefined, '', 'classroom', 'unknown', '__proto__', 'constructor', 'toString']) {
    assert.throws(() => assertNativeFallbackRulesScope(before, after, target), /Unexpected release target/);
  }
});

function fixture(options = {}) {
  const target = options.target || 'rules';
  const site = target === 'rules' ? 'archive-pilates' : 'archive-pilates-core';
  const resource = target === 'rules' ? '/core/rules/index.html' : '/rules/index.html';
  const url = target === 'rules' ? 'https://archive-pilates.web.app/core/rules/' : 'https://archive-pilates-core.web.app/rules/';
  const oldVersion = `sites/${site}/versions/reviewed`, newVersion = `sites/${site}/versions/replacement`;
  const releaseName = `sites/${site}/releases/reviewed`;
  const config = { headers: [{ glob: '**', headers: { 'Cache-Control': 'no-cache' } }], rewrites: [{ glob: '**', path: '/index.html' }] };
  const baselineFiles = [{ path: resource, hash: 'a'.repeat(64) }, ...Array.from({ length: options.large ? 1001 : 3 },
    (_, index) => ({ path: `/preserved-${index}.html`, hash: 'b'.repeat(64) }))];
  let manifest, latestReads = 0, baselinePages = 0, versionPages = 0;
  const calls = [], commands = [], saved = [], locks = [];
  const counters = { auth: 0, finalized: 0, released: 0, uploads: 0, closes: 0, unlinks: 0 };
  const mockExec = (binary, args) => {
    commands.push([binary, ...args]);
    if (binary === 'gcloud') {
      counters.auth++;
      assert.deepEqual(Array.from(args), ['auth', 'print-access-token', '--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com']);
      return 'synthetic-placeholder-not-a-credential';
    }
    assert.equal(binary, 'git');
    if (args[0] === 'show') {
      assert.equal(args[1], 'd6f864fd:core/rules/index.html');
      return Buffer.from(baseline + (options.baselineHashDrift ? '\n' : ''));
    }
    const key = args.join(' ');
    if (key === 'fetch origin main' && options.fetchFailure) throw Error('Synthetic fetch failure');
    return ({ 'rev-parse --show-toplevel': '/synthetic-repo', 'fetch origin main': '',
      'branch --show-current': options.branch || 'main', 'status --porcelain': options.dirty || '',
      'rev-parse HEAD': 'synthetic-commit', 'rev-parse origin/main': options.diverged ? 'other-commit' : 'synthetic-commit' })[key]
      ?? assert.fail(`Unexpected mock Git operation: ${key}`);
  };
  const mockFs = {
    readFileSync(file) {
      assert.equal(file, '/synthetic-repo/core/rules/index.html');
      return Buffer.from(options.noChange ? baseline : proposed + (options.sourceDrift ? '\n' : ''));
    },
    mkdirSync() {},
    writeFileSync(file, data) { saved.push({ file, evidence: JSON.parse(data) }); },
    openSync(file, flags, mode) {
      assert.equal(file, `/synthetic-home/ArchiveIN/automation/locks/firebase-hosting-${site}.lock`);
      assert.equal(flags, 'wx'); assert.equal(mode, 0o600);
      if (options.busy) throw Error('Synthetic lock busy');
      locks.push(file); return 42;
    },
    writeSync() {}, closeSync() { counters.closes++; }, unlinkSync() { counters.unlinks++; },
  };
  const json = value => ({ ok: true, json: async () => structuredClone(value) });
  const bytes = value => ({ ok: true, arrayBuffer: async () => Buffer.from(value) });
  const mockFetch = async (address, init = {}) => {
    calls.push({ url: address, method: init.method || 'GET', body: init.body });
    if (!address.startsWith('https://firebasehosting.googleapis.com/v1beta1/')) {
      if (address.startsWith('https://upload-firebasehosting.googleapis.com/')) {
        assert.equal(init.method, 'POST'); counters.uploads++;
        assert.equal(sha(init.body), sha(gzipSync(Buffer.from(proposed), { level: 9 })));
        return { ok: !options.uploadFailure, status: 500 };
      }
      assert.equal(address, url); assert.equal(init.cache, 'no-store');
      if (options.liveHttpFailure) return { ok: false, status: 503 };
      return bytes(counters.released ? options.badReadback ? 'wrong' : proposed : options.liveDrift ? 'wrong' : baseline);
    }
    const name = address.slice('https://firebasehosting.googleapis.com/v1beta1/'.length);
    if (options.apiFailure) return { ok: false, status: 503 };
    if (name.includes('/releases?pageSize=')) {
      latestReads++;
      return json({ releases: [{ name: options.badReleaseName ? 'sites/other/releases/wrong'
        : options.concurrentAt === latestReads ? `${releaseName}-concurrent` : releaseName,
      version: { name: options.badInitialVersion && latestReads === 1 ? 'sites/other/versions/wrong'
        : counters.released ? options.postReleaseDrift ? `${newVersion}-other` : newVersion : oldVersion } }] });
    }
    if (name === `sites/${site}/versions` && init.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), { config });
      return json({ name: options.badCreatedVersion ? 'sites/other/versions/wrong' : newVersion });
    }
    if (name.startsWith(`${oldVersion}/files?pageSize=1000`)) {
      baselinePages++;
      return json(options.large ? baselinePages === 1 ? { files: baselineFiles.slice(0, 1000), nextPageToken: 'next' }
        : { files: baselineFiles.slice(1000) } : { files: options.missingAsset ? baselineFiles.slice(1)
          : options.duplicateAsset ? [...baselineFiles, baselineFiles[0]] : baselineFiles });
    }
    if (name === oldVersion) return json({ name: options.badBaseline ? 'sites/other/versions/wrong' : oldVersion,
      config: options.missingConfig ? undefined : config });
    if (name === `${newVersion}:populateFiles`) {
      manifest = { ...manifest, ...JSON.parse(init.body).files };
      return json({ uploadRequiredHashes: options.unrelatedUpload ? ['f'.repeat(64)] : [sha(gzipSync(Buffer.from(proposed), { level: 9 }))],
        uploadUrl: options.badUploadHost ? 'https://untrusted.invalid/upload' : 'https://upload-firebasehosting.googleapis.com/upload' });
    }
    if (name.startsWith(`${newVersion}/files?pageSize=1000`)) {
      versionPages++;
      const values = Object.entries(manifest).map(([path, hash]) => ({ path, hash }));
      if (options.manifestDrift) values.find(row => row.path !== resource).hash = 'e'.repeat(64);
      if (options.extraResource) values.push({ path: '/unexpected.html', hash: 'f'.repeat(64) });
      return json(options.large ? versionPages === 1 ? { files: values.slice(0, 1000), nextPageToken: 'next' }
        : { files: values.slice(1000) } : { files: values });
    }
    if (name === newVersion) return json({ name: newVersion, config: options.configDrift ? {} : config });
    if (name === `${newVersion}?updateMask=status`) {
      assert.equal(init.method, 'PATCH'); assert.deepEqual(JSON.parse(init.body), { status: 'FINALIZED' });
      counters.finalized++; return json({});
    }
    if (name === `sites/${site}/releases?versionName=${newVersion}`) {
      assert.equal(init.method, 'POST');
      assert.ok(saved.at(-1).evidence.releaseIntentAt, 'persist intent before publishing');
      assert.match(JSON.parse(init.body).message, /^Imweb native continuation (?:rules|core-rules) notes only /);
      counters.released++; return json({ name: `sites/${site}/releases/replacement` });
    }
    assert.fail(`Unexpected mock request: ${name}`);
  };
  const from = releaseSource.indexOf('const BASE ='), to = releaseSource.lastIndexOf('\nif (process.argv[1]');
  // Only pinned Git reads above are real; the CLI body has no real filesystem, auth or network.
  const main = runInNewContext(`${releaseSource.slice(from, to).replace('export function assertNativeFallbackRulesScope', 'function assertNativeFallbackRulesScope')}\nmain;`, {
    fs: mockFs, path, execFileSync: mockExec, createHash, gzipSync, Buffer, URL, Date,
    isDeepStrictEqual: (a, b) => isDeepStrictEqual(structuredClone(a), structuredClone(b)), makeManifest, assertManifest,
    fetch: mockFetch, AbortSignal: { timeout: () => undefined }, console: { log() {} },
    process: { argv: ['node', 'synthetic-release', ...(options.args || [`--target=${target}`, '--apply',
      `--expected-version=${options.expected || oldVersion}`])], env: { HOME: '/synthetic-home' }, pid: 42 },
  });
  return { main, calls, commands, saved, locks, counters, baselineFiles, resource, get manifest() { return manifest; } };
}

for (const target of ['rules', 'core-rules']) {
  test(`${target}: mock apply preserves config and every other file; intent and readback verified`, async () => {
    const f = fixture({ target }); await f.main();
    assert.equal(f.counters.released, 1); assert.equal(f.counters.finalized, 1);
    assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
    assert.equal(f.saved.at(-1).evidence.verified, true);
    assert.equal(f.saved[0].evidence.sourceBaseline, 'd6f864fd');
    assert.equal(f.saved[0].evidence.baselineSourceSha256, baselineHash);
    assert.ok(f.saved.every(row => row.file.includes('/artifacts/imweb-native-fallback-20261028/')));
    assert.deepEqual(f.saved[0].evidence.changedPaths, [f.resource]);
    assert.ok(f.commands.findIndex(row => row.join(' ') === 'git fetch origin main') < f.commands.findIndex(row => row[0] === 'gcloud'));
    const changed = f.baselineFiles.filter(file => f.manifest[file.path] !== file.hash);
    assert.deepEqual(changed.map(file => file.path), [f.resource]);
    assert.equal(Object.keys(f.manifest).length, f.baselineFiles.length);
  });
  test(`${target}: mock plan makes GET requests only, takes no lock and stores plan not release`, async () => {
    const f = fixture({ target, args: [`--target=${target}`] }); await f.main();
    assert.ok(f.calls.every(call => call.method === 'GET'));
    assert.equal(f.locks.length, 0); assert.equal(f.counters.released, 0);
    assert.equal(f.saved[0].evidence.mode, 'plan');
    assert.equal(f.saved[0].evidence.verified, undefined);
  });
}

test('large manifest paginates both versions and preserves unrelated files across chunks', async () => {
  const f = fixture({ large: true }); await f.main();
  assert.equal(Object.keys(f.manifest).length, 1002);
  assert.equal(f.calls.filter(call => call.url.includes(':populateFiles')).length, 2);
  assert.equal(f.calls.filter(call => call.url.includes('pageToken=next')).length, 2);
});

for (const args of [[], ['--target=classroom'], ['--target=unknown'], ['--target=__proto__'], ['--target=constructor'],
  ['--target=toString'], ['--target=rules', '--force'], ['--target=rules', '--target=core-rules'],
  ['--target=rules', '--apply', '--apply'], ['--target=rules', '--expected-version=a', '--expected-version=b']]) {
  test(`invalid CLI stops before auth/network: ${args.join(' ')}`, async () => {
    const f = fixture({ args }); await assert.rejects(f.main(), /Unsupported/);
    assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
  });
}

for (const options of [{ branch: 'codex/mini/imweb-native-fallback-20261028' }, { dirty: '?? unrelated' },
  { diverged: true }, { fetchFailure: true }, { baselineHashDrift: true }, { sourceDrift: true },
  { noChange: true }, { args: ['--target=rules', '--apply'] }]) {
  test(`unsafe source stops before auth/network: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.main());
    assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
  });
}

for (const options of [{ expected: 'stale' }, { badInitialVersion: true }, { badReleaseName: true }, { liveDrift: true },
  { liveHttpFailure: true }, { badBaseline: true }, { missingConfig: true }, { missingAsset: true },
  { duplicateAsset: true }, { apiFailure: true }, { busy: true }]) {
  test(`baseline/version/lock guard stops before provider mutations: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.main());
    assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(f.counters.released, 0);
  });
}

for (const concurrentAt of [2, 3, 4]) test(`concurrent release at read ${concurrentAt} blocks publishing and releases lock`, async () => {
  const f = fixture({ concurrentAt }); await assert.rejects(f.main(), /[Cc]oncurrent|release changed/);
  assert.equal(f.counters.released, 0); assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
});

for (const options of [{ badCreatedVersion: true }, { unrelatedUpload: true }, { badUploadHost: true },
  { uploadFailure: true }, { manifestDrift: true }, { extraResource: true }, { configDrift: true }]) {
  test(`version/upload/manifest/config guard prevents finalize and publish: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.main());
    assert.equal(f.counters.finalized, 0); assert.equal(f.counters.released, 0);
    assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
  });
}

for (const options of [{ badReadback: true }, { postReleaseDrift: true }]) test('ambiguous readback does not retry or mark verified', async () => {
  const f = fixture(options); await assert.rejects(f.main(), /do not repeat release/);
  assert.equal(f.counters.released, 1); assert.equal(f.saved.at(-1).evidence.verified, undefined);
  assert.ok(f.saved.at(-1).evidence.releaseIntentAt);
  assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
});
