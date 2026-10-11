import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEALTH_WEB_SURFACES, probeWebSurface } from '../lib/system-health-web-surfaces.mjs';

const target = HEALTH_WEB_SURFACES[0];
test('checks cover active CORE routes; retired operator root is not an active app', () => {
  assert.equal(HEALTH_WEB_SURFACES.filter(row => row.area === 'core').length, 15);
  assert.ok(!HEALTH_WEB_SURFACES.some(row => row.url === 'https://in.archivepilates.com/'));
  for (const row of HEALTH_WEB_SURFACES) {
    const route = new URL(row.url).pathname;
    const file = row.area === 'core' ? `../../core${route}index.html` : `../../archivein${route}index.html`;
    assert.ok(readFileSync(new URL(file, import.meta.url), 'utf8').includes(row.marker), row.url);
  }
});
test('weekly operator access verifier targets CORE by default, retaining explicit legacy overrides', () => {
  const source = readFileSync(new URL('../verify-archivein-admin-firestore-access.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('process.env.ARCHIVE_CORE_VERIFY_URL || process.env.ARCHIVEIN_VERIFY_URL || "https://core.archivepilates.com/"'));
  assert.ok(source.includes('getUserByEmail(adminEmail)'));
  assert.ok(!source.includes('setCustomUserClaims('));
});

for (const status of [301, 302, 401, 403, 404, 429, 500]) {
  test(`HTTP ${status} is not reported healthy`, async () => {
    const result = await probeWebSurface(target, { fetchImpl: async () => ({ status, text: async () => target.marker }) });
    assert.equal(result.ok, false);
  });
}
test('wrong page served with HTTP 200 is not healthy', async () => {
  const result = await probeWebSurface(target, { fetchImpl: async () => ({ status: 200, text: async () => '<title>Not Found</title>' }) });
  assert.equal(result.ok, false);
  assert.equal(result.markerOk, false);
});
test('expected shell has explicit non-functional verification scope and a timeout', async () => {
  const result = await probeWebSurface(target, { fetchImpl: async (_, options) => {
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    return { status: 200, text: async () => target.marker };
  } });
  assert.equal(result.ok, true);
  assert.equal(result.verification, 'public_shell_only');
});
test('network failures are reported without throwing the entire check', async () => {
  const result = await probeWebSurface(target, { fetchImpl: async () => { throw new Error('timeout'); } });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'timeout');
});
