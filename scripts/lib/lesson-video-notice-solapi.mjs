import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
export function makeLessonVideoSolapiRequest() {
  const secret = name => execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', `--secret=${name}`,
    '--project=archive-pilates', `--account=${ACCOUNT}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
  const key = secret('SOLAPI_API_KEY'), apiSecret = secret('SOLAPI_API_SECRET');
  return createLessonVideoSolapiTransport({ key, apiSecret });
}

export function createLessonVideoSolapiTransport({ key, apiSecret, fetcher = fetch, clock = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let nextReadAt = 0;
  return async function request(resource, method = 'GET', body) {
    if (typeof resource !== 'string' || !resource.startsWith('/') || resource.startsWith('//') || !['GET', 'POST', 'PUT'].includes(method)) throw Error('Unsupported SOLAPI request');
    const url = new URL(resource, 'https://api.solapi.com');
    if (url.origin !== 'https://api.solapi.com') throw Error('Unexpected SOLAPI origin');
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (method === 'GET') {
        if (clock() < nextReadAt) await wait(nextReadAt - clock());
        nextReadAt = clock() + 400;
      }
      const date = new Date(clock()).toISOString(), salt = randomBytes(16).toString('hex');
      const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex');
      response = await fetcher(url, { method, headers: { Authorization: `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}`,
        'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
      if (method !== 'GET' || response.status !== 429 || attempt !== 0) break;
      const seconds = Number(response.headers.get('x-retry-after') || response.headers.get('retry-after'));
      const delay = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 5500;
      if (delay > 60000) break;
      await response.arrayBuffer();
      nextReadAt = Math.max(nextReadAt, clock() + delay);
    }
    if (!response.ok) {
      const error = Error(`SOLAPI ${method} ${response.status}; read provider state before retrying any write`);
      // Keep provider diagnostics in memory for a private operational reconciliation only.
      error.providerResponse = await response.json().catch(() => null);
      throw error;
    }
    return response.json();
  };
}
