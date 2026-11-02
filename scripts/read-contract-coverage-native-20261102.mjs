import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { ensureStudioMateLoggedIn } from './lib/studiomate-login.mjs';
import { contractObservationGroups } from './lib/studiomate-membership-contract-observer.mjs';
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets,
  readCompleteStudioMateContractHistory } from './lib/studiomate-native-contract-source.mjs';
import { selectNativeMembershipContractCandidate } from './lib/studiomate-membership-contract-native-selection.mjs';
const runtime = '/Users/archivepilates/dev/archive-in-runtime';
const require = createRequire(`${runtime}/package.json`);
const admin = require(`${runtime}/firebase/kangsain-functions/functions/node_modules/firebase-admin`);
const ts = require(`${runtime}/firebase/kangsain-functions/functions/node_modules/typescript`);
const { chromium } = require('playwright');
const directory = path.join(os.homedir(), 'ArchiveIN/operations/contract-coverage-review-20261102');
const download = JSON.parse(fs.readFileSync(path.join(directory, 'downloads/last-emergency-excel-download-result.json'), 'utf8'));
if (!download.ok || !download.downloads.member?.ok) throw Error('Fresh member export unavailable');
const bytes = fs.readFileSync(download.downloads.member.archivePath);
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = createHash('sha256').update(bytes).digest('hex');
if (fileHash !== download.downloads.member.sha256) throw Error('Source digest changed');
// Use the importer's exact parser so numeric formatting cannot manufacture row changes.
const source = fs.readFileSync(`${runtime}/scripts/emergency-import-studiomate-member-excel.mjs`, 'utf8');
const tree = ts.createSourceFile('importer.mjs', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const parser = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'readMemberRows');
if (!parser) throw Error('Canonical member parser unavailable');
const readRows = vm.runInNewContext(`${parser.getText(tree)}\nreadMemberRows`, { spawnSync, JSON, String,
  PYTHON: '/Users/archivepilates/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' });
const rows = readRows(download.downloads.member.archivePath);
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(os.homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json');
admin.initializeApp({ projectId: 'archive-pilates' });
const db = admin.firestore(), lane = db.doc('workLanes/studiomate-membership-contract-automation');
let context, release;
try {
  const baseline = (await lane.collection('state').doc('excelBaseline').get()).data();
  const config = (await db.doc('systemSettings/membershipContractAutomation').get()).data();
  const groups = contractObservationGroups(rows), evidence = { observedAt: new Date().toISOString(),
    exportStartedAt: download.startedAt, exportFinishedAt: download.finishedAt, sourceFileHash: fileHash,
    baselineSourceImportId: baseline.sourceImportId, records: [] };
  evidence.configHash = hash(config);
  release = await acquireStudioMateBrowserLock({ owner: 'contract-coverage-read-only-review-20261102', waitMs: 60000 });
  context = await chromium.launchPersistentContext(path.join(os.homedir(), 'ArchiveIN/automation/browser-profile'), { headless: true });
  const page = await context.newPage();
  const client = await captureStudioMateNativeApiClient(page, { ensureLoggedIn: p => ensureStudioMateLoggedIn(p, { headless: true }) });
  const api = { get: client.get };
  for (const profileId of ['3045390', '3513809', 'excel_dc431d561dc12c11']) {
    const p = (await db.doc(`memberProfiles/${profileId}`).get()).data();
    const fingerprint = contractObservationGroups([{ 전화번호: p.phone, 수강권명: 'lookup' }])[0]?.id;
    if (!baseline.coverageLossIds.includes(fingerprint)) throw Error('Incident identity changed');
    const memberRead = await readExactStudioMateMember(api, p.phone);
    if (memberRead.status !== 'verified' || memberRead.member.memberId !== String(p.studiomateMemberId || p.memberId)) throw Error('Native identity mismatch');
    const member = memberRead.member;
    const tickets = await readStudioMateUserTickets(api, member.memberId);
    const contracts = await readCompleteStudioMateContractHistory(api, { phone: p.phone });
    if (tickets.status !== 'verified' || contracts.status !== 'verified') throw Error('Incomplete native history');
    const hints = await lane.collection('purchaseHints').where('phoneFingerprint', '==', fingerprint).limit(20).get();
    const prior = hints.docs.map(d => ({ id: d.id, ...d.data() })).find(h => h.fingerprint === baseline.fingerprints[fingerprint]);
    if (!prior || hash(prior.hints) !== baseline.fingerprints[fingerprint]) throw Error('Original row evidence unavailable');
    const current = groups.find(g => g.id === fingerprint);
    const selection = selectNativeMembershipContractCandidate({ group: { phone: p.phone,
      rows: [{ 회원구분: member.memberGrade || p.memberGrade || '' }] }, member, ticketRead: tickets,
      contractHistory: contracts, previousDownloadedAt: baseline.observedAtByMember[fingerprint],
      sourceDownloadedAt: new Date().toISOString(), issuanceWindowEndAt: download.startedAt, config });
    if (!['ignored', 'excluded'].includes(selection.status)) throw Error('Unresolved native contract candidate; retain hold');
    const hintDecisions = hints.docs.filter(d => d.data().status === 'native_verification_required').map(d => {
      const h = d.data();
      const result = selectNativeMembershipContractCandidate({ group: { phone: p.phone,
        rows: [{ 회원구분: member.memberGrade || p.memberGrade || '' }] }, member, ticketRead: tickets,
        contractHistory: contracts, previousDownloadedAt: h.previousDownloadedAt,
        sourceDownloadedAt: new Date().toISOString(), issuanceWindowEndAt: download.startedAt, config });
      return { hintId: d.id, hintHash: hash(h), previousDownloadedAt: h.previousDownloadedAt,
        status: result.status, reason: result.reason };
    });
    const multiset = values => values.reduce((map, v) => { const key = hash(v); map[key] = (map[key] || 0) + 1; return map; }, {});
    const beforeRows = multiset(prior.hints), afterRows = multiset(current?.hints || []);
    const removed = prior.hints.filter((h, i, all) => all.slice(0, i + 1).filter(x => hash(x) === hash(h)).length > (afterRows[hash(h)] || 0));
    const added = (current?.hints || []).filter((h, i, all) => all.slice(0, i + 1).filter(x => hash(x) === hash(h)).length > (beforeRows[hash(h)] || 0));
    const item = { profileId, memberId: member.memberId, name: member.name, phoneFingerprint: fingerprint,
      grade: member.memberGrade || p.memberGrade || '', nativeObservedAt: new Date().toISOString(),
      nativeMemberVerified: true, ticketReadStatus: tickets.status, contractReadStatus: contracts.status,
      profileIdentityHash: hash({ memberId: p.memberId, nativeMemberId: p.studiomateMemberId || p.memberId,
        phoneFingerprint: fingerprint, grade: p.memberGrade || '' }),
      priorFingerprint: baseline.fingerprints[fingerprint], priorRows: baseline.rowCounts[fingerprint],
      priorObservedAt: baseline.observedAtByMember[fingerprint], currentFingerprint: current?.fingerprint || null,
      currentRows: current?.hints.length || 0, priorRowDigests: beforeRows, currentRowDigests: afterRows,
      selection: { status: selection.status, reason: selection.reason },
      hintDecisions,
      priorHints: prior.hints, currentHints: current?.hints || [], removed, added,
      hints: hints.docs.map(d => ({ id: d.id, status: d.data().status, reason: d.data().reason })),
      tickets: tickets.tickets, contracts: contracts.records.map(({ memberPhone, terms, ...rest }) => rest) };
    evidence.records.push(item);
    console.log(JSON.stringify({ memberId: member.memberId, name: member.name, grade: item.grade,
      priorRows: item.priorRows, currentRows: item.currentRows, removed, added,
      nativeTicketCount: tickets.tickets.length,
      selection: item.selection,
      hintDecisions,
      recentTickets: tickets.tickets.filter(t => t.issuedAt >= item.priorObservedAt).map(({ userTicketId, title, issuedAt, status, refunded, cancelled }) => ({ userTicketId, title, issuedAt, status, refunded, cancelled })),
      contracts: contracts.records.map(({ contractId, title, status, signedAt, ticket }) => ({ contractId, title, status, signedAt, userTicketId: ticket?.userTicketId })) }));
  }
  fs.writeFileSync(path.join(directory, 'native-evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
} finally {
  try { await context?.close(); } finally { await release?.(); await admin.app().delete(); }
}
