import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { OperationError } from '../src/errors.mjs';
import { extractIdentityDom, validateIdentity } from '../src/live-dom.mjs';
import { readNativeInventory, readNativeBookings } from '../src/native-pages.mjs';

const ORIGIN = 'https://arcpilates.studiomate.kr';
const API = 'https://api.studiomate.kr';
const MEMBER_PATH = '/v2/staff/members';
const EXPECTED = { memberId: '123', name: 'Synthetic Member', phone: '01012345678' };
const BOOKING_PATH = `/staff/member/${EXPECTED.memberId}/booking`;
const RANGE = { startDate: '2026-10-10', endDate: '2026-10-20' };
const LABELS = { history: '\uc774\uc6a9\ub0b4\uc5ed', booked: '\uc608\uc57d', all: '\uc804\uccb4',
  order: '\uc218\uc5c5\uc77c \ub0b4\ub9bc\ucc28\uc21c' };

function members(count = 123) {
  return Array.from({ length: count }, (_, i) => ({ id: 1000 + i,
    name: `Synthetic Member ${String(i).padStart(3, '0')}`, mobile: '01000000000', userTickets: [] }));
}

function bookings() {
  return ['25', '21', '20', '19', '10', '09', '08', '07', '06', '05', '04', '03'].map((day, i) => ({
    id: 2000 + i, studio_id: 5330, member_id: 123, lecture_id: 3000 + i, user_ticket_id: 71,
    status: i === 3 ? 'cancel' : 'booked', deleted_at: null,
    lecture: { id: 3000 + i, studio_id: 5330, type: 'G',
      start_on: `2026-10-${day} 08:30:00`, end_on: `2026-10-${day} 09:20:00`,
      instructor: { name: 'Synthetic Instructor' } },
  }));
}

function nativeBody(rows, number, perPage, kind) {
  const meta = { current_page: number, per_page: perPage, total: rows.length,
    last_page: Math.max(1, Math.ceil(rows.length / perPage)) };
  const data = structuredClone(rows.slice((number - 1) * perPage, number * perPage));
  return kind === 'inventory' ? { data, count: { total_count: rows.length }, meta }
    : { bookings: { ...meta, data }, kind: { total_count: rows.length } };
}

// Runs only inside routed fixture documents, with the native classes consumed by the reader.
function fixtureApp(config) {
  const root = document.getElementById('app');
  window.fixtureEvents = [];
  let number = 1, perPage = config.kind === 'inventory' ? 10 : config.perPage, generation = 0;
  const event = value => window.fixtureEvents.push(value);
  const pagination = document.createElement('div');
  pagination.className = 'el-pagination';
  pagination.innerHTML = '<ul class="el-pager"></ul><button class="btn-next" aria-label="Next page">Next</button>';
  const output = document.createElement('div');
  output.dataset.testid = 'native-rows';
  const state = document.createElement('output');
  state.dataset.testid = 'render-state';

  function render(filtered) {
    const rows = filtered ? config.rows.filter(row => row.status === 'booked') : config.rows;
    const last = Math.max(1, Math.ceil(rows.length / perPage));
    const pager = pagination.querySelector('ul');
    pager.replaceChildren();
    for (let i = 1; i <= last; i++) {
      const item = document.createElement('li');
      item.className = `number${i === number ? ' active' : ''}`;
      item.textContent = String(i);
      item.onclick = () => { event(`page:${i}`); void load(i, false); };
      pager.append(item);
    }
    pagination.querySelector('.btn-next').disabled = number === last;
    output.textContent = rows.slice((number - 1) * perPage, number * perPage)
      .map(row => `${row.id}:${row.name ?? row.status}`).join('\n');
    state.textContent = `${filtered ? 'booked' : 'all'}:${number}:${perPage}`;
    event(`render:${state.textContent}`);
  }

  async function load(target, filtered) {
    const revision = ++generation;
    const query = new URLSearchParams({ page: String(target) });
    if (config.kind === 'inventory') {
      query.set('limit', String(perPage)); query.set('sort_name', 'asc'); query.set('with', 'tickets.ticket');
    } else {
      query.set('per_page', String(perPage)); query.set('with', 'lecture.instructor');
      query.set('order_by', 'start_on');
      if (filtered) query.set('status[]', 'booked');
    }
    const response = await fetch(`${config.api}${config.path}?${query}`);
    // Render independently of the envelope so a plausible DOM cannot hide invalid native JSON.
    await response.text();
    if (revision !== generation) return;
    number = target;
    render(filtered);
  }
  pagination.querySelector('.btn-next').onclick = () => {
    event(`next:${number + 1}`); void load(number + 1, false);
  };

  if (config.kind === 'inventory') {
    const select = document.createElement('div');
    select.className = 'el-select';
    select.innerHTML = '<input class="el-input__inner" aria-label="Page size" value="10/page" readonly>'
      + '<button hidden>50/page</button>';
    const input = select.querySelector('input'), option = select.querySelector('button');
    input.onclick = () => { option.hidden = false; event('open-page-size'); };
    option.onclick = () => {
      perPage = 50; input.value = '50/page'; option.hidden = true;
      event('select:50'); void load(1, false);
    };
    pagination.prepend(select);
    root.append(pagination, output, state);
    void load(1, false);
  } else {
    root.innerHTML = '<header class="member-detail__header" data-testid="identity">'
      + '<div class="member-detail__header__name"><h3></h3></div>'
      + '<div class="member-detail__header__mobile"><span></span></div>'
      + '<div class="member-detail__header__user-grade"><span>Synthetic Grade</span></div></header>'
      + '<nav class="member-detail__header-tabs"><button></button></nav>'
      + '<section class="member-detail__body" hidden><nav class="member-history__header__tabs">'
      + '<button data-testid="booked-tab"></button><button data-testid="all-tab"></button></nav>'
      + '<div class="member-history__header__buttons__order-by-select">'
      + '<input aria-label="History order" readonly></div></section>';
    root.querySelector('h3').textContent = config.expected.name;
    root.querySelector('.member-detail__header__mobile span').textContent = config.expected.phone;
    const body = root.querySelector('section'), history = root.querySelector('nav button');
    history.textContent = config.labels.history;
    history.onclick = () => { body.hidden = false; event('history'); };
    const tabs = body.querySelectorAll('nav button');
    // A previously mounted all-status tab may look empty; the reader must explicitly reselect it.
    tabs[0].textContent = `\n  ${config.labels.booked}(0) \n`;
    tabs[1].textContent = `\n  ${config.labels.all}(${config.rows.length}) \n`;
    tabs[0].onclick = () => { event('tab:booked'); void load(1, true); };
    tabs[1].onclick = () => { event('tab:all'); void load(1, false); };
    body.querySelector('input').value = config.order;
    body.append(pagination, output, state);
    render(false);
    output.textContent = 'Synthetic previously mounted empty history';
  }
}

async function fixture(t, { kind = 'inventory', rows = kind === 'inventory' ? members() : bookings(),
  perPage = 3, order = LABELS.order, mutate = () => {}, status = 200, rawBody } = {}) {
  const browser = await chromium.launch({ headless: true });
  let context;
  const requests = [], unexpected = [], pageErrors = [], checkpoints = [], navigations = [];
  t.after(async () => {
    try { if (context) await context.close(); }
    finally { await browser.close(); }
    assert.equal(browser.isConnected(), false, 'task-owned browser must be closed');
    assert.equal(context?.pages().length ?? 0, 0, 'task-owned context must have no open pages');
    assert.deepEqual(unexpected, [], 'every request must be a known locally fulfilled GET');
    assert.deepEqual(pageErrors, [], 'fixture scripts must render without errors');
  });
  context = await browser.newContext({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });
  const path = kind === 'inventory' ? MEMBER_PATH : BOOKING_PATH;
  const config = { kind, rows, perPage, order, api: API, path, expected: EXPECTED, labels: LABELS };
  const html = `<!doctype html><meta charset="utf-8"><main id="app"></main>
    <script>(${fixtureApp.toString()})(${JSON.stringify(config)})</script>`;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'GET' && url.origin === ORIGIN
      && (url.pathname === '/users' || url.pathname === '/users/detail')) {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    }
    if (request.method() === 'GET' && url.origin === API && url.pathname === path) {
      const number = Number(url.searchParams.get('page'));
      const size = Number(url.searchParams.get(kind === 'inventory' ? 'limit' : 'per_page'));
      const filtered = url.searchParams.has('status[]');
      const requestRows = filtered ? rows.filter(row => row.status === 'booked') : rows;
      const visit = requests.filter(item => item.number === number && item.size === size
        && item.filtered === filtered).length + 1;
      const entry = { number, size, filtered, visit, url: url.href };
      requests.push(entry);
      const body = nativeBody(requestRows, number, size, kind);
      const changed = mutate(body, entry);
      return route.fulfill({ status, contentType: 'application/json',
        headers: { 'access-control-allow-origin': ORIGIN },
        body: rawBody ?? JSON.stringify(changed === undefined ? body : changed) });
    }
    unexpected.push(`${request.method()} ${url.href}`);
    return route.fulfill({ status: 599, body: 'Unexpected fixture request; never forwarded' });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  page.on('pageerror', error => pageErrors.push(error.message));
  let identityWaits = 0;
  const helpers = {
    navigate: async (target, pathname) => {
      assert.equal(target, page); navigations.push(pathname);
      await target.goto(`${ORIGIN}${pathname}`, { waitUntil: 'domcontentloaded' });
    },
    checkpoint: target => { assert.equal(target, page); checkpoints.push(target.url()); },
    waitIdentity: async target => {
      assert.equal(target, page); identityWaits++;
      await target.getByTestId('identity').waitFor({ state: 'visible' });
      validateIdentity(await target.evaluate(extractIdentityDom), EXPECTED);
    },
  };
  return { page, requests, checkpoints, navigations, helpers, identityWaits: () => identityWaits,
    events: () => page.evaluate(() => window.fixtureEvents),
    inventory: () => readNativeInventory(page, helpers),
    bookings: (range = RANGE, expected = EXPECTED) => readNativeBookings(page, expected, range, helpers) };
}

const sequence = f => f.requests.map(({ number, size, filtered }) => [number, size, filtered]);
async function rejectsNative(action, code) {
  await assert.rejects(action, error => error instanceof OperationError && error.safe === true
    && (code === undefined || error.code === code), 'invalid native data must reject, not return a snapshot');
}

test('inventory selects UI 50/page after initial 10, reads every page, then rereads first', async t => {
  const f = await fixture(t);
  const result = await f.inventory();
  assert.deepEqual(result.profiles.map(row => row.memberId), members().map(row => String(row.id)));
  assert.equal(new Set(result.profiles.map(row => row.memberId)).size, 123);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.nativeTotal, 123);
  assert.equal(result.coverage.scannedMembers, 123);
  assert.equal(result.coverage.pageCount, 3);
  assert.equal(result.coverage.kind, 'native_member_pages');
  assert.equal(result.coverage.atomicSnapshot, false);
  assert.equal(result.coverage.pointInTimeComplete, false);
  assert.equal(result.coverage.stabilityCheck, 'first_page_rechecked_only');
  assert.equal(result.coverage.sourceWindowStartedAt, result.startedAt);
  assert.ok(Number.isFinite(Date.parse(result.startedAt)));
  assert.deepEqual(sequence(f), [[1, 10, false], [1, 50, false], [2, 50, false], [3, 50, false], [1, 50, false]]);
  await f.page.getByTestId('render-state').filter({ hasText: /^all:1:50$/ }).waitFor({ state: 'visible' });
  assert.equal(await f.page.getByLabel('Page size').inputValue(), '50/page');
  assert.deepEqual((await f.events()).filter(event => !event.startsWith('render:')),
    ['open-page-size', 'select:50', 'next:2', 'next:3', 'page:1']);
  assert.deepEqual(f.navigations, ['/users']);
  assert.equal(f.checkpoints.length, 3);
});

for (const count of [0, 10]) {
  test(`inventory verifies ${count} members without unnecessary size changes or rereads`, async t => {
    const f = await fixture(t, { rows: members(count) });
    const result = await f.inventory();
    assert.equal(result.profiles.length, count);
    assert.equal(result.coverage.complete, true);
    assert.equal(result.coverage.nativeTotal, count);
    assert.deepEqual(sequence(f), [[1, 10, false]]);
  });
}

for (const stage of ['size-change', 'next-page']) {
  test(`inventory rejects a changed total during ${stage}`, async t => {
    const f = await fixture(t, { mutate: (body, { number, size }) => {
      if (size === 50 && number === (stage === 'size-change' ? 1 : 2)) {
        body.meta.total++; body.count.total_count++;
      }
    } });
    await rejectsNative(f.inventory);
    assert.deepEqual(sequence(f), stage === 'size-change'
      ? [[1, 10, false], [1, 50, false]] : [[1, 10, false], [1, 50, false], [2, 50, false]]);
  });
}

test('inventory rejects an ID repeated across otherwise valid native pages', async t => {
  const f = await fixture(t, { mutate: (body, { number }) => {
    if (number === 2) body.data[0].id = 1000;
  } });
  await rejectsNative(f.inventory, 'LIVE_CHANGED');
  assert.deepEqual(sequence(f), [[1, 10, false], [1, 50, false], [2, 50, false]]);
});

test('inventory reread rejects first-page changes even when totals and IDs stay stable', async t => {
  const f = await fixture(t, { mutate: (body, { number, size, visit }) => {
    if (number === 1 && size === 50 && visit === 2) body.data[0].name = 'Synthetic Changed Member';
  } });
  await rejectsNative(f.inventory, 'LIVE_CHANGED');
  assert.deepEqual(sequence(f), [[1, 10, false], [1, 50, false], [2, 50, false], [3, 50, false], [1, 50, false]]);
});

test('bookings explicitly select all statuses, include cancellation and stop at descending date boundary', async t => {
  const f = await fixture(t, { kind: 'bookings' });
  const result = await f.bookings();
  assert.deepEqual(result.records.map(row => row.bookingId), ['2002', '2003', '2004']);
  assert.deepEqual(result.records.map(row => row.lectureDate), ['2026-10-20', '2026-10-19', '2026-10-10']);
  assert.equal(result.records[1].sourceStatus, 'cancel');
  assert.equal(result.coverage.kind, 'native_member_booking_history');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.nativeHistoryTotal, 12);
  assert.equal(result.coverage.scannedBookings, 6);
  assert.equal(result.coverage.pageCount, 2);
  assert.equal(result.coverage.dateBoundaryReached, true);
  assert.equal(result.coverage.fullHistoryComplete, false);
  assert.equal(result.coverage.atomicSnapshot, false);
  assert.deepEqual(result.coverage.requestedRange, RANGE);
  assert.equal(result.coverage.sourceWindowStartedAt, result.startedAt);
  assert.deepEqual(sequence(f), [[1, 3, true], [1, 3, false], [2, 3, false], [1, 3, false], [2, 3, false]]);
  assert.ok(f.requests.filter(row => !row.filtered).every(row => !new URL(row.url).searchParams.has('status[]')));
  assert.deepEqual((await f.events()).filter(event => !event.startsWith('render:')),
    ['history', 'tab:booked', 'tab:all', 'next:2', 'page:1', 'next:2']);
  assert.deepEqual(f.navigations, ['/users/detail?id=123']);
  assert.equal(f.identityWaits(), 1);
  assert.equal(f.checkpoints.length, 4);
});

test('bookings traverse the entire history when no earlier-date boundary exists', async t => {
  const f = await fixture(t, { kind: 'bookings' });
  const range = { startDate: '2026-10-01', endDate: '2026-10-31' };
  const result = await f.bookings(range);
  assert.deepEqual(result.records.map(row => row.bookingId), bookings().map(row => String(row.id)));
  assert.equal(result.coverage.fullHistoryComplete, true);
  assert.equal(result.coverage.dateBoundaryReached, false);
  assert.equal(result.coverage.scannedBookings, 12);
  assert.equal(result.coverage.pageCount, 4);
  assert.deepEqual(sequence(f), [[1, 3, true], [1, 3, false], [2, 3, false], [3, 3, false], [4, 3, false],
    [1, 3, false], [2, 3, false], [3, 3, false], [4, 3, false]]);
});

test('booking reread rejects a same-total page shift even when every observed ID is unique', async t => {
  const f = await fixture(t, { kind: 'bookings', mutate: (body, { number, visit, filtered }) => {
    if (!filtered && number === 2 && visit === 1) body.bookings.data[0].id = 9876;
  } });
  await rejectsNative(f.bookings, 'LIVE_CHANGED');
});

test('inventory discloses traversal-only completeness when middle pages change without a first-page change', async t => {
  const f = await fixture(t, { mutate: (body, { number }) => {
    if (number === 2) body.data[0].id = 9876;
  } });
  const result = await f.inventory();
  assert.equal(result.coverage.traversalComplete, true);
  assert.equal(result.coverage.pointInTimeComplete, false);
  assert.equal(result.coverage.atomicSnapshot, false);
  assert.equal(result.coverage.stabilityCheck, 'first_page_rechecked_only');
});

for (const fault of ['duplicate', 'ascending', 'total-change']) {
  test(`bookings reject ${fault} across pages before claiming complete range coverage`, async t => {
    const f = await fixture(t, { kind: 'bookings', mutate: (body, { number }) => {
      if (number !== 2) return;
      if (fault === 'duplicate') body.bookings.data[0].id = 2000;
      if (fault === 'ascending') {
        body.bookings.data[0].lecture.start_on = '2026-10-26 08:30:00';
        body.bookings.data[0].lecture.end_on = '2026-10-26 09:20:00';
      }
      if (fault === 'total-change') { body.bookings.total++; body.kind.total_count++; }
    } });
    await rejectsNative(f.bookings, fault === 'total-change' ? undefined : 'LIVE_CHANGED');
    assert.deepEqual(sequence(f), [[1, 3, true], [1, 3, false], [2, 3, false]]);
  });
}

test('bookings reject an unverified sort even with valid descending response rows', async t => {
  const f = await fixture(t, { kind: 'bookings', order: 'Synthetic unknown order' });
  await rejectsNative(f.bookings, 'LIVE_INCOMPLETE');
  assert.deepEqual(sequence(f), [[1, 3, true], [1, 3, false]]);
});

test('bookings verify visible identity before selecting history', async t => {
  const f = await fixture(t, { kind: 'bookings' });
  await rejectsNative(() => f.bookings(RANGE, { ...EXPECTED, phone: '01099998888' }), 'LIVE_IDENTITY_MISMATCH');
  assert.deepEqual(f.requests, []);
  assert.deepEqual(await f.events(), ['render:all:1:3']);
});

for (const kind of ['inventory', 'bookings']) {
  for (const fault of ['unknown-envelope', 'malformed-metadata', 'unknown-row', 'http-error']) {
    test(`${kind} ${fault} remains an error despite a renderable native-like DOM, never a snapshot`, async t => {
      const f = await fixture(t, { kind, status: fault === 'http-error' ? 503 : 200,
        mutate: (body, { filtered }) => {
          if (filtered) return;
          if (fault === 'unknown-envelope') return { snapshot: { complete: true, rows: [] } };
          if (fault === 'malformed-metadata') delete (body.meta ?? body.bookings).last_page;
          if (fault === 'unknown-row') {
            if (kind === 'inventory') body.data[0].userTickets = null;
            else body.bookings.data[0].status = 'synthetic-unknown-status';
          }
        } });
      await rejectsNative(kind === 'inventory' ? f.inventory : f.bookings,
        fault === 'http-error' ? 'LIVE_INCOMPLETE' : undefined);
      assert.deepEqual(sequence(f), kind === 'inventory' ? [[1, 10, false]] : [[1, 3, true], [1, 3, false]]);
    });
  }
  test(`${kind} malformed JSON rejects instead of falling back to a complete snapshot`, async t => {
    const f = await fixture(t, { kind, rawBody: '{not-json' });
    await assert.rejects(kind === 'inventory' ? f.inventory : f.bookings, error => error instanceof SyntaxError);
    assert.deepEqual(sequence(f), kind === 'inventory' ? [[1, 10, false]] : [[1, 3, true], [1, 3, false]]);
  });
}
