import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { acquireStudioMateBrowserLock } from '../../../scripts/lib/studiomate-browser-lock.mjs';
import { OperationError, requireValue } from './errors.mjs';
import { STUDIO_ORIGIN, clean, assertMemberUrl, extractSearchDom, validateSearch,
  extractOverviewDom, validateOverview } from './live-dom.mjs';

export const allowReadRequest = method => ['GET', 'HEAD', 'OPTIONS'].includes(method);

export function createLiveReader({ launch = options => chromium.launchPersistentContext(
  path.join(os.homedir(), 'ArchiveIN/automation/browser-profile'), options),
  acquire = acquireStudioMateBrowserLock, budgetMs = 45000, cleanupMs = 5000 } = {}) {
  const active = new Map();
  const pending = new Set();
  const cancelActive = new Set();
  const guards = new WeakMap();
  let stopped = false;
  function closeResource(resource) {
    if (!resource.closing) resource.closing = Promise.resolve().then(async () => {
      await resource.context.close();
      await resource.release();
      active.delete(resource.context);
    }).catch(error => { resource.closing = null; throw error; });
    return resource.closing;
  }
  async function boundedClose(resource) {
    let timer;
    try {
      await Promise.race([closeResource(resource), new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('cleanup deadline')), cleanupMs);
      })]);
    } catch {
      throw new OperationError('LIVE_CLEANUP_REQUIRED', '조회 브라우저 종료를 확인하지 못해 잠금을 유지했습니다. 운영자 확인이 필요합니다.');
    } finally { clearTimeout(timer); }
  }
  const checkpoint = page => guards.get(page)?.();
  async function runSession(run, signal) {
    requireValue(!stopped && !signal?.aborted, 'LIVE_CANCELLED', '조회를 중단했습니다.');
    let release, context, resource, timer, expired = false, rejectStopped;
    const started = Date.now();
    const interrupt = new Promise((_resolve, reject) => { rejectStopped = reject; });
    // Observe early cancellation even if browser setup has not reached the race yet.
    void interrupt.catch(() => {});
    const abort = () => {
      rejectStopped(new OperationError(expired ? 'LIVE_TIMEOUT' : 'LIVE_CANCELLED',
        expired ? '실시간 조회 제한시간을 넘었습니다. 저장 자료로 대체하지 않았습니다.' : '조회를 중단했습니다.'));
      if (resource) void closeResource(resource).catch(() => {});
    };
    try {
      try { release = await acquire({ owner: 'archivepilates-mcp-live-read', waitMs: 5000 }); }
      catch { throw new OperationError('LIVE_BUSY', '다른 StudioMate 작업이 브라우저를 사용 중입니다. 잠시 후 다시 조회하세요.'); }
      requireValue(!stopped && !signal?.aborted, 'LIVE_CANCELLED', '조회를 중단했습니다.');
      context = await launch({ headless: true, serviceWorkers: 'block', timeout: 10000 });
      resource = { context, release };
      active.set(context, resource);
      requireValue(!stopped && !signal?.aborted, 'LIVE_CANCELLED', '조회를 중단했습니다.');
      timer = setTimeout(() => { expired = true; abort(); }, Math.max(1, budgetMs - (Date.now() - started)));
      signal?.addEventListener('abort', abort, { once: true });
      cancelActive.add(abort);
      const assertRunning = () => requireValue(!expired && !signal?.aborted && !stopped,
        expired ? 'LIVE_TIMEOUT' : 'LIVE_CANCELLED', '조회를 중단했습니다.');
      const execute = async () => {
        assertRunning();
        context.setDefaultTimeout(8000);
        context.setDefaultNavigationTimeout(12000);
        await context.route('**/*', route => allowReadRequest(route.request().method())
          ? route.fallback() : route.abort('blockedbyclient'));
        assertRunning();
        const page = await context.newPage();
        assertRunning();
        guards.set(page, assertRunning);
        return run(page);
      };
      const result = await Promise.race([execute(), interrupt]);
      requireValue(!expired && !signal?.aborted && !stopped, 'LIVE_CANCELLED', '조회를 중단했습니다.');
      return { ...result, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started };
    } catch (error) {
      if (expired) throw new OperationError('LIVE_TIMEOUT', '실시간 조회 제한시간을 넘었습니다. 저장 자료로 대체하지 않았습니다.');
      if (signal?.aborted || stopped) throw new OperationError('LIVE_CANCELLED', '조회를 중단했습니다.');
      if (error instanceof OperationError) throw error;
      throw new OperationError('LIVE_UNAVAILABLE', 'StudioMate 실시간 화면을 확인하지 못했습니다. 로그인·화면·통신 상태를 확인하세요.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      cancelActive.delete(abort);
      // Keep exclusive ownership until the task-owned browser has actually closed.
      if (resource) await boundedClose(resource);
      else await release?.();
    }
  }
  function session(run, signal) {
    const promise = runSession(run, signal);
    pending.add(promise);
    void promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  }
  async function navigate(page, pathname) {
    checkpoint(page);
    await page.goto(`${STUDIO_ORIGIN}${pathname}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('.member-detail__header, .search-bar, input[type="password"]'));
    const url = new URL(page.url());
    requireValue(url.origin === STUDIO_ORIGIN, 'LIVE_IDENTITY_MISMATCH', 'StudioMate 센터 주소가 다릅니다.');
    requireValue(!(await page.getByRole('textbox', { name: /비밀번호/ }).count())
      && !(await page.locator('input[type="password"]').count()) && !/login|signin/i.test(url.pathname),
    'LIVE_LOGIN_REQUIRED', 'StudioMate 로그인이 만료됐습니다. 맥미니에서 재인증한 뒤 다시 조회하세요.');
    requireValue(url.pathname === pathname.split('?')[0], 'LIVE_IDENTITY_MISMATCH', 'StudioMate 조회 화면 주소가 다릅니다.');
  }
  async function search(page, query, isPhone) {
    checkpoint(page);
    await navigate(page, '/users');
    const response = page.waitForResponse(value => value.request().method() === 'GET'
      && new URL(value.url()).pathname.endsWith('/members/top-bar-search')
      && [...new URL(value.url()).searchParams.values()].includes(query), { timeout: 10000 }).catch(() => null);
    // Only completion/status is observed; no private API body or authorization is read.
    await page.getByRole('textbox', { name: '이름 또는 전화번호로 검색' }).fill(query);
    const received = await response;
    checkpoint(page);
    requireValue(received?.ok(), 'LIVE_UNAVAILABLE', 'StudioMate 검색 화면 조회에 실패했습니다.');
    await page.waitForFunction(() => {
      const bar = document.querySelector('.search-bar');
      return bar && [...bar.querySelectorAll('.members .member, .no-member')].some(e => e.getClientRects().length);
    });
    return validateSearch(await page.evaluate(extractSearchDom), query, isPhone);
  }
  async function openSelected(page, expected) {
    checkpoint(page);
    const rows = await search(page, expected.phone, true);
    requireValue(rows.filter(row => row.name === expected.name && row.phone === expected.phone).length === 1,
      'LIVE_IDENTITY_MISMATCH', '선택한 회원의 이름·전체 전화번호가 현재 검색 결과와 다릅니다.');
    const target = page.locator('.search-bar .members .member').filter({ has: page.locator('.name', { hasText: new RegExp(`^${escape(expected.name)}$`) }) })
      .filter({ has: page.locator('.mobile', { hasText: new RegExp(`^${expected.phone.slice(0, 3)}[- ]?${expected.phone.slice(3, -4)}[- ]?${expected.phone.slice(-4)}$`) }) });
    requireValue(await target.count() === 1, 'LIVE_AMBIGUOUS', '검색 화면에서 한 명을 확정하지 못했습니다.');
    checkpoint(page);
    await target.click();
    await page.waitForURL(url => url.origin === STUDIO_ORIGIN && url.pathname === '/users/detail' && /^[1-9]\d+$/.test(url.searchParams.get('id') || ''));
    await page.waitForLoadState('networkidle');
    const memberId = new URL(page.url()).searchParams.get('id');
    assertMemberUrl(page.url(), memberId);
    if (expected.memberId) requireValue(memberId === expected.memberId, 'LIVE_IDENTITY_MISMATCH', '선택한 StudioMate 회원 ID가 달라졌습니다.');
    await waitOverview(page);
    checkpoint(page);
    const raw = await page.evaluate(extractOverviewDom);
    const detail = validateOverview(raw, expected);
    return { memberId, detail, raw };
  }
  async function waitOverview(page) {
    checkpoint(page);
    await page.waitForFunction(() => {
      const sections = [...document.querySelectorAll('.member-basic__user-tickets')];
      const section = sections.find(e => e.querySelector('.userticket-card__extra__add-new'));
      return !!document.querySelector('.member-detail__header__mobile span')?.textContent?.trim() && section
        && ![...section.querySelectorAll('.el-loading-mask')].some(e => e.getClientRects().length > 0);
    });
  }
  return {
    findMembers: (query, isPhone, signal) => session(async page => {
      const rows = await search(page, query, isPhone), members = [];
      for (const expected of rows) {
        const value = await openSelected(page, expected);
        members.push({ memberId: value.memberId, name: value.detail.name, phone: value.detail.phone });
      }
      requireValue(new Set(members.map(row => row.memberId)).size === members.length,
        'LIVE_AMBIGUOUS', '검색 결과의 회원 ID가 중복됩니다.');
      return { members, coverage: 'visible_exact_matches' };
    }, signal),
    getOverview: (expected, signal) => session(async page => {
      const first = await openSelected(page, expected);
      // Two fresh navigations detect changing/partially rendered tickets without a cached fallback.
      await navigate(page, `/users/detail?id=${first.memberId}`);
      await waitOverview(page);
      assertMemberUrl(page.url(), first.memberId);
      const second = validateOverview(await page.evaluate(extractOverviewDom), expected);
      requireValue(JSON.stringify(first.detail) === JSON.stringify(second), 'LIVE_CHANGED', '조회 중 회원·수강권 정보가 바뀌었습니다. 다시 조회하세요.');
      return { memberId: first.memberId, ...second, coverage: 'current_ticket_cards', ticketIdsAvailable: false };
    }, signal),
    close: async () => {
      stopped = true;
      for (const cancel of cancelActive) cancel();
      await Promise.all([...active.values()].map(boundedClose));
      await Promise.allSettled([...pending]);
    },
  };
}

function escape(value) { return clean(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
