import { readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { acquireEformsignBrowserLock } from './lib/eformsign-browser-lock.mjs';
import { assertEformEmptySearchResponse } from './lib/instructor-eform-search-evidence.mjs';

const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const { chromium } = require('playwright');
const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const ids = process.argv.slice(2).filter(a => a.startsWith('--registration-id=')).map(a => a.slice(18));
const output = process.argv.slice(2).find(a => a.startsWith('--output='))?.slice(9);
if (!ids.length || ids.length > 2 || new Set(ids).size !== ids.length || ids.some(id => !/^ilr_[a-f0-9]{24}$/.test(id))
  || process.argv.length !== ids.length + 3 || !output?.startsWith('/Users/archivepilates/ArchiveIN/operations/') || path.resolve(output) !== output)
  throw Error('Exact source IDs and private output required.');
const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'))), projectId: 'archive-pilates' });
let context, release;
try {
  const registrations = [];
  for (const id of ids) {
    const r = (await app.firestore().doc('instructorLessonRegistrations/' + id).get()).data();
    if (r?.studioId !== '5330' || r.mode !== 'new_member' || r.cancellation || !r.memberName || r.status !== 'action_required') throw Error('Source changed.');
    registrations.push({ id, name: r.memberName });
  }
  release = await acquireEformsignBrowserLock({ owner: 'instructor-new-ticket-eform-absence', waitMs: 120000 });
  context = await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/eformsign-browser-profile', { headless: true });
  const page = await context.newPage();
  const proofs = [];
  for (const r of registrations) {
    const checks = [];
    for (const mode of ['ip', 'ai']) {
      await page.goto('https://www.eformsign.com/eform/document/document_list.html?mode=' + mode, { waitUntil: 'networkidle', timeout: 60000 });
      if (!(await page.locator('body').innerText()).includes('archivepilates@gmail.com')) throw Error('Eform account verification required.');
      await page.locator('#simpleSearchKey').fill(r.name);
      const checkedAt = new Date().toISOString();
      const responsePromise = page.waitForResponse(response => {
        if (new URL(response.url()).pathname !== '/v1.0/companies/848f6dc7fa024a6cb28a2994c0835e53/documents'
          || response.request().method() !== 'POST') return false;
        try {
          const query = response.request().postDataJSON()?.input?.query;
          return query?.search === r.name && query.type === mode && query.skip === 0;
        } catch { return false; }
      }, { timeout: 20000 });
      await page.locator('#simpleSearchButton').click();
      const response = await responsePromise;
      const responseProof = assertEformEmptySearchResponse({ httpStatus: response.status(),
        request: response.request().postDataJSON(), body: await response.json(), name: r.name, mode });
      await page.getByText('No search results found.', { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 20000 });
      await page.waitForLoadState('networkidle');
      const check = await page.evaluate(({ name, mode }) => ({ mode,
        accountVerified: document.body.innerText.includes('archivepilates@gmail.com'),
        queryMatches: document.querySelector('#simpleSearchKey')?.value === name,
        rows: [...document.querySelectorAll('tbody tr')].filter(e => e.getBoundingClientRect().height && e.innerText.trim()).length,
        emptyVisible: [...document.querySelectorAll('p,td,div')].some(e => !e.childElementCount && e.getBoundingClientRect().height && /No search results found\./.test(e.textContent)),
      }), { name: r.name, mode });
      if (!check.accountVerified || !check.queryMatches || !check.emptyVisible || check.rows) throw Error('Complete absence not verified.');
      checks.push({ ...check, ...responseProof, checkedAt });
    }
    proofs.push({ registrationId: r.id, memberName: r.name, account: 'archivepilates@gmail.com',
      templateId: 'a5b5ea6b85ec44c8bcb4af1e980e94eb', complete: true, progressCount: 0, completedCount: 0,
      checkedAt: checks[0].checkedAt, checks });
  }
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const handle = await open(output, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify({ proofs }, null, 2)); await handle.sync(); } finally { await handle.close(); }
  console.log(JSON.stringify({ ok: true, proofs: proofs.map(p => ({ registrationId: p.registrationId,
    complete: p.complete, progressCount: 0, completedCount: 0, checkedAt: p.checkedAt })) }));
} catch {
  console.error(JSON.stringify({ ok: false, code: 'EFORM_ABSENCE_NOT_VERIFIED', memberSends: 0 })); process.exitCode = 1;
} finally { await context?.close(); await release?.(); await app.delete(); }
