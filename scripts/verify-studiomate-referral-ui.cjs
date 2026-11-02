const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const output = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'core-referral-ui-'));
const html = readFileSync(path.join(repo, 'core/member-registration/index.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace('<html lang="ko">', '<html lang="ko" data-core-access="manager">');
const reports = [];
const errors = [];
let browser;

async function fixture(page, options = {}) {
  await page.goto('http://referral.local/core/member-registration/');
  await page.evaluate(async (options) => {
    window.calls = [];
    window.pending = {};
    window.dashboard = {
      enabled: true, policyConfirmed: true, complete: true,
      requests: [{
        id: 'mock-referral-1', newMemberName: '테스트신규', referrerName: '테스트추천',
        newMemberPhoneLast4: '0001', referrerPhoneLast4: '0002', status: 'pending',
        reason: 'payment_pending', updatedAt: '2026-11-02T02:00:00.000Z',
      }],
      ...options.dashboard,
    };
    window.options = options;
    window.runtime = {
      functionsClient: { mock: true },
      httpsCallable(client, name) {
        if (client !== window.runtime.functionsClient) throw new Error('wrong functions client');
        if (!['operatorCaptureStudioMateReferral', 'getStudioMateReferralDashboard'].includes(name)) throw new Error('unexpected callable');
        return async data => {
          window.calls.push({ name, data });
          if (name === 'getStudioMateReferralDashboard') {
            if (window.options.readFail) throw new Error('mock read error');
            if (window.options.holdRead) await new Promise(resolve => { window.pending.read = resolve; });
            return { data: window.dashboard };
          }
          if (window.options.holdSave) await new Promise(resolve => { window.pending.save = resolve; });
          if (window.options.saveFail) throw new Error('mock transport error with secret phone 01000009999');
          return { data: window.options.result || { requestId: 'mock-referral-2', status: 'pending', duplicate: false } };
        };
      },
    };
    window.unsubCount = 0;
    window.initialAuthRuns = 0;
    if (!options.noAuth) {
      window.runtime.authClient = { currentUser: { uid: 'mock-manager-a' } };
      window.runtime.auth = {
        onAuthStateChanged(client, next, error) {
          window.authCallback = next;
          window.authError = error;
          if (options.syncAuthChange) {
            client.currentUser = { uid: 'mock-manager-b' };
            next(client.currentUser);
          } else {
            queueMicrotask(() => { window.initialAuthRuns++; next(client.currentUser); });
          }
          return () => {
            window.unsubCount++;
            if (options.unsubscribeThrow) throw new Error('mock unsubscribe failure');
          };
        },
      };
    }
    const { mountStudioMateReferralIntake } = await import('/core/assets/studiomate-referral-intake.js');
    window.mountIntake = mountStudioMateReferralIntake;
    window.disposeIntake = await mountStudioMateReferralIntake(window.runtime, document.querySelector('[data-studiomate-referral-intake]'));
  }, options);
  if (!options.skipOpen) await page.locator('.sm-referral-details > summary').click();
}

async function fill(page) {
  await page.getByLabel('신규회원 이름', { exact: true }).fill(' 테스트신규 ');
  await page.getByLabel('신규회원 전화번호', { exact: true }).fill('010 - 0000 - 0001');
  await page.getByLabel('추천인 이름', { exact: true }).fill('테스트추천');
  await page.getByLabel('추천인 전화번호', { exact: true }).fill('010\t0000-0002');
}

const saveButton = page => page.getByRole('button', { name: '추천정보 저장', exact: true });
const refreshButton = page => page.getByRole('button', { name: '추천 기록 새로고침' });
const captures = page => page.evaluate(() => window.calls.filter(call => call.name === 'operatorCaptureStudioMateReferral'));
async function expectStatus(page, text) {
  await page.waitForFunction(text => document.querySelector('.sm-referral-status').textContent === text, text);
}

(async () => {
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      assert.equal(url.hostname, 'referral.local', 'External requests are forbidden');
      if (url.pathname === '/core/member-registration/') {
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
        return;
      }
      const allowed = new Set([
        '/core/assets/styles.css', '/core/assets/interface.css', '/core/assets/studiomate-referral-intake.css',
        '/core/assets/studiomate-referral-intake.js', '/core/assets/ui-icons.js',
      ]);
      if (allowed.has(url.pathname)) {
        await route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(path.join(repo, url.pathname)) });
      } else if (/^\/core\/(icons\/|favicon|site.webmanifest)/.test(url.pathname)) {
        await route.fulfill({ status: 204, body: '' });
      } else {
        errors.push(`Unexpected request ${url.pathname}`);
        await route.abort();
      }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));

    for (const dashboard of [
      { enabled: false, policyConfirmed: false }, { enabled: false, policyConfirmed: true },
      { enabled: true, policyConfirmed: false },
    ]) {
      await fixture(page, { dashboard, result: { requestId: 'mock-new-receipt', status: 'verification_required', duplicate: false } });
      assert.equal(await saveButton(page).isEnabled(), true);
      assert.match(await page.locator('.sm-referral-dashboard-status').textContent(), /자동 적립 준비 중/);
      await fill(page);
      await saveButton(page).click();
      await expectStatus(page, '추천정보 저장됨 · StudioMate 원본 확인 대기');
      assert.equal((await captures(page)).length, 1);
      assert.doesNotMatch(await page.locator('.sm-referral-status').textContent(), /적립 완료|지급|결제/);
      assert.match(await page.locator('.sm-referral-dashboard-status').textContent(), /자동 적립 준비 중/);
    }
    await page.screenshot({ path: path.join(output, 'disabled-390.png'), fullPage: true });
    reports.push('Receipt saving works with payouts disabled or policy unconfirmed; preparation status and source-check message retained');

    await fixture(page, { readFail: true });
    assert.equal(await saveButton(page).isDisabled(), true);
    assert.equal(await page.locator('.sm-referral-dashboard-status').textContent(), '추천 기록 조회 실패');
    reports.push('Failed dashboard still blocks receipt capture');
    await fixture(page, { dashboard: { complete: false } });
    assert.equal(await saveButton(page).isEnabled(), true);
    assert.equal(await page.locator('.sm-referral-dashboard-status').textContent(), '일부 기록 · 전체 확인 필요');
    reports.push('Partial/paginated dashboard does not block intake or imply all records are shown');

    await fixture(page);
    assert.equal(await page.locator('.sm-referral-requests').innerText(), '신규회원 테스트신규 · ***-0001\n추천인 테스트추천 · ***-0002\n확인 대기\n결제 확인 대기\n11. 02. 11:00 KST');
    await fill(page);
    await page.getByLabel('신규회원 전화번호', { exact: true }).fill('0001');
    await saveButton(page).click();
    assert.equal((await captures(page)).length, 0);
    await page.getByLabel('신규회원 전화번호', { exact: true }).fill('010 - 0000 - 0001');
    await page.getByLabel('추천인 전화번호', { exact: true }).fill('010-abc-0002');
    await saveButton(page).click();
    assert.equal((await captures(page)).length, 0);
    await page.getByLabel('추천인 전화번호', { exact: true }).fill('010\t0000-0002');
    reports.push('Short and invalid full phone values rejected without a callable');

    await page.getByLabel('추천인 전화번호', { exact: true }).fill('010-0000-0001');
    await saveButton(page).click();
    assert.equal((await captures(page)).length, 0);
    await page.getByLabel('신규회원 전화번호', { exact: true }).fill('010-0000-0003');
    assert.equal(await page.locator('input[name=referrerPhone]').evaluate(input => input.validity.valid), true);
    await fill(page);
    reports.push('Same-phone validation clears when either participant phone changes');

    await page.evaluate(() => { window.options.holdSave = true; });
    await saveButton(page).click();
    await page.waitForFunction(() => Boolean(window.pending.save));
    assert.equal(await saveButton(page).isDisabled(), true);
    assert.equal(await refreshButton(page).isDisabled(), true);
    await page.locator('.sm-referral-form').evaluate(form => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal((await captures(page)).length, 1);
    assert.deepEqual((await captures(page))[0].data, {
      newMemberName: '테스트신규', newMemberPhone: '01000000001', referrerName: '테스트추천', referrerPhone: '01000000002',
    });
    await page.evaluate(() => window.pending.save());
    await expectStatus(page, '추천정보 저장됨');
    await page.waitForFunction(() => document.querySelector('.sm-referral-dashboard-status').textContent === '추천 기록 확인됨');
    assert.equal(await saveButton(page).isDisabled(), true);
    assert.doesNotMatch(await page.locator('.sm-referral-status').textContent(), /적립|지급|결제/);
    await page.getByLabel('신규회원 이름', { exact: true }).fill('다른테스트');
    assert.equal(await saveButton(page).isEnabled(), true);
    await page.getByLabel('신규회원 이름', { exact: true }).fill('테스트신규');
    assert.equal(await saveButton(page).isDisabled(), true);
    reports.push('Normalized four-field payload; in-flight and same-payload duplicates blocked; save never implies payment');

    await fixture(page, { result: { requestId: 'existing-mock', status: 'paid', duplicate: true } });
    await fill(page);
    await saveButton(page).click();
    await expectStatus(page, '기존 추천정보 확인됨');
    assert.doesNotMatch(await page.locator('.sm-referral-status').textContent(), /적립|지급|결제/);
    reports.push('Duplicate receipt acknowledges an existing record only');

    for (const status of ['verification_required', 'source_check_required', 'source_check_pending', 'native_verification_required']) {
      await fixture(page, { result: { requestId: 'mock-source-check', status, duplicate: false } });
      await page.evaluate(status => {
        window.dashboard.requests[0].status = status;
        window.dashboard.requests[0].reason = 'fresh_complete_excel_required';
      }, status);
      await fill(page);
      await saveButton(page).click();
      await page.waitForFunction(() => document.querySelector('.sm-referral-status').textContent.includes('StudioMate 원본 확인'));
      await page.waitForFunction(() => document.querySelector('.sm-referral-requests').textContent.includes('최신 Excel 원본 확인 필요'));
      assert.match(await page.locator('.sm-referral-request-status').innerText(), /StudioMate 원본 확인/);
    }
    reports.push('Source-check request statuses and latest-Excel reason use fixed operator messages');

    for (const options of [{ saveFail: true }, { result: { requestId: '', duplicate: false } }]) {
      await fixture(page, options);
      await fill(page);
      const before = await page.locator('.sm-referral-form input').evaluateAll(inputs => inputs.map(input => input.value));
      await saveButton(page).click();
      await expectStatus(page, '저장 결과 미확인 · 목록 확인 필요');
      assert.deepEqual(await page.locator('.sm-referral-form input').evaluateAll(inputs => inputs.map(input => input.value)), before);
      assert.equal(await saveButton(page).isDisabled(), true);
      assert.equal((await page.evaluate(() => window.calls)).length, 2, 'No automatic read or retry of an uncertain save');
      await page.evaluate(() => { window.options.readFail = true; });
      await refreshButton(page).click();
      await page.waitForFunction(() => document.querySelector('.sm-referral-dashboard-status').textContent === '추천 기록 조회 실패');
      assert.equal(await saveButton(page).isDisabled(), true);
      await page.evaluate(() => { window.options.readFail = false; window.dashboard.requests = []; });
      await refreshButton(page).click();
      await expectStatus(page, '저장 결과 미확인 · 운영 확인 필요');
      assert.equal(await saveButton(page).isDisabled(), true);
      await page.evaluate(() => window.mountIntake(window.runtime, document.querySelector('[data-studiomate-referral-intake]')));
      assert.equal(await saveButton(page).isDisabled(), true);
      assert.deepEqual(await page.locator('.sm-referral-form input').evaluateAll(inputs => inputs.map(input => input.value)), before);
      await page.locator('.sm-referral-form').evaluate(form => form.dispatchEvent(new Event('submit', { cancelable: true })));
      assert.equal((await captures(page)).length, 1);
      assert.doesNotMatch(await page.locator('.sm-referral-details').innerText(), /01000009999/);
    }
    await page.screenshot({ path: path.join(output, 'uncertain-390.png'), fullPage: true });
    reports.push('Network/malformed results preserve fields and block retries even after failed or empty dashboard reads');

    await fixture(page);
    await page.evaluate(() => {
      window.dashboard.requests = [{
        id: 'malicious-mock', newMemberName: '<img src=x onerror=alert(1)>', referrerName: '긴테스트이름'.repeat(15),
        newMemberPhoneLast4: '01000000001', referrerPhoneLast4: '<script>',
        status: 'raw-private-status-01000009999', reason: 'raw-private-reason-01000009999', updatedAt: 'raw-private-date-01000009999',
      }];
    });
    await refreshButton(page).click();
    await page.waitForFunction(() => document.querySelector('.sm-referral-requests').textContent.includes('<img'));
    const listText = await page.locator('.sm-referral-requests').innerText();
    assert.doesNotMatch(listText, /01000000001|01000009999|<script>/);
    assert.equal(await page.locator('.sm-referral-requests img').count(), 0);
    reports.push('Unsafe response strings are text-only; full phones and unknown reason/status text are not rendered');

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const overflow = await page.locator('.sm-referral-intake').evaluate(host => [...host.querySelectorAll('li,li span,li strong')]
        .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.tagName));
      assert.deepEqual(overflow, [], `Long-name overflow at ${width}`);
    }
    reports.push('Long unbroken names wrap at all four viewport widths');

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await fixture(page);
      await page.evaluate(() => {
        window.dashboard.requests[0].status = 'verification_required';
        window.dashboard.requests[0].reason = 'fresh_complete_excel_required';
      });
      await page.evaluate(() => window.disposeIntake.refresh());
      await fill(page);
      const summary = page.locator('.sm-referral-details > summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.sm-referral-details').getAttribute('open'), null);
      await page.keyboard.press('Enter');
      assert.notEqual(await page.locator('.sm-referral-details').getAttribute('open'), null);
      const layout = await page.evaluate(() => {
        const host = document.querySelector('.sm-referral-intake');
        const visible = [...host.querySelectorAll('summary,input,button,label,p,li')].filter(node => node.getClientRects().length);
        return {
          viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          clipped: visible.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.tagName),
          undersized: [...host.querySelectorAll('summary,input,button')].filter(node => node.getBoundingClientRect().height < 44).map(node => node.tagName),
          focusStyle: getComputedStyle(document.activeElement).outlineStyle,
          formInputs: [...host.querySelectorAll('input')].map(input => input.name),
        };
      });
      assert.ok(layout.scrollWidth <= layout.viewport, JSON.stringify(layout));
      assert.deepEqual(layout.clipped, [], JSON.stringify(layout));
      assert.deepEqual(layout.undersized, [], JSON.stringify(layout));
      assert.notEqual(layout.focusStyle, 'none');
      assert.deepEqual(layout.formInputs, ['newMemberName', 'newMemberPhone', 'referrerName', 'referrerPhone']);
      await page.screenshot({ path: path.join(output, `responsive-${width}.png`), fullPage: true });
      reports.push(`Responsive ${width}px: no overflow or clipped text; 44px targets, visible focus and keyboard collapse`);
    }

    const readsBefore = await page.evaluate(() => window.calls.length);
    const fieldsBefore = await page.locator('.sm-referral-form input').evaluateAll(inputs => inputs.map(input => input.value));
    await page.evaluate(async () => {
      const disposeAgain = await window.mountIntake(window.runtime, document.querySelector('[data-studiomate-referral-intake]'));
      if (disposeAgain !== window.disposeIntake) throw new Error('mount not idempotent');
    });
    assert.equal(await page.evaluate(() => window.calls.length), readsBefore + 1);
    assert.deepEqual(await page.locator('.sm-referral-form input').evaluateAll(inputs => inputs.map(input => input.value)), fieldsBefore);
    await page.evaluate(() => window.disposeIntake.refresh());
    assert.equal(await page.evaluate(() => window.calls.length), readsBefore + 2);
    await page.evaluate(() => window.disposeIntake());
    assert.equal(await page.locator('[data-studiomate-referral-intake]').innerHTML(), '');
    assert.equal(await page.locator('[data-studiomate-referral-intake]').isHidden(), true);
    assert.equal(await page.evaluate(() => window.unsubCount), 1);
    reports.push('Repeated mount refreshes in place; disposer.refresh exposes a read-only reload without losing inputs');

    for (const change of ['logout', 'uid-change', 'auth-error', 'pagehide']) {
      await fixture(page, { unsubscribeThrow: change === 'pagehide' });
      await fill(page);
      assert.equal(await page.evaluate(() => window.initialAuthRuns), 1);
      await page.evaluate(change => {
        window.retainedInputs = [...document.querySelectorAll('.sm-referral-form input')];
        if (change === 'pagehide') window.dispatchEvent(new Event('pagehide'));
        else if (change === 'auth-error') window.authError(new Error('mock auth error'));
        else {
          window.runtime.authClient.currentUser = change === 'logout' ? null : { uid: 'mock-manager-b' };
          window.authCallback(window.runtime.authClient.currentUser);
        }
        // A stale callback and repeated teardown must not resurrect UI or unsubscribe twice.
        window.authCallback({ uid: 'mock-manager-a' });
        window.disposeIntake();
      }, change);
      assert.equal(await page.locator('[data-studiomate-referral-intake]').isHidden(), true);
      assert.equal(await page.locator('[data-studiomate-referral-intake]').innerHTML(), '');
      assert.deepEqual(await page.evaluate(() => window.retainedInputs.map(input => input.value)), ['', '', '', '']);
      assert.equal(await page.evaluate(() => window.unsubCount), 1);
    }
    reports.push('Logout, UID change, auth error and pagehide dispose and clear detached inputs, even if unsubscribe throws');

    await fixture(page, { syncAuthChange: true, skipOpen: true });
    assert.equal(await page.locator('[data-studiomate-referral-intake]').isHidden(), true);
    assert.equal(await page.evaluate(() => window.unsubCount), 1);
    assert.equal(await page.evaluate(() => window.calls.length), 0);
    reports.push('Synchronous initial account-change callback safely unsubscribes before starting a dashboard read');

    await fixture(page);
    await fill(page);
    await page.evaluate(() => {
      window.options.holdRead = true;
      window.readPromise = window.disposeIntake.refresh();
    });
    await page.waitForFunction(() => Boolean(window.pending.read));
    await page.evaluate(async () => {
      window.retainedInputs = [...document.querySelectorAll('.sm-referral-form input')];
      window.dispatchEvent(new Event('pagehide'));
      window.pending.read();
      await window.readPromise;
    });
    assert.equal(await page.locator('[data-studiomate-referral-intake]').innerHTML(), '');
    assert.deepEqual(await page.evaluate(() => window.retainedInputs.map(input => input.value)), ['', '', '', '']);
    reports.push('Late dashboard response after pagehide cannot restore input or list content');

    await fixture(page);
    await fill(page);
    await page.evaluate(() => { window.runtime.authClient.currentUser = { uid: 'mock-manager-b' }; });
    await saveButton(page).click();
    assert.equal((await captures(page)).length, 0);
    assert.equal(await page.locator('[data-studiomate-referral-intake]').isHidden(), true);
    reports.push('UID change before delayed auth callback blocks capture and disposes stale identity fields');

    await fixture(page, { noAuth: true });
    await fill(page);
    assert.equal(await saveButton(page).isEnabled(), true);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.locator('[data-studiomate-referral-intake]').isHidden(), true);
    reports.push('Pagehide cleanup works when auth observer API is unavailable');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(JSON.stringify({ result: 'PASS', checks: reports, screenshots: output, externalNetworkRequests: 0, productionWrites: 0 }, null, 2));
  } finally {
    if (browser) {
      await browser.close();
      assert.equal(browser.isConnected(), false);
      assert.equal(browser.contexts().length, 0);
    }
    console.log('Task-owned browser closed');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
