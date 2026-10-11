import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { systemHealthEmail } from './lib/system-health-email.mjs';
import { renderOperationsEmail } from './lib/operations-email-format.mjs';

const output = '/tmp/core-health-mail-audit-email-20261011';
await mkdir(output, { recursive: true });
const report = systemHealthEmail({ status: 'action_required', findingCount: 1, criticalCount: 0,
  actionRequiredCount: 1, warningCount: 0, repairedCount: 0, restartRequestedCount: 0,
  mode: 'quick', runId: 'synthetic_preview_only', finishedAt: '2026-10-11T03:13:29.558Z',
  findings: [{ title: '회원 계약 원천 확인', cause: 'membershipContractDiscovery: member_coverage_review_1',
    impact: '해당 회원의 계약 감지 보류. 회원·예약 동기화는 정상입니다.',
    suggestedAction: '원천 수강권과 계약 원장을 확인합니다. 재발송하지 않습니다.' }],
}, '/tmp/synthetic-preview-only.json');
const html = renderOperationsEmail(report.subject, report.body);
await writeFile(`${output}/preview.html`, html);
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.setContent(html);
      assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), report.subject);
      assert.equal(await page.getByRole('link').count(), 1);
      const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
        font: getComputedStyle(document.body).fontSize }));
      assert.equal(metrics.overflow, false, `overflow at ${width}`);
      assert.equal(metrics.font, '16px');
      await page.screenshot({ path: `${output}/${width}.png`, fullPage: true });
      results.push({ width, ...metrics });
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${output}/results.json`, JSON.stringify({ ok: true, results, sent: false }, null, 2));
console.log(JSON.stringify({ ok: true, results, preview: `${output}/preview.html`, sent: false }, null, 2));
