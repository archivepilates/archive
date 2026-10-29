import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { STAFF_GROUP } from './imweb-staff-video-policy.mjs';

const LIMIT = 1000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const groupCode = value => typeof value === 'string' && value.length <= 128 && /^g[0-9a-f]+$/.test(value);
const videoPath = value => /^\/(?:archive-method-watch-|private-lesson-)/.test(value);
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function groups(value) {
  assert.ok(Array.isArray(value) && value.length <= LIMIT && Array.from(value).every(groupCode), 'Invalid ACL group codes');
  assert.equal(new Set(value).size, value.length, 'Duplicate ACL group code');
  return [...value].sort(compare);
}

function menuPath(value) {
  // Native menus omit the leading slash and use an empty string for home.
  assert.ok(typeof value === 'string' && value.length <= 2048
    && (value === '' || value === '/' || /^\/?[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(value)), 'Invalid native menu URL');
  return value.startsWith('/') ? value : `/${value}`;
}

function menuIndex(menus) {
  assert.ok(Array.isArray(menus) && menus.length <= LIMIT, 'Expected at most 1000 native menus');
  const byCode = new Map(), urls = new Set();
  for (const menu of menus) {
    assert.ok(record(menu) && typeof menu.menuCode === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(menu.menuCode), 'Invalid native menu code');
    const url = menuPath(menu.url);
    const key = url === '/' ? '/' : url.replace(/\/$/, '');
    assert.ok(!byCode.has(menu.menuCode) && !urls.has(key), 'Duplicate native menu code or URL');
    assert.ok(record(menu.accessPermission) && typeof menu.accessPermission.type === 'string', 'Invalid native menu permission');
    const groupCodes = menu.accessPermission.type !== 'group' && menu.accessPermission.groupCodes == null
      ? [] : groups(menu.accessPermission.groupCodes);
    byCode.set(menu.menuCode, { menuCode: menu.menuCode, url,
      type: menu.accessPermission.type, groupCodes });
    urls.add(key);
  }
  return byCode;
}

// catalog is the current video-group-code array; baselineMenus is the original protected-page snapshot.
export function assertCommonStaffAcl({ menus, catalog, baselineMenus = [] }) {
  const catalogGroups = groups(catalog), catalogSet = new Set(catalogGroups);
  assert.ok(catalogGroups.length > 0 && !catalogSet.has(STAFF_GROUP), 'Expected nonempty video catalog without STAFF');
  const current = menuIndex(menus), baseline = menuIndex(baselineMenus);
  for (const original of baseline.values()) {
    assert.ok(original.type === 'group' && original.groupCodes.some(code => code !== STAFF_GROUP), 'Invalid protected baseline ACL');
    const menu = current.get(original.menuCode);
    assert.ok(menu && menu.url === original.url, 'Baseline menu code or URL changed or missing');
    const expected = [...new Set([...original.groupCodes, STAFF_GROUP])].sort(compare);
    assert.deepEqual(menu.groupCodes, expected, 'Baseline ACL lost original groups or gained unexpected groups');
  }
  const mapping = [], covered = new Set();
  for (const menu of current.values()) {
    const catalogMatches = menu.groupCodes.filter(code => catalogSet.has(code));
    if (!baseline.has(menu.menuCode) && !videoPath(menu.url) && !catalogMatches.length) continue;
    assert.ok(menu.type === 'group' && menu.groupCodes.includes(STAFF_GROUP)
      && menu.groupCodes.some(code => code !== STAFF_GROUP), 'Video menu requires group-only STAFF OR existing-group ACL');
    assert.ok(baseline.has(menu.menuCode) || catalogMatches.length > 0, 'New video menu has no current catalog group');
    for (const code of catalogMatches) covered.add(code);
    mapping.push({ menuCode: menu.menuCode, url: menu.url, groupCodes: [...menu.groupCodes] });
  }
  assert.ok(catalogGroups.every(code => covered.has(code)), 'Catalog video group has no protected menu');
  mapping.sort((left, right) => compare(left.menuCode, right.menuCode));
  const fingerprint = createHash('sha256').update(JSON.stringify({ catalog: catalogGroups, mapping })).digest('hex');
  return { ok: true, mapping, fingerprint, menuCount: mapping.length };
}
