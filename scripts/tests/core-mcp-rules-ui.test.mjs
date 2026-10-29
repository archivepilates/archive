import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ACTIONS as CALLABLE_ACTIONS, UNSUPPORTED } from '../../services/archive-core-mcp/src/actions.mjs';
import { ACTIONS as CATALOG } from '../../services/archive-core-mcp/src/catalog.mjs';
import { DIRECT_ACTIONS } from '../../services/archive-core-mcp/src/direct.mjs';

const root = new URL('../../', import.meta.url);
const output = new URL('artifacts/core-mcp-rules/', root);
const read = file => readFile(new URL(file, root), 'utf8');
const origin = 'https://core-mcp-rules.invalid';
const fixtureUrl = `${origin}/core/rules/`;

test('fixed callable exports are covered without inventing endpoints or exposing credentials', async t => {
  const directory = 'firebase/kangsain-functions/functions/src/exports/';
  const exports = [];
  for (const file of await readdir(new URL(directory, root))) {
    if (!file.endsWith('.ts')) continue;
    const source = await read(directory + file);
    exports.push(...[...source.matchAll(/^export\s+const\s+(\w+)\s*=\s*onCall\s*\(/gm)].map(match => match[1]));
  }
  assert.ok(exports.length >= 50, 'inspect the actual fixed onCall export declarations');
  const endpoints = new Set(exports);
  assert.equal(endpoints.size, exports.length, 'callable exports must be unique');
  const supported = new Set(CALLABLE_ACTIONS.map(action => action.name));
  assert.equal(supported.size, CALLABLE_ACTIONS.length);
  const excludedNames = ['getCoreAccessSession', 'completeCoreFirstLogin', 'loginStaffWithPin',
    'setupStaffPinWithTempCode', 'adminIssueStaffTempCode', 'registerFcmToken',
    'adminSyncLecturesRange', 'adminSyncManagerStaffs', 'adminPollManagerNotices'];
  const excluded = new Set(excludedNames);
  const explanations = new Map(UNSUPPORTED.map(item => [item.name, item.reason]));
  for (const name of excluded) {
    assert.ok(endpoints.has(name), `${name} must be a real export`);
    assert.ok(!supported.has(name), `${name} stays outside business actions`);
    assert.ok(explanations.get(name)?.trim(), `${name} needs an exclusion explanation`);
  }
  for (const action of CALLABLE_ACTIONS) {
    assert.ok(endpoints.has(action.name), `${action.name} must be an actual onCall export`);
    assert.ok(['read', 'write'].includes(action.mode));
    assert.equal(typeof action.memberFacing, 'boolean');
    assert.match(action.label, /[가-힣]/);
    assert.ok(action.notes?.trim());
    assert.ok(Array.isArray(action.required));
    assert.equal(new Set(action.required).size, action.required.length);
    assert.ok(action.required.every(key => typeof key === 'string' && key.length));
    assert.ok(Array.isArray(action.sources));
    for (const source of action.sources) {
      assert.ok(typeof source.collection === 'string' && source.collection.length);
      assert.ok(typeof source.key === 'string' && source.key.length);
      assert.ok(source.optional === undefined || typeof source.optional === 'boolean');
    }
  }
  assert.deepEqual(exports.filter(name => !supported.has(name) && !excluded.has(name)), [],
    'new callable exports need explicit coverage or an approved exclusion');
  assert.equal(CATALOG.length, CALLABLE_ACTIONS.length + DIRECT_ACTIONS.length);
  assert.equal(new Set(CATALOG.map(action => action.name)).size, CATALOG.length);
  assert.deepEqual(CATALOG, [...CALLABLE_ACTIONS, ...DIRECT_ACTIONS]);
  for (const action of DIRECT_ACTIONS) {
    assert.ok(!endpoints.has(action.name), 'local adapters must not masquerade as deployed callables');
  }
  t.diagnostic(JSON.stringify({ fixedCallables: exports.length, callableActions: CALLABLE_ACTIONS.length,
    excludedCallables: excluded.size, localAdapters: DIRECT_ACTIONS.length, catalogActions: CATALOG.length }));
});

test('actual CORE MCP rules remain readable with real styles at 320/390/768/1440', { timeout: 90000 }, async t => {
  const html = await read('core/rules/index.html');
  const assets = new Map();
  for (const name of ['styles.css', 'interface.css']) {
    assets.set(`${origin}/core/assets/${name}`, { contentType: 'text/css', body: await read(`core/assets/${name}`) });
  }
  await mkdir(output, { recursive: true });
  const reports = [];
  const network = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    // Every request is locally fulfilled or aborted; no request is continued to any network host.
    const context = await browser.newContext({ serviceWorkers: 'block', storageState: { cookies: [], origins: [] },
      reducedMotion: 'reduce', offline: true });
    try {
      await context.route('**/*', async route => {
        const request = route.request();
        const asset = request.method() === 'GET' ? assets.get(request.url()) : null;
        network.push({ method: request.method(), url: request.url(), decision: asset ? 'local' : 'blocked' });
        if (!asset) return route.abort('blockedbyclient');
        return route.fulfill({ status: 200, ...asset, headers: { 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'" } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // DOMParser is inert. Remove executable/auth content before the document is ever loaded.
      const fixture = await page.evaluate(source => {
        const doc = new DOMParser().parseFromString(source, 'text/html');
        const removedScripts = doc.querySelectorAll('script').length;
        doc.querySelectorAll('script, base, iframe, object, embed, link:not([rel="stylesheet"])').forEach(node => node.remove());
        for (const node of doc.querySelectorAll('*')) {
          for (const attribute of [...node.attributes]) {
            if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
          }
        }
        // Only reveal the static manager CSS surface; no account, token or mock runtime is installed.
        doc.documentElement.dataset.coreAccess = 'manager';
        doc.getElementById('coreAccessLoading')?.remove();
        return { html: '<!doctype html>\n' + doc.documentElement.outerHTML, removedScripts };
      }, html);
      assert.ok(fixture.removedScripts >= 2, 'actual Firebase config and app scripts were removed');
      assets.set(fixtureUrl, { contentType: 'text/html', body: fixture.html });
      for (const width of [320, 390, 768, 1440]) {
        await t.test(`${width}px static rules layout`, async () => {
          await page.setViewportSize({ width, height: 1000 });
          await page.goto(fixtureUrl, { waitUntil: 'load' });
          assert.equal(await page.locator('script').count(), 0);
          assert.deepEqual(await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.map(link => link.href)),
            [...assets.keys()].filter(url => url.endsWith('.css')));
          assert.equal(await page.evaluate(() => document.styleSheets.length), 2);
          const section = page.locator('#core-ops-mcp');
          assert.equal(await section.count(), 1);
          assert.equal(await section.isVisible(), true);
          await section.evaluate(node => node.scrollIntoView({ block: 'start' }));
          const report = await section.evaluate(node => {
            const box = element => {
              const r = element.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
            };
            const epsilon = 1;
            const bounds = box(node);
            const issues = [];
            const textRects = [];
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            let text;
            while ((text = walker.nextNode())) {
              if (!text.textContent.trim()) continue;
              const parent = text.parentElement;
              const style = getComputedStyle(parent);
              if (style.visibility !== 'visible' || +style.opacity === 0 || parseFloat(style.fontSize) < 12) {
                issues.push(`unreadable text: ${text.textContent.slice(0, 40)}`);
              }
              const range = document.createRange();
              range.selectNodeContents(text);
              const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
              if (!rects.length) issues.push(`hidden text: ${text.textContent.slice(0, 40)}`);
              for (const r of rects) {
                const rect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                  text: text.textContent.slice(0, 40) };
                textRects.push(rect);
                if (r.left < bounds.left - epsilon || r.right > bounds.right + epsilon
                  || r.top < bounds.top - epsilon || r.bottom > bounds.bottom + epsilon) {
                  issues.push(`text outside section: ${rect.text}`);
                }
                for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
                  const s = getComputedStyle(ancestor), a = box(ancestor);
                  const left = a.left + ancestor.clientLeft, top = a.top + ancestor.clientTop;
                  if (/(hidden|clip|auto|scroll)/.test(s.overflowX)
                    && (r.left < left - epsilon || r.right > left + ancestor.clientWidth + epsilon)) {
                    issues.push(`horizontally clipped by ${ancestor.tagName}: ${rect.text}`);
                  }
                  if (/(hidden|clip|auto|scroll)/.test(s.overflowY)
                    && (r.top < top - epsilon || r.bottom > top + ancestor.clientHeight + epsilon)) {
                    issues.push(`vertically clipped by ${ancestor.tagName}: ${rect.text}`);
                  }
                }
              }
            }
            for (let a = 0; a < textRects.length; a++) {
              for (let b = a + 1; b < textRects.length; b++) {
                const x = Math.min(textRects[a].right, textRects[b].right) - Math.max(textRects[a].left, textRects[b].left);
                const y = Math.min(textRects[a].bottom, textRects[b].bottom) - Math.max(textRects[a].top, textRects[b].top);
                if (x > epsilon && y > epsilon) issues.push(`overlapping text: ${textRects[a].text} / ${textRects[b].text}`);
              }
            }
            const blocks = [...node.children].map(box);
            for (let i = 1; i < blocks.length; i++) {
              if (blocks[i].top < blocks[i - 1].bottom - epsilon) issues.push('overlapping section blocks');
            }
            const previous = node.previousElementSibling, next = node.nextElementSibling;
            if (previous && box(previous).bottom > bounds.top + epsilon) issues.push('overlaps preceding section');
            if (next && box(next).top < bounds.bottom - epsilon) issues.push('overlaps following section');
            const outside = [...document.querySelectorAll('body *')].filter(element => {
              if (element === node || node.contains(element) || element.contains(node)) return false;
              const r = element.getBoundingClientRect();
              return r.width > 0 && (r.left < -epsilon || r.right > innerWidth + epsilon);
            }).slice(0, 12).map(element => ({ tag: element.tagName, id: element.id,
              section: element.closest('section')?.id || null, text: element.textContent.trim().slice(0, 90), ...box(element) }));
            return { width: innerWidth, bounds, sectionClientWidth: node.clientWidth,
              sectionScrollWidth: node.scrollWidth, documentWidth: document.documentElement.scrollWidth,
              heading: node.querySelector('h2')?.textContent, labels: [...node.querySelectorAll('.rule-note > strong')].map(e => e.textContent),
              textLines: textRects.length, issues, outside, stylesheetRules: [...document.styleSheets].map(sheet => sheet.cssRules.length) };
          });
          reports.push(report);
          // Capture before assertions so any layout regression leaves inspectable evidence.
          await page.screenshot({ path: new URL(`viewport-${width}.png`, output).pathname });
          await section.screenshot({ path: new URL(`section-${width}.png`, output).pathname });
          assert.match(report.heading, /CORE MCP 업무 연결/);
          assert.deepEqual(report.labels, ['목적·범위', '수정 원칙', '차단·개인정보', '원천·반영 상태']);
          assert.ok(report.stylesheetRules.every(count => count > 100), 'both real stylesheets must be parsed');
          assert.ok(report.bounds.width > 0 && report.bounds.height > 100);
          assert.ok(report.textLines >= 9, 'all heading, label and body text must render');
          assert.ok(report.bounds.left >= -1 && report.bounds.right <= width + 1, 'section fits viewport');
          assert.ok(report.sectionScrollWidth <= report.sectionClientWidth + 1, 'no horizontal overflow inside MCP section');
          assert.deepEqual(report.issues, [], 'no hidden, overlapping or clipped MCP text/blocks');
          const recovery = page.locator('#instructor-new-ticket-recovery-policy');
          await recovery.scrollIntoViewIfNeeded();
          const recoveryLayout = await recovery.evaluate(node => {
            const bounds = node.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(node);
            return { left: bounds.left, right: bounds.right, client: node.clientWidth, scroll: node.scrollWidth,
              overflow: [...range.getClientRects()].some(r => r.left < bounds.left - 1 || r.right > bounds.right + 1) };
          });
          assert.ok(recoveryLayout.left >= -1 && recoveryLayout.right <= width + 1);
          assert.ok(recoveryLayout.scroll <= recoveryLayout.client + 1);
          assert.equal(recoveryLayout.overflow, false);
          await recovery.screenshot({ path: new URL(`recovery-${width}.png`, output).pathname });
          if (report.documentWidth > width + 1) {
            t.diagnostic(`Existing rules overflow outside MCP section at ${width}px: ${JSON.stringify(report.outside)}`);
          }
        });
      }
      assert.deepEqual(errors, [], 'no browser script errors');
      assert.deepEqual(network.filter(request => request.decision === 'blocked'), [], 'no unexpected network attempts');
      assert.ok(network.every(request => request.method === 'GET' && assets.has(request.url)));
      t.diagnostic(`Screenshots: ${output.pathname} (4 viewport + 4 full-section captures)`);
    } finally {
      await context.close();
    }
    assert.equal(browser.contexts().length, 0, 'all isolated contexts are closed');
  } finally {
    try {
      await browser?.close();
      if (browser) assert.equal(browser.isConnected(), false, 'task-owned browser is closed');
    } finally {
      await writeFile(new URL('layout.json', output), JSON.stringify({ reports, network,
        browserClosed: browser ? !browser.isConnected() : true }, null, 2) + '\n');
    }
  }
});
