import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { homeShopNavTarget, assertHomeShopNavScope, makeHomeShopNavManifest,
  assertHomeShopNavManifest, runHomeShopNavRelease } from '../release-home-shop-nav.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const selections = Object.fromEntries(['home', 'core-rules'].map(target => [target, homeShopNavTarget(target)]));
const commits = Object.fromEntries(['bd04987f', 'f09b901d'].map(base => [base, git(['rev-parse', `${base}^{commit}`])]));
const baselines = new Map(Object.values(selections).flatMap(selected => selected.files.map(file =>
  [file.source, execFileSync('git', ['show', `${selected.base}:${file.source}`], { cwd: root })])));
const note = '          <div class="rule-note" id="home-community-nav-20261028"><strong>Home shop navigation</strong><span>Move only the product link out of Academy; preserve all other content.</span></div>\n';
const notePattern = /^          <div class="rule-note" id="home-community-nav-20261028">[^\n]+\n/gm;
const shop = '<a class="nav-swap" data-nav="products" href="/shop" aria-label="\uD310\uB9E4\uC0C1\uD488"><span class="nav-ko">\uD310\uB9E4\uC0C1\uD488</span><span class="nav-en" aria-hidden="true">SHOP</span></a>';
const move = value => value.toString()
  .replace(/^[ \t]*<a data-nav="products" href="\/shop">\uD310\uB9E4\uC0C1\uD488<\/a>\n/m, '')
  .replace(/^([ \t]*)(<a class="nav-swap" data-nav="career")/m, (_, indent, opening) => indent + shop + '\n' + indent + opening);
const proposed = (file, target) => Buffer.from(target === 'home' ? move(baselines.get(file.source))
  : baselines.get(file.source).toString().replace(notePattern, () => note));
const classroom = '/assets/imweb-my-classroom-20260723a.js';
function manifestFixture(target = 'home') {
  const selected = selections[target];
  const files = selected.files.map(file => ({ path: file.resource, hash: sha(gzipSync(baselines.get(file.source), { level: 9 })) }));
  files.push({ path: classroom, hash: sha('current-live-classroom-not-historical-source') });
  for (let i = files.length; i < (target === 'home' ? 80 : 5); i++) files.push({ path: `/preserved-${i}.css`, hash: sha(`live-${i}`) });
  const replacements = Object.fromEntries(selected.files.map(file => [file.resource, sha(gzipSync(proposed(file, target), { level: 9 }))]));
  return { files, replacements };
}

test('pins all eight home resources to bd04987f and current CORE to f09b901d', () => {
  assert.deepEqual(selections.home.files.map(file => file.resource), ['/index.html', '/instructor-lessons/index.html', '/teams/index.html',
    '/teams/minjin/index.html', '/teams/eunyoung/index.html', '/teams/chorim/index.html', '/teams/kihyo/index.html', '/teams/yuri/index.html']);
  for (const selected of Object.values(selections)) {
    assert.ok(git(['branch', '--all', '--contains', commits[selected.base]]));
    for (const file of selected.files) assert.equal(sha(baselines.get(file.source)), file.baselineSha256);
  }
  assert.equal(selections.home.base, 'bd04987f');
  assert.equal(selections['core-rules'].base, 'f09b901d');
  assert.equal(selections.home.site, 'archive-pilates-home');
  assert.equal(selections['core-rules'].files[0].resource, '/rules/index.html');
});

test('accepts the exact Academy-to-top-level product move on all eight real Git HTML baselines', () => {
  for (const file of selections.home.files) assert.doesNotThrow(() =>
    assertHomeShopNavScope(baselines.get(file.source), proposed(file, 'home'), 'home', file.resource));
});

test('rejects no-op, duplicate/missing links, wrong order/indent/content and unrelated byte drift', () => {
  for (const file of selections.home.files) {
    const before = baselines.get(file.source).toString(), after = proposed(file, 'home').toString();
    const career = after.match(/^([ \t]*)<a class="nav-swap" data-nav="career"[^>]*>(?:(?!<\/a>)[\s\S])*?<\/a>\n/m)[0];
    const product = after.match(/^[ \t]*<a class="nav-swap" data-nav="products"[^\n]+\n/m)[0];
    const submenuLine = before.match(/^[ \t]*<a data-nav="products"[^\n]+\n/m)[0];
    for (const candidate of [before, after + '\n', after.replace(product, ''), after.replace(product, product + product),
      after.replace(product, product + submenuLine), after.replace(product, ' ' + product),
      after.replace(product + career, career + product), after.replace('>SHOP</span>', '>PRODUCTS</span>'),
      after.replace('<html', '<html data-unrelated="changed"')]) {
      assert.notEqual(candidate, after);
      assert.throws(() => assertHomeShopNavScope(before, candidate, 'home', file.resource));
    }
    assert.throws(() => assertHomeShopNavScope(before.replace(submenuLine, ''), after, 'home', file.resource));
  }
});

test('CORE permits only replacement of the existing note, never a new note or neighbor edit', () => {
  for (const target of ['core-rules']) {
    const file = selections[target].files[0], before = baselines.get(file.source).toString(), after = proposed(file, target).toString();
    assert.doesNotThrow(() => assertHomeShopNavScope(before, after, target, file.resource));
    for (const candidate of [before, after + '\n', after.replace(note, note + note), before + note,
      after.replace('Home shop navigation', '<b>Shop</b>'), after.replace('Home shop navigation', 'Home\nshop'),
      after.replace('id="imweb-local-quota-native-continuation"', 'id="changed"'),
      after.replace('id="home-community-nav-20261028"', 'id="home-shop-new-note"')]) {
      assert.throws(() => assertHomeShopNavScope(before, candidate, target, file.resource));
    }
  }
});

test('rejects unknown/inherited targets and cross-site resources', () => {
  for (const target of [undefined, 'rules', 'classroom', '__proto__', 'constructor']) assert.throws(() => homeShopNavTarget(target));
  assert.throws(() => assertHomeShopNavScope('a', 'b', 'home', classroom));
  assert.throws(() => assertHomeShopNavScope('a', 'b', 'core-rules', '/core/rules/index.html'));
});

test('home manifest changes only eight HTMLs, retaining all 72 live hashes including current classroom', () => {
  const { files, replacements } = manifestFixture(), original = structuredClone(files);
  const manifest = makeHomeShopNavManifest(files, replacements, 'home');
  assert.equal(Object.keys(manifest).length, 80); assert.deepEqual(files, original);
  assert.equal(manifest[classroom], files.find(file => file.path === classroom).hash);
  assert.equal(files.filter(file => manifest[file.path] === file.hash).length, 72);
  assert.deepEqual(files.filter(file => manifest[file.path] !== file.hash).map(file => file.path), Object.keys(replacements));
  assertHomeShopNavManifest(Object.entries(manifest).map(([path, hash]) => ({ path, hash })), manifest);
});

test('manifest rejects wrong counts, missing assets, duplicates, invalid hashes and replacement expansion', () => {
  const { files, replacements } = manifestFixture();
  for (const invalid of [files.slice(1), [...files, { path: '/extra', hash: sha('extra') }],
    files.map(file => file.path === classroom ? { ...file, path: '/missing-classroom' } : file),
    files.map((file, i) => i === 79 ? files[0] : file),
    files.map((file, i) => i === 1 ? { ...file, path: '/missing-target.html' } : file)]) {
    assert.throws(() => makeHomeShopNavManifest(invalid, replacements, 'home'));
  }
  for (const invalid of [{ ...replacements, [classroom]: sha('wrong') }, { ...replacements, '/index.html': 'invalid' },
    { ...replacements, '/index.html': files[0].hash }, Object.fromEntries(Object.entries(replacements).slice(1))]) {
    assert.throws(() => makeHomeShopNavManifest(files, invalid, 'home'));
  }
});

test('readback manifest rejects unrelated drift, dropped files and extra/duplicate paths', () => {
  const { files, replacements } = manifestFixture();
  const manifest = makeHomeShopNavManifest(files, replacements, 'home');
  const rows = Object.entries(manifest).map(([path, hash]) => ({ path, hash }));
  for (const invalid of [rows.slice(1), [...rows, rows[0]], rows.map(file => file.path === classroom ? { ...file, hash: sha('rollback') } : file)]) {
    assert.throws(() => assertHomeShopNavManifest(invalid, manifest));
  }
});

function releaseFixture(options = {}) {
  const target = options.target || 'home', selected = selections[target], { files, replacements } = manifestFixture(target);
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
    writeFileSync(_filename, value) { receipt = JSON.parse(value); saves.push(structuredClone(receipt)); },
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
    run: (apply = true) => runHomeShopNavRelease([`--target=${target}`, ...(apply ? ['--apply', `--expected-version=${oldVersion}`] : [])],
      { io, execute, fetcher, home: '/synthetic-home', clock: () => '2026-10-28T05:00:00Z' }) };
}

test('synthetic plan is GET-only, reads every baseline and takes no deployment lock', async () => {
  const f = releaseFixture(); const result = await f.run(false);
  assert.equal(result.mode, 'plan'); assert.equal(result.fileCount, 80); assert.equal(result.changedPaths.length, 8);
  assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(f.counters.locks, 0);
  assert.equal(f.calls.filter(call => call.url.startsWith('https://archivepilates.com')).length, 8);
});

test('synthetic home apply changes eight files only, preserves config, records intent and verifies all eight readbacks', async () => {
  const f = releaseFixture(); const result = await f.run();
  assert.equal(result.verified, true); assert.equal(result.sourceBaseline, 'bd04987f');
  assert.equal(f.counters.uploads, 8); assert.equal(f.counters.releases, 1);
  assert.equal(f.counters.closed, 1); assert.equal(f.counters.unlinked, 1);
  assert.equal(f.files.filter(file => f.manifest[file.path] === file.hash).length, 72);
  assert.equal(f.calls.filter(call => call.url.startsWith('https://archivepilates.com')).length, 16);
  assert.ok(f.commands.findIndex(call => call.join(' ') === 'git fetch origin main') < f.commands.findIndex(call => call[0] === 'gcloud'));
});

test('synthetic CORE releases retain single-note scope and site-specific resources', async () => {
  for (const target of ['core-rules']) {
    const f = releaseFixture({ target }); const result = await f.run();
    assert.deepEqual(result.changedPaths, [selections[target].files[0].resource]);
    assert.equal(result.sourceBaseline, 'f09b901d'); assert.equal(result.verified, true);
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
