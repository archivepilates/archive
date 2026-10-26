import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { assertSalesStartPolicyNoteOnly } from '../release-imweb-staff-core-rules.mjs';

const id = 'imweb-sale-opening-safety-policy';
const line = `  <div class="rule-note" id="${id}"><strong>Opening safety</strong><span>Keep closed pending approval.</span></div>\n`;
const before = '<main>\n  <p>Existing first</p>\n  <p>Existing second</p>\n</main>\n';
const after = before.replace('</main>', line + '</main>');
const root = fileURLToPath(new URL('../..', import.meta.url));
const source = readFileSync(new URL('../release-imweb-staff-core-rules.mjs', import.meta.url), 'utf8');
const base = 'f8af6e9a53090ed3fb95a84cdd1eee7b13570858';
const baseHash = '1cdfe428b4595c6ea466858a02bd6dde099b71ccb959e4101da01e9391d7dacb';
const baseline = execFileSync('git', ['show', `${base}:core/rules/index.html`], { cwd: root });

test('accepts exactly one complete new note while preserving existing bytes and order', () => {
  for (const [old, next] of [[before, after], [Buffer.from(before), Buffer.from(after)],
    [Buffer.from(before), after], [before, Buffer.from(after)]]) {
    assert.doesNotThrow(() => assertSalesStartPolicyNoteOnly(old, next));
  }
  assert.doesNotThrow(() => assertSalesStartPolicyNoteOnly(before,
    after.replace('Opening safety', '\uD310\uB9E4 \uC624\uD508 \uC548\uC804').replace('Keep closed', 'Keep &amp; verify closed')));
});

for (const [label, bad] of [
  ['missing note', before],
  ['wrong ID', after.replace(id, 'unrelated-policy')],
  ['wrong ID case', after.replace(id, id.toUpperCase())],
  ['unrelated prefix', '<!-- changed -->\n' + after],
  ['unrelated suffix', after + '\n'],
  ['unrelated edit', after.replace('Existing first', 'Changed')],
  ['byte deletion', after.slice(1)],
  ['existing order change', after.replace('Existing first', 'Swap').replace('Existing second', 'Existing first').replace('Swap', 'Existing second')],
  ['extra unrelated note', after.replace('</main>', line.replace(id, 'other-policy') + '</main>')],
  ['changed line endings', after.replaceAll('\n', '\r\n')],
  ['missing terminal newline', after.replace(line, line.trimEnd())],
]) test(`rejects ${label}`, () => assert.throws(() => assertSalesStartPolicyNoteOnly(before, bad)));

for (const [label, variant] of [
  ['exact', line],
  ['single quotes', line.replace(`id="${id}"`, `id='${id}'`)],
  ['unquoted', line.replace(`id="${id}"`, `id=${id}`)],
  ['uppercase attribute', line.replace(`id="${id}"`, `ID = "${id}"`)],
  ['uppercase value', line.replace(id, id.toUpperCase())],
  ['mixed-case attribute', line.replace(`id="${id}"`, `iD\t=\t'${id}'`)],
  ['multiline attribute', line.replace(`id="${id}"`, `id\n=\n"${id}"`)],
  ['different element', `<p id="${id}">Duplicate</p>\n`],
  ['entity-encoded ID', `<p id="imweb-sale-opening-safety-polic&#121;">Duplicate</p>\n`],
  ['same line', line.trimEnd()],
]) test(`rejects added ${label} duplicate ID variants`, () => {
  assert.throws(() => assertSalesStartPolicyNoteOnly(before, after.replace(line, line + variant)));
});

for (const [label, variant] of [
  ['canonical', line],
  ['single-quoted', line.replace(`id="${id}"`, `id='${id}'`)],
  ['unquoted', line.replace(`id="${id}"`, `id=${id}`)],
  ['case-insensitive', line.replace(`id="${id}"`, `ID = "${id.toUpperCase()}"`)],
]) test(`rejects an already present ${label} policy ID in the baseline`, () => {
  assert.throws(() => assertSalesStartPolicyNoteOnly(before + variant, after + variant));
  assert.throws(() => assertSalesStartPolicyNoteOnly(before + variant, after));
});

for (const [label, badLine] of [
  ['script', line.replace('Keep closed', '<script>bad()</script>Keep closed')],
  ['nested HTML', line.replace('Opening safety', '<b>Opening safety</b>')],
  ['nested unrelated note', line.replace('</span>', '</span><div class="rule-note">Other</div>')],
  ['comment', line.replace('Keep closed', '<!-- other -->Keep closed')],
  ['extra div attribute', line.replace('class="rule-note"', 'class="rule-note" data-extra="yes"')],
  ['extra id attribute', line.replace(`id="${id}"`, `id="${id}" id="other"`)],
  ['strong attribute', line.replace('<strong>', '<strong onclick="bad()">')],
  ['span attribute', line.replace('<span>', '<span class="other">')],
  ['missing strong', line.replace('<strong>Opening safety</strong>', '')],
  ['missing span', line.replace('<span>Keep closed pending approval.</span>', '')],
  ['empty heading', line.replace('Opening safety', '')],
  ['empty body', line.replace('Keep closed pending approval.', '')],
  ['wrong outer element', line.replace('<div ', '<section ').replace('</div>', '</section>')],
  ['reordered children', line.replace('<strong>Opening safety</strong><span>Keep closed pending approval.</span>', '<span>Body</span><strong>Heading</strong>')],
  ['multiline heading', line.replace('Opening safety', 'Opening\nsafety')],
  ['multiline body', line.replace('Keep closed', 'Keep\rclosed')],
  ['null byte', line.replace('Keep closed', 'Keep\0closed')],
  ['Unicode line separator', line.replace('Keep closed', 'Keep\u2028closed')],
  ['extra same-line sibling', line.replace('</div>\n', '</div><p>Extra</p>\n')],
  ['trailing spaces', line.replace('</div>\n', '</div> \n')],
  ['truncated element', line.replace('</div>', '')],
]) test(`rejects ${label} in the added note`, () => {
  assert.throws(() => assertSalesStartPolicyNoteOnly(before, after.replace(line, badLine)));
});

test('preserves unrelated existing notes without permitting their relocation or editing', () => {
  const other = line.replace(id, 'existing-policy');
  assert.doesNotThrow(() => assertSalesStartPolicyNoteOnly(before + other, after + other));
  assert.throws(() => assertSalesStartPolicyNoteOnly(before + other, other + after));
  assert.throws(() => assertSalesStartPolicyNoteOnly(before + other, after + other.replace('Opening safety', 'Changed')));
});

test('rejects invalid UTF-8 bytes, unpaired surrogates and unsupported source types', () => {
  for (const bad of [Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xe2, 0x82]),
    Buffer.concat([Buffer.from(before), Buffer.from([0xfe])]), '\ud800', null, undefined, {}]) {
    assert.throws(() => assertSalesStartPolicyNoteOnly(bad, after), /UTF-8/);
    assert.throws(() => assertSalesStartPolicyNoteOnly(before, bad), /UTF-8/);
  }
  assert.throws(() => assertSalesStartPolicyNoteOnly(Buffer.from([0xff]), Buffer.from([0xfe])), /UTF-8/);
});

// Evaluate selection only: no main(), auth, network, or Hosting operations.
function selection(args) {
  const constants = source.match(/^const [A-Z_]+ = '[^']+';/gm).join('\n');
  const start = source.indexOf('  const args = process.argv.slice(2);');
  const end = source.indexOf('  const expected =', start);
  assert.ok(start >= 0 && end > start);
  return structuredClone(runInNewContext(`${constants}\n${source.slice(start, end)}\n({ SITE, ASSET, LIVE, baselineCommit, baselineHash, apply });`, {
    process: { argv: ['node', 'synthetic-release', ...args] },
  }));
}

for (const [site, asset] of [['archive-pilates', '/core/rules/index.html'], ['archive-pilates-core', '/rules/index.html']]) {
  for (const apply of [false, true]) test(`sales-start pins the same baseline and only the rules asset on ${site}, apply=${apply}`, () => {
    assert.deepEqual(selection(['--sales-start-policy', `--site=${site}`, ...(apply ? ['--apply', '--expected-version=reviewed'] : [])]), {
      SITE: site, ASSET: asset, LIVE: `https://${site}.web.app${asset.slice(0, -10)}`,
      baselineCommit: base, baselineHash: baseHash, apply,
    });
  });
}

const historical = [
  [null, '652c16ea1bc120306742bbe1e0b867dce80291f0', '4f1e879c2a5356f113d70b4126b9245afb8337e9fd8b595770c571fae503ef9d'],
  ['--student-share-policy', '074d9a6600bf00f5268bafc32d1d8958769edbf5', '692397d07b4a443b6138a7a06773e4358e3eaf80bda24918a185fa9d935b5a93'],
  ['--webhook-onboarding', 'e38a36e7b4f334ceac8757c4e685b0af46fec16e', '44a9c5c076e562279933c02c3f24562f0a504d20c7f946a71c6d296537849892'],
  ['--webhook-oauth', 'dac9e03c96416b066cc9717f0759698d2fed12d1', '00af19ccf93380b0f6aa025b6c9356289d41a9a8db1c05a0bcefedfe05e66534'],
  ['--staff-lock-policy', '9aaf7a8c38145f60e5b1c0ebab8d562ab832e929', '42b17144216b720cff439930466b09a832979072a2e1ebe72d16e1e09f338a74'],
  ['--registered-share-policy', '6e50653f20c243953c3bc03ec4bba00f02ab4ff4', '4d3d3063d82b4f2c2056dd29586bb3df371c200d023703107c28953f46e1faae'],
];
for (const [flag, commit, hash] of historical) test(`historical ${flag || 'default'} selection stays unchanged and exclusive`, () => {
  const chosen = selection(flag ? [flag] : []);
  assert.equal(chosen.baselineCommit, commit);
  assert.equal(chosen.baselineHash, hash);
  if (flag) {
    assert.equal(selection([flag, '--site=archive-pilates-core']).SITE, 'archive-pilates-core');
    for (const args of [[flag, '--sales-start-policy'], ['--sales-start-policy', flag],
      [flag, '--sales-start-policy', '--apply', '--site=archive-pilates-core']]) {
      assert.throws(() => selection(args), /Choose one policy release/);
    }
  } else {
    assert.equal(chosen.SITE, 'archive-pilates');
    assert.throws(() => selection(['--site=archive-pilates-core']), /main-site only/);
    assert.equal(selection(['--sales-start-policy']).SITE, 'archive-pilates');
  }
});

test('rejects repeated sales-start flag and combinations of all policy flags', () => {
  assert.throws(() => selection(['--sales-start-policy', '--sales-start-policy']), /Choose one policy release/);
  const flags = ['--sales-start-policy', ...historical.map(([flag]) => flag).filter(Boolean)];
  for (let mask = 1; mask < 2 ** flags.length; mask++) {
    const args = flags.filter((_, index) => mask & (1 << index));
    if (args.length > 1) assert.throws(() => selection(args), /Choose one policy release/);
  }
});

for (const arg of ['--sales-start', '--sales-start-policy=true', '--sale-opening-safety-policy', '--force',
  '--config=other.json', '--site=archive-pilates-home', '--baseline=HEAD', '--skip-live-check']) {
  test(`rejects unsupported ${arg} before any I/O`, () => {
    assert.throws(() => selection(['--sales-start-policy', arg]), /Unsupported release argument/);
  });
}

test('immutable baseline matches the pinned hash and lacks the new note', () => {
  assert.equal(createHash('sha256').update(baseline).digest('hex'), baseHash);
  assert.ok(!baseline.toString('utf8').includes(id));
  assert.throws(() => assertSalesStartPolicyNoteOnly(baseline, baseline));
  const proposed = baseline.toString('utf8').replace('      </main>', line + '      </main>');
  assert.doesNotThrow(() => assertSalesStartPolicyNoteOnly(baseline, proposed));
  assert.throws(() => assertSalesStartPolicyNoteOnly(baseline, proposed.replace('<title>', '<title>Changed ')));
});

const current = readFileSync(new URL('../../core/rules/index.html', import.meta.url));
test('main-owned note is the only change against the immutable baseline when available', {
  skip: current.includes(Buffer.from(id)) ? false : 'Main-owned policy note has not been added yet',
}, () => assert.doesNotThrow(() => assertSalesStartPolicyNoteOnly(baseline, current)));

test('new guard dispatches before auth and all existing release protections remain', () => {
  const dispatch = 'else if (salesStart) assertSalesStartPolicyNoteOnly(baselineSource, source);';
  assert.ok(source.includes(dispatch));
  assert.ok(source.indexOf(dispatch) < source.indexOf("execFileSync('gcloud'"));
  for (const guard of [
    "if (sha(baselineSource) !== baselineHash)",
    "git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])",
    "'--require-origin-main', '--require-main-branch'",
    '`--account=${ACCOUNT}`',
    'if (apply && release.version.name !== expected)',
    'sha(liveBytes) !== (staffLock ? STAFF_LOCK_LIVE_HASH : baselineHash)',
    'const manifest = makeManifest(files, hash, ASSET)',
    'changedPaths: [ASSET]',
    "fs.openSync(lock, 'wx', 0o600)",
    "const created = await request(`sites/${SITE}/versions`, 'POST', { config: baseline.config })",
    'assertManifest(await filesFor(created.name), manifest)',
    'isDeepStrictEqual((await request(created.name)).config, baseline.config)',
    'required.some(value => value !== hash)',
    "upload.origin !== 'https://upload-firebasehosting.googleapis.com'",
    'if ((await latest()).version.name !== created.name)',
    'sha(Buffer.from(await verified.arrayBuffer())) !== sha(source)',
    'finally { fs.closeSync(fd); fs.unlinkSync(lock); }',
    'salesStart ? `sales-start-hosting-${SITE}.json`',
    "salesStart ? 'Sale-opening safety'",
  ]) assert.ok(source.includes(guard), `Missing release gate: ${guard}`);
  assert.equal(source.match(/\(await latest\(\)\)\.name !== release\.name/g).length, 3);
});
