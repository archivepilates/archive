import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { assertRegistrationPolicyNotesOnly } from '../release-imweb-staff-core-rules.mjs';

const ids = ['imweb-student-share-first-grant-policy', 'lesson-share-261025', 'lesson-share-261024'];
const line = (id, content = 'Previous') => `  <div class="rule-note" id="${id}"><strong>${id}</strong><span>${content}</span></div>\n`;
const before = '<main>\n<p>Prefix</p>\n' + ids.map((id, i) => line(id) + `<p>Untouched ${i}</p>\n`).join('') + '</main>\n';
const after = before.replaceAll('Previous', 'Registered source verified; no provider action');
const source = readFileSync(new URL('../release-imweb-staff-core-rules.mjs', import.meta.url), 'utf8');
const base = '6e50653f20c243953c3bc03ec4bba00f02ab4ff4';
const baseHash = '4d3d3063d82b4f2c2056dd29586bb3df371c200d023703107c28953f46e1faae';

test('accepts exactly three changed existing notes with surrounding bytes and order preserved', () => {
  assert.doesNotThrow(() => assertRegistrationPolicyNotesOnly(before, after));
  assert.doesNotThrow(() => assertRegistrationPolicyNotesOnly(Buffer.from(before), Buffer.from(after)));
  const reversed = '<main>\n' + [...ids].reverse().map(id => line(id)).join('') + '</main>\n';
  assert.doesNotThrow(() => assertRegistrationPolicyNotesOnly(reversed, reversed.replaceAll('Previous', 'New')));
  assert.doesNotThrow(() => assertRegistrationPolicyNotesOnly(before,
    after.replace(`<strong>${ids[0]}</strong>`, '<strong>Updated heading</strong>')));
});

test('rejects a complete no-op', () => {
  assert.throws(() => assertRegistrationPolicyNotesOnly(before, before));
});

for (const id of ids) {
  const old = line(id), replacement = old.replace('Previous', 'Registered source verified; no provider action');
  test(`${id} must change, not merely exist`, () => {
    assert.throws(() => assertRegistrationPolicyNotesOnly(before, after.replace(replacement, old)));
  });
  for (const [label, mutate] of [
    ['missing', value => value.replace(old, '')],
    ['duplicate on another line', value => value + old],
    ['duplicate on same line', value => value.replace(old, old.trimEnd() + old.trimStart())],
    ['single-quoted duplicate', value => value + old.replace(`id="${id}"`, `id='${id}'`)],
    ['unquoted duplicate', value => value + old.replace(`id="${id}"`, `id=${id}`)],
    ['case-variant attribute duplicate', value => value + old.replace(`id="${id}"`, `ID = "${id}"`)],
    ['different element duplicate', value => value + `<p id="${id}">Extra</p>\n`],
    ['multiline', value => value.replace(old, old.replace('Previous', 'Previous\nline'))],
    ['wrong element', value => value.replace(old, old.replace('<div ', '<section ').replace('</div>', '</section>'))],
    ['extra attribute', value => value.replace(old, old.replace('class="rule-note"', 'class="rule-note" data-extra="yes"'))],
  ]) test(`${id} rejects ${label} before or after`, () => {
    assert.throws(() => assertRegistrationPolicyNotesOnly(mutate(before), after));
    assert.throws(() => assertRegistrationPolicyNotesOnly(before,
      mutate(before).replaceAll('Previous', 'Registered source verified; no provider action')));
  });
  for (const [label, bad] of [
    ['relocation', after.replace(replacement, '') + replacement],
    ['indentation change', after.replace(replacement, ' ' + replacement)],
    ['same-line sibling', after.replace(replacement, replacement.trimEnd() + '<div>Other</div>\n')],
    ['nested unrelated note', after.replace(replacement, replacement.replace('</span>', '</span>' + line('unrelated').trim()))],
    ['script content', after.replace(replacement, replacement.replace('Registered source verified;', '<script>bad()</script>'))],
  ]) test(`${id} rejects ${label}`, () => {
    assert.throws(() => assertRegistrationPolicyNotesOnly(before, bad));
  });
}

for (const [label, bad] of [
  ['unrelated prefix', '<!-- other -->\n' + after],
  ['unrelated suffix', after + '\n'],
  ['surrounding byte deletion', after.slice(1)],
  ['surrounding HTML', after.replace('Untouched 1', 'Changed 1')],
  ['unrelated note addition', after.replace('</main>', line('unrelated') + '</main>')],
  ['line endings', after.replaceAll('\n', '\r\n')],
  ['note order', after.replace(ids[0], 'temporary').replace(ids[1], ids[0]).replace('temporary', ids[1])],
]) test(`rejects ${label}`, () => {
  assert.throws(() => assertRegistrationPolicyNotesOnly(before, bad));
});

test('rejects reordered adjacent notes even when removing all three leaves identical bytes', () => {
  const adjacent = ids.map(id => line(id)).join('');
  const swapped = [...ids].reverse().map(id => line(id, 'New')).join('');
  assert.throws(() => assertRegistrationPolicyNotesOnly(adjacent, swapped));
});

test('preserves unrelated existing notes exactly', () => {
  const other = line('unrelated');
  assert.doesNotThrow(() => assertRegistrationPolicyNotesOnly(before + other, after + other));
  assert.throws(() => assertRegistrationPolicyNotesOnly(before + other, after));
  assert.throws(() => assertRegistrationPolicyNotesOnly(before + other, after + other.replace('Previous', 'Changed')));
});

test('rejects invalid UTF-8 rather than collapsing different bytes to replacement characters', () => {
  assert.throws(() => assertRegistrationPolicyNotesOnly(Buffer.from([0xff]), Buffer.from([0xfe])), /UTF-8/);
  assert.throws(() => assertRegistrationPolicyNotesOnly(before, null), /UTF-8/);
});

// Evaluate only CLI selection expressions, never main(), auth, network or release actions.
function selection(args) {
  const constants = source.match(/^const [A-Z_]+ = '[^']+';/gm).join('\n');
  const start = source.indexOf('  const args = process.argv.slice(2);');
  const end = source.indexOf('  const expected =', start);
  assert.ok(start >= 0 && end > start);
  return structuredClone(runInNewContext(`${constants}\n${source.slice(start, end)}\n({ SITE, ASSET, LIVE, baselineCommit, baselineHash });`, {
    process: { argv: ['node', 'synthetic-release', ...args] },
  }));
}

for (const [site, asset] of [['archive-pilates', '/core/rules/index.html'], ['archive-pilates-core', '/rules/index.html']]) {
  test(`explicit registered-share flag pins only the rules asset on ${site}`, () => {
    assert.deepEqual(selection(['--registered-share-policy', `--site=${site}`]), {
      SITE: site, ASSET: asset, LIVE: `https://${site}.web.app${asset.slice(0, -10)}`,
      baselineCommit: base, baselineHash: baseHash,
    });
  });
}

const historical = [
  [null, '652c16ea1bc120306742bbe1e0b867dce80291f0', '4f1e879c2a5356f113d70b4126b9245afb8337e9fd8b595770c571fae503ef9d'],
  ['--student-share-policy', '074d9a6600bf00f5268bafc32d1d8958769edbf5', '692397d07b4a443b6138a7a06773e4358e3eaf80bda24918a185fa9d935b5a93'],
  ['--webhook-onboarding', 'e38a36e7b4f334ceac8757c4e685b0af46fec16e', '44a9c5c076e562279933c02c3f24562f0a504d20c7f946a71c6d296537849892'],
  ['--webhook-oauth', 'dac9e03c96416b066cc9717f0759698d2fed12d1', '00af19ccf93380b0f6aa025b6c9356289d41a9a8db1c05a0bcefedfe05e66534'],
  ['--staff-lock-policy', '9aaf7a8c38145f60e5b1c0ebab8d562ab832e929', '42b17144216b720cff439930466b09a832979072a2e1ebe72d16e1e09f338a74'],
];
for (const [flag, commit, hash] of historical) test(`historical selection ${flag || 'default'} stays pinned and exclusive`, () => {
  const chosen = selection(flag ? [flag] : []);
  assert.equal(chosen.baselineCommit, commit);
  assert.equal(chosen.baselineHash, hash);
  if (flag) {
    assert.equal(selection([flag, '--site=archive-pilates-core']).SITE, 'archive-pilates-core');
    assert.throws(() => selection([flag, '--registered-share-policy']), /Choose one policy release/);
    assert.throws(() => selection(['--registered-share-policy', flag]), /Choose one policy release/);
  } else assert.throws(() => selection(['--site=archive-pilates-core']), /main-site only/);
});

for (const arg of ['--registered-share', '--registered-share-policy=true', '--site=archive-pilates-home', '--force', '--config=other.json'])
  test(`rejects unsupported scope ${arg} before any I/O`, () => {
    assert.throws(() => selection(['--registered-share-policy', arg]), /Unsupported release argument/);
  });

test('registered-share baseline hash is computed from immutable Git source only', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const bytes = execFileSync('git', ['show', `${base}:core/rules/index.html`], { cwd: root });
  assert.equal(createHash('sha256').update(bytes).digest('hex'), baseHash);
  const proposed = bytes.toString().replace(new RegExp(`(id="(?:${ids.join('|')})"><strong>)`, 'g'), '$1Updated ');
  assert.doesNotThrow(() => assertRegistrationPolicyNotesOnly(bytes, proposed));
});

test('source keeps existing narrow-scope release gates and dispatches new guard before auth', () => {
  assert.match(source, /else if \(registeredShare\) assertRegistrationPolicyNotesOnly\(baselineSource, source\);/);
  assert.ok(source.indexOf('else if (registeredShare)') < source.indexOf("execFileSync('gcloud'"));
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
    "required.some(value => value !== hash)",
    "upload.origin !== 'https://upload-firebasehosting.googleapis.com'",
    'if ((await latest()).version.name !== created.name)',
    'sha(Buffer.from(await verified.arrayBuffer())) !== sha(source)',
    'finally { fs.closeSync(fd); fs.unlinkSync(lock); }',
  ]) assert.ok(source.includes(guard), `Missing existing gate: ${guard}`);
  assert.equal(source.match(/\(await latest\(\)\)\.name !== release\.name/g).length, 3);
  assert.match(source, /registeredShare \? `registered-share-hosting-\$\{SITE\}\.json`/);
  assert.match(source, /oauth \? assertWebhookOAuthNoteOnly : webhook \? assertWebhookOnboardingNoteOnly : studentShare \? assertStudentShareNoteOnly : assertStaffNoteOnly/);
});
