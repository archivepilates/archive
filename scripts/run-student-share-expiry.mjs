import { runExpiryWorker } from './lib/student-share-expiry-worker.mjs';
const args = process.argv.slice(2);
if (args.length !== 1 || !['--apply','--check'].includes(args[0])) throw Error('Use --apply or --check; no clock override');
try {
  const result = await runExpiryWorker({ apply: args[0] === '--apply' });
  console.log(JSON.stringify(result));
  if (!result.ok && result.status !== 'deferred_lock') process.exitCode = 1;
} catch { console.error(JSON.stringify({ ok: false, errorCode: 'EXPIRY_WORKER_FAILED' })); process.exitCode = 1; }
