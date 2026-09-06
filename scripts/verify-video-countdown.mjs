import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const asset = new URL('official-home/assets/imweb-video-countdown-20260906.js', root);
const source = await readFile(asset, 'utf8');
const live = process.argv.includes('--live');
const output = new URL(`artifacts/countdown-20260906/${live ? 'live' : 'local'}/`, root);
await mkdir(output, { recursive: true });
const results = [];
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const width of [320, 390, 768, 1440]) {
    for (const [type, path] of [['list', '/17'], ['detail', '/17/?idx=84']]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      try {
        // Keep future local checks from accidentally exercising the deployed singleton.
        if (!live) await context.route('https://archivepilates.com/assets/imweb-video-countdown-*.js', request => request.fulfill({ contentType: 'application/javascript', body: '' }));
        const page = await context.newPage();
        await page.goto(`https://archivepilates.imweb.me${path}`, { waitUntil: 'domcontentloaded' });
        if (!live) await page.addScriptTag({ content: source });
        const countdown = page.getByTestId('video-price-countdown');
        await countdown.waitFor({ state: 'visible', timeout: 20000 });
        assert.equal(await countdown.count(), 1);
        await page.evaluate(() => document.fonts.ready);
        await countdown.scrollIntoViewIfNeeded();
        const before = await countdown.boundingBox();
        const seconds = await countdown.innerText();
        await page.waitForFunction(previous => document.querySelector('[data-testid="video-price-countdown"]').innerText !== previous, seconds);
        const after = await countdown.boundingBox();
        assert.equal(before.width, after.width);
        assert.equal(before.height, after.height);
        const geometry = await countdown.evaluate(el => {
          const b = el.getBoundingClientRect();
          return { left: b.left, right: b.right, viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
            clipped: [...el.querySelectorAll('*')].filter(n => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).display !== 'inline').map(n => n.className),
            outside: [...el.querySelectorAll('*')].filter(n => { const r = n.getBoundingClientRect(); return r.left < b.left || r.right > b.right; }).map(n => n.className),
            rightBorder: getComputedStyle(el).borderRightWidth,
            nativePrice: document.querySelector('.real_price')?.textContent.trim() };
        });
        assert.ok(geometry.left >= 0 && geometry.right <= width + 1);
        assert.equal(geometry.overflow, false);
        assert.deepEqual(geometry.clipped, []);
        assert.deepEqual(geometry.outside, []);
        assert.ok(parseFloat(geometry.rightBorder) > 0 && parseFloat(geometry.rightBorder) <= 2);
        if (type === 'detail') assert.equal(geometry.nativePrice, '15,000원');
        await page.screenshot({ path: new URL(`${type}-${width}.png`, output).pathname });
        results.push({ type, width, ...geometry, stableCounter: true });
      } finally { await context.close(); }
    }
  }
  // Deterministic time and route fixtures never contact commerce endpoints.
  const context = await browser.newContext();
  try {
    await context.route('https://archivepilates.imweb.me/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><head></head><body><main><section class="ap-video-sales"></section><header><h1 class="view_tit">캐딜락 지지와 움직임 (ACA6)</h1><div class="pay_detail"><span class="real_price">15,000원</span></div></header></main></body></html>' }));
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-09-30T14:59:50Z') });
    await page.clock.pauseAt(new Date('2026-09-30T14:59:58Z'));
    await page.goto('https://archivepilates.imweb.me/17/?idx=84');
    await page.addScriptTag({ content: source });
    await page.addScriptTag({ content: source });
    assert.equal(await page.getByTestId('video-price-countdown').count(), 1);
    assert.match(await page.getByTestId('video-price-countdown').innerText(), /02/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await page.clock.runFor(1100);
    assert.equal(await page.getByTestId('video-price-countdown').count(), 0);
    assert.equal(await page.getByText('15,000원', { exact: true }).count(), 1);
    for (const path of ['/16?ap_shop=knitido', '/18', '/my-classroom', '/archive-method-watch-aca6', '/17?mode=login', '/17?idx=34', '/17?idx=999']) {
      await page.goto(`https://archivepilates.imweb.me${path}`);
      await page.clock.setSystemTime(new Date('2026-09-06T03:00:00Z'));
      await page.addScriptTag({ content: source });
      assert.equal(await page.getByTestId('video-price-countdown').count(), 0, path);
    }
    results.push({ expiry: true, nativePricePreserved: true, deduplication: true, reducedMotion: true, excludedRoutes: 7 });
  } finally { await context.close(); }
} finally { await browser.close(); }
await writeFile(new URL('results.json', output), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ live, passed: results.length, results }));
