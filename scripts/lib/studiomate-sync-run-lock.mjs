import { acquireStudioMateBrowserLock } from './studiomate-browser-lock.mjs';

export async function acquireStudioMateSyncRun({ acquire = acquireStudioMateBrowserLock, waitMs = 0 } = {}) {
  try {
    return { acquired: true, release: await acquire({
      lockPath: '~/ArchiveIN/automation/locks/studiomate-excel-sync-run.lock',
      owner: 'studiomate-excel-sync-run', waitMs,
    }) };
  } catch (error) {
    if (String(error?.message).includes('profile is locked by')) return { acquired: false };
    throw error;
  }
}
