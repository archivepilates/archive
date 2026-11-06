import { createHash } from 'node:crypto';

const SETTINGS = 'systemSettings/membershipContractAutomation';
const JOBS = 'studiomateMembershipContractJobs';
const CONTRACTS = 'studiomateMembershipContracts';
const LANE = 'workLanes/studiomate-membership-contract-automation';
const TYPE = 'dispatch_accepted_not_all_signed';
const POLICY = 'signature_maintenance_resume_v1';
const REFERENCE = 'user_signature_resume_20261028';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nativeId = value => typeof value === 'string' && /^[1-9]\d{0,63}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const requireThat = (condition, code) => { if (!condition) throw new Error(`contract_recovery_closure_${code}`); };

export const MEMBERSHIP_CONTRACT_RECOVERY_BINDINGS = Object.freeze([
  ['1984759', 'cd9031b5a8c4fe0893030a955c6598de4f43262c603ce29248e71364f21cd609', 'membership_contract_4816182cce91af32dc1f12df9c1c3c601de6719415a64fecd21c85335f5a40ab'],
  ['4888735', '7d56425236e5f4bfd9dbe668f305e65d7f0129b3aac1602d43aaad3b7ec891f1', 'membership_contract_c36a1079660ca29c45aa9f10a531034936c39f33e9d66f0d0b67f12d74f43f1b'],
  ['5077781', '4ed860ef43b947047e1c7a460d4f6e2c05ecc0abe573eafaca2ca05b5e795d45', 'membership_contract_baa8cd197a90cdd439ae9adbcc53da9b462106efa21b69e0cdffec207dc2e118'],
  ['3635427', 'b0993895344f20716b9d8ab75bcef2541b5449b7696d66bda2661cef1dcea5d7', 'membership_contract_8622bab14f6a7a38eb1361dd3c763107666bd524eb3e9ab0c4549916557da4b5'],
  ['5081479', '8b335c83f1a1c06328c3bca3476d5dc5517f7614e34b1fc3a834a52923f34c7d', 'membership_contract_584c2c0881e869fb49d1452e02caf25d21171be70fe11717bd8736d283cd2cb6'],
].map(([memberId, contractId, jobId]) => Object.freeze({ memberId, contractId, jobId })));

// Inputs are detached JSON snapshots, not Firestore references or SDK objects.
function canonical(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    requireThat(Number.isFinite(value), 'non_json_snapshot');
    return value;
  }
  requireThat(object(value) || Array.isArray(value), 'non_json_snapshot');
  requireThat(!ancestors.has(value) && !Object.getOwnPropertySymbols(value).length, 'non_json_snapshot');
  requireThat(Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'non_json_snapshot');
  ancestors.add(value);
  const result = Array.isArray(value)
    ? Array.from(value, item => canonical(item, ancestors))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], ancestors)]));
  ancestors.delete(value);
  return result;
}

export function membershipContractRecoveryClosureHash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function snapshots(rows, root, ids) {
  requireThat(Array.isArray(rows) && rows.length === 5, 'snapshot_count');
  const result = new Map();
  for (const row of rows) {
    requireThat(object(row) && ids.includes(row.id) && !result.has(row.id) && object(row.data)
      && (row.path === undefined || row.path === `${root}/${row.id}`), 'snapshot_scope');
    membershipContractRecoveryClosureHash(row.data);
    result.set(row.id, row.data);
  }
  return result;
}

function bindingMatches(value, binding, userTicketId, requireJob = true) {
  return object(value) && value.memberId === binding.memberId && value.contractId === binding.contractId
    && value.userTicketId === userTicketId
    && (!requireJob || (value.jobId === binding.jobId || value.jobKey === binding.jobId))
    && (value.jobId === undefined || value.jobId === binding.jobId)
    && (value.jobKey === undefined || value.jobKey === binding.jobId)
    && (value.studioId === undefined || value.studioId === '5330');
}

function validateReceipt(receipt, binding, userTicketId) {
  requireThat(bindingMatches(receipt, binding, userTicketId, false)
    && receipt.canonicalContractPath === `${CONTRACTS}/${binding.contractId}`
    && receipt.status === 'accepted' && receipt.attempts === 1 && receipt.maxAttempts === 1
    && receipt.noReplay === true && receipt.route === 'native_ui', 'receipt_unverified');
  const result = receipt.nativeResult;
  requireThat(object(result) && result.contractId === binding.contractId && result.memberId === binding.memberId
    && result.attempts === 1 && result.status === 'accepted'
    && result.transmissionStatus === 'success' && result.success === 1 && result.failed === 0
    && result.pending === 0, 'native_result_unverified');
  for (const [key, expected] of Object.entries({ memberId: binding.memberId, contractId: binding.contractId,
    userTicketId, jobId: binding.jobId, jobKey: binding.jobId, canonicalContractPath: `${CONTRACTS}/${binding.contractId}` })) {
    requireThat(result[key] === undefined || result[key] === expected, 'native_result_binding');
  }
}

function validateContractReceipt(receipt, binding, userTicketId) {
  requireThat(object(receipt) && receipt.memberId === binding.memberId && receipt.contractId === binding.contractId
    && receipt.status === 'accepted' && receipt.attempts === 1 && receipt.noReplay === true
    && receipt.route === 'native_ui' && receipt.transmissionStatus === 'success'
    && receipt.success === 1 && receipt.failed === 0 && receipt.pending === 0, 'contract_receipt_unverified');
  for (const [key, expected] of Object.entries({ userTicketId, jobId: binding.jobId, jobKey: binding.jobId,
    maxAttempts: 1, studioId: '5330', canonicalContractPath: `${CONTRACTS}/${binding.contractId}` })) {
    requireThat(receipt[key] === undefined || receipt[key] === expected, 'contract_receipt_binding');
  }
  if (receipt.nativeResult !== undefined) {
    // A redundant nested copy must agree too; it never substitutes for the full job receipt.
    validateReceipt({ ...receipt, userTicketId, jobId: binding.jobId, maxAttempts: 1,
      canonicalContractPath: `${CONTRACTS}/${binding.contractId}` }, binding, userTicketId);
  }
}

/** Pure proposal only. The caller must replan from transactional reads and atomically
 * enforce every CAS precondition, including audit absence, before applying anything.
 * The returned audit contains the full prior approval and is private-caller-only.
 */
export function planMembershipContractRecoveryClosure({ config, jobs, contracts, hints, expectedConfigHash, now }) {
  requireThat(Number.isSafeInteger(now) && now > 0, 'invalid_clock');
  requireThat(object(config) && digest(expectedConfigHash) && membershipContractRecoveryClosureHash(config) === expectedConfigHash,
    'config_changed');
  requireThat(config.studioId === '5330' && config.contractWriterEnabled === false, 'writer_must_remain_disabled');
  const approval = config.signatureMaintenanceRecovery, hold = config.signatureMaintenanceHold;
  requireThat(object(approval) && approval.policy === POLICY && approval.reference === REFERENCE
    && approval.status === 'blocked' && approval.closure === undefined
    && approval.noticeUrl === 'https://arcpilates.studiomate.kr/boards/studio-notice/224?page=1'
    && object(hold) && typeof hold.id === 'string' && hold.id.length > 0 && approval.holdId === hold.id
    && [approval.approvedAt, approval.expiresAt, hold.requestedAt].every(instant)
    && Date.parse(hold.requestedAt) < Date.parse(approval.approvedAt)
    && Date.parse(approval.approvedAt) < Date.parse(approval.expiresAt)
    && Date.parse(approval.expiresAt) - Date.parse(approval.approvedAt) <= 24 * 3600000
    && Date.parse(approval.expiresAt) <= now, 'approval_scope');
  requireThat(Array.isArray(approval.entries) && approval.entries.length === 5, 'approval_entries');
  const entries = new Map();
  const unique = { hintId: new Set(), phoneFingerprint: new Set() };
  const products = new Set(['사전등록 50회권', '20회(5개월)', '10주(주2회)']);
  for (const entry of approval.entries) {
    requireThat(object(entry) && MEMBERSHIP_CONTRACT_RECOVERY_BINDINGS.some(pin => pin.memberId === entry.memberId)
      && !entries.has(entry.memberId) && [entry.hintId, entry.phoneFingerprint, entry.fingerprint].every(digest)
      && entry.hintId === membershipContractRecoveryClosureHash([entry.phoneFingerprint, entry.fingerprint])
      && products.has(entry.productName) && [entry.previousDownloadedAt, entry.sourceDownloadedAt].every(instant)
      && Date.parse(entry.previousDownloadedAt) < Date.parse(entry.sourceDownloadedAt)
      && Date.parse(hold.requestedAt) <= Date.parse(entry.sourceDownloadedAt)
      && Date.parse(entry.sourceDownloadedAt) <= Date.parse(approval.approvedAt), 'approval_entries');
    for (const key of Object.keys(unique)) {
      requireThat(!unique[key].has(entry[key]), 'approval_entries');
      unique[key].add(entry[key]);
    }
    entries.set(entry.memberId, entry);
  }
  const jobMap = snapshots(jobs, JOBS, MEMBERSHIP_CONTRACT_RECOVERY_BINDINGS.map(pin => pin.jobId));
  const contractMap = snapshots(contracts, CONTRACTS, MEMBERSHIP_CONTRACT_RECOVERY_BINDINGS.map(pin => pin.contractId));
  const hintMap = snapshots(hints, `${LANE}/purchaseHints`, [...unique.hintId]);
  const beforeHashes = { [SETTINGS]: expectedConfigHash };
  const bound = [];
  for (const pin of MEMBERSHIP_CONTRACT_RECOVERY_BINDINGS) {
    const entry = entries.get(pin.memberId), job = jobMap.get(pin.jobId), contract = contractMap.get(pin.contractId);
    const hint = hintMap.get(entry.hintId), userTicketId = job.userTicketId;
    requireThat(nativeId(userTicketId) && bindingMatches(job, pin, userTicketId)
      && contract.contractId === pin.contractId && contract.studioId === '5330'
      && (contract.memberId === undefined || contract.memberId === pin.memberId)
      && (contract.userTicketId === undefined || contract.userTicketId === userTicketId)
      && object(contract.selection) && contract.selection.memberId === pin.memberId
      && contract.selection.userTicketId === userTicketId && contract.selection.jobKey === pin.jobId
      && contract.selection.studioId === '5330', 'canonical_binding');
    if (job.selection !== undefined) requireThat(object(job.selection) && job.selection.memberId === pin.memberId
      && job.selection.userTicketId === userTicketId && job.selection.jobKey === pin.jobId
      && job.selection.studioId === '5330', 'canonical_binding');
    if (contract.binding !== undefined) requireThat(bindingMatches(contract.binding, pin, userTicketId, false)
      && contract.binding.selectionJobKey === pin.jobId, 'canonical_binding');
    requireThat(job.operatorDraftSignatureRequest !== undefined, 'receipt_missing');
    validateReceipt(job.operatorDraftSignatureRequest, pin, userTicketId);
    if (contract.operatorDraftSignatureRequest !== undefined)
      validateContractReceipt(contract.operatorDraftSignatureRequest, pin, userTicketId);
    requireThat(hint.signatureMaintenanceRecoveryClosure === undefined
      && ['hintId', 'phoneFingerprint', 'fingerprint', 'previousDownloadedAt', 'sourceDownloadedAt']
        .every(key => key === 'hintId' ? hint[key] === undefined || hint[key] === entry[key] : hint[key] === entry[key])
      && (hint.memberId === undefined || hint.memberId === pin.memberId), 'hint_conflict');
    for (const [path, data] of [[`${JOBS}/${pin.jobId}`, job], [`${CONTRACTS}/${pin.contractId}`, contract],
      [`${LANE}/purchaseHints/${entry.hintId}`, hint]]) beforeHashes[path] = membershipContractRecoveryClosureHash(data);
    bound.push({ ...pin, userTicketId, hintId: entry.hintId });
  }
  const priorApproval = structuredClone(approval), priorApprovalHash = membershipContractRecoveryClosureHash(approval);
  const closedAt = new Date(now).toISOString();
  const auditPath = `${LANE}/reports/signature-dispatch-closure-${priorApprovalHash}`;
  const closure = { type: TYPE, closedAt, acceptedDispatchCount: 5, signatureCompletion: 'not_asserted',
    writerMustRemainDisabled: true, priorApprovalHash, auditPath };
  return {
    schemaVersion: 1, type: TYPE,
    settingPatch: { 'signatureMaintenanceRecovery.status': 'completed', 'signatureMaintenanceRecovery.closure': { ...closure } },
    hintPatches: bound.map(binding => ({ path: `${LANE}/purchaseHints/${binding.hintId}`,
      patch: { signatureMaintenanceRecoveryClosure: { ...closure, memberId: binding.memberId,
        contractId: binding.contractId, jobId: binding.jobId, userTicketId: binding.userTicketId } } })),
    beforeHashes: { ...beforeHashes },
    cas: { atomic: true, expectedConfigHash, writerMustRemainDisabled: true,
      preconditions: Object.entries(beforeHashes).map(([path, beforeHash]) => ({ path, beforeHash })),
      createOnly: [auditPath] },
    audit: { path: auditPath, privateCallerOnly: true, data: { ...closure, reference: REFERENCE, policy: POLICY,
      priorApproval, expectedConfigHash, beforeHashes: { ...beforeHashes }, bindings: bound } },
  };
}
