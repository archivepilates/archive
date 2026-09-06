import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const source = await readFile(new URL('../official-home/assets/imweb-video-sales-20260730b.js', import.meta.url), 'utf8');
const ids = [27, 28, 29, 30, 31, 44, 47, 79];
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const price of [15000, 20000, 22000]) {
    const context = await browser.newContext();
    try {
      await context.route('**/*', route => {
        if (route.request().resourceType() !== 'document') return route.abort();
        const items = ids.map(idx => `<article class="shop-item _shop_item" data-product-properties='${JSON.stringify({idx, price})}'></article>`).join('');
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<main>${items}</main>` });
      });
      const page = await context.newPage();
      await page.goto('https://archivepilates.imweb.me/17');
      await page.addScriptTag({ content: source });
      const cards = page.getByRole('link').filter({ hasText: /BEST 0[1-3]/ });
      assert.equal(await cards.count(), 3);
      for (const text of await cards.allTextContents()) assert.ok(text.includes(price.toLocaleString('ko-KR') + '원'), text);
      console.log(JSON.stringify({ nativePrice: price, recommendedCards: 3, passed: true }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
