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
import { assertMethod9ReleaseScope } from '../release-method9-c-sale.mjs';
import { makeManifest, assertManifest } from '../release-e261017-classroom.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const releaseSource = readFileSync(new URL('../release-method9-c-sale.mjs', import.meta.url), 'utf8');
const baseline = file => execFileSync('git', ['show', `18b75b9a:${file}`], { cwd: root, encoding: 'utf8' });
const classroomPath = 'official-home/assets/imweb-my-classroom-20260723a.js';
const classroom = baseline(classroomPath), rules = baseline('core/rules/index.html');
const ASSET = '/assets/imweb-my-classroom-20260723a.js';
const anchor = '    {"code":"AB10","path":"/archive-method-watch-ab10","title":"바렐 외부 피드백 (AB10)"}\n';
const tuples = [
  { code: 'AB11', path: '/archive-method-watch-ab11', title: '바렐 외부 피드백2 (AB11)' },
  { code: 'AR7', path: '/archive-method-watch-ar7', title: '리포머 외부 피드백2 (AR7)' },
];
const rows = tuples.map(row => `    ${JSON.stringify(row)}`).join(',\n') + '\n';
const proposedClassroom = classroom.replace(anchor, `${anchor.trimEnd()},\n${rows}`);
const rulesAnchor = '          <div class="rule-note" id="imweb-sale-opening-safety-policy">';
const note = '          <div class="rule-note" id="method9-c-sale-20261028"><strong>METHOD #9 preparation</strong><span>Local only; ordinary-account verification pending; sale not opened.</span></div>\n';
const proposedRules = rules.replace(rulesAnchor, () => note + rulesAnchor);
const sha = value => createHash('sha256').update(value).digest('hex');

test('actual classroom adds exactly AB11/AR7 and preserves every private and unrelated byte', () => {
  const current = readFileSync(path.join(root, classroomPath), 'utf8');
  assert.equal(current, proposedClassroom);
  assert.doesNotThrow(() => assertMethod9ReleaseScope(classroom, current, 'classroom'));
  const start = current.indexOf('  var PAID_VIDEO_CATALOG='), end = current.indexOf('  var M=', start);
  const catalog = structuredClone(runInNewContext(`${current.slice(start, end)}\n({paid:PAID_VIDEO_CATALOG,all:L});`));
  assert.equal(catalog.paid.length, 33);
  assert.equal(catalog.all.filter(row => row.private).length, 16);
  assert.equal(new Set(catalog.all.map(row => row.code)).size, catalog.all.length);
  assert.deepEqual(catalog.paid.slice(-2), tuples);
  assert.equal(current.slice(current.indexOf('  var L=')), classroom.slice(classroom.indexOf('  var L=')));
  assert.ok(!/youtube|videoId|iframe|group|private/.test(rows));
});

for (const [name, mutate] of [
  ['missing AR7', value => value.replace(`,\n    ${JSON.stringify(tuples[1])}`, '')],
  ['duplicate AB11', value => value.replace('"code":"AR7"', '"code":"AB11"')],
  ['wrong path', value => value.replace(tuples[0].path, tuples[1].path)],
  ['wrong title', value => value.replace(tuples[0].title, tuples[1].title)],
  ['extra group', value => value.replace('"code":"AB11",', '"code":"AB11","group":"OTHER",')],
  ['private flag', value => value.replace('"code":"AB11",', '"code":"AB11","private":true,')],
  ['full video ID', value => value.replace('"code":"AB11",', '"code":"AB11","videoId":"AbCdEfGhI_1",')],
  ['reordered tuples', value => value.replace(rows, tuples.slice().reverse().map(row => `    ${JSON.stringify(row)}`).join(',\n') + '\n')],
  ['private C mutation', value => value.replace('"code":"C261025"', '"code":"CHANGED"')],
  ['old paid mutation', value => value.replace('"code":"AR1"', '"code":"AR0"')],
  ['manual mapping mutation', value => value.replace(':"owner"', ':"all"')],
  ['unrelated prefix', value => `\n${value}`],
  ['unrelated suffix', value => `${value}\n`],
]) test(`classroom scope rejects ${name}`, () => {
  const after = mutate(proposedClassroom);
  assert.notEqual(after, proposedClassroom);
  assert.throws(() => assertMethod9ReleaseScope(classroom, after, 'classroom'));
});

test('classroom scope rejects no-op, private-array insertion and already-present new codes', () => {
  assert.throws(() => assertMethod9ReleaseScope(classroom, classroom, 'classroom'));
  assert.throws(() => assertMethod9ReleaseScope(classroom, classroom.replace('  var L=', rows + '  var L='), 'classroom'));
  for (const code of ['AB11', 'AR7']) {
    const before = classroom + `\n{"code" : "${code}"}`;
    assert.throws(() => assertMethod9ReleaseScope(before, before.replace(anchor, `${anchor.trimEnd()},\n${rows}`), 'classroom'));
  }
  const withoutAnchor = classroom.replace(anchor, '');
  assert.throws(() => assertMethod9ReleaseScope(withoutAnchor, proposedClassroom, 'classroom'));
});

for (const target of ['rules', 'core-rules']) {
  test(`${target}: actual note is the only change, explicitly local and pending`, () => {
    const current = readFileSync(path.join(root, 'core/rules/index.html'), 'utf8');
    assert.doesNotThrow(() => assertMethod9ReleaseScope(rules, current, target));
    const actual = current.match(/^          <div class="rule-note" id="method9-c-sale-20261028">[^\n]+\n/gm);
    assert.equal(actual.length, 1);
    for (const marker of ['implemented:', 'verified:', 'pending:', 'deployed later:']) {
      assert.ok(actual[0].includes(marker), marker);
    }
    assert.match(actual[0], /일반 구매자.*미완료/);
    assert.match(actual[0], /판매 오픈·쿠폰 배포는 아직 실행하지 않았습니다/);
    assert.match(actual[0], /write_quota_exceeded/);
    assert.equal(current.replace(actual[0], ''), rules);
  });
  test(`${target}: permits only one anchored note addition`, () => {
    assert.doesNotThrow(() => assertMethod9ReleaseScope(rules, proposedRules, target));
  });
  for (const [name, after] of [
    ['no-op', rules], ['duplicate note', proposedRules.replace(note, note + note)],
    ['same-line sibling', proposedRules.replace('</span></div>\n' + rulesAnchor, '</span></div><p>Other</p>\n' + rulesAnchor)],
    ['suffix drift', proposedRules + '\n'], ['title drift', proposedRules.replace('<title>', '<title>Other')],
    ['old student rule mutation', proposedRules.replace('id="lesson-share-261025"', 'id="changed"')],
    ['misplaced note', rules + note], ['wrong ID', proposedRules.replace('id="method9-c-sale-20261028"', 'id="other"')],
  ]) test(`${target}: refuses ${name}`, () => {
    assert.throws(() => assertMethod9ReleaseScope(rules, after, target));
  });
  test(`${target}: cannot replace or duplicate a pre-existing lane note`, () => {
    assert.throws(() => assertMethod9ReleaseScope(proposedRules, proposedRules.replace('Local only;', 'Changed;'), target));
    assert.throws(() => assertMethod9ReleaseScope(proposedRules, proposedRules.replace(note, note + note), target));
  });
}

test('release source pins BASE18b75b9a, the exact three resources and import-safe entrypoint', () => {
  assert.match(releaseSource, /const BASE = '18b75b9a';/);
  const start = releaseSource.indexOf('const targets = {'), end = releaseSource.indexOf('\n};', start);
  const targets = structuredClone(runInNewContext(`${releaseSource.slice(start, end + 3)}\ntargets;`, { ASSET }));
  assert.deepEqual(targets, {
    classroom: { site: 'archive-pilates-home', resource: ASSET, source: classroomPath, url: `https://archivepilates.com${ASSET}` },
    rules: { site: 'archive-pilates', resource: '/core/rules/index.html', source: 'core/rules/index.html', url: 'https://archive-pilates.web.app/core/rules/' },
    'core-rules': { site: 'archive-pilates-core', resource: '/rules/index.html', source: 'core/rules/index.html', url: 'https://archive-pilates-core.web.app/rules/' },
  });
  assert.match(releaseSource, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  for (const target of [undefined, '', 'unknown', '__proto__', 'constructor', 'toString']) {
    assert.throws(() => assertMethod9ReleaseScope(rules, proposedRules, target), /Unexpected release target/);
  }
});

function fixture(options = {}) {
  const target = options.target || 'classroom';
  const site = target === 'rules' ? 'archive-pilates' : target === 'core-rules' ? 'archive-pilates-core' : 'archive-pilates-home';
  const resource = target === 'rules' ? '/core/rules/index.html' : target === 'core-rules' ? '/rules/index.html' : ASSET;
  const before = target === 'classroom' ? classroom : rules;
  const after = target === 'classroom' ? proposedClassroom : proposedRules;
  const oldVersion = `sites/${site}/versions/reviewed`, newVersion = `sites/${site}/versions/replacement`;
  const releaseName = `sites/${site}/releases/reviewed`;
  const config = { headers: [{ glob: '**', headers: { 'Cache-Control': 'no-cache' } }], rewrites: [{ glob: '**', path: '/index.html' }] };
  const baselineFiles = [{ path: resource, hash: 'a'.repeat(64) }, ...Array.from({ length: options.large ? 1001 : 3 },
    (_, index) => ({ path: `/preserved-${index}.html`, hash: 'b'.repeat(64) }))];
  let proposedManifest, latestReads = 0, baselinePages = 0, versionPages = 0;
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
      assert.equal(args[1], `18b75b9a:${target === 'classroom' ? classroomPath : 'core/rules/index.html'}`);
      return Buffer.from(before);
    }
    const key = args.join(' ');
    if (key === 'fetch origin main' && options.fetchFailure) throw Error('Synthetic fetch failed');
    return ({ 'rev-parse --show-toplevel': '/synthetic-repo', 'fetch origin main': '',
      'branch --show-current': options.branch || 'main', 'status --porcelain': options.dirty || '',
      'rev-parse HEAD': 'synthetic-commit', 'rev-parse origin/main': options.diverged ? 'other-commit' : 'synthetic-commit' })[key]
      ?? assert.fail(`Unexpected mock Git operation: ${key}`);
  };
  const mockFs = {
    readFileSync(file) {
      assert.equal(file, `/synthetic-repo/${target === 'classroom' ? classroomPath : 'core/rules/index.html'}`);
      return Buffer.from(after + (options.sourceDrift ? '\n' : ''));
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
  const mockFetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    if (!url.startsWith('https://firebasehosting.googleapis.com/v1beta1/')) {
      if (url.startsWith('https://upload-firebasehosting.googleapis.com/')) {
        assert.equal(init.method, 'POST'); counters.uploads++;
        return { ok: !options.uploadFailure, status: 500 };
      }
      assert.equal(url, target === 'classroom' ? `https://archivepilates.com${ASSET}`
        : target === 'rules' ? 'https://archive-pilates.web.app/core/rules/' : 'https://archive-pilates-core.web.app/rules/');
      assert.equal(init.cache, 'no-store');
      return bytes(counters.released ? options.badReadback ? 'wrong' : after : options.liveDrift ? 'wrong' : before);
    }
    const name = url.slice('https://firebasehosting.googleapis.com/v1beta1/'.length);
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
        : { files: baselineFiles.slice(1000) } : { files: options.missingAsset ? baselineFiles.slice(1) : baselineFiles });
    }
    if (name === oldVersion) return json({ name: options.badBaseline ? 'sites/other/versions/wrong' : oldVersion, config });
    if (name === `${newVersion}:populateFiles`) {
      proposedManifest = { ...proposedManifest, ...JSON.parse(init.body).files };
      return json({ uploadRequiredHashes: options.unrelatedUpload ? ['f'.repeat(64)] : [sha(gzipSync(Buffer.from(after), { level: 9 }))],
        uploadUrl: options.badUploadHost ? 'https://untrusted.invalid/upload' : 'https://upload-firebasehosting.googleapis.com/upload' });
    }
    if (name.startsWith(`${newVersion}/files?pageSize=1000`)) {
      versionPages++;
      const values = Object.entries(proposedManifest).map(([path, hash]) => ({ path, hash }));
      if (options.manifestDrift) values[0].hash = 'e'.repeat(64);
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
      assert.ok(saved.at(-1).evidence.releaseIntentAt);
      assert.match(JSON.parse(init.body).message, /^METHOD #9 AB11\/AR7 /);
      counters.released++; return json({ name: `sites/${site}/releases/replacement` });
    }
    assert.fail(`Unexpected mock request: ${name}`);
  };
  const from = releaseSource.indexOf('const BASE ='), to = releaseSource.lastIndexOf('\nif (process.argv[1]');
  // The CLI body runs with fake filesystem, auth, subprocesses and network only.
  const main = runInNewContext(`${releaseSource.slice(from, to).replace('export function assertMethod9ReleaseScope', 'function assertMethod9ReleaseScope')}\nmain;`, {
    fs: mockFs, path, execFileSync: mockExec, createHash, gzipSync, Buffer, URL, Date,
    isDeepStrictEqual: (a, b) => isDeepStrictEqual(structuredClone(a), structuredClone(b)), makeManifest, assertManifest,
    fetch: mockFetch, AbortSignal: { timeout: () => undefined }, console: { log() {} },
    process: { argv: ['node', 'synthetic-release', ...(options.args || [`--target=${target}`, '--apply',
      `--expected-version=${options.expected || oldVersion}`])], env: { HOME: '/synthetic-home' }, pid: 42 },
  });
  return { main, calls, commands, saved, locks, counters, baselineFiles, resource, get manifest() { return proposedManifest; } };
}

for (const target of ['classroom', 'rules', 'core-rules']) {
  test(`${target}: mock apply preserves all other files/config and verifies exact live bytes`, async () => {
    const f = fixture({ target }); await f.main();
    assert.equal(f.counters.released, 1); assert.equal(f.counters.finalized, 1);
    assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
    assert.equal(f.saved.at(-1).evidence.verified, true);
    assert.ok(f.saved.every(row => row.file.includes('/artifacts/method9-c-sale-20261028/')));
    assert.equal(f.saved[0].evidence.sourceBaseline, '18b75b9a');
    assert.deepEqual(f.saved[0].evidence.changedPaths, [f.resource]);
    assert.ok(f.commands.findIndex(row => row.join(' ') === 'git fetch origin main') < f.commands.findIndex(row => row[0] === 'gcloud'));
    for (const file of f.baselineFiles.filter(file => file.path !== f.resource)) assert.equal(f.manifest[file.path], file.hash);
  });
  test(`${target}: mock plan has no provider mutations or lock`, async () => {
    const f = fixture({ target, args: [`--target=${target}`] }); await f.main();
    assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(f.locks.length, 0);
    assert.equal(f.saved[0].evidence.mode, 'plan');
  });
}

test('large manifest paginates and preserves unchanged hashes across upload chunks', async () => {
  const f = fixture({ large: true }); await f.main();
  assert.equal(Object.keys(f.manifest).length, 1002);
  assert.equal(f.calls.filter(call => call.url.includes(':populateFiles')).length, 2);
  assert.equal(f.calls.filter(call => call.url.includes('pageToken=next')).length, 2);
});

for (const args of [[], ['--target=unknown'], ['--target=__proto__'], ['--target=constructor'], ['--target=toString'],
  ['--target=classroom', '--force'], ['--target=classroom', '--target=rules'],
  ['--target=classroom', '--apply', '--apply'], ['--target=classroom', '--expected-version=a', '--expected-version=b']]) {
  test(`invalid CLI stops before auth/API: ${args.join(' ')}`, async () => {
    const f = fixture({ args }); await assert.rejects(f.main(), /Unsupported/);
    assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
  });
}

for (const options of [{ branch: 'codex/mini/method9-c-sale-20261027' }, { dirty: '?? unrelated' },
  { diverged: true }, { fetchFailure: true }, { sourceDrift: true }, { args: ['--target=classroom', '--apply'] }]) {
  test(`unsafe source stops before auth/API: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.main());
    assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
  });
}

for (const options of [{ expected: 'stale' }, { badInitialVersion: true }, { badReleaseName: true },
  { liveDrift: true }, { badBaseline: true }, { missingAsset: true }, { apiFailure: true }, { busy: true }]) {
  test(`baseline/lock guard stops before provider writes: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.main());
    assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(f.counters.released, 0);
  });
}

for (const concurrentAt of [2, 3, 4]) test(`concurrent release at read ${concurrentAt} blocks publishing and frees lock`, async () => {
  const f = fixture({ concurrentAt }); await assert.rejects(f.main(), /[Cc]oncurrent|release changed/);
  assert.equal(f.counters.released, 0); assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
});

for (const options of [{ badCreatedVersion: true }, { unrelatedUpload: true }, { badUploadHost: true },
  { uploadFailure: true }, { manifestDrift: true }, { configDrift: true }]) {
  test(`version/upload/manifest/config guard prevents finalize and publish: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.main());
    assert.equal(f.counters.finalized, 0); assert.equal(f.counters.released, 0);
    assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
  });
}

for (const options of [{ badReadback: true }, { postReleaseDrift: true }]) test('ambiguous readback never retries or marks receipt verified', async () => {
  const f = fixture(options); await assert.rejects(f.main(), /do not repeat release/);
  assert.equal(f.counters.released, 1); assert.equal(f.saved.at(-1).evidence.verified, undefined);
  assert.ok(f.saved.at(-1).evidence.releaseIntentAt);
  assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
});
