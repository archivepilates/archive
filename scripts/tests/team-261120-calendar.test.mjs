import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TEAM_EVENT, TEAM_CALENDAR_DIR, buildTeamCalendar, foldIcsLine, icsEscape,
  renderTeamCalendarHtml, renderTeamCalendarIcs } from '../build-team-261120-calendar.mjs';
import { TEAM_CALENDAR_FILES as paths, teamCalendarManifest, releaseArguments, assertCleanMain,
  assertCalendarSource, releaseTeamCalendar } from '../release-team-261120-calendar.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const unfold = text => text.replace(/\r\n[ \t]/g, '');
const stamp = '20261029T000000Z';
const source = () => Object.fromEntries(paths.map(f => [f, fs.readFileSync(path.join(ROOT, 'archivein' + f))]));
const version = 'sites/archive-pilates-in/versions/baseline';

test('immutable November 20 schedule uses the approved topic rather than a native description', () => {
  assert.equal(TEAM_EVENT.managementId, 'team-261120');
  assert.equal(TEAM_EVENT.title, 'ARCHIVE PILATES Team 강사레슨 · ARCHIVE METHOD #1 직장인 증후군');
  assert.equal(TEAM_EVENT.topicSource, 'operator-approved');
  assert.equal(TEAM_EVENT.topic, 'ARCHIVE METHOD #1 직장인 증후군');
  assert.equal(TEAM_EVENT.dateText, '2026년 11월 20일(금)');
  assert.equal(TEAM_EVENT.timeText, '14:00~15:50');
  assert.equal(TEAM_EVENT.composition, '민진쌤 체어\n은영쌤 바렐');
  assert.equal(new Date(`${TEAM_EVENT.date}T00:00:00Z`).getUTCDay(), 5);
  assert.deepEqual(TEAM_EVENT.sessions.map(s => [s.lectureId, s.start, s.end, s.staffName, s.room, s.maxCapacity, s.bookingsAtVerification]), [
    ['98900618', '14:00', '14:50', '배민진', '체어', 6, 0],
    ['98900887', '15:00', '15:50', '정은영', '바렐', 6, 0],
  ]);
  assert.ok(Object.isFrozen(TEAM_EVENT) && Object.isFrozen(TEAM_EVENT.sessions));
  assert.ok(TEAM_EVENT.sessions.every(s => Object.isFrozen(s) && !Object.hasOwn(s, 'description')));
  assert.equal(TEAM_EVENT.location, 'ARCHIVE PILATES 명지, 부산광역시 강서구 명지국제2로28번길 34 에코팰리스 704호');
});

test('ICS contains one combined UTC event, stable identity, composition and same venue', () => {
  const text = unfold(renderTeamCalendarIcs(stamp));
  assert.equal(text.split('BEGIN:VEVENT').length - 1, 1);
  for (const line of ['UID:team-261120@archivepilates.com', `DTSTAMP:${stamp}`,
    'DTSTART:20261120T050000Z', 'DTEND:20261120T065000Z', `SUMMARY:${TEAM_EVENT.title}`,
    `LOCATION:${icsEscape(TEAM_EVENT.location)}`, 'DESCRIPTION:민진쌤 체어\\n은영쌤 바렐',
    'STATUS:CONFIRMED', `URL:${TEAM_EVENT.url}`]) assert.ok(text.includes(`${line}\r\n`), line);
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(text.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n'));
});

test('RFC 5545 UTF-8 folding, CRLF and escaping remain valid', () => {
  const logical = `DESCRIPTION:${'한글é'.repeat(100)}`;
  for (const text of [renderTeamCalendarIcs(stamp), `${foldIcsLine(logical)}\r\n`]) {
    assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(text)), text);
    assert.equal(text.replaceAll('\r\n', '').includes('\n'), false);
    assert.ok(text.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  }
  assert.equal(unfold(foldIcsLine(logical)), logical);
  assert.equal(icsEscape('a,b;c\\d\r\ne\rf\ng'), 'a\\,b\\;c\\\\d\\ne\\nf\\ng');
  assert.throws(() => renderTeamCalendarIcs('invalid'));
});

test('HTML and Google calendar agree with the approved schedule without accessories or other offerings', () => {
  const html = renderTeamCalendarHtml();
  assert.match(html, /<html lang="ko"/);
  assert.match(html, /src="\/logo120\.png"/);
  assert.match(html, /2026년 11월 20일\(금\) · 14:00~15:50/);
  assert.match(html, /href="\.\/archive-method-261120\.ics"/);
  assert.ok(html.includes(`<link rel="canonical" href="${TEAM_EVENT.url}">`));
  assert.match(html, /data-lecture-id="98900618"/);
  assert.match(html, /data-lecture-id="98900887"/);
  assert.doesNotMatch(html, /<script|rel="stylesheet"|@import|261121|261128|외부 피드백|리포머|블럭|스틱/);
  const rows = [...html.matchAll(/<tr>(<td[\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<td[\s\S]*?<\/td>/g)].map(m => m[0]));
  assert.equal(rows.length, 5);
  assert.ok(rows.every(row => row.length === 7));
  assert.equal(rows[2].findIndex(cell => cell.includes('event-day')), 5);
  assert.match(rows[2][5], /11월 20일 금요일 Team 강사레슨">20<\/time>/);
  const url = new URL(html.match(/href="(https:\/\/calendar\.google\.com[^"]+)"/)[1].replaceAll('&amp;', '&'));
  assert.deepEqual(Object.fromEntries(url.searchParams), { action: 'TEMPLATE', text: TEAM_EVENT.title,
    dates: '20261120T050000Z/20261120T065000Z', details: TEAM_EVENT.composition,
    location: TEAM_EVENT.location, ctz: 'Asia/Seoul' });
});

test('mobile-first layout retains the proven 320/390/tablet/desktop constraints without browser calls', () => {
  const html = renderTeamCalendarHtml();
  for (const rule of ['*{box-sizing:border-box}', 'width:min(100%,64rem)', 'overflow-wrap:anywhere',
    '.layout>*{min-width:0}', 'table-layout:fixed;width:100%', 'grid-template-columns:6.5rem minmax(0,1fr)',
    'min-height:48px', 'a:focus-visible{outline:3px solid', '@media(min-width:700px)',
    'grid-template-columns:minmax(0,1fr) minmax(0,1fr)']) assert.ok(html.includes(rule), rule);
  assert.doesNotMatch(html, /100vw|overflow-x:\s*(hidden|clip)|user-scalable\s*=\s*no|font-size:[^;}]*vw/);
  assert.match(html, /<img[^>]*width="44" height="44"[^>]*alt="ARCHIVE PILATES 심볼"/);
});

test('saved artifacts match the builder without writing during checks', async () => {
  const before = source();
  await buildTeamCalendar({ check: true });
  assert.equal(fs.readFileSync(path.join(TEAM_CALENDAR_DIR, 'index.html'), 'utf8'), renderTeamCalendarHtml());
  assertCalendarSource(before);
  assert.deepEqual(source(), before);
  for (const f of paths) {
    const changed = { ...before, [f]: Buffer.concat([before[f], Buffer.from('unexpected content')]) };
    assert.throws(() => assertCalendarSource(changed));
  }
  assert.throws(() => assertCalendarSource({ ...before, '/secret.json': Buffer.from('secret') }));
});

test('manifest preserves all baseline hashes including November 21 and adds exactly the two allowed files', () => {
  const old = [{ path: '/old.js', hash: 'a'.repeat(64) },
    { path: '/method/team-261121/calendar/index.html', hash: 'c'.repeat(64) }];
  const hashes = Object.fromEntries(paths.map(f => [f, 'b'.repeat(64)]));
  const next = teamCalendarManifest(old, hashes);
  for (const file of old) assert.equal(next[file.path], file.hash);
  assert.equal(Object.keys(next).length, old.length + 2);
  for (const file of [...paths, '/method/team-261120/other.html', '/method/team-261120']) {
    assert.throws(() => teamCalendarManifest([...old, { path: file, hash: 'a'.repeat(64) }], hashes));
  }
  assert.throws(() => teamCalendarManifest([...old, old[0]], hashes));
  assert.throws(() => teamCalendarManifest([{ path: 'invalid', hash: 'a'.repeat(64) }], hashes));
  assert.throws(() => teamCalendarManifest(old, { ...hashes, '/secret.json': 'd'.repeat(64) }));
  assert.throws(() => teamCalendarManifest(old, { [paths[0]]: 'b'.repeat(64) }));
  assert.throws(() => teamCalendarManifest(old, { ...hashes, [paths[0]]: 'invalid' }));
});

test('apply requires an explicit reviewed baseline and supports no replacement or unknown mode', () => {
  assert.deepEqual(releaseArguments([]), { apply: false, expected: undefined });
  assert.deepEqual(releaseArguments(['--apply', `--expected-version=${version}`]), { apply: true, expected: version });
  for (const args of [['--apply'], ['--update'], ['--apply', '--apply'], ['--expected-version='],
    [`--expected-version=${version}`, `--expected-version=${version}2`], ['--expected-version=sites/another/versions/x']]) {
    assert.throws(() => releaseArguments(args));
  }
});

test('clean synchronized main rejects dirty, feature branch, stale origin and moved HEAD', () => {
  const state = { branch: 'main', status: '', head: 'commit', origin: 'commit' };
  const git = a => ({ 'branch --show-current': state.branch, 'status --porcelain': state.status,
    'rev-parse HEAD': state.head, 'rev-parse origin/main': state.origin })[a.join(' ')];
  assertCleanMain(git, 'commit');
  for (const [key, value] of [['branch', 'feature'], ['status', '?? secret'], ['head', 'other'], ['origin', 'other']]) {
    const previous = state[key]; state[key] = value;
    assert.throws(() => assertCleanMain(git, 'commit'));
    state[key] = previous;
  }
});

function fixture(t, scenario = '') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'team-261120-calendar-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const out = path.join(home, 'ArchiveIN/operations/november-instructor-confirmation-20261029/team-261120-calendar-release.json');
  const lock = path.join(home, 'ArchiveIN/automation/locks/firebase-hosting-archive-pilates-in.lock');
  const config = { headers: [{ glob: '**', headers: { 'Cache-Control': 'no-cache' } }],
    rewrites: [{ glob: '/core/**', path: '/core/index.html' }], redirects: [{ glob: '/old', location: '/new', statusCode: 301 }] };
  const baselineFiles = [{ path: '/logo120.png', hash: 'a'.repeat(64) },
    { path: '/method/team-261121/calendar/index.html', hash: 'b'.repeat(64) },
    { path: '/method/team-261121/calendar/archive-method-261121.ics', hash: 'c'.repeat(64) }];
  const createdVersion = 'sites/archive-pilates-in/versions/new-calendar';
  const calls = [], populated = {};
  let latestCount = 0, released = false;
  const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const git = a => {
    const key = a.join(' ');
    if (key === 'rev-parse HEAD' || key === 'rev-parse origin/main') return 'commit';
    if (key === 'branch --show-current') return scenario === 'feature-branch' ? 'feature' : 'main';
    if (key === 'status --porcelain') return '';
    if (key === 'fetch origin main' || a[0] === 'ls-files') return '';
    throw Error('Unexpected git command');
  };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input), method = options.method || 'GET';
    const body = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : undefined;
    calls.push({ url: url.href, method, body });
    if (url.origin === 'https://upload-firebasehosting.googleapis.com') {
      assert.equal(method, 'POST');
      assert.ok(Buffer.isBuffer(options.body));
      return new Response('');
    }
    if (url.origin === 'https://in.archivepilates.com') {
      if (!released) return new Response('', { status: scenario === 'existing-url' ? 200 : 404 });
      const f = url.pathname.endsWith('/') ? paths[0] : url.pathname;
      return new Response(source()[f]);
    }
    assert.equal(url.origin, 'https://firebasehosting.googleapis.com');
    const resource = url.pathname.replace('/v1beta1/', '');
    if (method === 'GET' && resource === 'sites/archive-pilates-in/releases') {
      latestCount++;
      const drift = scenario === 'baseline-drift' && latestCount >= 2;
      return json({ releases: [{ name: drift ? 'different-release' : 'baseline-release',
        version: { name: released ? createdVersion : version } }] });
    }
    if (method === 'GET' && resource === version) return json({ name: version, status: 'FINALIZED', config });
    if (method === 'GET' && resource === version + '/files') {
      return json(url.searchParams.has('pageToken') ? { files: baselineFiles.slice(1),
        ...(scenario === 'repeated-cursor' ? { nextPageToken: 'next' } : {}) }
        : { files: baselineFiles.slice(0, 1), nextPageToken: 'next' });
    }
    if (method === 'POST') {
      assert.ok(fs.existsSync(out), 'durable intent precedes the first mutation');
      assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    }
    if (method === 'POST' && resource === 'sites/archive-pilates-in/versions') {
      assert.deepEqual(body.config, config);
      return json({ name: createdVersion });
    }
    if (method === 'POST' && resource === createdVersion + ':populateFiles') {
      Object.assign(populated, body.files);
      return json({ uploadRequiredHashes: scenario === 'unexpected-upload' ? ['unapproved-hash']
        : paths.map(f => populated[f]), uploadUrl: scenario === 'bad-upload-host' ? 'https://untrusted.invalid/upload'
          : 'https://upload-firebasehosting.googleapis.com/upload' });
    }
    if (method === 'GET' && resource === createdVersion + '/files') {
      const files = Object.entries(populated).map(([path, hash]) => ({ path, hash }));
      if (scenario === 'manifest-drift') files[0].hash = 'd'.repeat(64);
      return json({ files });
    }
    if (method === 'GET' && resource === createdVersion) return json({ config: scenario === 'config-drift' ? {} : config });
    if (method === 'PATCH' && resource === createdVersion) return json({ status: 'FINALIZED' });
    if (method === 'POST' && resource === 'sites/archive-pilates-in/releases') {
      if (scenario === 'ambiguous-release') throw Error('Unknown transport outcome');
      released = true; return json({ name: 'new-release' });
    }
    throw Error(`Unexpected fake request: ${method} ${resource}`);
  };
  const run = (apply = true, expected = version) => releaseTeamCalendar({ root: ROOT, home, git,
    args: apply ? ['--apply', `--expected-version=${expected}`] : [], getToken: () => 'TEST_TOKEN_NOT_FOR_OUTPUT', fetchImpl });
  return { home, calls, run, out, lock, baselineFiles, populated };
}

test('offline plan is read-only and exposes no credentials or private source content', async t => {
  const f = fixture(t), result = await f.run(false);
  assert.equal(result.mode, 'plan');
  assert.deepEqual(result.addedPaths, paths);
  assert.equal(result.preservedFiles, 3);
  assert.equal(result.finalFiles, 5);
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.deepEqual(fs.readdirSync(f.home), []);
  assert.doesNotMatch(JSON.stringify(result), /TEST_TOKEN|Authorization|BEGIN:VCALENDAR|직장인/);
});

test('offline apply preserves paginated baseline and config, verifies both files and route, cleans lock', async t => {
  const f = fixture(t), result = await f.run();
  assert.equal(result.verified, true);
  assert.equal(Object.keys(f.populated).length, 5);
  for (const file of f.baselineFiles) assert.equal(f.populated[file.path], file.hash);
  assert.equal(fs.existsSync(f.lock), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.out)), result);
  assert.doesNotMatch(fs.readFileSync(f.out, 'utf8'), /TEST_TOKEN|Authorization/);
});

for (const scenario of ['feature-branch', 'existing-url', 'baseline-drift', 'unexpected-upload', 'bad-upload-host',
  'repeated-cursor', 'manifest-drift', 'config-drift']) {
  test(`offline ${scenario} stops before a public release and releases its lock`, async t => {
    const f = fixture(t, scenario);
    await assert.rejects(f.run());
    assert.equal(f.calls.some(c => c.method === 'POST' && new URL(c.url).pathname.endsWith('/releases')), false);
    assert.equal(fs.existsSync(f.lock), false);
    if (scenario === 'feature-branch') assert.deepEqual(f.calls, []);
  });
}

test('offline expected-version conflict blocks all mutations', async t => {
  const f = fixture(t);
  await assert.rejects(f.run(true, version + '-stale'));
  assert.ok(f.calls.every(c => c.method === 'GET'));
});

test('offline ambiguous release retains intent and refuses replay without a second write', async t => {
  const f = fixture(t, 'ambiguous-release');
  await assert.rejects(f.run());
  assert.ok(JSON.parse(fs.readFileSync(f.out)).releaseIntentAt);
  const writes = f.calls.filter(c => c.method !== 'GET').length;
  await assert.rejects(f.run());
  assert.equal(f.calls.filter(c => c.method !== 'GET').length, writes);
  assert.equal(fs.existsSync(f.lock), false);
});
