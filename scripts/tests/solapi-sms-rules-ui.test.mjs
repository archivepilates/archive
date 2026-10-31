import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url);
const output = new URL('artifacts/solapi-sms-rules/', root);
const origin = 'https://solapi-sms-rules.invalid';
const fixtureUrl = `${origin}/core/rules/`;
const sectionId = 'member-sms-solapi-20261031';

test('actual SOLAPI rules section fits 320/390/768/1440 with inert HTML and local CSS', { timeout: 90000 }, async t => {
  const html = await readFile(new URL('core/rules/index.html', root), 'utf8');
  const assets = new Map();
  for (const name of ['styles.css', 'interface.css']) assets.set(`${origin}/core/assets/${name}`,
    { contentType: 'text/css', body: await readFile(new URL(`core/assets/${name}`, root), 'utf8') });
  await mkdir(output, { recursive: true });
  const reports = [], requests = [], errors = [];
  let browser, contextsClosed = false;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ offline: true, serviceWorkers: 'block',
      storageState: { cookies: [], origins: [] }, reducedMotion: 'reduce' });
    try {
      await context.route('**/*', async route => {
        const request = route.request(), asset = request.method() === 'GET' && assets.get(request.url());
        requests.push({ url: request.url(), method: request.method(), local: Boolean(asset) });
        if (!asset) return route.abort('blockedbyclient');
        return route.fulfill({ status: 200, ...asset, headers: {
          'Content-Security-Policy': "default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'",
        } });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      // Parse off-document, removing auth/runtime code before loading the actual layout.
      const fixture = await page.evaluate(source => {
        const doc = new DOMParser().parseFromString(source, 'text/html');
        const removedScripts = doc.querySelectorAll('script').length;
        doc.querySelectorAll('script, base, iframe, object, embed, link:not([rel="stylesheet"])').forEach(node => node.remove());
        for (const node of doc.querySelectorAll('*')) for (const attribute of [...node.attributes])
          if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
        doc.documentElement.dataset.coreAccess = 'manager';
        doc.getElementById('coreAccessLoading')?.remove();
        return { html: '<!doctype html>\n' + doc.documentElement.outerHTML, removedScripts };
      }, html);
      assert.ok(fixture.removedScripts >= 2, 'remove actual Firebase configuration and runtime scripts');
      assets.set(fixtureUrl, { contentType: 'text/html', body: fixture.html });
      for (const width of [320, 390, 768, 1440]) await t.test(`${width}px SOLAPI section`, async () => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(fixtureUrl, { waitUntil: 'load' });
        assert.equal(await page.locator('script').count(), 0);
        assert.deepEqual(await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.map(link => link.href)),
          [...assets.keys()].filter(url => url.endsWith('.css')));
        const section = page.locator(`#${sectionId}`);
        assert.equal(await section.count(), 1);
        assert.equal(await section.isVisible(), true);
        await section.evaluate(node => node.scrollIntoView({ block: 'start' }));
        const report = await section.evaluate(node => {
          const bounds = node.getBoundingClientRect(), issues = [], lines = [], epsilon = 1;
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let text;
          while ((text = walker.nextNode())) {
            if (!text.textContent.trim()) continue;
            const parent = text.parentElement, style = getComputedStyle(parent), box = parent.getBoundingClientRect();
            const label = text.textContent.trim().slice(0, 40);
            // CORE's existing date pill uses the 11px metadata token.
            const minimumFont = parent.closest('.pill') ? 11 : 12;
            if (style.visibility !== 'visible' || +style.opacity === 0 || parseFloat(style.fontSize) < minimumFont)
              issues.push(`unreadable: ${label}`);
            const range = document.createRange();
            range.selectNodeContents(text);
            const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
            if (!rects.length) issues.push(`hidden: ${label}`);
            for (const r of rects) {
              lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
              for (const container of [bounds, box]) if (r.left < container.left - epsilon || r.right > container.right + epsilon
                || r.top < container.top - epsilon || r.bottom > container.bottom + epsilon) issues.push(`text bounds: ${label}`);
              for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
                const s = getComputedStyle(ancestor), a = ancestor.getBoundingClientRect();
                if (/(hidden|clip|auto|scroll)/.test(s.overflowX)
                  && (r.left < a.left + ancestor.clientLeft - epsilon
                    || r.right > a.left + ancestor.clientLeft + ancestor.clientWidth + epsilon)) issues.push(`clipped X: ${label}`);
                if (/(hidden|clip|auto|scroll)/.test(s.overflowY)
                  && (r.top < a.top + ancestor.clientTop - epsilon
                    || r.bottom > a.top + ancestor.clientTop + ancestor.clientHeight + epsilon)) issues.push(`clipped Y: ${label}`);
              }
            }
          }
          for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++)
            if (Math.min(lines[i].right, lines[j].right) - Math.max(lines[i].left, lines[j].left) > epsilon
              && Math.min(lines[i].bottom, lines[j].bottom) - Math.max(lines[i].top, lines[j].top) > epsilon) issues.push('text overlap');
          if (node.previousElementSibling?.getBoundingClientRect().bottom > bounds.top + epsilon) issues.push('preceding section overlap');
          if (node.nextElementSibling?.getBoundingClientRect().top < bounds.bottom - epsilon) issues.push('following section overlap');
          return { width: innerWidth, left: bounds.left, right: bounds.right, height: bounds.height,
            client: node.clientWidth, scroll: node.scrollWidth, textLines: lines.length, issues,
            heading: node.querySelector('h2')?.textContent, date: node.querySelector('.pill')?.textContent,
            items: node.querySelectorAll('li').length, stylesheetRules: [...document.styleSheets].map(sheet => sheet.cssRules.length) };
        });
        reports.push(report);
        await page.screenshot({ path: new URL(`viewport-${width}.png`, output).pathname });
        await section.screenshot({ path: new URL(`section-${width}.png`, output).pathname });
        assert.match(report.heading, /SOLAPI/);
        assert.equal(report.date, '2026.10.31');
        assert.equal(report.items, 5);
        assert.equal(report.stylesheetRules.length, 2);
        assert.ok(report.stylesheetRules.every(count => count > 100), 'real CSS must be parsed');
        assert.ok(report.height > 100 && report.textLines >= 7, 'section text must render');
        assert.ok(report.left >= -1 && report.right <= width + 1, 'section fits viewport');
        assert.ok(report.scroll <= report.client + 1, 'section has no horizontal overflow');
        assert.deepEqual(report.issues, [], 'section text stays readable, unclipped and non-overlapping');
      });
      assert.deepEqual(errors, []);
      assert.ok(requests.length >= 12 && requests.every(request => request.local && request.method === 'GET'),
        'only locally fulfilled HTML/CSS requests are allowed');
    } finally {
      await context.close();
      contextsClosed = browser.contexts().length === 0;
      assert.equal(contextsClosed, true);
    }
  } finally {
    await browser?.close();
    const browserClosed = !browser || !browser.isConnected();
    await writeFile(new URL('layout.json', output), JSON.stringify({ reports, requests, errors, contextsClosed, browserClosed }, null, 2) + '\n');
    assert.equal(browserClosed, true);
  }
  t.diagnostic(`Screenshots: ${output.pathname} (4 viewport + 4 section); isolated browser and contexts closed`);
});
