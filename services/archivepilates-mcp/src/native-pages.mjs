import { requireValue } from './errors.mjs';
import { normalizeMemberPage, normalizeBookingPage } from './native-model.mjs';
import { extractIdentityDom, validateIdentity } from './live-dom.mjs';

const API = 'https://api.studiomate.kr';
const memberPath = '/v2/staff/members';

function responseFor(page, pathname, pageNumber, extra = () => true) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.origin === API && url.pathname === pathname
      && Number(url.searchParams.get('page') || 1) === pageNumber && extra(url);
  }, { timeout: 12000 }).catch(() => null);
}

async function readResponse(response) {
  requireValue(response?.ok() && !await response.finished(), 'LIVE_INCOMPLETE',
    'StudioMate 원본 목록의 조회 완료를 확인하지 못했습니다. 저장 자료로 대체하지 않았습니다.');
  return response.json();
}

async function currentPage(page, number, scope = '') {
  await page.waitForFunction(({ selector, number }) => {
    const nodes = [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length);
    return nodes.length === 1 && nodes[0].textContent.trim() === String(number);
  }, { selector: `${scope}.el-pagination li.number.active`, number });
}

async function nextPage(page, scope, pending) {
  const next = page.locator(`${scope}.el-pagination .btn-next`);
  requireValue(await next.count() === 1 && await next.isEnabled(), 'LIVE_INCOMPLETE',
    '원본 목록의 다음 페이지를 확인하지 못했습니다. 일부를 전체 목록으로 표시하지 않았습니다.');
  await next.click();
  return readResponse(await pending);
}

export async function readNativeInventory(page, { navigate, checkpoint }) {
  const startedAt = new Date().toISOString();
  let pending = responseFor(page, memberPath, 1);
  await navigate(page, '/users');
  let response = await pending;
  let first = normalizeMemberPage(await readResponse(response), response.url(), { page: 1 });
  // This is a local view change only; the context's write gate remains GET/HEAD/OPTIONS only.
  if (first.total > 10 && first.perPage < 50) {
    await page.locator('.el-pagination .el-select .el-input__inner').click();
    pending = responseFor(page, memberPath, 1, url => url.searchParams.get('limit') === '50');
    await page.getByText('50/page', { exact: true }).click();
    response = await pending;
    first = normalizeMemberPage(await readResponse(response), response.url(), { page: 1, total: first.total });
  }
  const profiles = [...first.profiles], seen = new Set(profiles.map(p => p.memberId));
  for (let number = 2; number <= first.lastPage; number++) {
    checkpoint(page);
    await currentPage(page, number - 1);
    pending = responseFor(page, memberPath, number);
    const body = await nextPage(page, '', pending);
    response = await pending;
    const next = normalizeMemberPage(body, response.url(), { page: number, total: first.total, perPage: first.perPage });
    for (const profile of next.profiles) {
      requireValue(!seen.has(profile.memberId), 'LIVE_CHANGED', '조회 중 회원 목록의 순서·범위가 변경됐습니다. 다시 조회하세요.');
      seen.add(profile.memberId); profiles.push(profile);
    }
  }
  requireValue(profiles.length === first.total, 'LIVE_INCOMPLETE', '원본 총 회원 수와 조회 건수가 다릅니다.');
  if (first.lastPage > 1) {
    await currentPage(page, first.lastPage);
    pending = responseFor(page, memberPath, 1);
    await page.locator('.el-pagination li.number').filter({ hasText: /^1$/ }).click();
    response = await pending;
    const repeated = normalizeMemberPage(await readResponse(response), response.url(), { page: 1, total: first.total, perPage: first.perPage });
    requireValue(JSON.stringify(repeated.profiles) === JSON.stringify(first.profiles), 'LIVE_CHANGED',
      '전체 조회 중 첫 페이지 원본이 바뀌었습니다. 최신 전체 명단을 확정하지 않았습니다.');
  }
  checkpoint(page);
  return { profiles, startedAt, coverage: { kind: 'native_member_pages', complete: true,
    nativeTotal: first.total, scannedMembers: profiles.length, pageCount: first.lastPage,
    atomicSnapshot: false, pointInTimeComplete: false, traversalComplete: true,
    completenessBasis: 'pagination_traversal', scope: 'member_roster',
    pagesTraversed: first.lastPage, pagesRechecked: first.lastPage > 1 ? 1 : 0,
    stabilityCheck: first.lastPage > 1 ? 'first_page_rechecked_only' : 'single_page_observed',
    ticketScope: 'member_list_userTickets', sourceWindowStartedAt: startedAt } };
}

export async function readNativeBookings(page, expected, range, { navigate, checkpoint, waitIdentity }) {
  const startedAt = new Date().toISOString();
  const pathname = `/staff/member/${expected.memberId}/booking`;
  await navigate(page, `/users/detail?id=${expected.memberId}`);
  await waitIdentity(page);
  validateIdentity(await page.evaluate(extractIdentityDom), expected);
  await page.locator('.member-detail__header-tabs').getByText('이용내역', { exact: true }).click();
  const tabs = page.locator('.member-history__header__tabs');
  await tabs.waitFor({ state: 'visible' });
  // Force an explicit all-status read, even if a previously mounted default view looks empty.
  await tabs.getByText(/^\s*예약\(\d+\)\s*$/).click();
  let pending = responseFor(page, pathname, 1, url => !url.searchParams.has('status[]'));
  await tabs.getByText(/^\s*전체\(\d+\)\s*$/).click();
  let response = await pending;
  const first = normalizeBookingPage(await readResponse(response), response.url(), { memberId: expected.memberId, page: 1 });
  const order = page.locator('.member-history__header__buttons__order-by-select input');
  requireValue(await order.inputValue() === '수업일 내림차순', 'LIVE_INCOMPLETE', '원본 예약 정렬 범위를 확인해야 합니다.');
  const records = [], seen = new Set(), traversed = [];
  let lastStart = null, pages = 0, dateBoundary = false;
  function add(part) {
    traversed.push(part);
    pages++;
    for (const row of part.records) {
      requireValue(!seen.has(row.bookingId) && (!lastStart || row.startAt <= lastStart), 'LIVE_CHANGED',
        '조회 중 예약 순서·중복 원본이 변경됐습니다. 전체 결과로 표시하지 않았습니다.');
      seen.add(row.bookingId); lastStart = row.startAt;
      if (row.lectureDate < range.startDate) dateBoundary = true;
      if (row.lectureDate >= range.startDate && row.lectureDate <= range.endDate) records.push(row);
    }
    requireValue(seen.size <= 2000 && records.length <= 200, 'SOURCE_LIMIT', '예약 원본 조회 한도를 넘었습니다. 기간을 좁혀 주세요.');
  }
  add(first);
  for (let number = 2; number <= first.lastPage && !dateBoundary; number++) {
    checkpoint(page);
    await currentPage(page, number - 1, '.member-detail__body ');
    pending = responseFor(page, pathname, number, url => !url.searchParams.has('status[]'));
    const body = await nextPage(page, '.member-detail__body ', pending);
    response = await pending;
    add(normalizeBookingPage(body, response.url(), { memberId: expected.memberId, page: number,
      total: first.total, perPage: first.perPage }));
  }
  if (pages > 1) {
    await currentPage(page, pages, '.member-detail__body ');
    pending = responseFor(page, pathname, 1, url => !url.searchParams.has('status[]'));
    await page.locator('.member-detail__body .el-pagination li.number').filter({ hasText: /^1$/ }).click();
    for (let number = 1; number <= pages; number++) {
      checkpoint(page);
      response = await pending;
      const repeated = normalizeBookingPage(await readResponse(response), response.url(), {
        memberId: expected.memberId, page: number, total: first.total, perPage: first.perPage });
      requireValue(JSON.stringify(repeated) === JSON.stringify(traversed[number - 1]), 'LIVE_CHANGED',
        '예약 원본 페이지가 조회 중 바뀌었습니다. 전체 결과로 확정하지 않았습니다.');
      if (number < pages) {
        await currentPage(page, number, '.member-detail__body ');
        pending = responseFor(page, pathname, number + 1, url => !url.searchParams.has('status[]'));
        await nextPage(page, '.member-detail__body ', pending);
      }
    }
  }
  validateIdentity(await page.evaluate(extractIdentityDom), expected);
  checkpoint(page);
  return { ...expected, records, startedAt, coverage: { kind: 'native_member_booking_history', complete: true,
    nativeHistoryTotal: first.total, scannedBookings: seen.size, pageCount: pages,
    fullHistoryComplete: seen.size === first.total, fullHistoryScanned: seen.size === first.total,
    dateBoundaryReached: dateBoundary, atomicSnapshot: false, pointInTimeComplete: false,
    traversalComplete: true, stabilityCheck: pages > 1 ? 'traversed_pages_rechecked' : 'single_page_observed',
    completenessBasis: 'pagination_traversal', scope: 'requested_date_range',
    pagesTraversed: pages, pagesRechecked: pages > 1 ? pages : 0,
    requestedRange: { ...range }, sourceWindowStartedAt: startedAt } };
}
