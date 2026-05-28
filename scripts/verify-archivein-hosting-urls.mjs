#!/usr/bin/env node

import https from 'node:https';

const DEFAULT_URLS = [
  'https://in.archivepilates.com/',
  'https://in.archivepilates.com/groupSurvey/',
];

const urls = process.argv.slice(2);
const targets = urls.length > 0 ? urls : DEFAULT_URLS;
const maxAttempts = Number(process.env.ARCHIVEIN_HOSTING_VERIFY_ATTEMPTS || 8);
const delayMs = Number(process.env.ARCHIVEIN_HOSTING_VERIFY_DELAY_MS || 5000);
const timeoutMs = Number(process.env.ARCHIVEIN_HOSTING_VERIFY_TIMEOUT_MS || 12000);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(url, redirectsLeft = 5) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const statusCode = res.statusCode || 0;
      const location = res.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location && redirectsLeft > 0) {
        res.resume();
        const nextUrl = new URL(location, url).toString();
        request(nextUrl, redirectsLeft - 1).then(resolve);
        return;
      }

      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
      });
      res.on('end', () => {
        resolve({
          ok: statusCode >= 200 && statusCode < 300,
          statusCode,
          bytes,
          url,
          finalUrl: res.responseUrl || url,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.on('error', (error) => {
      resolve({
        ok: false,
        statusCode: 0,
        bytes: 0,
        url,
        finalUrl: url,
        error: error.message,
      });
    });
  });
}

async function verifyUrl(url) {
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await request(url);
    const label = `${url} -> ${lastResult.statusCode || 'ERR'}`;

    if (lastResult.ok) {
      console.log(`OK ${label} (${lastResult.bytes} bytes, attempt ${attempt}/${maxAttempts})`);
      return;
    }

    const reason = lastResult.error ? `, ${lastResult.error}` : '';
    console.warn(`WAIT ${label}${reason} (attempt ${attempt}/${maxAttempts})`);

    if (attempt < maxAttempts) {
      await wait(delayMs);
    }
  }

  const detail = lastResult?.error ? ` (${lastResult.error})` : '';
  throw new Error(`Hosting URL did not become available: ${url} -> ${lastResult?.statusCode || 'ERR'}${detail}`);
}

try {
  for (const target of targets) {
    await verifyUrl(target);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
