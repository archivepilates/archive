import assert from 'node:assert/strict';
import test from 'node:test';
import { createLessonVideoSolapiTransport } from '../lib/lesson-video-notice-solapi.mjs';

function fixture(responses) {
  let now = 100000;
  const calls = [], waits = [];
  const request = createLessonVideoSolapiTransport({ key: 'synthetic', apiSecret: 'synthetic', clock: () => now,
    wait: async ms => { waits.push(ms); now += ms; },
    fetcher: async (_url, options) => {
      calls.push({ at: now, method: options.method });
      return responses.shift();
    } });
  return { request, calls, waits };
}
const ok = () => Response.json({ ok: true });
test('GET requests are paced below the documented read limit', async () => {
  const f = fixture([ok(), ok(), ok()]);
  await f.request('/messages/v4/list'); await f.request('/messages/v4/list'); await f.request('/messages/v4/list');
  assert.deepEqual(f.calls.map(c => c.at), [100000, 100400, 100800]);
});
test('one GET 429 respects provider retry-after before a bounded retry', async () => {
  const f = fixture([Response.json({ errorCode: 'TooManyRequests' }, { status: 429, headers: { 'x-retry-after': '5.2' } }), ok()]);
  assert.deepEqual(await f.request('/messages/v4/list'), { ok: true });
  assert.deepEqual(f.waits, [5200]); assert.equal(f.calls.length, 2);
});
test('repeated GET 429 stops after one retry', async () => {
  const f = fixture([Response.json({}, { status: 429 }), Response.json({}, { status: 429 })]);
  await assert.rejects(f.request('/messages/v4/list'), /SOLAPI GET 429/);
  assert.equal(f.calls.length, 2);
});
test('POST and PUT never wait or retry, including ambiguous or rate-limited writes', async () => {
  for (const method of ['POST', 'PUT']) {
    const f = fixture([ok(), Response.json({}, { status: 429 })]);
    await f.request('/messages/v4/list');
    await assert.rejects(f.request('/messages/v4/send-many/detail', method, {}), /429/);
    assert.equal(f.calls.length, 2); assert.deepEqual(f.waits, []);
    assert.equal(f.calls[1].at, f.calls[0].at);
  }
});
