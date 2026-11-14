import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { matchesPreviousFunctionConfiguration, servesExpectedChartRevision } from '../lib/private-chart-release-verification.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const original = { eventTrigger: { trigger: 'existing', eventFilters: [{ attribute: 'database', value: 'default' },
  { attribute: 'namespace', value: 'default' }, { attribute: 'document', value: 'records/{id}' }] },
  serviceAccountEmail: 'synthetic@example.test', secrets: [{ key: 'EXAMPLE', version: '1' }], environment: { EXAMPLE: 'synthetic' }, timeout: 540 };
test('exact and conjunctive event-filter reordering match the retained checksum', () => {
  assert.ok(matchesPreviousFunctionConfiguration(hash(original), original));
  const current = structuredClone(original); current.eventTrigger.eventFilters.reverse();
  assert.ok(matchesPreviousFunctionConfiguration(hash(original), current));
});
test('filter content, other arrays, security and runtime changes never match', () => {
  for (const mutate of [v => v.eventTrigger.eventFilters[0].value = 'other', v => v.timeout++,
    v => v.serviceAccountEmail = 'other', v => v.secrets[0].version = '2',
    v => v.environment.EXAMPLE = 'other', v => v.eventTrigger.trigger = 'other']) {
    const current = structuredClone(original); mutate(current);
    assert.equal(matchesPreviousFunctionConfiguration(hash(original), current), false);
  }
});
test('unavailable or oversized filter evidence is not accepted', () => {
  assert.equal(matchesPreviousFunctionConfiguration(hash(original), {}), false);
  assert.equal(matchesPreviousFunctionConfiguration(hash(original), { eventTrigger: { eventFilters: Array(6).fill({}) } }), false);
});
test('serving proof accepts canonical long or short revision names, never stale or split traffic', () => {
  for (const prefix of ['', 'projects/synthetic/locations/test/services/test/revisions/']) {
    const service = { latestReadyRevision: prefix + 'revision-2', trafficStatuses: [{ revision: prefix + 'revision-2', percent: 100 }] };
    assert.equal(servesExpectedChartRevision(service, 'revision-2'), true);
    assert.equal(servesExpectedChartRevision(service, 'revision-1'), false);
    assert.equal(servesExpectedChartRevision({ ...service, trafficStatuses: [{ revision: prefix + 'revision-2', percent: 99 }] }, 'revision-2'), false);
    assert.equal(servesExpectedChartRevision({ ...service, trafficStatuses: [{ type: 'LATEST', percent: 100 }] }, 'revision-2'), false);
  }
});
