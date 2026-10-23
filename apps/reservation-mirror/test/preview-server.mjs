// Synthetic browser-test harness only. Docker and Hosting never include this server or its bundle.
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile, mkdir, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {DateTime} from 'luxon';
const output = new URL('../.runtime/preview/', import.meta.url);
await mkdir(output, {recursive: true});
await build({entryPoints: [fileURLToPath(new URL('../web/app.js', import.meta.url))], bundle: true, format: 'esm', outfile: fileURLToPath(new URL('app.js', output)), alias: {'firebase/auth': fileURLToPath(new URL('./preview-auth.mjs', import.meta.url)), 'firebase/app': fileURLToPath(new URL('./preview-app.mjs', import.meta.url))}});
for (const name of ['index.html', 'style.css']) await copyFile(new URL('../web/' + name, import.meta.url), new URL(name, output));
await copyFile(new URL('../../../core/icons/archive-pilates-icon-192.png', import.meta.url), new URL('symbol.png', output));
const now = DateTime.now().setZone('Asia/Seoul');
const week = now.startOf('week');
const day = now.toISODate(), at = now.toISO();
const snapshotId = `synthetic-browser-preview-${week.toISODate()}-${randomBytes(8).toString('hex')}`;
const members = Array.from({length: 55}, (_, i) => ({id: 'm' + (i + 1), name: '가상회원 ' + String(i + 1).padStart(2, '0'), phone: 'TEST-' + String(i + 1), status: 'active'}));
const pass = {id: 't1', memberId: 'm1', memberName: members[0].name, title: '합성 그룹 20회', totalUnits: 20, remainingUnits: 12, bookableUnits: 10, cancellableUnits: null, validFrom: week.toISODate(), validThrough: now.plus({days: 90}).toISODate(), status: 'active', sourceAsOf: day, identityKind: 'source_snapshot_row'};
const staff = Array.from({length: 3}, (_, i) => ({id: `s${i + 1}`, name: `가상 강사 ${i + 1}`, active: true}));
const slots = [[8, 0], [9, 0], [9, 10], [10, 0], [11, 0], [12, 0], [15, 0], [17, 0], [18, 0], [20, 0]];
const titles = ['합성 리포머', '합성 체어', '합성 바렐'];
const occurrences = Array.from({length: 7}, (_, weekday) => slots.map(([hour, minute], slot) => {
  const start = week.plus({days: weekday}).set({hour, minute});
  const index = weekday * slots.length + slot;
  return {id: `c${index + 1}`, title: titles[slot % titles.length], startAt: start.toISO(), endAt: start.plus({minutes: 50}).toISO(), localDate: start.toISODate(), staffName: staff[slot % staff.length].name, roomName: `테스트룸 ${slot % 2 + 1}`, capacity: 6, occupiedCount: 2 + slot % 4, waitingCount: slot % 3, state: 'open'};
})).flat();
const statuses = ['booked', 'booking_confirmed', 'booking_waiting', 'attendance', 'absence', 'noshow'];
const bookings = occurrences.map((occurrence, i) => {
  const member = members[i % members.length];
  return {id: `b${i + 1}`, memberId: member.id, memberName: member.name, occurrenceId: occurrence.id, title: occurrence.title, startAt: occurrence.startAt, endAt: occurrence.endAt, staffName: occurrence.staffName, status: statuses[i % statuses.length], localDate: occurrence.localDate};
});
const data = {members, entitlements: [pass, {...pass, id: 'history_1', identityKind: 'historical_snapshot_not_permanent_ticket_id', sourceAsOf: week.minus({days: 150}).toISODate()}], bookings, occurrences, staff, products: [{id: 'p1', title: '합성 그룹 20회', productType: 'T', availableClassType: 'G', totalUnits: 20}]};
const cursors = new Map();
const key = (value) => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
const nameKey = (row) => key(row.name || row.memberName || row.title);
const problem = (status, code) => { throw Object.assign(new Error(code), {status, code}); };
const validId = (value) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value, {zone: 'Asia/Seoul'}).isValid;

function list(params) {
  const entity = params.get('entity');
  if (!Object.hasOwn(data, entity)) problem(400, 'ENTITY_INVALID');
  const limit = Number(params.get('limit') || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) problem(400, 'LIMIT_INVALID');
  const search = key(params.get('search'));
  if (search.length > 60) problem(400, 'SEARCH_INVALID');
  const memberId = params.get('memberId'), status = params.get('status');
  if (memberId && !['entitlements', 'bookings'].includes(entity)) problem(400, 'FILTER_INVALID');
  if (memberId && (search || status && status !== 'all')) problem(400, 'FILTER_COMBINATION_UNSUPPORTED');
  if (memberId && !validId(memberId)) problem(400, 'ID_INVALID');
  if (entity === 'bookings' && status && !['all', 'booked', 'after'].includes(status)) problem(400, 'STATUS_INVALID');
  const dated = ['bookings', 'occurrences'].includes(entity);
  const from = dated ? params.get('from') : null, to = dated ? params.get('to') : null;
  if (from && !validDay(from) || to && !validDay(to) || from && to && from > to) problem(400, 'DATE_INVALID');
  const rows = data[entity].filter((row) => {
    if (search && !nameKey(row).startsWith(search)) return false;
    if (memberId && row.memberId !== memberId) return false;
    if (from && row.localDate < from || to && row.localDate > to) return false;
    if (entity === 'bookings' && status && status !== 'all') {
      const group = statuses.slice(0, 3).includes(row.status) ? 'booked' : 'after';
      if (group !== status) return false;
    }
    return true;
  }).sort((a, b) => {
    const primary = dated && !search ? a.localDate.localeCompare(b.localDate) : nameKey(a).localeCompare(nameKey(b));
    return primary || (dated ? a.startAt.localeCompare(b.startAt) : 0) || a.id.localeCompare(b.id, 'en', {numeric: true});
  });
  const binding = new URLSearchParams(params); binding.delete('after'); binding.sort();
  const query = binding.toString(), after = params.get('after');
  let offset = 0;
  if (after) {
    const cursor = cursors.get(after);
    if (!cursor) problem(400, 'CURSOR_INVALID');
    if (cursor.snapshot !== snapshotId || cursor.query !== query) problem(409, 'CURSOR_STALE');
    offset = cursor.offset;
  }
  const items = rows.slice(offset, offset + limit);
  let nextCursor = null;
  if (offset + limit < rows.length) {
    nextCursor = randomBytes(24).toString('base64url');
    cursors.set(nextCursor, {snapshot: snapshotId, query, offset: offset + limit});
  }
  return {items, nextCursor, snapshotId};
}

const server = http.createServer(async (req, res) => {
  const json = (value, status = 200) => {res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(JSON.stringify(value));};
  try {
  const url = new URL(req.url, 'http://127.0.0.1:4313');
  if (req.method !== 'GET') return json({code: 'READ_ONLY_MIRROR'}, 405);
  if (url.pathname === '/api/health') return json({status: 'ok', mode: 'read_only_mirror', dispatchEnabled: false, source: 'synthetic'});
  if (url.pathname === '/api/config') return json({mode: 'read_only_mirror', loginEmailDomain: 'archivepilates.com', loginEmailPrefix: 'p', firebase: {apiKey: 'SYNTHETIC_PREVIEW', authDomain: 'demo.invalid', projectId: 'demo-synthetic'}});
  if (url.pathname === '/api/session') return json({role: 'manager', staffName: '합성 검증 운영자'});
  if (url.pathname === '/api/summary') return json({mode: 'read_only_mirror', snapshot: {id: snapshotId, capturedAt: at, sourceUpdatedAt: at, counts: Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])), coverage: ['합성 데이터 화면 검증. 실제 회원 자료 아님.'], complete: false}, rea: {version: '6.7.0', applied: ['합성 회귀 검증']}});
  if (url.pathname === '/api/list') return json(list(url.searchParams));
  if (url.pathname === '/api/member') {
    const id = url.searchParams.get('id');
    if (!id || !validId(id)) return json({code: 'ID_INVALID'}, 400);
    const member = members.find((row) => row.id === id);
    if (!member) return json({code: 'MEMBER_NOT_FOUND'}, 404);
    const entitlements = list(new URLSearchParams({entity: 'entitlements', memberId: id, limit: '100'}));
    return json({member, entitlements: entitlements.items, entitlementsNextCursor: entitlements.nextCursor, bookings: list(new URLSearchParams({entity: 'bookings', memberId: id, limit: '50'}))});
  }
  const files = {'/': ['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/style.css':['style.css','text/css'], '/symbol.png':['symbol.png','image/png']};
  const f = files[url.pathname]; if (!f) return json({code: 'NOT_FOUND'}, 404);
  const bytes = await readFile(new URL(f[0], output));
  res.writeHead(200, {'Content-Type': f[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(bytes);
  } catch (error) {
    json({code: error.code && error.status ? error.code : 'PREVIEW_UNAVAILABLE'}, error.status || 503);
  }
});
server.listen(4313, '127.0.0.1', () => console.log('Synthetic UI preview on loopback 4313 only.'));
const stop = () => {server.close(); server.closeAllConnections();}; process.on('SIGTERM', stop); process.on('SIGINT', stop);
