import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCommonStaffAcl } from '../lib/imweb-staff-common-acl.mjs';
import { STAFF_GROUP } from '../lib/imweb-staff-video-policy.mjs';

const BUYER = 'g101', TEAM = 'g102', OLD = 'g103', EXTRA = 'g104';
const menu = (menuCode, url, groupCodes, type = 'group') => ({ menuCode,
  menuTitle: 'Private title not included in evidence', url, accessPermission: { type, groupCodes } });
const fixture = () => ({
  catalog: [BUYER, TEAM],
  baselineMenus: [menu('paid', '/archive-method-watch-a', [BUYER]),
    menu('special', '/legacy-special-watch', [OLD, TEAM])],
  menus: [menu('paid', '/archive-method-watch-a', [BUYER, STAFF_GROUP]),
    menu('special', '/legacy-special-watch', [OLD, TEAM, STAFF_GROUP]),
    menu('private', '/private-lesson-new', [TEAM, STAFF_GROUP]),
    menu('home', '/', undefined, 'guest')],
});
const check = value => assertCommonStaffAcl(value);

const nativeSite = () => {
  const catalog = Array.from({ length: 49 }, (_, index) => `g${(index + 1000).toString(16)}`);
  const baselineMenus = catalog.map((code, index) => menu(`protected-${index}`,
    index === 48 ? 'legacy-special-watch' : `archive-method-watch-ar${index}`, [code]));
  const menus = baselineMenus.map((row, index) => ({ ...structuredClone(row),
    url: index % 2 ? `/${row.url}` : row.url,
    accessPermission: { type: 'group', groupCodes: [...row.accessPermission.groupCodes, STAFF_GROUP] } }));
  menus.push(menu('home', '', null, 'guest'), menu('parent', '17', null, 'login'),
    ...Array.from({ length: 10 }, (_, index) => menu(`ordinary-${index}`, `${index + 100}`, null, 'guest')));
  return { catalog, menus, baselineMenus };
};

test('normalizes all 61 native menus while preserving all 49 protected baseline pages', () => {
  const input = nativeSite(), before = structuredClone(input), result = check(input);
  assert.equal(input.menus.length, 61);
  assert.equal(input.baselineMenus.length, 49);
  assert.equal(result.menuCount, 49);
  assert.ok(result.mapping.every(row => row.url.startsWith('/') && row.groupCodes.includes(STAFF_GROUP)));
  assert.ok(!result.mapping.some(row => row.menuCode === 'home' || row.menuCode === 'parent'));
  assert.deepEqual(input, before);
  const canonical = structuredClone(input);
  for (const row of [...canonical.menus, ...canonical.baselineMenus]) {
    row.url = row.url.startsWith('/') ? row.url : `/${row.url}`;
  }
  assert.deepEqual(check(canonical), result);
});

test('optional leading slash, home and numeric parent paths normalize without widening discovery', () => {
  const input = { catalog: [BUYER], baselineMenus: [menu('paid', 'archive-method-watch-ar7', [BUYER])],
    menus: [menu('paid', '/archive-method-watch-ar7', [BUYER, STAFF_GROUP]),
      menu('home', '', null, 'guest'), menu('parent', '17', null, 'login')] };
  const result = check(input);
  assert.equal(result.menuCount, 1);
  assert.equal(result.mapping[0].url, '/archive-method-watch-ar7');
  input.baselineMenus[0].url = '/archive-method-watch-ar7';
  input.menus[0].url = 'archive-method-watch-ar7';
  input.menus[1].url = '/'; input.menus[2].url = '/17';
  assert.deepEqual(check(input), result);
});

for (const [label, mutate] of [
  ['missing STAFF', input => { input.menus[0].accessPermission.groupCodes.pop(); }],
  ['lost buyer', input => { input.menus[0].accessPermission.groupCodes = [STAFF_GROUP]; }],
  ['public baseline', input => { input.menus[0].accessPermission = { type: 'guest', groupCodes: null }; }],
  ['changed baseline URL', input => { input.menus[0].url = 'archive-method-watch-different'; }],
  ['extra baseline group', input => { input.menus[0].accessPermission.groupCodes.push(EXTRA); }],
  ['missing baseline page', input => { input.menus.splice(0, 1); }],
  ['null group ACL', input => { input.menus[0].accessPermission.groupCodes = null; }],
  ['null baseline ACL', input => { input.baselineMenus[0].accessPermission.groupCodes = null; }],
  ['new catalog without page', input => { input.catalog.push(EXTRA); }],
  ['public new slashless video page', input => { input.menus.push(menu('new-public', 'private-lesson-new', null, 'login')); }],
  ['duplicate normalized URL', input => { input.menus.push(menu('duplicate', `/${input.menus[0].url}`, [input.catalog[0], STAFF_GROUP])); }],
  ['duplicate home alias', input => { input.menus.push(menu('other-home', '/', null, 'guest')); }],
]) test(`61-menu failure preserves both native source snapshots: ${label}`, () => {
  const input = nativeSite(); mutate(input); const before = structuredClone(input);
  assert.throws(() => check(input));
  assert.deepEqual(input, before);
});

test('null and absent groups are allowed only for nongroup ACLs, never protected pages', () => {
  for (const value of [null, undefined]) {
    const input = nativeSite();
    input.menus.at(-1).accessPermission.groupCodes = value;
    assert.equal(check(input).menuCount, 49);
    input.menus.at(-1).accessPermission.type = 'group';
    const before = structuredClone(input);
    assert.throws(() => check(input), /group codes/);
    assert.deepEqual(input, before);
  }
});

test('preserves baseline pages and returns only deterministic non-PII ACL mapping', () => {
  const input = fixture(), before = structuredClone(input);
  input.menus[0].youtubeId = 'sensitive-media-id';
  input.menus[0].memberEmail = 'private@example.test';
  const snapshot = structuredClone(input), result = check(input);
  assert.equal(result.ok, true);
  assert.equal(result.menuCount, 3);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(result).sort(), ['fingerprint', 'mapping', 'menuCount', 'ok']);
  assert.deepEqual(result.mapping.map(row => row.menuCode), ['paid', 'private', 'special']);
  assert.deepEqual(result.mapping[2].groupCodes, [OLD, TEAM, STAFF_GROUP].sort());
  assert.doesNotMatch(JSON.stringify(result), /Private title|sensitive-media-id|private@example|menuTitle|youtubeId|memberEmail/);
  assert.deepEqual(input, snapshot);
  const reversed = structuredClone(before);
  reversed.catalog.reverse(); reversed.menus.reverse(); reversed.baselineMenus.reverse();
  for (const row of [...reversed.menus, ...reversed.baselineMenus]) row.accessPermission.groupCodes?.reverse();
  assert.deepEqual(check(reversed), result);
});

test('default baseline supports catalog-group and exact known-prefix discovery only', () => {
  const input = { catalog: [BUYER], menus: [menu('opaque', '/321', [BUYER, STAFF_GROUP]),
    menu('new', '/private-lesson-new', [BUYER, STAFF_GROUP]),
    menu('other', '/private-lessons-public', undefined, 'guest'),
    menu('other2', '/archive-method-watches-public', undefined, 'guest')] };
  assert.equal(check(input).menuCount, 2);
});

test('old special paths remain protected even after their group leaves the current catalog', () => {
  const input = fixture();
  input.baselineMenus[1].accessPermission.groupCodes = [OLD];
  input.menus[1].accessPermission.groupCodes = [OLD, STAFF_GROUP];
  assert.equal(check(input).menuCount, 3);
  input.menus[1].accessPermission = { type: 'guest' };
  assert.throws(() => check(input));
});

for (const type of ['guest', 'login', 'allmembers', 'all', 'owner', 'password', 'password-group', 'GROUP', '']) {
  test(`rejects video-page permission type ${JSON.stringify(type)}`, () => {
    const input = fixture(); input.menus[2].accessPermission.type = type;
    assert.throws(() => check(input), /group-only/);
  });
}

for (const [label, mutate] of [
  ['missing STAFF', input => { input.menus[2].accessPermission.groupCodes = [TEAM]; }],
  ['lost buyer', input => { input.menus[0].accessPermission.groupCodes = [STAFF_GROUP]; }],
  ['lost one original group', input => { input.menus[1].accessPermission.groupCodes = [TEAM, STAFF_GROUP]; }],
  ['unexpected baseline group', input => { input.menus[0].accessPermission.groupCodes.push(EXTRA); }],
  ['wrong baseline path', input => { input.menus[1].url = '/renamed-special-watch'; }],
  ['wrong baseline code', input => { input.menus[1].menuCode = 'renamed'; }],
  ['missing baseline page', input => { input.menus.splice(1, 1); }],
  ['new group missing page', input => { input.catalog.push(EXTRA); }],
  ['new prefix page with no catalog group', input => { input.menus.push(menu('unknown', '/archive-method-watch-unknown', [EXTRA, STAFF_GROUP])); }],
  ['new prefix page with STAFF only', input => { input.menus.push(menu('staffonly', '/private-lesson-staffonly', [STAFF_GROUP])); }],
  ['leaked public new page', input => { input.menus.push(menu('public', '/private-lesson-public', undefined, 'guest')); }],
  ['leaked public opaque catalog page', input => { input.menus.push(menu('public', '/987', [BUYER], 'guest')); }],
  ['leaked public baseline page', input => { input.menus[1].accessPermission.type = 'guest'; }],
]) test(`fails closed: ${label}`, () => {
  const input = fixture(); mutate(input); const before = structuredClone(input);
  assert.throws(() => check(input));
  assert.deepEqual(input, before);
});

test('baseline can already contain STAFF, but cannot be public or STAFF-only', () => {
  const input = fixture(); input.baselineMenus[0].accessPermission.groupCodes.push(STAFF_GROUP);
  assert.equal(check(input).ok, true);
  input.baselineMenus[0].accessPermission.type = 'guest';
  assert.throws(() => check(input), /baseline/);
  input.baselineMenus[0].accessPermission.type = 'group';
  input.baselineMenus[0].accessPermission.groupCodes = [STAFF_GROUP];
  assert.throws(() => check(input), /baseline/);
});

test('supports multiple pages per group, more than 48 pages, and the 1000-menu boundary', () => {
  const input = { catalog: [BUYER], menus: Array.from({ length: 1000 }, (_, index) =>
    menu(`page-${index}`, `/private-lesson-${index}`, [BUYER, STAFF_GROUP])) };
  assert.equal(check({ ...input, menus: input.menus.slice(0, 49) }).menuCount, 49);
  assert.equal(check(input).menuCount, 1000);
  input.menus.push(menu('overflow', '/private-lesson-overflow', [BUYER, STAFF_GROUP]));
  assert.throws(() => check(input), /1000/);
  assert.throws(() => check({ ...fixture(), baselineMenus: input.menus }), /1000/);
});

test('supports more than 48 catalog groups without inheriting the legacy group cap', () => {
  const catalog = Array.from({ length: 49 }, (_, index) => `g${(index + 1000).toString(16)}`);
  const menus = catalog.map((code, index) => menu(`page-${index}`, `/private-lesson-${index}`, [code, STAFF_GROUP]));
  assert.equal(check({ catalog, menus }).menuCount, 49);
});

for (const [label, mutate] of [
  ['identical menu', input => { input.menus.push(structuredClone(input.menus[0])); }],
  ['conflicting code', input => { input.menus.push(menu('paid', '/other-path', [TEAM, STAFF_GROUP])); }],
  ['conflicting URL', input => { input.menus.push(menu('different', input.menus[0].url, [TEAM, STAFF_GROUP])); }],
  ['trailing slash alias', input => { input.menus.push(menu('different', `${input.menus[0].url}/`, [TEAM, STAFF_GROUP])); }],
  ['baseline duplicate', input => { input.baselineMenus.push(structuredClone(input.baselineMenus[0])); }],
]) test(`rejects duplicate identity: ${label}`, () => {
  const input = fixture(); mutate(input); assert.throws(() => check(input), /Duplicate/);
});

for (const url of ['https://archivepilates.com/watch', 'http://example.test/watch', '//example.test/watch',
  'javascript:alert(1)', 'data:text/html,test', '/a/../watch', '/./watch', '/a//watch',
  '/%2e%2e/watch', '/%252e%252e/watch', '/a\\watch', '/watch?group=g101', '/watch#fragment',
  '/watch\n', '/watch ', '/watch@host', '/watch:443', '../watch', './watch', 'a//watch',
  '%2e%2e/watch', 'a\\watch', 'watch?group=g101', 'watch#fragment', 'watch\n', 'watch ', null]) {
  test(`rejects noncanonical URL ${JSON.stringify(url)}`, () => {
    const input = fixture(); input.menus[2].url = url;
    assert.throws(() => check(input), /URL/);
    const baseline = fixture(); baseline.baselineMenus[0].url = url;
    assert.throws(() => check(baseline), /URL/);
  });
}

test('baseline URL preservation is exact, including trailing slash', () => {
  const input = fixture(); input.menus[0].url += '/';
  assert.throws(() => check(input), /URL changed/);
});

test('sparse group arrays cannot smuggle undefined permissions into evidence', () => {
  const input = fixture();
  input.menus[2].accessPermission.groupCodes = [TEAM, , STAFF_GROUP];
  assert.throws(() => check(input), /group codes/);
  assert.throws(() => check({ ...fixture(), catalog: [BUYER, , TEAM] }), /group codes/);
});

test('returned ACL arrays are detached from both input snapshots', () => {
  const input = fixture(), before = structuredClone(input), result = check(input);
  result.mapping[0].groupCodes.push(EXTRA);
  result.mapping[0].url = '/changed-output-only';
  assert.deepEqual(input, before);
});

test('rejects malformed catalogs, group arrays, menus and permissions', () => {
  for (const catalog of [null, {}, [], [STAFF_GROUP], [BUYER, BUYER], [' buyer '], [123],
    Array.from({ length: 1001 }, (_, index) => `g${(index + 1000).toString(16)}`)]) {
    assert.throws(() => check({ ...fixture(), catalog }));
  }
  for (const value of [null, {}, [BUYER, BUYER], [BUYER, null], ['g101\n'], [`g${'a'.repeat(128)}`]]) {
    const input = fixture(); input.menus[0].accessPermission.groupCodes = value;
    assert.throws(() => check(input));
  }
  for (const menus of [null, {}, [null], [{ menuCode: 'bad', url: '/' }]]) {
    assert.throws(() => check({ ...fixture(), menus }));
  }
  for (const code of ['', ' private ', 'private@example.test', 'a'.repeat(129), null]) {
    const input = fixture(); input.menus[0].menuCode = code;
    assert.throws(() => check(input), /menu code/);
  }
  assert.throws(() => check({ ...fixture(), baselineMenus: null }));
  assert.throws(() => check({ ...fixture(), menus: [] }), /Baseline/);
});

test('fingerprint reflects catalog, path and ACL changes, not titles or native ordering', () => {
  const input = fixture(), original = check(input).fingerprint;
  input.menus[0].menuTitle = 'Different private title';
  assert.equal(check(input).fingerprint, original);
  input.menus[2].url = '/private-lesson-other';
  assert.notEqual(check(input).fingerprint, original);
  input.menus[2].url = '/private-lesson-new';
  input.menus[2].accessPermission.groupCodes.push(EXTRA);
  assert.notEqual(check(input).fingerprint, original);
  input.menus[2].accessPermission.groupCodes.pop();
  input.catalog.push(OLD);
  assert.notEqual(check(input).fingerprint, original);
});
