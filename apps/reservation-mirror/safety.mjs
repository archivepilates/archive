import {Firestore} from '@google-cloud/firestore';
export const PROJECT = 'archive-pilates';
export const DATABASE = 'reservation-mirror';
export const MODE = 'read_only_mirror';
export function validateTarget(env = process.env) {
  if (env.GOOGLE_CLOUD_PROJECT !== PROJECT || env.RESERVATION_DATABASE !== DATABASE) throw new Error('Explicit isolated mirror database required. No default database fallback.');
  if (env.RESERVATION_MODE !== MODE || env.RESERVATION_DISPATCH_ENABLED !== 'false') throw new Error('Read-only mirror with dispatch disabled required.');
  if (env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d{4,5}$/.test(env.FIRESTORE_EMULATOR_HOST)) throw new Error('Only loopback test emulators allowed.');
  return {projectId: PROJECT, databaseId: DATABASE, mode: MODE, dispatchEnabled: false};
}
export function createMirrorDb(env = process.env) { validateTarget(env); return new Firestore({projectId: PROJECT, databaseId: DATABASE}); }
