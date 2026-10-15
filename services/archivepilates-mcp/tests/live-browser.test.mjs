import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { createLiveReader, allowReadRequest } from '../src/live-browser.mjs';

const member = { memberId: '123', name: '가상강사', phone: '01012345678' };
const origin = 'https://arcpilates.studiomate.kr';
const apiOrigin = 'https://api.studiomate.kr';
const ticket = name => `<div class="userticket-card"><h3>${name}</h3>
  <span class="userticket-card__indicator__tag contained">사용중</span>
  <p class="userticket-card__body__details">그룹형 횟수제</p>
  <p class="userticket-card__footer__counts"><span><span>잔여</span><span>4</span></span>
  <span><span>예약가능</span><span>3</span></span></p>
  <p class="userticket-card__footer__period">2026.10.15 ~ 2026.12.31 (77일 남음)</p>
  <span class="userticket-card__extra__price__total">결제 금액 0원</span></div>`;
function searchHtml() {
  return `<div class="search-bar"><input aria-label="이름 또는 전화번호로 검색"><div id="results"></div></div>
  <script>document.querySelector('input').addEventListener('input',async e=>{
    const q=e.target.value;await fetch('/v2/staff/members/top-bar-search?query='+encodeURIComponent(q));
    const container=document.createElement('div');
    if(q==='없는회원'){
      container.className='no-member';const heading=document.createElement('h3');heading.textContent='"'+q+'"';container.append(heading);
    }else{
      container.className='members';const row=document.createElement('div');row.className='member';
      row.innerHTML='<span class="name">가상강사</span><span class="mobile">01012345678</span>';
      row.onclick=()=>location.assign('/users/detail?id=123');container.append(row);
    }
    document.getElementById('results').replaceChildren(container);
  });</script>`;
}
function detailHtml(name, grade = '스텝', malformedTicket = false) {
  return `<div class="member-detail__header">
    <div class="member-detail__header__name"><h3>가상강사</h3></div>
    <div class="member-detail__header__mobile"><span>01012345678</span></div>
    <div class="member-detail__header__user-grade"><span>${grade}</span></div></div>
    <div class="member-basic__user-tickets"><div class="userticket-card"><p class="userticket-card__extra__add-new">새 수강권</p></div>
    <div class="el-loading-mask">불러오는 중</div><div id="tickets"></div></div>
    <script>fetch('${apiOrigin}/v2/staff/userTickets?member_id=123').then(()=>{document.getElementById('tickets').innerHTML=${JSON.stringify(malformedTicket ? '<div class="userticket-card">변경된 표시</div>' : ticket(name))};
    document.querySelector('.el-loading-mask').remove();});fetch('/must-not-write',{method:'POST'}).catch(()=>{});</script>`;
}

async function fixture(t, { change = false, login = false, grade = '스텝', malformedTicket = false, pendingTickets = false } = {}) {
  const events = [], forwardedWrites = [], contexts = [];
  let held = false, visits = 0;
  const reader = createLiveReader({
    budgetMs: pendingTickets ? 2000 : 45000,
    acquire: async () => {
      if (held) throw new Error('busy');
      held = true; events.push('lock');
      return async () => { events.push('release'); held = false; };
    },
    launch: async () => {
      assert.equal(held, true); events.push('launch');
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });
      contexts.push(context);
      context.on('page', page => page.on('pageerror', error => events.push(`fixture-script-error:${error.message}`)));
      const close = context.close.bind(context);
      context.close = async () => { await close(); await browser.close(); events.push('close'); };
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        events.push(`fixture-request:${request.method()}:${url.pathname}`);
        if (!allowReadRequest(request.method())) forwardedWrites.push(request.method());
        if (![origin, apiOrigin].includes(url.origin)) return route.abort();
        if (url.pathname === '/users') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: login ? '<input type="password">' : searchHtml() });
        if (url.pathname === '/users/detail') {
          visits += 1;
          const html = detailHtml(change && visits > 1 ? '변경권' : '가상권', grade, malformedTicket);
          return route.fulfill({ contentType: 'text/html; charset=utf-8', body: login ? '<input type="password">'
            : pendingTickets ? html.replace('class="el-loading-mask"', 'class="el-loading-mask" style="display:none"') : html });
        }
        if (pendingTickets && url.pathname === '/v2/staff/userTickets') return new Promise(() => {});
        return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: '{}' });
      });
      return context;
    },
  });
  t.after(async () => { await reader.close(); t.diagnostic(JSON.stringify(events)); });
  return { reader, events, contexts, forwardedWrites, held: () => held };
}

test('fixture browser searches exact identity, resolves native ID, waits for ticket load and verifies two views', async t => {
  const f = await fixture(t);
  const found = await f.reader.findMembers(member.name, false);
  assert.deepEqual(found.members, [member]);
  const result = await f.reader.getOverview(member);
  assert.equal(result.tickets.length, 1);
  assert.equal(result.tickets[0].remainingCount, 4);
  assert.equal(result.tickets[0].reservableCount, 3);
  assert.equal(result.tickets[0].paymentAmount, 0);
  assert.equal(result.ticketIdsAvailable, false);
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  assert.deepEqual(f.forwardedWrites, []);
  assert.deepEqual(f.events.filter(event => !event.startsWith('fixture-')), ['lock', 'launch', 'close', 'release', 'lock', 'launch', 'close', 'release']);
  assert.equal(f.held(), false);
  assert.ok(f.contexts.every(context => context.pages().length === 0));
  assert.equal(f.events.filter(e => e === 'fixture-request:GET:/v2/staff/members/top-bar-search').length, 1);
  assert.equal(f.events.filter(e => e === 'fixture-request:GET:/users/detail').length, 3);
});

test('search needs identity only, not grade or parsable ticket layout', async t => {
  const f = await fixture(t, { grade: '', malformedTicket: true });
  assert.deepEqual((await f.reader.findMembers(member.name, false)).members, [member]);
  await assert.rejects(f.reader.getOverview(member), { code: 'LIVE_LAYOUT_CHANGED' });
  assert.equal(f.held(), false);
});

test('direct overview permits unknown grade but preserves live identity verification', async t => {
  const f = await fixture(t, { grade: '' });
  assert.equal((await f.reader.getOverview(member)).memberGrade, null);
  await assert.rejects(f.reader.getOverview({ ...member, phone: '01099995678' }), { code: 'LIVE_IDENTITY_MISMATCH' });
  assert.equal(f.held(), false);
});
test('pending ticket request without a loading mask cannot become a verified empty list', async t => {
  const f = await fixture(t, { pendingTickets: true });
  await assert.rejects(f.reader.getOverview(member), { code: 'LIVE_TIMEOUT' });
  assert.equal(f.held(), false);
  assert.ok(f.contexts.every(context => context.pages().length === 0));
});

test('explicit empty results are distinct from partial-name matches', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.reader.findMembers('없는회원', false)).members, []);
  assert.deepEqual((await f.reader.findMembers('가상', false)).members, []);
  assert.equal(f.held(), false);
});

test('login expiry and changing source fail closed and clean up browser/lock', async t => {
  const login = await fixture(t, { login: true });
  await assert.rejects(login.reader.findMembers(member.name, false), { code: 'LIVE_LOGIN_REQUIRED' });
  assert.equal(login.held(), false);
  const changed = await fixture(t, { change: true });
  await assert.rejects(changed.reader.getOverview(member), { code: 'LIVE_CHANGED' });
  assert.equal(changed.held(), false);
});

test('shared lock contention starts no browser and is sanitized', async () => {
  let launched = false;
  const reader = createLiveReader({ acquire: async () => { throw new Error('private owner'); },
    launch: async () => { launched = true; } });
  try {
    await assert.rejects(reader.findMembers(member.name, false), { code: 'LIVE_BUSY' });
    assert.equal(launched, false);
  } finally { await reader.close(); }
});

test('launch and page setup failures release only task-owned lock', async () => {
  for (const stage of ['launch', 'page']) {
    const events = [];
    const context = { setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, route: async () => {},
      newPage: async () => { throw new Error('private raw source'); }, close: async () => events.push('close') };
    const reader = createLiveReader({ acquire: async () => { events.push('lock'); return async () => events.push('release'); },
      launch: async () => { events.push('launch'); if (stage === 'launch') throw new Error('private'); return context; } });
    try { await assert.rejects(reader.findMembers(member.name, false), { code: 'LIVE_UNAVAILABLE' }); }
    finally { await reader.close(); }
    assert.deepEqual(events, stage === 'launch' ? ['lock', 'launch', 'release'] : ['lock', 'launch', 'close', 'release']);
  }
});

test('cancellation and deadline close active browser before releasing the lock', async () => {
  for (const mode of ['cancel', 'deadline', 'disconnect']) {
    const events = [], controller = new AbortController();
    let rejectNavigation, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const context = { setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, route: async () => {},
      newPage: async () => ({ goto: () => new Promise((_resolve, reject) => { rejectNavigation = reject; entered(); }) }),
      close: async () => { events.push('close'); rejectNavigation?.(new Error('closed')); } };
    const reader = createLiveReader({ acquire: async () => async () => events.push('release'),
      launch: async () => context, budgetMs: mode === 'deadline' ? 30 : 5000 });
    const result = assert.rejects(reader.findMembers(member.name, false, controller.signal),
      { code: mode === 'deadline' ? 'LIVE_TIMEOUT' : 'LIVE_CANCELLED' });
    await started;
    if (mode === 'cancel') controller.abort();
    if (mode === 'disconnect') await reader.close();
    await result;
    await reader.close();
    assert.equal(events.at(-1), 'release');
    assert.equal(events[0], 'close');
  }
});

test('unconfirmed browser close retains exclusive lock for operator review', async () => {
  let released = false;
  const reader = createLiveReader({ acquire: async () => async () => { released = true; },
    launch: async () => ({ setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, route: async () => {},
      newPage: async () => { throw new Error('failed'); }, close: async () => { throw new Error('uncertain close'); } }) });
  await assert.rejects(reader.findMembers(member.name, false), { code: 'LIVE_CLEANUP_REQUIRED' });
  assert.equal(released, false);
  await assert.rejects(reader.close());
});

test('confirmed cleanup retry releases the same owned lock exactly once', async () => {
  let releases = 0, closes = 0;
  const reader = createLiveReader({ acquire: async () => async () => { releases += 1; },
    launch: async () => ({ setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, route: async () => {},
      newPage: async () => { throw new Error('fixture setup'); }, close: async () => {
        closes += 1; if (closes === 1) throw new Error('transient close');
      } }) });
  await assert.rejects(reader.findMembers(member.name, false), { code: 'LIVE_CLEANUP_REQUIRED' });
  assert.equal(releases, 0);
  await reader.close();
  assert.equal(releases, 1);
  assert.equal(closes, 2);
});

test('stalled shutdown reports bounded cleanup failure and retains lock', async () => {
  let releases = 0;
  const reader = createLiveReader({ budgetMs: 10, cleanupMs: 10,
    acquire: async () => async () => { releases += 1; },
    launch: async () => ({ setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, route: async () => {},
      newPage: async () => ({ goto: () => new Promise(() => {}) }), close: () => new Promise(() => {}) }) });
  await assert.rejects(reader.findMembers(member.name, false), { code: 'LIVE_CLEANUP_REQUIRED' });
  assert.equal(releases, 0);
  await assert.rejects(reader.close(), { code: 'LIVE_CLEANUP_REQUIRED' });
});

test('stalled route or page setup also obeys deadline and never continues after cancellation', async () => {
  for (const stage of ['route', 'page']) {
    let releases = 0, pageCalls = 0;
    const reader = createLiveReader({ budgetMs: 5, cleanupMs: 5,
      acquire: async () => async () => { releases += 1; },
      launch: async () => ({ setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
        route: () => stage === 'route' ? new Promise(() => {}) : Promise.resolve(),
        newPage: () => { pageCalls += 1; return new Promise(() => {}); }, close: () => new Promise(() => {}) }) });
    await assert.rejects(reader.findMembers(member.name, false), { code: 'LIVE_CLEANUP_REQUIRED' });
    assert.equal(releases, 0);
    assert.equal(pageCalls, stage === 'route' ? 0 : 1);
    await assert.rejects(reader.close(), { code: 'LIVE_CLEANUP_REQUIRED' });
  }
});

test('write requests are blocked by method, not just tool declarations', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(allowReadRequest(method), true);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT']) assert.equal(allowReadRequest(method), false);
});
