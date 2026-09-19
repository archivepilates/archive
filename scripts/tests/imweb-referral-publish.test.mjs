import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeReferralBlock, publishReferral } from '../publish-imweb-referral.mjs';
import { IMWEB_REFERRAL_SCOPE as scope } from '../lib/imweb-referral-source.mjs';
const block = '<!-- ARCHIVE-REFERRAL:START -->\n<script data-archive-referral="test">x</script>\n<!-- ARCHIVE-REFERRAL:END -->';
test('marker merge preserves unrelated bytes and is idempotent', () => {
  const base = 'native footer\n';
  const merged = mergeReferralBlock(base, block);
  assert.equal(mergeReferralBlock(merged, block), merged);
  const next = block.replace('>x<', '>y<');
  assert.equal(mergeReferralBlock(`${merged}\nafter`, next), `${base}\n${next}\nafter`);
  assert.throws(() => mergeReferralBlock(`${block}${block}`, block), /Ambiguous/);
});
test('publisher aborts concurrent edits and preserves protected positions', () => {
  for (const concurrent of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), 'referral-publish-'));
    const scripts = { body: 'data-archive-pilates-video-watch-tracker="2026-09-19.1"' + 'b'.repeat(10000),
      header: 'data-archive-pilates-my-classroom-v2="2026-09-04d"' + 'h'.repeat(10000), footer: 'f'.repeat(10000) };
    let reads = 0, writes = 0;
    const run = args => {
      if (args[0] === 'config') return { resolved_profile: { site_code: scope.siteCode, unit_code: scope.unitCode } };
      if (args[1] === 'list') {
        if (++reads === 2 && concurrent) scripts.footer += 'other change';
        return { data: Object.entries(scripts).map(([position, scriptContent]) => ({ ...scope, position, scriptContent })) };
      }
      if (args.includes('--dry-run')) return { confirmation_token: 'test-only' };
      scripts.footer = JSON.parse(args[args.indexOf('--data') + 1]).scriptContent;
      writes++; return {};
    };
    try {
      if (concurrent) { assert.throws(() => publishReferral({ apply: true, block, privateDirectory: directory, run }), /Concurrent/); assert.equal(writes, 0); }
      else { assert.equal(publishReferral({ apply: true, block, privateDirectory: directory, run }).headerUnchanged, true); assert.equal(writes, 1); }
    } finally { rmSync(directory, { recursive: true }); }
  }
});
