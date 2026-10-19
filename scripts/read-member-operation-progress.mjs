#!/usr/bin/env node
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { operationProgressView, progressInput } from '../services/archivepilates-mcp/src/operation-progress.mjs';

const backendUrl = new URL('../firebase/kangsain-functions/functions/lib/operations/memberOperationProgress.js', import.meta.url);
const requireBackend = createRequire(backendUrl);

export async function readMemberOperationProgress(input, {
  loadAdmin = () => requireBackend('firebase-admin/app'),
  loadInspect = () => requireBackend(fileURLToPath(backendUrl)).inspectMemberOperationProgress,
  signal,
} = {}) {
  progressInput(input);
  let admin;
  try {
    admin = loadAdmin();
    const inspect = loadInspect();
    if (typeof inspect !== 'function' || signal?.aborted) throw new Error('progress_unavailable');
    const result = await inspect(input, '5330');
    if (signal?.aborted) throw new Error('progress_cancelled');
    return operationProgressView(result, input);
  } finally {
    if (admin) {
      const results = await Promise.allSettled(admin.getApps().map(app => admin.deleteApp(app)));
      if (results.some(result => result.status === 'rejected')) throw new Error('progress_cleanup_failed');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    if (process.argv.length !== 4) throw new Error('invalid_arguments');
    const result = await readMemberOperationProgress({ kind: process.argv[2], operationId: process.argv[3] }, { signal: controller.signal });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write('Member operation progress unavailable.\n'); process.exitCode = 1;
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
  }
}
