import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { ensureStudioMateLoggedIn } from './lib/studiomate-login.mjs';
const url = 'https://arcpilates.studiomate.kr/boards/studio-notice/225?page=1';
const directory = path.resolve('artifacts/studiomate-registration-revamp-20261102');
let release, context;
try {
  release = await acquireStudioMateBrowserLock({ owner: 'registration-revamp-notice-readonly', waitMs: 60000 });
  context = await chromium.launchPersistentContext(path.join(os.homedir(), 'ArchiveIN/automation/browser-profile'), { headless: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto('https://arcpilates.studiomate.kr/users/contract', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureStudioMateLoggedIn(page, { headless: true });
  await context.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
    ? route.continue() : route.abort());
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  if (!page.url().includes('/boards/studio-notice/225') || await page.locator('input[type=password]').isVisible())
    throw Error('Notice requires an authenticated source read');
  const index = await page.locator('img').evaluateAll(images => images.findIndex(i => i.naturalWidth >= 1500 && i.naturalHeight >= 2000));
  if (index < 0) throw Error('Expected primary notice image unavailable');
  const image = page.locator('img').nth(index);
  await page.setViewportSize({ width: 2400, height: 1800 });
  const imageMetadata = await image.evaluate(i => ({ width: i.naturalWidth, height: i.naturalHeight,
    loaded: i.complete && i.naturalWidth > 0 }));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const evidence = { sourceUrl: url, observedAt: new Date().toISOString(),
    title: '[공지] 회원 등록 및 이용권 발급 절차 개편 안내', image: imageMetadata };
  await fs.writeFile(path.join(directory, 'notice.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  await image.screenshot({ path: path.join(directory, 'notice.png') });
  await page.goto('https://arcpilates.studiomate.kr/users/create', { waitUntil: 'networkidle', timeout: 30000 });
  if (page.url() !== 'https://arcpilates.studiomate.kr/users/create') throw Error('Unexpected blank registration form URL');
  const name = page.locator('input[placeholder="이름을 입력해주세요"]');
  const phone = page.locator('input[placeholder="휴대폰 번호"]');
  evidence.currentForm = {
    observedAt: new Date().toISOString(),
    nameCount: await name.count(), phoneCount: await phone.count(),
    nameEmpty: await name.count() === 1 && await name.inputValue() === '',
    phoneEmpty: await phone.count() === 1 && await phone.inputValue() === '',
    saveButtonCount: await page.getByRole('button', { name: '회원 등록 완료', exact: true }).count(),
    gradeFieldCount: await page.locator('.member-form__header__user-grade').count(),
    fieldsFilled: false, saveClicked: false, nonReadRequestsBlocked: true,
  };
  await fs.writeFile(path.join(directory, 'notice.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally { try { await context?.close(); } finally { await release?.(); } }
