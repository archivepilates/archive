// Synthetic browser-test harness only. Docker and Hosting never include this server or its bundle.
import http from 'node:http';
import {readFile, mkdir, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const output = new URL('../.runtime/preview/', import.meta.url);
await mkdir(output, {recursive: true});
await build({entryPoints: [fileURLToPath(new URL('../web/app.js', import.meta.url))], bundle: true, format: 'esm', outfile: fileURLToPath(new URL('app.js', output)), alias: {'firebase/auth': fileURLToPath(new URL('./preview-auth.mjs', import.meta.url)), 'firebase/app': fileURLToPath(new URL('./preview-app.mjs', import.meta.url))}});
for (const name of ['index.html', 'style.css']) await copyFile(new URL('../web/' + name, import.meta.url), new URL(name, output));
await copyFile(new URL('../dist/symbol.png', import.meta.url), new URL('symbol.png', output));
const day = '2026-10-23', at = day + 'T09:00:00+09:00';
const members = Array.from({length: 55}, (_, i) => ({id: 'm' + (i + 1), name: '가상회원 ' + String(i + 1).padStart(2, '0'), phone: 'TEST-' + String(i + 1), status: 'active'}));
const pass = {id: 't1', memberId: 'm1', memberName: members[0].name, title: '합성 그룹 20회', totalUnits: 20, remainingUnits: 12, bookableUnits: 10, cancellableUnits: null, validFrom: day, validThrough: '2026-12-31', status: 'active', sourceAsOf: day, identityKind: 'source_snapshot_row'};
const data = {members, entitlements: [pass, {...pass, id: 'history_1', identityKind: 'historical_snapshot_not_permanent_ticket_id', sourceAsOf: '2026-05-27'}], bookings: [{id: 'b1', memberId: 'm1', memberName: members[0].name, occurrenceId: 'c1', title: '합성 리포머', startAt: at, endAt: day + 'T09:50:00+09:00', status: 'booking_waiting', localDate: day}], occurrences: [{id: 'c1', title: '합성 리포머', startAt: at, endAt: day + 'T09:50:00+09:00', localDate: day, staffName: '가상 강사', roomName: '테스트룸', capacity: 6, occupiedCount: 3, waitingCount: 1, state: 'open'}], staff: [{id: 's1', name: '가상 강사', active: true}], products: [{id: 'p1', title: '합성 그룹 20회', productType: 'T', availableClassType: 'G', totalUnits: 20}]};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4313');
  const json = v => {res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(v));};
  if (req.method !== 'GET') {res.writeHead(405); res.end(); return;}
  if (url.pathname === '/api/config') return json({mode: 'read_only_mirror', loginEmailDomain: 'archivepilates.com', loginEmailPrefix: 'p', firebase: {apiKey: 'SYNTHETIC_PREVIEW', authDomain: 'demo.invalid', projectId: 'demo-synthetic'}});
  if (url.pathname === '/api/session') return json({role: 'manager', staffName: '합성 검증 운영자'});
  if (url.pathname === '/api/summary') return json({mode: 'read_only_mirror', snapshot: {id: 'synthetic-browser-preview', capturedAt: at, sourceUpdatedAt: at, counts: Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])), coverage: ['합성 데이터 화면 검증. 실제 회원 자료 아님.'], complete: false}, rea: {version: '6.7.0', applied: ['합성 회귀 검증']}});
  if (url.pathname === '/api/list') {const rows = data[url.searchParams.get('entity')] || []; const search = url.searchParams.get('search') || ''; const selected = rows.filter(r=>!search || String(r.name || r.memberName || r.title).startsWith(search)); return json({items: selected.slice(url.searchParams.has('after') ? 50 : 0, url.searchParams.has('after') ? 100 : 50), nextCursor: selected.length > 50 && !url.searchParams.has('after') ? 'second-page' : null, snapshotId: 'synthetic-browser-preview'});}
  if (url.pathname === '/api/member') return json({member: members[0], entitlements: data.entitlements, bookings: {items: data.bookings, nextCursor: null}});
  const files = {'/': ['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/style.css':['style.css','text/css'], '/symbol.png':['symbol.png','image/png']};
  const f = files[url.pathname]; if (!f) {res.writeHead(404); res.end(); return;}
  res.writeHead(200, {'Content-Type': f[1]}); res.end(await readFile(new URL(f[0], output)));
});
server.listen(4313, '127.0.0.1', () => console.log('Synthetic UI preview on loopback 4313 only.'));
const stop = () => {server.close(); server.closeAllConnections();}; process.on('SIGTERM', stop); process.on('SIGINT', stop);
