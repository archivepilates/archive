#!/usr/bin/env node
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { id } from '../services/archivepilates-mcp/src/errors.mjs';

const backendUrl = new URL('../firebase/kangsain-functions/functions/lib/alimtalk/targetValidation.js', import.meta.url);
const requireBackend = createRequire(backendUrl);

export async function readAlimtalkTargetValidation(candidateId, {
  loadAdmin = () => requireBackend('firebase-admin/app'),
  loadInspect = () => requireBackend(fileURLToPath(backendUrl)).inspectAlimtalkTargets,
  signal,
} = {}) {
  id(candidateId);
  let admin;
  try {
    admin = loadAdmin();
    const inspect = loadInspect();
    if (typeof inspect !== 'function' || signal?.aborted) throw new Error('validation_unavailable');
    // Inspection owns the default app until it settles. The parent may kill only
    // this child if an interrupted read cannot drain within the cleanup grace.
    const result = await inspect([candidateId], '5330');
    if (signal?.aborted) throw new Error('validation_cancelled');
    return result;
  } finally {
    if (admin) {
      const results = await Promise.allSettled(admin.getApps().map(app => admin.deleteApp(app)));
      if (results.some(result => result.status === 'rejected')) throw new Error('validation_cleanup_failed');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    if (process.argv.length !== 3) throw new Error('invalid_arguments');
    const result = await readAlimtalkTargetValidation(process.argv[2], { signal: controller.signal });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write('Alimtalk preflight validation unavailable.\n');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}
