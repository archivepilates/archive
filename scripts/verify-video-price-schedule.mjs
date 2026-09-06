import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const ids = [27,28,29,30,31,32,33,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,79,80,84,85];
const dir = new URL('../artifacts/video-price-schedule-20260906/', import.meta.url);
const results = [];
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    for (const id of ids) {
      const after = JSON.parse(readFileSync(new URL(`after-${id}.json`, dir)));
      assert.equal(after.price, 20000);
      assert.equal(after.discountOptions.period, 'Y');
      const response = await page.goto(`https://archivepilates.imweb.me/17/?idx=${id}`, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      const html = await response.text();
      const match = html.match(/PeriodDiscountData\(\s*1,\s*(\{.*?\})\s*,\s*\[\]/s);
      assert.ok(match, `Missing native discount on ${id}`);
      const native = JSON.parse(match[1]);
      assert.equal(native.use_period, true);
      assert.equal(native.start_time, '2026-09-06 00:00');
      assert.equal(native.end_time, '2026-10-01 00:00');
      const targets = Object.values(native.target);
      assert.equal(targets.length, 1);
      assert.equal(targets[0].group_type, 'guest');
      assert.equal(targets[0].dc_amount, 5000);
      assert.equal(targets[0].dc_type, 'price');
      await page.getByTestId('video-price-countdown').waitFor({ state: 'visible' });
      const price = await page.evaluate(() => document.querySelector('.real_price')?.textContent.trim());
      assert.equal(price, '15,000원');
      results.push({ id, basePrice: after.price, currentPrice: 15000, discount: 5000, endKst: native.end_time, periodDays: after.prodDigitalData.subscribeData.period });
      console.log(JSON.stringify({ id, verified: true }));
    }
  } finally { await context.close(); }
} finally { await browser.close(); }
writeFileSync(new URL('public-verification.json', dir), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ verifiedCount: results.length }));
