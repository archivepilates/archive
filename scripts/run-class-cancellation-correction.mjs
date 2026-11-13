import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {acquireStudioMateBrowserLock} from './lib/studiomate-browser-lock.mjs';
import {createClassCancellationBrowser} from './lib/class-cancellation-native-browser.mjs';
import {createClassCorrectionLedger, privateDirectory, savePrivateJson} from './lib/class-cancellation-correction-ledger.mjs';
import {runClassCancellationCorrection} from './lib/class-cancellation-correction-worker.mjs';
import {createApprovedPretransportRecovery, withResolvedPretransportRecoveries, validatePretransportRecoveryApproval} from './lib/class-cancellation-pretransport-recovery.mjs';
import {evaluateClassCancellation} from './lib/class-cancellation-policy.mjs';

export function correctionHorizon(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600000);
  if (!Number.isFinite(kst.getTime())) throw Error('Invalid correction clock');
  const from = kst.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 2, 0));
  return {from, through: end.toISOString().slice(0, 10)};
}

export function shouldRunClassCorrection({apply, download, scheduledRun, notificationRefresh, steps}) {
  return !!(apply && download && scheduledRun && !notificationRefresh
    && ['download', 'memberProfiles', 'reservations'].every(name => steps.some(s => s.name === name && s.exitCode === 0 && s.stdoutOk !== false)));
}

export function validateClassCorrectionOptions({apply, preview, recover, approval}) {
  if ([apply, preview, recover].some(value => typeof value !== 'boolean') || preview && apply
    || recover && (!apply || preview || !approval || typeof approval !== 'object' || Array.isArray(approval))
    || !recover && approval !== undefined) throw Error('Explicit recovery mode and valid bound approval required');
  if (recover) validatePretransportRecoveryApproval(approval);
}

export async function notifyClassCorrectionReview(result, root, reportPath, send) {
  if (!result.reviewCount && result.status !== 'review' || result.status === 'deferred') return 'not_needed';
  const keys = (result.details || []).filter(d => d.status === 'review').map(d => d.key || String(d.reason || '').split('\n')[0].replace(/\d/g, '')).sort();
  const hash = createHash('sha256').update(JSON.stringify(keys.length ? keys : [result.cause, result.cleanup])).digest('hex');
  const intent = path.join(root, 'state/class-cancellation/alerts', hash + '.json');
  try {await savePrivateJson(intent, {eventId: hash, status: 'intent', reportPath, at: new Date().toISOString()});}
  catch (e) {if (e.code === 'EEXIST') return 'already_reported_or_unknown'; throw e;}
  const receipt = await send({eventId: hash, subject: '[주말 수업 취소마감][확인필요] 자동교정 검증 보류',
    body: `전체 수업 원본 또는 교정 결과가 검증되지 않아 해당 단계가 보류됐습니다.\n검토 ${result.reviewCount || 1}건, 검증된 수정 ${result.correctedCount || 0}건입니다.\n기존 회원·예약 수집과는 별개이며 불명확한 수정은 재실행하지 않습니다.\n비공개 실행기록: ${reportPath}\nCORE: https://core.archivepilates.com/rules/#class-cancellation-guard-20261113\n다음 조치: 원본과 canonical claim을 대조하고, 이미 접수됐거나 불명확한 건은 재시도하지 마세요.`});
  await savePrivateJson(intent, {eventId: hash, status: receipt ? 'sent' : 'unknown', reportPath, at: new Date().toISOString()}, {replace: true});
  return receipt ? 'sent' : 'unknown';
}

const sendAttention = async value => {
  const result = spawnSync(process.execPath, ['firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs'], {encoding: 'utf8', timeout: 60000, env: {...process.env,
    AUTOMATION_REPORT_EVENT_ID: value.eventId, AUTOMATION_REPORT_SUBJECT: value.subject, AUTOMATION_REPORT_BODY: value.body,
    AUTOMATION_REPORT_FROM: 'home@archivepilates.com', AUTOMATION_REPORT_TO: 'home@archivepilates.com', AUTOMATION_REPORT_LABEL: '자동화 확인필요'}});
  return result.status === 0;
};

export async function verifyNativeCorrectionDrafts(adapter, horizon) {
  const before = await adapter.exportClasses(horizon);
  const same = after => {
    const cells = rows => rows.map(r => JSON.stringify(r.nativeCells)).sort();
    if (before.total !== after.total || !isDeepStrictEqual(cells(before.rows), cells(after.rows))) throw Error('Unexpected source change during preview verification');
  };
  let previewCount = 0;
  for (const row of before.rows) {
    if (![0, 6].includes(new Date(row.date + 'T00:00:00Z').getUTCDay())) continue;
    const policy = evaluateClassCancellation(row);
    if (policy.status !== 'enforce' || row.cancelDeadline.replace(/ ?까지$/, '') === policy.expectedDeadline) continue;
    const detail = await adapter.readClass(row);
    if (!isDeepStrictEqual(detail.nativeCells, row.nativeCells)) throw Error('Preview native identity changed');
    const outcome = await adapter.correctClass(row, policy, {previewOnly: true, beforeSubmit: async () => {
      const source = await adapter.exportClasses(horizon); same(source);
      const actual = await adapter.readClass(row);
      if (!isDeepStrictEqual(actual.nativeCells, row.nativeCells)) throw Error('Preview source changed');
      return {ok: true, expiresAt: Date.parse(source.observedAt) + 300000};
    }});
    if (!outcome.previewVerified || outcome.accepted) throw Error('Preview unexpectedly submitted');
    previewCount++;
    if (previewCount === 3) break;
  }
  same(await adapter.exportClasses(horizon));
  return {ok: true, status: 'success', previewCount, correctedCount: 0, reviewCount: 0, nativeWriteCount: 0, sourceCount: before.total};
}

export async function runNativeClassCorrection({apply = false, notify = false, preview = false, recover = false, approval, root = path.join(os.homedir(), 'ArchiveIN/automation'), now = () => new Date()} = {}) {
  validateClassCorrectionOptions({apply, preview, recover, approval});
  if (recover) validatePretransportRecoveryApproval(approval, now().getTime());
  const reportDir = path.join(root, 'reports/class-cancellation', randomUUID());
  await privateDirectory(reportDir);
  let release, context, result;
  try {
    release = await acquireStudioMateBrowserLock({owner: 'class-cancellation-correction', lockPath: path.join(os.homedir(), 'ArchiveIN/automation/locks/studiomate-browser-profile.lock'), waitMs: 15000});
    const {chromium} = await import('playwright');
    context = await chromium.launchPersistentContext(path.join(os.homedir(), 'ArchiveIN/automation/browser-profile'), {acceptDownloads: true, headless: true, serviceWorkers: 'block'});
    const readPage = await context.newPage(), editPage = await context.newPage();
    const adapter = createClassCancellationBrowser({readPage, editPage, directory: reportDir});
    await adapter.initialize();
    const baseLedger = createClassCorrectionLedger(path.join(root, 'state/class-cancellation/jobs'));
    const recoveryLedger = createClassCorrectionLedger(path.join(root, 'state/class-cancellation/recoveries'));
    const resolutionDirectory = path.join(root, 'state/class-cancellation/resolutions');
    const recovery = recover ? await createApprovedPretransportRecovery({baseLedger, recoveryLedger, resolutionDirectory, approval, now}) : null;
    const ledger = recovery?.ledger || withResolvedPretransportRecoveries({baseLedger, recoveryLedger, resolutionDirectory});
    result = preview ? await verifyNativeCorrectionDrafts(adapter, correctionHorizon(now())) : await runClassCancellationCorrection({adapter, ledger, now, ...correctionHorizon(now()), maxCorrections: recovery ? 1 : 6, apply,
      ...(recovery ? {onlyKeys: [recovery.targetKey]} : {})});
    if (recovery && result.correctedCount === 1 && result.reviewCount === 0) {
      await recovery.complete(); result.operatorRecoveryVerified = true;
    }
  } catch (error) {
    result = {ok: error.code === 'STUDIOMATE_BROWSER_BUSY', status: error.code === 'STUDIOMATE_BROWSER_BUSY' ? 'deferred' : 'review', cause: error.code === 'STUDIOMATE_BROWSER_BUSY' ? 'shared_browser_busy' : 'native_source_or_verification_failed', error: error.message, correctedCount: result?.correctedCount ?? 0};
  } finally {
    let closed = !context;
    try {
      if (context) {const browser = context.browser(); await context.close(); if (browser?.isConnected()) throw Error('Native correction browser closure unconfirmed'); closed = true;}
    } catch (e) {result = {...result, ok: false, status: 'review', cleanup: 'browser_close_unconfirmed_lock_retained'};}
    if (closed) await release?.();
  }
  const reportPath = path.join(reportDir, 'result.json');
  result.scope = recover ? 'operator_single_approved_class' : preview ? 'native_drafts_only' : 'future_weekend_classes';
  await savePrivateJson(reportPath, {...result, apply, finishedAt: new Date().toISOString()});
  const attentionEmail = notify && apply ? await notifyClassCorrectionReview(result, root, reportPath, sendAttention).catch(() => 'unknown') : 'not_requested';
  // Native rows and raw diagnostics stay in the private receipt, never in the shared sync log.
  return {ok: result.ok || result.reviewCount === 0 && !result.cleanup, scope: result.scope, status: result.status, cause: result.cause, checkedCount: result.checkedCount ?? 0, mismatchCount: result.mismatchCount ?? 0, correctedCount: result.correctedCount ?? 0, reviewCount: result.reviewCount ?? (result.ok ? 0 : 1), deferredCount: result.deferredCount ?? 0, previewCount: result.previewCount, nativeWriteCount: result.nativeWriteCount, operatorRecoveryVerified: result.operatorRecoveryVerified === true, reportPath, attentionEmail, cleanup: result.cleanup ?? 'closed'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const recoveryMode = args.length === 3 && args[0] === '--recover' && args[1] === '--approval-file' && path.isAbsolute(args[2]);
  if (!((args.length === 1 && ['--apply', '--read-only', '--verify-drafts'].includes(args[0])) || args.length === 2 && args[0] === '--apply' && args[1] === '--scheduled-run' || recoveryMode)) {console.error('Use --read-only, --verify-drafts, --apply [--scheduled-run] or --recover --approval-file /private/file.json'); process.exitCode = 1;}
  else {
    let approval;
    if (recoveryMode) {
      const s = await fs.lstat(args[2]);
      if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600) throw Error('Owned 0600 approval file required');
      approval = JSON.parse(await fs.readFile(args[2], 'utf8'));
    }
    const result = await runNativeClassCorrection({apply: recoveryMode || args[0] === '--apply', preview: args[0] === '--verify-drafts', recover: recoveryMode, notify: args.includes('--scheduled-run'), approval});
    console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
  }
}
