import { randomBytes } from 'node:crypto';
import { fault } from './config.mjs';

// Public SDK application identifier, not a PAT or a local account credential.
const SDK_API_KEY = 'v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3';
const ORIGIN = 'https://api-kic.lgthinq.com';
export const RENEW_MS = 12 * 60 * 60 * 1000;

async function validResponse(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw fault(response.status === 401 || response.status === 403 ? 'SUBSCRIPTION_AUTH' : 'SUBSCRIPTION_REJECTED');
  }
  const reader = response.body?.getReader();
  if (!reader) throw fault('SUBSCRIPTION_REJECTED');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw fault('SUBSCRIPTION_REJECTED');
      chunks.push(value);
    }
    let result;
    try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw fault('SUBSCRIPTION_REJECTED'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || result.error != null || !Object.hasOwn(result, 'response')
      || (result.response && typeof result.response === 'object' && result.response.error != null)) {
      throw fault('SUBSCRIPTION_REJECTED');
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Intentionally not a general HTTP helper: only event subscription is expressible.
export function createEventSubscriptions({ config, fetchImpl = globalThis.fetch }) {
  return async function renew(signal) {
    for (const deviceId of config.allowedDeviceIds) {
      if (signal?.aborted) throw fault('SUBSCRIPTION_ABORTED');
      let response;
      try {
        response = await fetchImpl(`${ORIGIN}/event/${encodeURIComponent(deviceId)}/subscribe`, {
          method: 'POST', redirect: 'error',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
          headers: { Authorization: `Bearer ${config.pat}`, 'Content-Type': 'application/json',
            'x-country': 'KR', 'x-client-id': config.clientId, 'x-api-key': SDK_API_KEY,
            'x-service-phase': 'OP', 'x-message-id': randomBytes(16).toString('base64url') },
          body: JSON.stringify({ expire: { unit: 'HOUR', timer: 24 } }),
        });
      } catch { throw fault('SUBSCRIPTION_NETWORK'); }
      // Check bounded success/error envelopes, but never return or log their contents.
      try { await validResponse(response); }
      catch (error) {
        if (['SUBSCRIPTION_AUTH', 'SUBSCRIPTION_REJECTED'].includes(error.code)) throw error;
        throw fault('SUBSCRIPTION_NETWORK');
      }
    }
  };
}
