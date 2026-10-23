import {Firestore, FieldPath} from '@google-cloud/firestore';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createMirrorDb, validateTarget} from './safety.mjs';
import {viewModel, ENTITIES} from './view-model.mjs';

const digest = (...v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const iso = (v) => v?.toDate?.().toISOString() || (typeof v === 'string' ? v : null);
const priority = (id) => /^\d+$/.test(String(id)) ? 0 : String(id).startsWith('usage_') ? 1 : String(id).startsWith('excel_') ? 2 : 3;
const sources = ['memberProfiles', 'bookings', 'lectures', 'staffs', 'memberTicketHolds', 'studiomateDeletedClassLogs'];
export function bookingIdentity(sid, row, nativeEvents) {
  const native = String(row.sourceBookingId || row.bookingId || sid), hasNative = /^\d+$/.test(native);
  const parts = [row.memberId, iso(row.lectureStartAt || row.startAt), row.staffId || row.staffName, row.lectureTitle || row.title];
  const eventKeys = [row.canonicalBookingKey ? digest(row.canonicalBookingKey) : null, parts.every(Boolean) ? digest(...parts) : null].filter(Boolean);
  if (hasNative) for (const key of eventKeys) nativeEvents.add(key);
  if (!hasNative && eventKeys.some(key => nativeEvents.has(key))) return null;
  return {id: hasNative ? 'b_native_' + native : 'b_fallback_' + digest(row.canonicalBookingKey || row.bookingId || sid), hasNative};
}
export function memberIdentity(sid, row, aliases) {
  const native = row.studiomateMemberId || (!String(row.memberId || sid).startsWith('excel_') ? row.memberId || sid : null);
  const mid = (native && aliases.get(String(native))) || 'm_' + String(native || sid).replace(/[^A-Za-z0-9_-]/g, '_');
  for (const alias of [sid, row.memberId, native].filter(Boolean)) {
    const old = aliases.get(String(alias)); if (old && old !== mid) throw new Error('Ambiguous explicit member identity link');
    aliases.set(String(alias), mid);
  }
  return mid;
}
export async function importSource({apply = false, historicFile} = {}) {
  validateTarget();
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Cloud source importer cannot run in emulator mode.');
  const source = new Firestore({projectId: 'archive-pilates', databaseId: '(default)'});
  const target = createMirrorDb();
  const id = 'snapshot-' + new Date().toISOString().replace(/[^\dTZ]/g, '') + '-' + randomUUID().slice(0, 8);
  const root = target.doc(`mirrorSnapshots/${id}`), runAt = new Date().toISOString();
  const manifest = {status: 'PREPARING', capturedAt: runAt, sourceUpdatedAt: null, sourceDatabase: '(default)', sourceSystem: 'StudioMate normalized canonical records', counts: Object.fromEntries(ENTITIES.map(k => [k, 0])), sourceCounts: {}, sourceEndCounts: {}, coverage: [], complete: false, mode: 'read_only_mirror', dispatchEnabled: false, quality: {orphanBookings: 0, unidentifiedTicketIds: 0, duplicateBookingsSuppressed: 0, unresolvedHoldings: 0}, sourceHashes: {}};
  const aliases = new Map(), memberRows = new Map(), meta = new Map(), nativeEvents = new Set(), unresolved = new Map();
  let historicalData = null;
  let writer;
  let errors = 0;
  try {
    for (const name of sources) manifest.sourceCounts[name] = (await source.collection(name).where('studioId', '==', '5330').count().get()).data().count;
    if (apply) {
      await target.runTransaction(async tx => {
        const lock = target.doc('mirrorMeta/importLock'), row = await tx.get(lock);
        if (row.data()?.leaseUntil > Date.now()) throw new Error('Another mirror import is in progress.');
        tx.set(lock, {owner: id, leaseUntil: Date.now() + 3600000});
        tx.create(root, manifest);
      });
      writer = target.bulkWriter({throttling: {initialOpsPerSecond: 100, maxOpsPerSecond: 300}});
      writer.onWriteError(e => { if (e.failedAttempts < 3 && [4, 8, 10, 14].includes(e.code)) return true; errors++; return false; });
    }
    async function put(entity, key, row, provenance, rank = 0) {
      const mkey = entity + ':' + key, previous = meta.get(mkey), time = provenance.updatedAt || '';
      if (previous && (previous.rank < rank || (previous.rank === rank && previous.time >= time))) { if (entity === 'bookings') manifest.quality.duplicateBookingsSuppressed++; return false; }
      if (previous && entity === 'bookings') manifest.quality.duplicateBookingsSuppressed++;
      if (!previous) manifest.counts[entity] = (manifest.counts[entity] || 0) + 1;
      meta.set(mkey, {rank, time});
      if (writer) writer.set(root.collection(entity).doc(key), {...row, id: key, _source: provenance}).catch(() => {});
      return true;
    }
    async function scan(name, handler) {
      let after = null, seen = 0;
      const hash = createHash('sha256');
      while (true) {
        let q = source.collection(name).where('studioId', '==', '5330').orderBy(FieldPath.documentId()).limit(1000);
        if (after) q = q.startAfter(after);
        const page = await q.get(); if (page.empty) break;
        for (const doc of page.docs) {
          const r = doc.data(), updatedAt = iso(doc.updateTime);
          hash.update(JSON.stringify([doc.id, updatedAt])); seen++;
          if (seen > 250000) throw new Error('Source safety limit exceeded');
          const p = {collection: name, sourceId: doc.id, updatedAt, observedAt: page.readTime.toDate().toISOString()};
          if (iso(r.syncedAt) > (manifest.sourceUpdatedAt || '')) manifest.sourceUpdatedAt = iso(r.syncedAt);
          await handler(doc.id, r, p);
        }
        if (writer) await writer.flush();
        after = page.docs.at(-1);
        if (page.size < 1000) break;
      }
      manifest.sourceHashes[name] = hash.digest('hex');
      manifest.sourceCounts[name + 'Read'] = seen;
      console.log(JSON.stringify({phase: 'source_scanned', collection: name, count: seen, mode: apply ? 'apply' : 'dry_run'}));
    }
    await scan('memberProfiles', async (sid, r, p) => {
      const mid = memberIdentity(sid, r, aliases);
      const row = viewModel('members', mid, r);
      const rank = priority(sid), fresh = iso(r.syncedAt) || iso(r.sourceUpdatedAt) || p.updatedAt, prev = memberRows.get(mid);
      if (!prev || fresh > prev.fresh || (fresh === prev.fresh && rank < prev.rank)) memberRows.set(mid, {row, r, p, rank, fresh});
    });
    async function projectMember(mid, m) {
      await put('members', mid, m.row, m.p, m.rank);
      for (const [index, t] of (m.r.activeTickets || []).entries()) {
        const native = /^\d+$/.test(String(t.userTicketId || '')) ? String(t.userTicketId) : null;
        if (!native) manifest.quality.unidentifiedTicketIds++;
        const tid = 't_' + digest(mid, native || [m.p.sourceId, index, t.name, iso(t.availableFrom)]);
        const row = viewModel('entitlements', tid, t, {memberId: mid, memberName: m.row.name});
        row.identityKind = native ? 'native_source_id' : 'source_snapshot_row';
        row.sourceAsOf = iso(m.r.syncedAt) || m.p.updatedAt;
        await put('entitlements', tid, row, m.p);
        const productId = /^\d+$/.test(String(t.ticketId || '')) ? String(t.ticketId) : null;
        const pid = 'p_' + digest(productId || [t.name, t.classType]);
        const product = viewModel('products', pid, {title: t.name, availableClassType: t.classType, totalUnits: t.maxCount});
        product.sourceType = productId ? 'issued_pass_product_reference' : 'derived_label_not_product_master';
        product.totalUnits = null;
        await put('products', pid, product, m.p);
      }
    }
    if (historicFile) {
      const file = await readFile(historicFile); historicalData = JSON.parse(file);
      manifest.historicFile = {sha256: createHash('sha256').update(file).digest('hex'), sourceAsOf: '2026-05-27', ticketRows: historicalData.ticketRows?.length || 0};
    }
    await scan('bookings', async (sid, r, p) => {
      const identity = bookingIdentity(sid, {...r, memberId: aliases.get(String(r.memberId)) || r.memberId}, nativeEvents);
      if (!identity) { manifest.quality.duplicateBookingsSuppressed++; return; }
      const {id, hasNative} = identity;
      const row = viewModel('bookings', id, r);
      const mid = aliases.get(String(r.memberId));
      row.memberId = mid || 'unlinked_' + digest(r.memberId || sid); row.sourceAsOf = iso(r.syncedAt) || p.updatedAt;
      row.identityKind = hasNative ? 'native_source_id' : 'canonical_fallback';
      const accepted = await put('bookings', id, row, p, priority(sid));
      if (accepted) {
        unresolved.delete(id);
        if (!mid && /^[A-Za-z0-9_-]{1,150}$/.test(String(r.memberId))) unresolved.set(id, {id, originalMemberId: String(r.memberId), row, p});
      }
    });
    // Older canonical profiles lack studioId. Only an explicit tenant-scoped booking foreign key may recover them.
    const missingIds = [...new Set([...unresolved.values()].map(r => r.originalMemberId))];
    for (let i = 0; i < missingIds.length; i += 100) {
      const docs = await source.getAll(...missingIds.slice(i, i + 100).map(id => source.collection('memberProfiles').doc(id)));
      for (const doc of docs) {
        if (!doc.exists) continue;
        const r = doc.data(); if (r.studioId != null && String(r.studioId) !== '5330') continue;
        const mid = memberIdentity(doc.id, r, aliases);
        const p = {collection: 'memberProfiles', sourceId: doc.id, updatedAt: iso(doc.updateTime), observedAt: new Date().toISOString(), scopeEvidence: 'explicit_booking_member_foreign_key'};
        const row = viewModel('members', mid, r);
        const rank = priority(doc.id), fresh = iso(r.syncedAt) || iso(r.sourceUpdatedAt) || p.updatedAt, prev = memberRows.get(mid);
        if (!prev || fresh > prev.fresh || (fresh === prev.fresh && rank < prev.rank)) memberRows.set(mid, {row, r, p, rank, fresh});
      }
    }
    for (const b of unresolved.values()) {
      const mid = aliases.get(b.originalMemberId); if (!mid) { manifest.quality.orphanBookings++; continue; }
      if (writer) writer.set(root.collection('bookings').doc(b.id), {...b.row, memberId: mid, _source: b.p}).catch(() => {});
    }
    for (const [mid, m] of memberRows) await projectMember(mid, m);
    for (const [index, t] of (historicalData?.ticketRows || []).entries()) {
      const mid = aliases.get(String(t.memberId)); if (!mid) continue;
      const tid = 'history_' + digest(t.ticketHistoryId || index, mid);
      const row = viewModel('entitlements', tid, t, {memberId: mid, memberName: memberRows.get(mid)?.row.name});
      row.identityKind = 'historical_snapshot_not_permanent_ticket_id'; row.sourceAsOf = '2026-05-27';
      await put('entitlements', tid, row, {collection: 'retained_ticket_history', updatedAt: '2026-05-27', fileHash: manifest.historicFile.sha256});
    }
    await scan('lectures', async (sid, r, p) => { const id = 'c_' + digest(r.lectureId || sid); await put('occurrences', id, viewModel('occurrences', id, r), p, priority(sid)); });
    await scan('staffs', async (sid, r, p) => { const id = 's_' + digest(r.studiomateStaffId || r.staffId || sid); await put('staff', id, viewModel('staff', id, r), p); });
    for (const name of ['memberTicketHolds', 'studiomateDeletedClassLogs']) await scan(name, async (sid, r, p) => {
      if (writer) writer.set(root.collection('sourceAux').doc(name + '_' + digest(sid)), {sourceId: sid, sourceCollection: name, date: r.date || null, title: r.title || null, status: r.status || null, _source: p}).catch(() => {});
    });
    if (writer) await writer.flush();
    if (errors) throw new Error('Mirror writes failed; active pointer preserved');
    for (const name of sources) manifest.sourceEndCounts[name] = (await source.collection(name).where('studioId', '==', '5330').count().get()).data().count;
    manifest.coverage = [
      'StudioMate 전체 원본이 아니라 기존 canonical DB의 보유 범위 미러입니다.',
      '회원·예약·수업·직원은 수집된 범위이며, 원본에서 누락된 과거 내역은 복구되지 않습니다.',
      '수강권은 현재 activeTickets와 2026-05-27 보관 이력입니다. 두 시점은 합산한 현재 잔여로 해석하지 않습니다.',
      '상품은 발급권의 상품 참조/라벨로 도출했습니다. 원본 상품 마스터 전체가 아닙니다.',
      '홀딩 전체 기간·고유 ID, 원본 결제·계약서·메모·건강 정보는 이 미러에 이전하지 않았습니다.',
      '복사는 관측 구간의 읽기이며 원본 전체의 단일 시점 트랜잭션 스냅샷이 아닙니다.'
    ];
    manifest.sourceChangedDuringCapture = sources.some(n => manifest.sourceCounts[n] !== manifest.sourceEndCounts[n]);
    manifest.verifiedAt = new Date().toISOString(); manifest.status = 'VERIFIED';
    if (apply) {
      for (const entity of ENTITIES) {
        const count = (await root.collection(entity).count().get()).data().count;
        if (count !== manifest.counts[entity]) throw new Error('Target count verification failed: ' + entity);
      }
      await target.runTransaction(async tx => {
        const lock = target.doc('mirrorMeta/importLock'), current = await tx.get(lock);
        if (current.data()?.owner !== id) throw new Error('Mirror lease changed');
        tx.set(root, manifest); tx.set(target.doc('mirrorMeta/current'), {snapshotId: id, verifiedAt: manifest.verifiedAt});
        tx.set(lock, {owner: id, leaseUntil: 0, status: 'done'});
      });
    }
    console.log(JSON.stringify({mode: apply ? 'applied' : 'dry_run', snapshotId: id, counts: manifest.counts, quality: manifest.quality, sourceChangedDuringCapture: manifest.sourceChangedDuringCapture}));
    return {id, manifest};
  } catch (error) {
    if (writer) await writer.flush();
    if (apply) {
      await root.set({status: 'FAILED', failedAt: new Date().toISOString(), reason: String(error.message).slice(0, 160)}, {merge: true});
      await target.runTransaction(async tx => {
        const lock = target.doc('mirrorMeta/importLock'), current = await tx.get(lock);
        if (current.data()?.owner === id) tx.set(lock, {owner: id, leaseUntil: 0, status: 'failed'});
      });
    }
    throw error;
  } finally {
    if (writer) await writer.close();
    await source.terminate(); await target.terminate();
  }
}
if (process.argv[1]?.endsWith('/import-source.mjs') || process.argv[1] === 'import-source.mjs') {
  if (process.argv.some(a => !['--apply'].includes(a) && a.startsWith('--'))) throw new Error('Unsupported importer option');
  await importSource({apply: process.argv.includes('--apply'), historicFile: '/Users/archivepilates/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-ticket-history-normalized-2026-05-27.json'});
}
