import { readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { ensureStudioMateLoggedIn } from './lib/studiomate-login.mjs';
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets } from './lib/studiomate-native-contract-source.mjs';

const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const { chromium } = require('playwright');
const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const ids = process.argv.slice(2).filter(a => a.startsWith('--registration-id=')).map(a => a.slice(18));
const output = process.argv.slice(2).find(a => a.startsWith('--output='))?.slice(9);
if (!ids.length || ids.length > 2 || new Set(ids).size !== ids.length || ids.some(id => !/^ilr_[a-f0-9]{24}$/.test(id))
  || process.argv.length !== ids.length + 3 || !output?.startsWith('/Users/archivepilates/ArchiveIN/operations/')
  || path.resolve(output) !== output) throw Error('Exact registration IDs and private output are required.');
const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'))), projectId: 'archive-pilates' });
let context, release;
try {
  const db = app.firestore();
  const registrations = [];
  for (const id of ids) {
    const snap = await db.doc('instructorLessonRegistrations/' + id).get();
    const r = snap.data();
    if (!snap.exists || r.studioId !== '5330' || r.status !== 'action_required' || r.mode !== 'new_member'
      || r.cancellation || !/^[1-9]\d+$/.test(r.evidence?.studiomateMemberId)) throw Error('Current source is outside the new-member ticket-review scope.');
    registrations.push({ id, r });
  }
  release = await acquireStudioMateBrowserLock({ owner: 'instructor-ticket-recovery-readonly-20261029', waitMs: 120000 });
  context = await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/browser-profile', { headless: true });
  const page = await context.newPage();
  await page.route('**/*', route => {
    const req = route.request();
    if (req.url().includes('studiomate') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.goto('https://arcpilates.studiomate.kr/users/detail?id=' + registrations[0].r.evidence.studiomateMemberId, { waitUntil: 'networkidle', timeout: 60000 });
  await ensureStudioMateLoggedIn(page, { headless: true, waitForLogin: false });
  const api = await captureStudioMateNativeApiClient(page);
  const result = { source: 'current native browser-bound read-only source', members: [], checkedAt: null };
  for (const { id, r } of registrations) {
    const checkedAt = new Date().toISOString();
    const member = await readExactStudioMateMember(api, r.memberPhone);
    const ticketRead = await readStudioMateUserTickets(api, r.evidence.studiomateMemberId);
    result.members.push({ registrationId: id, checkedAt, member, ticketRead });
  }
  result.checkedAt = new Date().toISOString();
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const handle = await open(output, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(result, null, 2)); await handle.sync(); } finally { await handle.close(); }
  console.log(JSON.stringify({ ok: true, checkedAt: result.checkedAt, members: result.members.map(m => ({
    registrationId: m.registrationId, identity: m.member.status, ticketRead: m.ticketRead.status,
    tickets: m.ticketRead.tickets.filter(t => t.title === '강사레슨 (2T)').map(t => ({ userTicketId: t.userTicketId,
      availableFrom: t.availabilityStartAt, expiresAt: t.expireAt, issuedAt: t.issuedAt, active: t.active,
      cancelled: t.cancelled, refunded: t.refunded, paymentVerified: t.payment?.verified, paymentStatus: t.payment?.status,
      paidAmount: t.payment?.paidAmount, totalAmount: t.payment?.totalAmount })) })) }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code || 'NATIVE_SOURCE_READ_STOPPED', message: 'Read-only source check stopped; no ticket/member writes.' }));
  process.exitCode = 1;
} finally { await context?.close(); await release?.(); await app.delete(); }
