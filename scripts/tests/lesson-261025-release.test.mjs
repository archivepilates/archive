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
import { assertLessonReleaseScope } from '../release-lesson-261025.mjs';
import { makeManifest, assertManifest } from '../release-e261017-classroom.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const releaseSource = readFileSync(new URL('../release-lesson-261025.mjs', import.meta.url), 'utf8');
const baseline = file => execFileSync('git', ['show', `3e6bd160:${file}`], { cwd: root, encoding: 'utf8' });
const classroom = baseline('official-home/assets/imweb-my-classroom-20260723a.js');
const rules = baseline('core/rules/index.html');
const ASSET = '/assets/imweb-my-classroom-20260723a.js';
const anchor = classroom.match(/^    \{"code":"B261024"[^\n]+\}\n/m)?.[0];
assert.ok(anchor, 'Pinned baseline must contain the existing B261024 anchor');
const tuples = ['C', 'D'].map(team => ({ code: `${team}261025`,
  path: `/private-lesson-external-feedback2-${team.toLowerCase()}-261025`,
  title: `10/25 외부 피드백2 ${team}팀 · 수강생 공유`,
  group: `PRIVATE LESSON EXTERNAL FEEDBACK2 ${team} 261025 40D`, private: true }));
const rows = tuples.map((row, index) => `    ${JSON.stringify(row)}${index ? '' : ','}\n`).join('');
const proposedClassroom = classroom.replace(anchor, `${anchor.trimEnd()},\n${rows}`);
const note = '          <div class="rule-note" id="lesson-share-261025"><strong>10/25 C/D</strong><span>Synthetic operating note.</span></div>\n';
const sha = value => createHash('sha256').update(value).digest('hex');

test('classroom accepts exactly canonical C/D tuples while preserving every E/A/B byte', () => {
  assert.doesNotThrow(() => assertLessonReleaseScope(classroom, proposedClassroom, 'classroom'));
  assert.equal(proposedClassroom.replace(`${anchor.trimEnd()},\n${rows}`, anchor), classroom);
  assert.deepEqual(Object.keys(tuples[0]), ['code', 'path', 'title', 'group', 'private']);
  assert.ok(!/youtube|videoId|embed|AbCdEfGhI_1/i.test(rows));
});

for (const [name, mutate] of [
  ['missing D', value => value.replace(`    ${JSON.stringify(tuples[1])}\n`, '')],
  ['duplicate code', value => value.replace('"D261025"', '"C261025"')],
  ['wrong path', value => value.replace(tuples[0].path, tuples[1].path)],
  ['wrong title', value => value.replace(tuples[0].title, tuples[1].title)],
  ['wrong group', value => value.replace(tuples[0].group, tuples[1].group)],
  ['extra field', value => value.replace('"C261025","path"', '"C261025","extra":true,"path"')],
  ['public tuple', value => value.replace(JSON.stringify(tuples[0]), JSON.stringify({ ...tuples[0], private: false }))],
  ['reversed order', value => value.replace(rows, `    ${JSON.stringify(tuples[1])},\n    ${JSON.stringify(tuples[0])}\n`)],
  ['new video ID field', value => value.replace('"C261025","path"', '"C261025","videoId":"AbCdEfGhI_1","path"')],
  ['embed path', value => value.replace(tuples[0].path, 'https://youtube.com/embed/AbCdEfGhI_1')],
  ['extra suffix', value => `${value}\n`],
  ['old E mutation', value => value.replace('"E261017"', '"E261018"')],
  ['old A mutation', value => value.replace('"A261024"', '"A261025"')],
  ['old B mutation', value => value.replace('"B261024"', '"B261025"')],
]) test(`classroom refuses ${name}`, () => {
  const after = mutate(proposedClassroom);
  assert.notEqual(after, proposedClassroom);
  assert.throws(() => assertLessonReleaseScope(classroom, after, 'classroom'));
});

test('classroom refuses no-op, misplaced rows and duplicated baseline anchors', () => {
  for (const [before, after] of [[classroom, classroom], [classroom, rows + classroom],
    [classroom + anchor, proposedClassroom + anchor]]) {
    assert.throws(() => assertLessonReleaseScope(before, after, 'classroom'));
  }
});

for (const target of ['rules', 'core-rules']) {
  test(`${target} permits one new note and no baseline edits`, () => {
    assert.doesNotThrow(() => assertLessonReleaseScope(rules, rules + note, target));
    assert.equal((rules + note).replace(note, ''), rules);
  });

  for (const [name, after] of [
    ['no-op', rules], ['duplicate notes on separate lines', rules + note + note],
    ['unrelated suffix', rules + note + '\n'], ['unrelated prefix', `<!-- unrelated -->\n${rules}${note}`],
    ['baseline title edit', rules.replace('<title>', '<title>Unrelated ') + note],
    ['old A/B note edit', rules.replace('id="lesson-share-261024"', 'id="changed-old-note"') + note],
    ['replacement instead of insertion', rules.slice(1) + note],
    ['unrelated sibling on the note line', rules + note.trimEnd() + '<div id="unrelated">Other content</div>\n'],
    ['duplicate notes on the same line', rules + note.trimEnd() + note.trimStart()],
  ]) test(`${target} refuses ${name}`, () => {
    assert.throws(() => assertLessonReleaseScope(rules, after, target));
  });
}

test('scope refuses every unrecognized target including inherited object names', () => {
  for (const target of [undefined, '', 'unknown', 'ui-rules', '__proto__', 'constructor', 'toString']) {
    assert.throws(() => assertLessonReleaseScope(rules, rules + note, target), /Unexpected release target/);
  }
});

test('target table pins the reviewed baseline, three sites, resources and source paths', () => {
  assert.match(releaseSource, /const BASE = '3e6bd160';/);
  const start = releaseSource.indexOf('const targets = {');
  const end = releaseSource.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start);
  const table = structuredClone(runInNewContext(`${releaseSource.slice(start, end + 3)}\ntargets;`, { ASSET }));
  assert.deepEqual(table, {
    classroom: { site: 'archive-pilates-home', resource: ASSET, source: `official-home${ASSET}`, url: `https://archivepilates.com${ASSET}` },
    rules: { site: 'archive-pilates', resource: '/core/rules/index.html', source: 'core/rules/index.html', url: 'https://archive-pilates.web.app/core/rules/' },
    'core-rules': { site: 'archive-pilates-core', resource: '/rules/index.html', source: 'core/rules/index.html', url: 'https://archive-pilates-core.web.app/rules/' },
  });
  assert.match(releaseSource, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  assert.match(releaseSource, /import \{ makeManifest, assertManifest \} from '\.\/release-e261017-classroom\.mjs'/);
});

test('manifest helper changes exactly one hash and rejects missing, invalid or duplicate paths', () => {
  const files = [{ path: ASSET, hash: 'a'.repeat(64) }, { path: '/preserved.html', hash: 'b'.repeat(64) }];
  const before = structuredClone(files), manifest = makeManifest(files, 'c'.repeat(64), ASSET);
  assert.deepEqual(files, before);
  assert.deepEqual(manifest, { [ASSET]: 'c'.repeat(64), '/preserved.html': 'b'.repeat(64) });
  assert.doesNotThrow(() => assertManifest(Object.entries(manifest).map(([path, hash]) => ({ path, hash })), manifest));
  for (const actual of [[], files, [...files, files[0]], [{ path: ASSET, hash: 'c'.repeat(64) }]]) {
    assert.throws(() => assertManifest(actual, manifest));
  }
  for (const input of [[], [...files, files[0]], [{ path: 'relative', hash: 'a'.repeat(64) }],
    [{ path: ASSET, hash: 'not-a-hash' }]]) assert.throws(() => makeManifest(input, 'c'.repeat(64), ASSET));
  assert.throws(() => makeManifest(files, 'not-a-hash', ASSET));
});

function fixture(options = {}) {
  const target = options.target || 'classroom';
  const site = target === 'rules' ? 'archive-pilates' : target === 'core-rules' ? 'archive-pilates-core' : 'archive-pilates-home';
  const resource = target === 'rules' ? '/core/rules/index.html' : target === 'core-rules' ? '/rules/index.html' : ASSET;
  const before = target === 'classroom' ? classroom : rules;
  const after = target === 'classroom' ? proposedClassroom : rules + note;
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
    if (args[0] === 'show') return Buffer.from(before);
    const key = args.join(' ');
    return ({ 'rev-parse --show-toplevel': '/synthetic-repo', 'fetch origin main': '',
      'branch --show-current': options.branch || 'main', 'status --porcelain': options.dirty || '',
      'rev-parse HEAD': 'synthetic-commit', 'rev-parse origin/main': options.diverged ? 'other-commit' : 'synthetic-commit' })[key]
      ?? assert.fail(`Unexpected mock Git operation: ${key}`);
  };
  const mockFs = {
    readFileSync(file) {
      assert.ok(file === `/synthetic-repo/official-home${ASSET}` || file === '/synthetic-repo/core/rules/index.html');
      return Buffer.from(after);
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
      assert.ok(url.startsWith('https://archivepilates.com/') || url.startsWith('https://archive-pilates.web.app/')
        || url.startsWith('https://archive-pilates-core.web.app/'));
      assert.equal(init.cache, 'no-store');
      return bytes(counters.released ? options.badReadback ? 'wrong' : after : options.liveDrift ? 'wrong' : before);
    }
    const name = url.slice('https://firebasehosting.googleapis.com/v1beta1/'.length);
    if (name.includes('/releases?pageSize=')) {
      latestReads++;
      return json({ releases: [{ name: options.concurrentAt === latestReads ? `${releaseName}-concurrent` : releaseName,
        version: { name: options.badInitialVersion && latestReads === 1 ? 'sites/other/versions/wrong'
          : counters.released ? options.postReleaseDrift ? `${newVersion}-other` : newVersion : oldVersion } }] });
    }
    if (name === `sites/${site}/versions` && init.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), { config });
      return json({ name: options.badCreatedVersion ? 'sites/other/versions/wrong' : newVersion });
    }
    if (name === `${oldVersion}/files?pageSize=1000` || name === `${oldVersion}/files?pageSize=1000&pageToken=next`) {
      baselinePages++;
      return json(options.large ? baselinePages === 1 ? { files: baselineFiles.slice(0, 1000), nextPageToken: 'next' }
        : { files: baselineFiles.slice(1000) } : { files: baselineFiles });
    }
    if (name === oldVersion) return json({ name: oldVersion, config });
    if (name === `${newVersion}:populateFiles`) {
      const { files } = JSON.parse(init.body);
      proposedManifest = { ...proposedManifest, ...files };
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
      assert.ok(saved.at(-1).evidence.releaseIntentAt, 'Persist intent before publishing');
      counters.released++; return json({ name: `sites/${site}/releases/replacement` });
    }
    assert.fail(`Unexpected mock request: ${name}`);
  };
  const from = releaseSource.indexOf('const BASE =');
  const to = releaseSource.lastIndexOf('\nif (process.argv[1]');
  assert.ok(from >= 0 && to > from);
  // No real process, filesystem, credentials, subprocess or fetch reaches this body.
  const main = runInNewContext(`${releaseSource.slice(from, to).replace('export function assertLessonReleaseScope', 'function assertLessonReleaseScope')}\nmain;`, {
    fs: mockFs, path, execFileSync: mockExec, createHash, gzipSync, Buffer, URL, Date,
    isDeepStrictEqual: (a, b) => isDeepStrictEqual(structuredClone(a), structuredClone(b)), makeManifest, assertManifest,
    fetch: mockFetch, AbortSignal: { timeout: () => undefined }, console: { log() {} },
    process: { argv: ['node', 'synthetic-release', ...(options.args || [`--target=${target}`, '--apply',
      `--expected-version=${options.expected || oldVersion}`])], env: { HOME: '/synthetic-home' }, pid: 42 },
  });
  return { main, calls, commands, saved, locks, counters, baselineFiles, resource,
    get manifest() { return proposedManifest; } };
}

for (const target of ['classroom', 'rules', 'core-rules']) test(`${target} mock release preserves config, every other hash, intent and independent readback`, async () => {
  const f = fixture({ target }); await f.main();
  assert.equal(f.counters.released, 1); assert.equal(f.counters.finalized, 1);
  assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
  assert.equal(f.saved.at(-1).evidence.verified, true);
  assert.ok(f.saved.every(row => row.file.includes('/artifacts/lesson-videos-261025/')));
  assert.deepEqual(f.saved[0].evidence.changedPaths, [f.resource]);
  for (const file of f.baselineFiles.filter(file => file.path !== f.resource)) assert.equal(f.manifest[file.path], file.hash);
});

test('large manifest paginates both versions and preserves all unchanged files across chunks', async () => {
  const f = fixture({ large: true }); await f.main();
  assert.equal(Object.keys(f.manifest).length, 1002);
  assert.equal(f.calls.filter(call => call.url.includes(':populateFiles')).length, 2);
  assert.equal(f.calls.filter(call => call.url.includes('pageToken=next')).length, 2);
});

test('plan makes no provider mutations and acquires no deployment lock', async () => {
  const f = fixture({ args: ['--target=classroom'] }); await f.main();
  assert.equal(f.counters.released, 0); assert.equal(f.locks.length, 0);
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.equal(f.saved[0].evidence.mode, 'plan');
});

for (const args of [['--target=unknown'], ['--target=__proto__'], ['--target=constructor'], ['--target=classroom', '--force']]) {
  test(`CLI refuses invalid target/arguments before auth or API: ${args.join(' ')}`, async () => {
    const f = fixture({ args }); await assert.rejects(f.main());
    assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
  });
}

for (const options of [{ branch: 'codex/mini/lesson-videos-261025' }, { dirty: ' M unrelated' },
  { diverged: true }, { args: ['--target=classroom', '--apply'] }]) test('apply refuses missing reviewed version, non-main, dirty or divergent source before auth', async () => {
  const f = fixture(options); await assert.rejects(f.main(), /clean synchronized main/);
  assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
});

for (const options of [{ expected: 'stale-reviewed-version' }, { badInitialVersion: true }, { liveDrift: true }]) {
  test('live version/site or baseline hash drift stops before any mutation', async () => {
    const f = fixture(options); await assert.rejects(f.main());
    assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(f.counters.released, 0);
  });
}

for (const concurrentAt of [2, 3, 4]) test(`concurrent release at identity recheck ${concurrentAt} blocks publication and releases lock`, async () => {
  const f = fixture({ concurrentAt }); await assert.rejects(f.main(), /[Cc]oncurrent|release changed/);
  assert.equal(f.counters.released, 0); assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
  assert.equal(f.counters.finalized, concurrentAt === 4 ? 1 : 0);
});

for (const options of [{ badCreatedVersion: true }, { unrelatedUpload: true }, { badUploadHost: true },
  { uploadFailure: true }, { manifestDrift: true }, { configDrift: true }]) {
  test('version, upload, manifest or config mismatch cannot finalize or publish', async () => {
    const f = fixture(options); await assert.rejects(f.main());
    assert.equal(f.counters.finalized, 0); assert.equal(f.counters.released, 0);
    assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
  });
}

for (const options of [{ badReadback: true }, { postReleaseDrift: true }]) test('ambiguous post-release state fails without replay or verified receipt', async () => {
  const f = fixture(options); await assert.rejects(f.main(), /do not repeat release/);
  assert.equal(f.counters.released, 1); assert.equal(f.saved.at(-1).evidence.verified, undefined);
  assert.equal(f.counters.closes, 1); assert.equal(f.counters.unlinks, 1);
});

test('held per-site lock prevents every mutation', async () => {
  const f = fixture({ busy: true }); await assert.rejects(f.main(), /lock busy/);
  assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(f.counters.released, 0);
});
