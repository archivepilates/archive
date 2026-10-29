import assert from 'node:assert/strict';
import { readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets } from './lib/studiomate-native-contract-source.mjs';
import { instructorLessonRegistrationId, normalizeInstructorLessonPhone } from './lib/instructor-lesson-registration-contract.mjs';
import { makeLessonVideoSolapiRequest } from './lib/lesson-video-notice-solapi.mjs';

const args = process.argv.slice(2);
assert.equal(args.length, 2);
const excel = args.find(a => a.startsWith('--excel='))?.slice(8);
const output = args.find(a => a.startsWith('--output='))?.slice(9);
for (const p of [excel, output]) assert(p?.startsWith('/Users/archivepilates/ArchiveIN/operations/') && path.resolve(p) === p);
const python = '/Users/archivepilates/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const rows = JSON.parse(execFileSync(python, ['-c', `import pandas as pd,json,sys
d=pd.read_excel(sys.argv[1]).fillna('')
s=d[d['수강권명'].isin(['강사레슨 (2T)','Team 강사레슨']) & d['수강권시작일'].astype(str).str.startswith('2026-11')]
cols=['이름','등급','전화번호','수강권명','수강권시작일','수강권종료일','수강권상태','결제금액','결제방법','수강권발급일']
print(json.dumps(s[cols].astype(str).to_dict('records'),ensure_ascii=False))`, excel], { encoding: 'utf8' }));
assert(rows.length > 0 && rows.length <= 100);
const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const { chromium } = require('playwright');
const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'))), projectId: 'archive-pilates' });
let context, release;
try {
  const db = app.firestore(), provider = makeLessonVideoSolapiRequest();
  const template = await provider('/kakao/v2/templates/KA01TP2608241233353269Jgtoiwnzi6', 'GET');
  const result = { source: 'fresh full member Excel plus independent native read-only verification',
    excelHash: createHash('sha256').update(await readFile(excel)).digest('hex'), template, rows: [], startedAt: new Date().toISOString() };
  release = await acquireStudioMateBrowserLock({ owner: 'november-instructor-confirmation-audit', waitMs: 120000 });
  context = await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/browser-profile', { headless: true });
  const page = await context.newPage();
  await page.route('**/*', route => route.request().url().includes('studiomate')
    && !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.abort() : route.continue());
  const api = await captureStudioMateNativeApiClient(page);
  const phones = new Set();
  for (const row of rows) {
    const phone = normalizeInstructorLessonPhone(row['전화번호']);
    assert(/^010\d{8}$/.test(phone));
    const date = row['수강권시작일'], registrationId = instructorLessonRegistrationId('5330', phone, date);
    assert(!phones.has(phone + '|' + date)); phones.add(phone + '|' + date);
    const checkedAt = new Date().toISOString();
    const native = await readExactStudioMateMember(api, phone);
    const ticketRead = native.status === 'verified' ? await readStudioMateUserTickets(api, native.member.memberId) : null;
    const tickets = ticketRead?.tickets.filter(t => t.title === row['수강권명'] && t.availabilityStartAt === date && t.expireAt === date) || [];
    const snapshots = await db.collection('instructorLessonRegistrations').where('memberPhone', '==', phone).limit(101).get();
    assert(snapshots.size < 101);
    const registrations = snapshots.docs.map(s => ({ id: s.id, ...s.data() }));
    const candidates = await db.collection('alimtalkCandidates').where('memberPhone', '==', phone).limit(201).get();
    const sends = await db.collection('alimtalkSends').where('memberPhone', '==', phone).limit(201).get();
    assert(candidates.size < 201 && sends.size < 201);
    const messages = await provider('/messages/v4/list?' + new URLSearchParams({ to: phone, dateType: 'CREATED',
      startDate: '2026-09-01T00:00:00Z', endDate: new Date().toISOString(), limit: '500' }), 'GET');
    assert(!messages.nextKey, 'Provider history incomplete.');
    const [year, month, day] = date.split('-').map(Number);
    const datePattern = new RegExp(`${year}년\\s*${month}월\\s*${day}일|${date.replaceAll('-', '[-./]')}`);
    const providerRows = Object.values(messages.messageList || {}).filter(m => datePattern.test(m.text || '')
      && (m.kakaoOptions?.templateId === 'KA01TP2608241233353269Jgtoiwnzi6' || /강사레슨/.test(m.text || '')));
    const relevant = r => r.payload?.lessonDate === date || r.payload?.registrationId === registrationId
      || registrations.filter(x => x.lessonDate === date).some(x => x.evidence?.confirmationCandidateId === r.id);
    result.rows.push({ name: row['이름'], phone, date, ticketName: row['수강권명'], grade: row['등급'],
      excelStatus: row['수강권상태'], excelPaidAmount: Number(row['결제금액']), excelPaymentMethod: row['결제방법'],
      registrationId, checkedAt, nativeStatus: native.status,
      member: native.member ? { memberId: native.member.memberId, name: native.member.name, phone: native.member.phone,
        memberGrade: native.member.memberGrade, inactive: native.member.inactive } : null,
      ticketReadStatus: ticketRead?.status, tickets,
      currentRegistration: registrations.find(r => r.lessonDate === date) || null,
      priorRegistrations: registrations.filter(r => r.lessonDate !== date).map(r => ({ id: r.id, date: r.lessonDate,
        mode: r.mode, status: r.status, memberId: r.evidence?.studiomateMemberId, eformStatus: r.steps?.eformsign?.status })),
      candidates: candidates.docs.map(s => ({ id: s.id, ...s.data() })).filter(relevant),
      sends: sends.docs.map(s => ({ id: s.id, ...s.data() })).filter(relevant),
      providerRows, providerCheckedAt: new Date().toISOString() });
  }
  result.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const handle = await open(output, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(result, null, 2)); await handle.sync(); } finally { await handle.close(); }
  console.log(JSON.stringify({ ok: true, count: result.rows.length, finishedAt: result.finishedAt,
    rows: result.rows.map(r => ({ name: r.name, date: r.date, title: r.ticketName, grade: r.grade, amount: r.excelPaidAmount,
      native: r.nativeStatus, ticketCount: r.tickets.length, nativeTicketId: r.tickets[0]?.userTicketId,
      payment: r.tickets[0]?.payment?.status, paidAmount: r.tickets[0]?.payment?.paidAmount,
      registration: r.currentRegistration?.status || 'missing', priorRegistrationCount: r.priorRegistrations.length,
      candidateCount: r.candidates.length, sendCount: r.sends.length,
      provider: r.providerRows.map(m => ({ status: m.status, statusCode: m.statusCode, type: m.type })) })) }));
} catch {
  console.error(JSON.stringify({ ok: false, code: 'NOVEMBER_CONFIRMATION_AUDIT_INCOMPLETE', writes: 0 })); process.exitCode = 1;
} finally { await context?.close(); await release?.(); await app.delete(); }
