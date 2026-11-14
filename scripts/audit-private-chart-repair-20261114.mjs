import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createLiveReader } from '../services/archivepilates-mcp/src/live-browser.mjs';

assert.equal(process.argv.length, 2, 'Read-only audit takes no arguments');
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'archive-pilates');
const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');
const app = admin.initializeApp({ projectId: 'archive-pilates' }, 'chart-repair-audit');
const db = app.firestore();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ids = ['plc_283112173', 'plc_283112178'];
const profileId = 'excel_6d84bbaa36f30f05', nativeId = '5114917';
const rootId = '22dd49eae4bf809da7e7d6953e41eb86';
const reader = createLiveReader({ budgetMs: 90000 });
const out = path.join(os.homedir(), 'ArchiveIN/operations/private-chart-repair-20261114');
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
try {
  const profile = (await db.doc(`memberProfiles/${profileId}`).get()).data();
  assert.ok(profile?.phone && profile?.name);
  const found = await reader.findMembers(profile.phone, true);
  assert.equal(found.members.length, 1, 'Native identity must be unique');
  const member = found.members[0];
  assert.equal(member.memberId, nativeId);
  assert.equal(member.name, profile.name);
  assert.equal(member.phone, profile.phone);
  const bookings = await reader.getBookings(member, { startDate: '2026-11-17', endDate: '2026-11-20' });
  assert.equal(bookings.coverage?.complete, true);
  const selected = ids.map(id => {
    const rows = bookings.records.filter(b => String(b.bookingId) === id.slice(4));
    assert.equal(rows.length, 1, 'Expected native booking exactly once');
    const b = rows[0];
    return Object.fromEntries(['bookingId', 'lectureDate', 'startAt', 'endAt', 'staffName', 'lessonType', 'sourceStatus', 'userTicketId'].map(k => [k, b[k] ?? null]));
  });
  const proof = { memberId: profileId, nativeMemberId: nativeId, queryKind: 'full_phone',
    uniqueMatchCount: 1, liveReadback: true, sourceKind: 'studiomate_rendered_dom',
    phoneSha256: createHash('sha256').update(profile.phone).digest('hex'), nameSha256: hash(profile.name),
    checkedAt: found.checkedAt, bookingCheckedAt: bookings.checkedAt, coverage: bookings.coverage, bookings: selected };
  const snapshots = await db.getAll(...ids.flatMap(id => [db.doc(`privateLessonChartRecords/${id}`), db.doc(`privateLessonChartRequests/${id}`), db.doc(`bookings/${id.slice(4)}`)]),
    db.doc(`memberProfiles/${profileId}`), db.doc('staffs/2222464'),
    db.doc(`studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${profileId}`),
    db.doc('workLanes/private-chart-repair-20261114/reports/source-repair'));
  const byPath = Object.fromEntries(snapshots.map(s => [s.ref.path, s.data() || null]));
  const peers = await db.collection('privateLessonChartRecords').where('memberId', '==', profileId).limit(100).get();
  assert.ok(peers.size < 100, 'Peer coverage incomplete');
  const { stableHash } = require('tsx/cjs') && require('./src/utils/hash.ts');
  const bindingKey = stableHash({ root: rootId, memberId: nativeId });
  const titleKey = stableHash({ root: rootId, title: `${profile.name.trim()}님`.replace(/\s+/g, '') });
  const bindings = await db.getAll(db.doc(`syncStates/privateNotionMember_${bindingKey}`), db.doc(`syncStates/privateNotionMemberTitle_${titleKey}`));
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const secret = await client.request({ url: 'https://secretmanager.googleapis.com/v1/projects/archive-pilates/secrets/NOTION_TOKEN/versions/latest:access' });
  const token = Buffer.from(secret.data.payload.data, 'base64').toString('utf8').trim();
  const notion = async endpoint => {
    const r = await fetch('https://api.notion.com/v1/' + endpoint, { headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' }, signal: AbortSignal.timeout(25000) });
    assert.ok(r.ok, `Notion read failed ${r.status}`);
    return r.json();
  };
  const root = await notion(`pages/${rootId}`);
  assert.ok(!root.archived && !root.in_trash);
  const folders = [], blockTypes = {}, cursors = new Set();
  let requests = 0;
  async function walk(id, depth = 0) {
    assert.ok(depth < 8 && ++requests < 100, 'Notion coverage budget exceeded');
    let cursor = '';
    do {
      const page = await notion(`blocks/${id}/children?page_size=100${cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''}`);
      assert.ok(Array.isArray(page.results));
      for (const b of page.results) {
        blockTypes[b.type] = (blockTypes[b.type] || 0) + 1;
        if (b.type === 'child_page') folders.push({ id: b.id, title: b.child_page.title });
        else if (b.has_children && b.type !== 'child_database') await walk(b.id, depth + 1);
      }
      cursor = page.has_more ? page.next_cursor : '';
      if (page.has_more) { assert.ok(cursor && !cursors.has(cursor)); cursors.add(cursor); }
    } while (cursor);
  }
  await walk(rootId);
  const matches = folders.filter(f => f.title.replace(/\s|님/g, '') === profile.name.replace(/\s|님/g, ''));
  // Name matches are review candidates only, never page-ownership evidence.
  const notionProof = { checkedAt: new Date().toISOString(), rootId, complete: true,
    rootActive: true, folderCount: folders.length, blockTypes, matchingFolderIds: matches.map(f => f.id),
    rootChildrenHash: hash(folders), peerCount: peers.size,
    peers: peers.docs.map(s => { const r = s.data(); return { id: s.id, staffId: r.staffId, hasPage: Boolean(r.notionSync?.instructorPageId || r.notionSync?.pageId || r.notionProjectionControl?.memberPageId), sourceHash: hash(r) }; }),
    bindings: bindings.map(s => ({ path: s.ref.path, exists: s.exists, status: s.data()?.status || null, pageId: s.data()?.pageId || null })) };
  const records = ids.map(id => {
    const r = byPath[`privateLessonChartRecords/${id}`], q = byPath[`privateLessonChartRequests/${id}`], b = byPath[`bookings/${id.slice(4)}`];
    assert.ok(r && q && b);
    const select = (row, keys) => Object.fromEntries(keys.map(k => [k, row[k] ?? null]));
    return { id, recordHash: hash(r), requestHash: hash(q), bookingHash: hash(b),
      businessHash: hash(Object.fromEntries(Object.entries(r).filter(([k]) => !['notionSync', 'notionProjectionLease'].includes(k)))),
      record: select(r, ['recordId', 'requestId', 'memberId', 'staffId', 'studioId', 'bookingId', 'lessonDate', 'lessonStartAt', 'gptStatus', 'preSubmittedAt', 'postSubmittedAt', 'cancelledAt', 'notionSync', 'notionProjectionLease', 'notionProjectionControl']),
      hasAnswers: ['prePlan', 'postRecord', 'preAnswers', 'postAnswers'].some(k => r[k] && Object.keys(r[k]).length),
      exactPhones: [r.memberPhone, q.memberPhone, b.memberPhone].every(p => p === profile.phone),
      request: select(q, ['requestId', 'memberId', 'staffId', 'studioId', 'bookingId', 'status', 'preStatus', 'postStatus', 'cancelledAt']),
      booking: select(b, ['bookingId', 'sourceBookingId', 'canonicalBookingKey', 'memberId', 'staffId', 'lectureDate', 'lectureStartAt', 'sourceStatus', 'appStatus', 'attendanceStatus']) };
  });
  const audit = { observedAt: new Date().toISOString(), proof, notionProof, records,
    profile: { memberId: profileId, nativePointer: profile.studiomateMemberId || null, sourceHash: hash(profile) },
    staff: { path: 'staffs/2222464', ...Object.fromEntries(['staffId', 'studioId', 'active', 'role', 'name'].map(k => [k, byPath['staffs/2222464']?.[k] ?? null])) },
    lookup: { status: byPath[`studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${profileId}`]?.status || null, sourceHash: hash(byPath[`studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${profileId}`]) },
    priorRepairExists: Boolean(byPath['workLanes/private-chart-repair-20261114/reports/source-repair']) };
  const filename = `audit-${Date.now()}.json`;
  save(filename, audit);
  console.log(JSON.stringify({ file: path.join(out, filename), ...audit }));
} finally { await reader.close(); await app.delete(); }
