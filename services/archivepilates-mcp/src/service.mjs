import { createHash } from 'node:crypto';
import { TOOLS, validate } from './catalog.mjs';
import { id, text, phone, maskedPhone, millis, iso, requireValue } from './errors.mjs';
import { selectExpiring } from './ticket-query.mjs';
import { liveSource, snapshotSource } from './freshness.mjs';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sourceHash = value => hash([value._id, value.memberId, value.studioId, value.name, value.phone,
  value.studiomateMemberId || null, value.canonicalMemberId || null, value.mergedInto || null,
  value.externalActionEligible !== false, value.status || null, iso(value.syncedAt), iso(value.sourceUpdatedAt)]);
const observed = value => value.syncedAt || value.sourceObservedAt || value.sourceUpdatedAt;
function source(value, collection, now) {
  const time = millis(observed(value));
  return { ...snapshotSource({ kind: 'firestore_snapshot', queriedAt: new Date(now).toISOString(),
    observedAt: iso(observed(value)) }), collection, recordId: value._id,
    persistenceAge: time && time <= now && now - time <= 2 * 3600000 ? 'recent' : 'old_or_unknown',
    freshness: 'unknown',
    liveReadback: false };
}
export function validateProfile(value, forWrite = false, now = Date.now()) {
  requireValue(value && value._id === value.memberId && value.studioId === '5330', 'MEMBER_NOT_FOUND', '회원 원본을 확인할 수 없습니다.');
  requireValue(!value.mergedInto && !value.canonicalMemberId && !value.memberMerge?.canonicalMemberId
    && !['merged', 'deleted'].includes(value.status),
    'SOURCE_CHANGED', '회원 원본 연결을 먼저 확인해 주세요.');
  if (forWrite) {
    requireValue(/^[1-9]\d{0,15}$/.test(value.memberId) && value.externalActionEligible !== false
      && /^01[016789]\d{7,8}$/.test(phone(value.phone)), 'SOURCE_ID_UNRESOLVED', '직접 연결된 StudioMate 원본 회원만 메모를 추가할 수 있습니다.');
    const at = millis(value.syncedAt);
    requireValue(at && at <= now && now - at <= 2 * 3600000, 'SOURCE_STALE', '최근 회원 동기화 확인 후 다시 준비해 주세요.');
  }
  return value;
}
function memberView(value, now) {
  return { memberId: value.memberId, name: value.name || '', maskedPhone: maskedPhone(value.phone),
    nativeMemberId: /^[1-9]\d*$/.test(value.memberId) ? value.memberId : null,
    linkedNativeMemberId: /^[1-9]\d*$/.test(value.studiomateMemberId || '') ? value.studiomateMemberId : null,
    linkVerified: /^[1-9]\d*$/.test(value.memberId), source: source(value, 'memberProfiles', now) };
}
export function validateContract(value, memberIds) {
  const bindings = [value.binding, value.selection, value.completion, value.signatureReceipt].filter(Boolean);
  requireValue(value.studioId === '5330' && (!Object.hasOwn(value, 'memberId') || memberIds.includes(value.memberId))
    && bindings.every(binding => (!binding.studioId || binding.studioId === '5330')
    && (!binding.memberId || memberIds.includes(binding.memberId))
    && (!binding.contractId || binding.contractId === (value.contractId || value._id)))
    && (!value.contractId || value.contractId === value._id),
  'SOURCE_BINDING_MISMATCH', '계약 원본의 회원·센터 연결이 서로 다릅니다. 서명 상태를 단정하지 않았습니다.');
  if (value.signatureReceipt?.authoritative === true) requireValue(value.signatureReceipt.studioId === '5330'
    && memberIds.includes(value.signatureReceipt.memberId) && value.signatureReceipt.contractId === value._id,
  'SOURCE_BINDING_MISMATCH', '계약 서명 증거의 대상 연결이 불완전합니다. 원본 확인이 필요합니다.');
}
function range(start, end) {
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  requireValue(date(start) && date(end), 'INVALID_ARGUMENT', '올바른 조회 날짜를 입력해 주세요.');
  const days = (Date.parse(end) - Date.parse(start)) / 86400000;
  requireValue(days >= 0 && days <= 30, 'INVALID_ARGUMENT', '조회 기간은 양 끝날 포함 최대 31일입니다.');
}
function kstDate(value) {
  const time = millis(value);
  return time ? new Date(time + 9 * 3600000).toISOString().slice(0, 10) : null;
}
function safeState(value) { return /^[a-zA-Z0-9_:.-]{1,100}$/.test(String(value || '')) ? String(value) : 'unknown'; }
const PUBLIC_REASONS = new Set(['duplicate', 'duplicate_canonical_source', 'source_changed', 'source_stale',
  'native_member_signature_required', 'late_signature_welcome_review_required', 'invalid_observation_history',
  'holding_cutover_not_reached', 'staff_excluded']);
const statusView = value => ({ recordId: value._id, status: safeState(value.status), stage: safeState(value.stage),
  updatedAt: iso(value.updatedAt), errorPresent: Boolean(value.lastError || value.error),
  reasonCode: PUBLIC_REASONS.has(value.reasonCode || value.skipCode || value.blockedReason)
    ? (value.reasonCode || value.skipCode || value.blockedReason) : 'not_exposed',
  // Arbitrary error strings can contain health answers, credentials or member content.
  nextAction: value.lastError || value.error ? '원본 업무 화면에서 오류를 확인하세요. 자동 재실행하지 않았습니다.' : null });

export function createService({ store, approvals, staffId, now = Date.now, memoWritesEnabled = false, readOnly = false, liveReader }) {
  const liveSelections = new Map();
  function rememberSelection(member) {
    liveSelections.delete(member.memberId);
    if (liveSelections.size >= 200) liveSelections.delete(liveSelections.keys().next().value);
    liveSelections.set(member.memberId, { memberId: member.memberId, name: member.name,
      phone: phone(member.phone), selectedAt: now() });
  }
  async function expectedMember(memberId) {
    id(memberId);
    const selected = liveSelections.get(memberId), age = selected ? now() - selected.selectedAt : null;
    if (selected && age >= 0 && age < 10 * 60000) return selected;
    const current = await profile(memberId);
    requireValue(/^[1-9]\d{0,15}$/.test(memberId), 'LIVE_SELECTION_REQUIRED',
      '임시 회원 ID를 원본 ID로 추측하지 않습니다. members_find로 다시 선택해 주세요.');
    return { memberId, name: current.name, phone: phone(current.phone) };
  }
  function verifyIdentity(result, expected) {
    requireValue(result?.memberId === expected.memberId && result.name === expected.name
      && phone(result.phone) === phone(expected.phone), 'LIVE_IDENTITY_MISMATCH', '실시간 회원 식별 결과가 다릅니다.');
  }
  function liveProof(result, kind) {
    requireValue(result?.coverage?.complete === true && result.coverage.kind === kind,
      'LIVE_SOURCE_INCOMPLETE', '실시간 원본 전체 조회 범위를 확인하지 못했습니다. 저장 자료로 대체하지 않았습니다.');
    // Reader timestamps describe the source window; the injected service clock may be a fixture clock.
    const proof = liveSource({ kind: 'studiomate_ui_generated_response', checkedAt: result.checkedAt,
      queriedAt: result.checkedAt, coverage: result.coverage });
    if (result.startedAt !== undefined) liveSource({ kind: proof.kind, checkedAt: result.startedAt, queriedAt: result.checkedAt });
    return { ...proof, sourceWindow: { startedAt: result.startedAt ?? null, checkedAt: result.checkedAt } };
  }
  function liveMember(value, checkedAt) {
    return { memberId: value.memberId, name: value.name, maskedPhone: maskedPhone(value.phone),
      nativeMemberId: value.memberId, linkedNativeMemberId: value.memberId, linkVerified: true,
      source: { ...liveSource({ kind: 'studiomate_rendered_dom', checkedAt, queriedAt: checkedAt }),
        collection: null, recordId: value.memberId } };
  }
  async function actor() {
    const current = await store.getOperator(id(staffId));
    requireValue(current && current.studioId === '5330' && current.active === true
      && ['owner', 'manager'].includes(current.role), 'PERMISSION_DENIED', '활성 운영자 계정 연결이 필요합니다.');
    return { staffId, uid: current.uid || '', role: current.role };
  }
  async function profile(memberId, forWrite = false) {
    return validateProfile(await store.getProfile(id(memberId)), forWrite, now());
  }
  async function memberIds(current) {
    const ids = [current.memberId];
    const aliases = [...new Set([...(current.mergedMemberIds || []), ...(current.memberMerge?.mergedMemberIds || [])])];
    requireValue(aliases.length <= 8, 'SOURCE_LIMIT', '회원 연결 이력이 많습니다. 원본 확인이 필요합니다.');
    for (const aliasId of aliases) {
      id(aliasId);
      const alias = await store.getProfile(aliasId);
      const targets = [alias?.canonicalMemberId, alias?.mergedInto, alias?.memberMerge?.canonicalMemberId].filter(Boolean);
      requireValue(alias && alias.studioId === '5330' && alias._id === alias.memberId && aliasId !== current.memberId
        && targets.length > 0 && targets.every(target => target === current.memberId)
        && phone(alias.phone) && phone(alias.phone) === phone(current.phone),
      'SOURCE_ID_UNRESOLVED', '병합 회원 연결 증거가 일치하지 않습니다. 일부 이력만 표시하지 않았습니다.');
      ids.push(aliasId);
    }
    if (/^excel_/.test(current.memberId) && /^[1-9]\d*$/.test(current.studiomateMemberId || '')) {
      const proof = await store.getLookup(current.memberId);
      requireValue(proof && proof.status === 'done' && proof.memberId === current.memberId && proof.studioId === '5330'
        && proof.studiomateMemberId === current.studiomateMemberId && proof.memberName === current.name
        && phone(proof.memberPhone) === phone(current.phone) && millis(proof.resolvedAt)
        && millis(proof.resolvedAt) === millis(current.studiomateMemberIdResolvedAt),
      'SOURCE_ID_UNRESOLVED', '회원 ID 연결 증거를 확인해야 합니다. 일부 이력만 전체로 표시하지 않았습니다.');
      const native = await store.getProfile(current.studiomateMemberId);
      if (native) requireValue(native._id === current.studiomateMemberId && native.memberId === native._id
        && native.studioId === '5330' && native.name === current.name && phone(native.phone) === phone(current.phone)
        && !native.canonicalMemberId && !native.mergedInto && !native.memberMerge?.canonicalMemberId,
      'SOURCE_ID_UNRESOLVED', '연결된 StudioMate 회원 원본이 다릅니다. 이력을 합치지 않았습니다.');
      const samePhone = await store.findMembers(phone(current.phone), true);
      const expectedIds = [current.memberId, ...(native ? [native.memberId] : [])];
      requireValue(samePhone.length === expectedIds.length && samePhone.every(value => expectedIds.includes(value._id)),
        'SOURCE_ID_UNRESOLVED', '동일 연락처의 회원 연결이 중복됩니다. 원본 확인이 필요합니다.');
      ids.push(current.studiomateMemberId);
    }
    return ids;
  }
  async function callTool(name, args, { signal } = {}) {
    requireValue(validate(name, args), 'INVALID_ARGUMENT', '지원하는 도구와 입력 항목을 확인해 주세요.');
    requireValue(!readOnly || !['memos_prepare', 'memos_commit'].includes(name), 'WRITE_DISABLED', '조회 전용 연결에서는 메모 계획·실행을 제공하지 않습니다.');
    const operator = await actor();
    if (name === 'bookings_list') range(args.startDate, args.endDate);
    if (name === 'members_list_expiring') {
      if (args.source !== 'snapshot') {
        requireValue(typeof liveReader?.getInventory === 'function', 'LIVE_SOURCE_UNAVAILABLE',
          '실시간 수강권 조회 연결이 없습니다. 저장 자료로 대체하지 않았습니다.');
        const inventory = await liveReader.getInventory(signal);
        const proof = liveProof(inventory, 'native_member_pages');
        const { profiles, coverage } = inventory;
        requireValue(Array.isArray(profiles) && Number.isSafeInteger(coverage.nativeTotal)
          && coverage.nativeTotal >= 0 && coverage.nativeTotal === profiles.length
          && coverage.scannedMembers === profiles.length,
        'LIVE_SOURCE_INCOMPLETE', '실시간 전체 회원 수와 조회 범위가 일치하지 않습니다.');
        requireValue(profiles.every(value => value && typeof value.memberId === 'string'
          && /^[1-9]\d{0,15}$/.test(value.memberId) && value._id === value.memberId && value.studioId === '5330')
          && new Set(profiles.map(value => value.memberId)).size === profiles.length,
        'LIVE_IDENTITY_MISMATCH', '실시간 회원 원본 ID 또는 센터 연결이 일치하지 않습니다.');
        const result = selectExpiring(profiles, { now: Date.parse(inventory.checkedAt),
          daysRemainingMax: args.daysRemainingMax, classType: args.classType });
        const matchedIds = new Set(result.members.map(value => value.memberId));
        for (const value of profiles) if (matchedIds.has(value.memberId)) rememberSelection(value);
        const scanCoverage = { ...result.coverage, ...coverage, liveRosterComplete: true, rosterTraversalComplete: true };
        return { ok: true, ...result,
          members: result.members.map(value => ({ ...value, ticketFreshness: proof.freshness,
            checkedAt: inventory.checkedAt })),
          source: { ...proof, collection: null, coverage: scanCoverage }, coverage: scanCoverage,
          checkedAt: inventory.checkedAt, startedAt: inventory.startedAt ?? null, elapsedMs: inventory.elapsedMs,
          liveReadback: true, allowedForExternalActions: false,
          note: 'StudioMate 원본 회원 목록의 전체 페이지 조회를 완료했습니다. 변경 점검은 첫 페이지 재확인에 한정되며 단일 시점의 전체 상태나 변경 없음을 보장하지 않습니다. 신원 불완전·미분류 제외 수를 확인하세요. 종료·삭제 이력은 아닙니다. 오늘 만료는 0일이며 만료·잔여 0회·정지권을 제외합니다. 예약·환불·발송 근거로 사용하지 않습니다.' };
      }
      const started = now();
      const inventory = await store.getTicketInventory({ forceRefresh: args.forceRefresh === true });
      return { ok: true, ...selectExpiring(inventory.profiles, { now: now(), daysRemainingMax: args.daysRemainingMax,
        classType: args.classType, verifiedLinks: inventory.verifiedLinks }),
        source: { ...snapshotSource({ kind: 'ticket_inventory_snapshot', queriedAt: new Date(now()).toISOString(),
          fetchedAt: iso(inventory.fetchedAt), cacheHit: inventory.cacheHit === true }),
          collection: 'memberProfiles', snapshotFetchedAt: iso(inventory.fetchedAt), cacheTtlSeconds: 300 },
        elapsedMs: now() - started };
    }
    if (name === 'members_find') {
      const query = text(args.query, 50);
      const isPhone = /^[\d\s()+-]+$/.test(query);
      requireValue(isPhone ? /^01[016789]\d{7,8}$/.test(phone(query)) : query.length >= 2,
        'INVALID_ARGUMENT', '이름 또는 전체 휴대폰 번호를 입력해 주세요.');
      if (liveReader) {
        const result = await liveReader.findMembers(isPhone ? phone(query) : query, isPhone, signal);
        for (const member of result.members) rememberSelection(member);
        return { ok: true, members: result.members.map(value => liveMember(value, result.checkedAt)),
          match: 'exact', needsSelection: result.members.length !== 1, liveReadback: true,
          checkedAt: result.checkedAt, elapsedMs: result.elapsedMs, coverage: result.coverage,
          note: 'StudioMate 화면의 정확 일치 검색입니다. 선택한 원본 회원 ID로 다음 조회를 진행하세요.' };
      }
      const found = await store.findMembers(isPhone ? phone(query) : query, isPhone);
      const active = found.filter(value => !value.mergedInto && !value.canonicalMemberId && !value.memberMerge?.canonicalMemberId
        && !['merged', 'deleted'].includes(value.status));
      return { ok: true, members: active.map(value => memberView(validateProfile(value), now())),
        match: 'exact', needsSelection: active.length !== 1, liveReadback: false,
        note: active.length ? '반환된 원본 회원 ID를 선택해 다음 조회에 사용하세요.' : '동기화 원장에 일치하는 회원이 없습니다. StudioMate 부재를 뜻하지 않습니다.' };
    }
    if (name === 'operations_get_job') {
      const value = await store.getJob(args.kind, id(args.jobId));
      return { ok: true, kind: args.kind, found: Boolean(value), job: value ? { ...statusView(value),
        memberId: value.memberId || null, writtenAt: iso(value.writtenAt), sentAt: iso(value.sentAt),
        memoSaved: args.kind === 'memo' ? Boolean(await store.getMemo(args.jobId)) : null } : null,
      note: '저장된 원장 상태이며 재실행하지 않았습니다. 접수·원본 반영·전달 완료를 구분하세요.' };
    }
    if (name === 'memos_commit') {
      requireValue(memoWritesEnabled, 'WRITE_DISABLED', '운영 쓰기는 비활성입니다. 회원·메모·큐를 변경하지 않았습니다.');
      const proposal = await approvals.loadApproved(id(args.proposalId), operator.staffId, now());
      await profile(proposal.memberId, true);
      const result = await store.commitMemo({ proposal, actor: operator, sourceHash, now: now(),
        validateProfile: value => validateProfile(value, true, now()) });
      return { ok: true, ...result, studioMateVerified: false,
        note: result.duplicate ? '기존 동일 메모 작업이 있습니다. 다시 접수하지 않았습니다.'
          : 'CORE 원장 저장·기존 큐 접수 완료입니다. StudioMate 반영 완료는 작업 상태로 별도 확인하세요.' };
    }
    if (name === 'members_get_overview' && liveReader) {
      const expected = await expectedMember(args.memberId);
      const result = await liveReader.getOverview(expected, signal);
      verifyIdentity(result, expected);
      return { ok: true, member: liveMember(result, result.checkedAt), memberGrade: result.memberGrade,
        tickets: result.tickets, checkedAt: result.checkedAt, elapsedMs: result.elapsedMs,
        coverage: result.coverage, ticketIdsAvailable: result.ticketIdsAvailable, liveReadback: true,
        note: 'StudioMate 현재 수강권 화면을 직접 확인했습니다. 종료·삭제 이력과 결제 원장은 이 조회 범위가 아닙니다.' };
    }
    if (name === 'bookings_list' && args.source !== 'snapshot') {
      requireValue(typeof liveReader?.getBookings === 'function', 'LIVE_SOURCE_UNAVAILABLE',
        '실시간 예약 조회 연결이 없습니다. 저장 자료로 대체하지 않았습니다.');
      const expected = await expectedMember(args.memberId);
      const result = await liveReader.getBookings(expected, { startDate: args.startDate, endDate: args.endDate }, signal);
      verifyIdentity(result, expected);
      const proof = liveProof(result, 'native_member_booking_history');
      requireValue(Array.isArray(result.records) && result.records.length <= 2000,
        'LIVE_SOURCE_INCOMPLETE', '실시간 예약 이력 범위를 확인하지 못했습니다.');
      const records = result.records.filter(value => value.lectureDate >= args.startDate && value.lectureDate <= args.endDate)
        .map(value => ({ bookingId: value.bookingId, lectureDate: value.lectureDate,
          startAt: value.startAt, endAt: value.endAt, staffName: value.staffName || null,
          lessonType: value.lessonType || null, sourceStatus: value.sourceStatus || 'unknown',
          userTicketId: value.userTicketId || null,
          source: { ...proof, collection: null, recordId: value.bookingId ?? null } }));
      return { ok: true, member: liveMember(result, result.checkedAt),
        records: records.sort((a, b) => `${a.lectureDate}${a.startAt}`.localeCompare(`${b.lectureDate}${b.startAt}`)),
        source: proof, coverage: result.coverage, checkedAt: result.checkedAt,
        startedAt: result.startedAt ?? null, elapsedMs: result.elapsedMs,
        liveReadback: true, allowedForExternalActions: false,
        note: '선택한 StudioMate 원본 회원의 예약 이력을 조회 구간까지 직접 확인했습니다. 예약·출석·발송을 변경하지 않았으며 외부 작업 대상 확정에 사용하지 않습니다.' };
    }
    const current = await profile(args.memberId, name === 'memos_prepare');
    const member = memberView(current, now());
    if (name === 'members_get_overview') {
      requireValue(!current.activeTickets || (Array.isArray(current.activeTickets) && current.activeTickets.length <= 100),
        'SOURCE_LIMIT', '수강권 원본 범위를 확인해 주세요.');
      return { ok: true, member, memberGrade: current.memberGrade || null,
        tickets: (current.activeTickets || []).map(ticket => ({ userTicketId: ticket.userTicketId || null,
          name: ticket.name, status: ticket.status || 'unknown', remainingCount: Number.isFinite(ticket.remainingCount) ? ticket.remainingCount : null,
          availableFrom: iso(ticket.availableFrom), expiresAt: iso(ticket.expiresAt),
          paymentAmount: Number.isFinite(ticket.paymentAmount) ? ticket.paymentAmount : null })),
        note: '동기화 자료입니다. 빈 목록은 실시간 수강권 미보유를 확정하지 않습니다.' };
    }
    if (name === 'memos_prepare') {
      const content = text(args.content);
      const proposal = await approvals.prepare({ memberId: current.memberId, memberName: current.name,
        maskedPhone: maskedPhone(current.phone), content, sourceHash: sourceHash(current), staffId: operator.staffId }, now());
      return { ok: true, proposal, writesEnabled: memoWritesEnabled,
        note: '로컬 계획만 준비했습니다. 운영자 터미널의 별도 승인 없이는 큐에 접수하지 않습니다.' };
    }
    const ids = await memberIds(current);
    if (name === 'bookings_list') {
      const rows = await store.getRows('bookings', ids, { startDate: args.startDate, endDate: args.endDate });
      const selected = rows.filter(value => value.lectureDate >= args.startDate && value.lectureDate <= args.endDate);
      const records = selected.map(value => ({ bookingId: value._id, lectureDate: value.lectureDate,
        startAt: iso(value.lectureStartAt), endAt: iso(value.lectureEndAt), staffName: value.staffName || null,
        lessonType: value.lessonType || null, sourceStatus: safeState(value.sourceStatus), appStatus: safeState(value.appStatus),
        attendanceStatus: safeState(value.attendanceStatus), canonicalBookingKey: value.canonicalBookingKey || null,
        supersededByBookingId: value.supersededByBookingId || null,
        sourceKind: /^(excel_|usage_)/.test(value._id) ? 'fallback' : 'native_or_other',
        source: source(value, 'bookings', now()) }));
      return { ok: true, member, records: records.sort((a, b) => `${a.lectureDate}${a.startAt}`.localeCompare(`${b.lectureDate}${b.startAt}`)),
        source: snapshotSource({ kind: 'bookings_snapshot', queriedAt: new Date(now()).toISOString() }),
        liveReadback: false, allowedForExternalActions: false,
        note: '동기화 원장을 그대로 표시합니다. 대체·중복 원본은 별도로 표시하며 이 목록으로 예약·발송하지 않습니다.' };
    }
    if (name === 'contracts_get_progress') {
      const rows = await store.getRows('studiomateMembershipContracts', ids);
      rows.forEach(value => validateContract(value, ids));
      return { ok: true, member, contracts: rows.map(value => ({ ...statusView(value), contractId: value.contractId || null,
        contractType: value.contractType || value.selection?.action || null, sentAt: iso(value.sentAt),
        signedAt: iso(value.signatureReceipt?.signedAt || value.completion?.signedAt || value.signedAt),
        signatureEvidence: value.signatureReceipt?.authoritative === true ? 'native_receipt'
          : value.completion ? 'completion_record' : 'not_recorded',
        signatureCheckedAt: iso(value.signatureReceipt?.checkedAt || value.completion?.checkedAt),
        observationStatus: safeState(value.observationStatus), observationHold: value.observationHold === true,
        completedAt: iso(value.completedAt), welcomeStatus: safeState(value.welcomeStatus),
        source: source(value, 'studiomateMembershipContracts', now()) })),
        note: '자동화 원장 기록입니다. 원본 전자계약서 최신 조회가 아니며 기록 없음·발송·서명은 서로 다른 상태입니다.' };
    }
    range(args.startDate, args.endDate);
    const requestedRange = { startDate: args.startDate, endDate: args.endDate };
    const candidateResult = await store.getMessageRows('alimtalkCandidates', ids, requestedRange);
    const sendResult = await store.getMessageRows('alimtalkSends', ids, requestedRange);
    const candidates = candidateResult.rows, sends = sendResult.rows;
    const inRange = value => { const date = kstDate(value.createdAt); return date && date >= args.startDate && date <= args.endDate; };
    const unknownDates = [...candidates, ...sends].filter(value => !kstDate(value.createdAt)).length;
    return { ok: true, member, dateBasis: 'createdAt_Asia_Seoul', observedUnknownDateRecords: unknownDates,
      coverage: { candidates: candidateResult.coverage, sends: sendResult.coverage },
      candidates: candidates.filter(inRange).map(value => ({ ...statusView(value), type: value.type || null, title: value.title || null,
        createdAt: iso(value.createdAt), sentAt: iso(value.sentAt), templateCode: value.templateCode || null })),
      sends: sends.filter(inRange).map(value => ({ ...statusView(value), candidateId: value.candidateId || null,
        createdAt: iso(value.createdAt), solapiMessageId: value.solapiMessageId || null,
        providerStatus: safeState(value.solapiStatus || value.providerStatus), providerStatusCode: value.solapiStatusCode || null })),
      providerLiveChecked: false, note: '후보·큐·발송 원장의 저장 상태입니다. done 또는 메시지 ID만으로 최종 전달 완료를 확정하지 않습니다.' };
  }
  return { listTools: () => readOnly ? TOOLS.filter(tool => tool.annotations.readOnlyHint) : TOOLS, callTool };
}
