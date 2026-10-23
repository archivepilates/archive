import {Firestore} from '@google-cloud/firestore';
import {createMirrorDb} from './safety.mjs';
// Run with the serving identity, never the broad local importer/operator identity.
const target = createMirrorDb();
const source = new Firestore({projectId: 'archive-pilates', databaseId: '(default)'});
try {
  await target.doc('mirrorMeta/current').get();
  let denied = false;
  try { await source.doc('mirrorMeta/reservation_mirror_isolation_probe').get(); }
  catch (error) { if ([7, 403].includes(error.code)) denied = true; else throw error; }
  if (!denied) throw new Error('Serving identity can access operating database. Deployment must remain blocked.');
  console.log(JSON.stringify({namedDatabaseRead: 'allowed', operatingDatabaseRead: 'denied'}));
} finally {await target.terminate(); await source.terminate();}
