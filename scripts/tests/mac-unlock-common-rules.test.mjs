import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const agents = fs.readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../../core/rules/index.html', import.meta.url), 'utf8');
const rule = agents.split('### On-Demand Mac Mini Unlock\n')[1]?.split('\n### ')[0];
const section = html.match(/<section class="panel rule-section" id="mac-mini-on-demand-unlock">[\s\S]*?<\/section>/)?.[0];

test('local instructions name the installed helper and independent readback', () => {
  assert.ok(rule);
  assert.match(rule, /\/Users\/archivepilates\/\.local\/bin\/archive-mac-unlock status/);
  assert.match(rule, /unlock.*once/);
  assert.match(rule, /fresh unlocked status/);
});
test('local instructions preserve safety boundaries', () => {
  for (const text of ['Keychain', 'consumed/unknown', 'first login', 'FileVault', 'member communication window']) assert.ok(rule.includes(text));
  assert.match(rule, /Do not export or print the password/);
  assert.match(rule, /scheduled\/background unlocks/);
});
test('CORE rule appears exactly once and separates local use from web publication', () => {
  assert.ok(section);
  assert.equal((html.match(/id="mac-mini-on-demand-unlock"/g) || []).length, 1);
  for (const text of ['status', '1회', '다시 조회', '키체인', '결과 불명확', 'FileVault', 'Hosting 릴리스', '구분']) assert.ok(section.includes(text));
});
