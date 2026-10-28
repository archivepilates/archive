import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { staffImweb, STAFF_VIDEO_DIR, MEMBER_GROUP_LOCK } from './lib/imweb-staff-video-sync.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { verifyStaffVideoAccess } from './lib/imweb-staff-video-verification.mjs';

export { verifyStaffVideoAccess };

export async function runStaffVideoVerification({ run = staffImweb, directory = STAFF_VIDEO_DIR,
  onlyMemberCode = '', expectedGroupCodes = [], acquireLock = acquireStudioMateBrowserLock, io = fs } = {}) {
  const release = await acquireLock({ lockPath: MEMBER_GROUP_LOCK, owner: 'imweb-staff-video-verification',
    waitMs: 0, staleMs: 600000 });
  let temporary;
  try {
    const state = JSON.parse(io.readFileSync(path.join(directory, 'state.json'), 'utf8'));
    const result = verifyStaffVideoAccess({ run, state, onlyMemberCode, expectedGroupCodes });
    temporary = path.join(directory, `.verification-${randomUUID()}.tmp`);
    io.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    io.renameSync(temporary, path.join(directory, 'verification.json'));
    temporary = undefined;
    return result;
  } finally {
    try {
      if (temporary) try { io.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } finally { await release(); }
  }
}

export async function main(args = process.argv.slice(2), options = {}) {
  let onlyMemberCode = '';
  const expectedGroupCodes = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--member-code' && !onlyMemberCode && /^m[0-9a-f]+$/.test(args[i + 1] || '')) onlyMemberCode = args[++i];
    else if (args[i] === '--expected-group' && args[i + 1] && !args[i + 1].startsWith('--')) expectedGroupCodes.push(args[++i]);
    else throw Error('Unsupported staff verification argument');
  }
  const result = await runStaffVideoVerification({ ...options, onlyMemberCode, expectedGroupCodes });
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('Staff video independent verification failed; completion not confirmed'); process.exitCode = 1;
});
