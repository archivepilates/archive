import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const admin = require('../firebase/kangsain-functions/functions/node_modules/firebase-admin');
const { v1 } = require('../firebase/kangsain-functions/functions/node_modules/@google-cloud/firestore');
const { values: args } = parseArgs({ options: {
  owner: { type: 'string' }, source: { type: 'string' }, from: { type: 'string' },
  until: { type: 'string' }, output: { type: 'string' }, apply: { type: 'boolean', default: false },
} });
if (!args.owner || !args.source || !args.output || !/^[A-Za-z0-9_-]{1,100}$/.test(args.source)) {
  throw Error('Required: --owner UID --source NOTE_ID --output PRIVATE_DIRECTORY [--from ISO --until ISO] [--apply]');
}
if (process.env.GOOGLE_CLOUD_PROJECT !== 'archive-pilates') throw Error('Set GOOGLE_CLOUD_PROJECT=archive-pilates explicitly.');
const output = resolve(args.output);
await mkdir(output, { recursive: true, mode: 0o700 });
admin.initializeApp({ projectId: 'archive-pilates' });
const db = admin.firestore();
const client = new v1.FirestoreClient();
const database = 'projects/archive-pilates/databases/(default)';
const sourceRef = db.collection('sequenceNotes').doc(args.source);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const persist = (name, value) => writeFile(resolve(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const semantic = (state) => { const result = structuredClone(state); delete result.id; return hash(result); };
const time = (value) => Math.floor(Date.parse(value) / 60000) * 60000;
const readCache = new Map();

async function historical(collection, id, at) {
  const key = `${collection}/${id}@${at}`;
  if (readCache.has(key)) return readCache.get(key);
  const stream = client.batchGetDocuments({ database,
    documents: [`${database}/documents/${collection}/${id}`], readTime: { seconds: at / 1000, nanos: 0 } });
  let found = null;
  for await (const response of stream) {
    if (response.found) found = response.found.fields;
  }
  readCache.set(key, found);
  return found;
}
async function noteAt(at) {
  const fields = await historical('sequenceNotes', args.source, at);
  if (!fields || fields.deleted?.booleanValue) return null;
  if (fields.ownerUid?.stringValue !== args.owner) throw Error('Historical owner mismatch.');
  const state = JSON.parse(fields.payload.stringValue);
  if (state.id !== args.source || !state.moves || !state.title) throw Error('Invalid historical payload.');
  return { at, state, revision: Number(fields.revision.integerValue) };
}
async function audit() {
  const begin = time(args.from), end = time(args.until);
  if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin || end - begin > 7 * 86400000) throw Error('Provide a valid bounded PITR interval of at most 7 days.');
  const before = await sourceRef.get();
  if (!before.exists || before.data().ownerUid !== args.owner || before.data().deleted) throw Error('Active source owner required.');
  const notes = await db.collection('sequenceNotes').where('ownerUid', '==', args.owner).get();
  const images = await db.collection('sequenceNoteImages').where('ownerUid', '==', args.owner).get();
  await persist('before.json', { sourceUpdateTime: before.updateTime.toDate().toISOString(),
    notes: notes.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    images: images.docs.map((doc) => ({ id: doc.id, data: doc.data() })) });
  const samples = [];
  for (let at = begin; at <= end; at = Math.min(at + 3600000, end)) {
    const sample = await noteAt(at);
    if (sample) samples.push(sample);
    if (at === end) break;
  }
  const terminal = [];
  for (let index = 1; index < samples.length; index++) {
    const prior = samples[index - 1], next = samples[index];
    if (prior.state.title === next.state.title) continue;
    let low = prior.at, high = next.at;
    // PITR older than one hour is minute-granular. Find the last old-title minute.
    while (high - low > 60000) {
      const middle = Math.floor((low + high) / 120000) * 60000;
      const sample = await noteAt(middle);
      if (sample?.state.title === prior.state.title) low = middle;
      else high = middle;
    }
    terminal.push(await noteAt(low));
  }
  const existing = new Set(notes.docs.filter((doc) => !doc.data().deleted).map((doc) => semantic(JSON.parse(doc.data().payload))));
  const recovered = [];
  for (const version of terminal) {
    if (existing.has(semantic(version.state))) continue;
    const id = `recovered_${hash([args.source, version.state]).slice(0, 48)}`;
    const state = { ...version.state, id };
    const assets = [];
    for (const move of Object.values(state.moves).flat()) {
      if (!move.image || assets.some((asset) => asset.hash === move.image)) continue;
      if (!/^[a-f0-9]{64}$/.test(move.image)) throw Error('Unexpected image reference.');
      const fields = await historical('sequenceNoteImages', `${args.source}_${move.image}`, version.at);
      if (fields?.ownerUid?.stringValue !== args.owner || fields?.noteId?.stringValue !== args.source || !fields?.dataUrl?.stringValue) throw Error('Historical image unavailable.');
      assets.push({ hash: move.image, dataUrl: fields.dataUrl.stringValue });
    }
    recovered.push({ id, state, assets, historicalReadTime: new Date(version.at).toISOString(), historicalRevision: version.revision });
    existing.add(semantic(state));
  }
  const plan = { source: args.source, owner: args.owner, sourcePayloadHash: hash(before.data()),
    sourceUpdateTime: before.updateTime.toDate().toISOString(), recovered };
  await persist('samples.json', samples);
  await persist('plan.json', plan);
  console.log(JSON.stringify({ mode: 'audit', hourlySamples: samples.length, recovered: recovered.map((item) => ({ title: item.state.title, moves: Object.values(item.state.moves).flat().length, historicalReadTime: item.historicalReadTime, historicalRevision: item.historicalRevision })) }));
}
async function apply() {
  const plan = JSON.parse(await readFile(resolve(output, 'plan.json'), 'utf8'));
  if (plan.source !== args.source || plan.owner !== args.owner) throw Error('Plan scope mismatch.');
  if (!Array.isArray(plan.recovered) || plan.recovered.length > 100) throw Error('Invalid recovery plan.');
  const results = [];
  for (const item of plan.recovered) {
    if (!/^recovered_[a-f0-9]{48}$/.test(item.id) || item.state?.id !== item.id || !item.state.moves || !Array.isArray(item.assets)) throw Error('Invalid recovery identity or payload.');
    const payload = JSON.stringify(item.state);
    if (Buffer.byteLength(payload) > 180000 || item.assets.length > 100) throw Error('Recovery payload exceeds storage bounds.');
    for (const asset of item.assets) {
      if (!/^[a-f0-9]{64}$/.test(asset.hash) || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(asset.dataUrl)
        || Buffer.from(asset.dataUrl.split(',')[1], 'base64').length > 65536
        || createHash('sha256').update(asset.dataUrl).digest('hex') !== asset.hash) throw Error('Invalid recovery image.');
    }
    const ref = db.collection('sequenceNotes').doc(item.id);
    const result = await db.runTransaction(async (transaction) => {
      const source = await transaction.get(sourceRef);
      const existing = await transaction.get(ref);
      if (hash(source.data()) !== plan.sourcePayloadHash) throw Error('Current note changed since audit. Re-audit before restoring.');
      if (existing.exists) {
        if (existing.data().ownerUid === args.owner && existing.data().payload === payload && !existing.data().deleted) return 'already-restored';
        throw Error('Recovery ID exists with different contents. No overwrite allowed.');
      }
      for (const asset of item.assets) transaction.create(db.collection('sequenceNoteImages').doc(`${item.id}_${asset.hash}`), { ownerUid: args.owner, noteId: item.id, dataUrl: asset.dataUrl });
      transaction.create(ref, { ownerUid: args.owner, revision: 1, deleted: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), payload,
        title: item.state.title, teacher: item.state.teacher || '', date: item.state.date || '',
        equipment: item.state.equipment === '기타' ? item.state.equipmentOther || '' : item.state.equipment || '',
        goal: item.state.goal || '', moveCount: Object.values(item.state.moves).flat().length });
      return 'created';
    });
    const saved = await ref.get();
    if (saved.data().payload !== payload || saved.data().ownerUid !== args.owner) throw Error('Recovery readback mismatch.');
    for (const asset of item.assets) {
      const savedAsset = await db.collection('sequenceNoteImages').doc(`${item.id}_${asset.hash}`).get();
      if (savedAsset.data()?.ownerUid !== args.owner || savedAsset.data()?.noteId !== item.id || savedAsset.data()?.dataUrl !== asset.dataUrl) throw Error('Recovery image readback mismatch.');
    }
    results.push({ id: item.id, title: item.state.title, result });
  }
  const after = await sourceRef.get();
  if (hash(after.data()) !== plan.sourcePayloadHash) throw Error('Original source changed during recovery.');
  const notes = await db.collection('sequenceNotes').where('ownerUid', '==', args.owner).get();
  const evidence = { results, originalPreserved: true, activeCount: notes.docs.filter((doc) => !doc.data().deleted).length,
    deletedCount: notes.docs.filter((doc) => doc.data().deleted).length, completedAt: new Date().toISOString() };
  await persist('result.json', evidence);
  console.log(JSON.stringify(evidence));
}
try { if (args.apply) await apply(); else await audit(); }
finally { await client.close(); await admin.app().delete(); }
