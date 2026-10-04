import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main } from './run-imweb-referral-worker.mjs';
import { observeAutomationRun, sendAutomationHealthEmail } from './lib/automation-failure-notifications.mjs';
import { TRANSIENT_READ_CODE } from './lib/imweb-read-failure.mjs';

const emailContext = { area: '친구초대', title: '자동 적립', link: 'https://archivepilates.imweb.me/admin' };

export async function runReferralJob({ directory = join(homedir(), 'ArchiveIN/automation/referral-production'),
  run = main, notify = event => sendAutomationHealthEmail(emailContext, event) } = {}) {
  const result = await run(['--config', join(directory, 'config.json'), '--apply']);
  try {
    await observeAutomationRun(directory, {
      ok: !result.exitCode, errorCode: result.errorCode,
      transient: result.errorCode === TRANSIENT_READ_CODE,
      runFinishedAt: result.finishedAt,
      skipped: !result.exitCode && (result.mode !== 'apply' || Boolean(result.summary?.disabled)),
    }, notify);
  } catch { process.stderr.write('Referral failure notification could not be confirmed.\n'); }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = (await runReferralJob()).exitCode;
}
