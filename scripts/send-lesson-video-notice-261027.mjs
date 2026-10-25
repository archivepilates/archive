#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runLessonVideoNotice } from './lib/lesson-video-notice-261027.mjs';

export async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && !['--plan', '--apply'].includes(args[0])))
    throw new Error('usage: node scripts/send-lesson-video-notice-261027.mjs [--plan|--apply]');
  return runLessonVideoNotice({ mode: args[0] === '--apply' ? 'apply' : 'plan',
    makeRequest: async () => {
      const { makeLessonVideoSolapiRequest } = await import('./lib/lesson-video-notice-solapi.mjs');
      return makeLessonVideoSolapiRequest();
    } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(result => { console.log(JSON.stringify(result)); }).catch(() => {
    // Provider errors and filesystem exceptions may carry private payloads or paths.
    console.error(JSON.stringify({ status: 'blocked', reason: 'validation_or_preflight_failed', attempted: 'unknown_check_private_ledger' }));
    process.exitCode = 1;
  });
}
