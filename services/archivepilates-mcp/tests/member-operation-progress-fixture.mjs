import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const at = '2026-10-19T10:00:00.000Z';
export const secret = 'SYNTHETIC_PRIVATE_CONTENT';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const acceptanceHash = send => sha(JSON.stringify([send.id, send.memberId, send.memberPhone, send.templateCode,
  send.message, Object.entries(send.variables).sort(([a], [b]) => a.localeCompare(b)),
  send.issuanceFingerprint, send.creationEvidenceFingerprint, send.solapiMessageId]));
export function fixture({ policy = 'holding_acceptance_memo_v2', queued = true, synced = true, delivered = true } = {}) {
  const identity = { studioId: '5330', memberId: '701', memberPhone: '01000000701',
    issuanceFingerprint: sha('synthetic-issuance'), creationEvidenceFingerprint: sha('synthetic-creation') };
  const operationId = `holding_operator_notice_${sha(JSON.stringify([identity.studioId, identity.memberId,
    identity.issuanceFingerprint, identity.creationEvidenceFingerprint]))}`;
  const memoId = `holding_notice_memo_${operationId.slice('holding_operator_notice_'.length)}`;
  const common = { ...identity, id: operationId, candidateId: operationId, memberName: secret, message: secret,
    variables: { syntheticVariable: secret }, summary: { originalDays: 120 }, templateCode: 'synthetic-template',
    isTest: false, calculationMode: 'live_studiomate_readback', observedAt: at, attempts: 1, maxAttempts: 1,
    payload: { holdingNotice: true, source: 'studiomate_live_ticket_readback', deliveryMode: 'automatic_live_readback',
      holdingEventId: operationId, policyId: 'synthetic-policy' }, createdAt: at, updatedAt: at };
  const event = { ...identity, id: operationId, canonical: true, source: 'studiomate_live_ticket_readback',
    policyId: 'synthetic-policy', registeredAt: at, status: 'ready' };
  const candidate = { ...structuredClone(common), status: 'sent', sentAt: at };
  const send = { ...structuredClone(common), sendId: operationId, status: 'done', providerOutcome: 'accepted_verified',
    solapiMessageId: 'synthetic-message', providerStatus: delivered ? 'COMPLETE' : 'SENDING', providerStatusCode: delivered ? '4000' : '2000',
    holdingMemoPolicy: policy, holdingMemoStatus: queued ? 'queued' : 'ready' };
  const claim = { ...identity, candidateId: operationId, status: delivered ? 'delivered' : 'accepted',
    solapiMessageId: send.solapiMessageId, createdAt: at, updatedAt: at };
  if (policy === 'holding_acceptance_memo_v2') {
    const marker = { holdingMemoAcceptedAt: at, holdingMemoAcceptedMessageId: send.solapiMessageId,
      holdingMemoAcceptanceEvidence: 'verified_provider_receipt', holdingMemoAcceptanceFingerprint: acceptanceHash(send) };
    Object.assign(send, marker); Object.assign(claim, marker);
  }
  const commonMemo = { studioId: identity.studioId, memberId: identity.memberId, memberName: secret, holdingNoticeId: operationId,
    solapiMessageId: send.solapiMessageId, source: 'holding_notice_delivery', holdingMemoPolicy: policy,
    content: secret, contentHash: sha(secret), createdAt: at, updatedAt: at };
  const memo = { ...commonMemo, memoId, syncStatus: synced ? 'synced' : 'pending', ...(synced ? { syncedAt: at } : {}) };
  const job = { ...commonMemo, jobId: memoId, memberPhone: identity.memberPhone, studiomateMemberId: identity.memberId,
    status: synced ? 'done' : 'pending', ...(synced ? { writtenAt: at } : {}) };
  if (queued) Object.assign(send, { holdingMemoId: memoId, holdingMemoQueuedAt: at });
  const docs = new Map([['holdingNoticeEvents', event], ['alimtalkCandidates', candidate], ['alimtalkSends', send],
    ['holdingNoticeClaims', claim], ...(queued ? [['memberMemos', memo], ['studiomateMemoWriteJobs', job]] : [])]
    .map(([collection, row]) => [`${collection}/${collection === 'memberMemos' || collection === 'studiomateMemoWriteJobs' ? memoId : operationId}`, row]));
  return { input: { kind: 'holding', operationId }, docs, event, candidate, send, claim, memo, job, memoId };
}

export function backend({ db } = {}) {
  const require = createRequire(new URL('../../../firebase/kangsain-functions/functions/package.json', import.meta.url));
  const ts = require('typescript'), exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../../firebase/kangsain-functions/functions/src/operations/memberOperationProgress.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date, Error, Set, Map,
    require: key => {
      if (key === 'node:crypto') return { createHash };
      if (key === '../utils/errors') return { AppError: class extends Error { constructor(code, message) { super(message); this.code = code; } } };
      if (key === '../config/firebase' && db) return { db };
      throw new Error(`Forbidden dependency: ${key}`);
    } });
  return exports;
}
export async function inspect(f = fixture(), options = {}) {
  const reads = [];
  const run = backend().createMemberOperationInspector({ now: () => new Date(at), readDocument: async path => {
    reads.push(path);
    if (options.fail === path.split('/')[0]) throw new Error(secret);
    return f.docs.get(path);
  } });
  const result = await run(f.input, '5330');
  return { result: JSON.parse(JSON.stringify(result)), reads, run };
}
export const stage = (value, name) => value.stages.find(row => row.stage === name);
