import { id, requireValue, phone, millis } from './errors.mjs';
import { validateContract } from './service.mjs';

export const JOB_COLLECTIONS = Object.freeze({
  memo: 'studiomateMemoWriteJobs', membership_contract: 'studiomateMembershipContractJobs',
  instructor_registration: 'studiomateInstructorLessonJobs', refund_sms: 'studiomateRefundSmsJobs',
  refund_agreement: 'eformsignRefundJobs', holding: 'holdingNoticeEvents',
});
const MEMBER_COLLECTIONS = new Set(['bookings', 'studiomateMembershipContracts', 'alimtalkCandidates', 'alimtalkSends']);
const row = doc => doc.exists ? { ...doc.data(), _id: doc.id } : null;

export function createStore(db, Timestamp, { now = Date.now } = {}) {
  let inventory, inventoryLoading, inventoryExpiry;
  const profile = memberId => db.collection('memberProfiles').doc(id(memberId));
  const memo = memoId => db.collection('memberMemos').doc(id(memoId));
  const job = memoId => db.collection(JOB_COLLECTIONS.memo).doc(id(memoId));
  const scope = value => {
    requireValue(value && value.studioId === '5330', 'SOURCE_SCOPE_MISMATCH', '원본 센터 연결을 확인해 주세요.');
    return value;
  };
  return {
    async getOperator(staffId) { return row(await db.collection('staffs').doc(id(staffId)).get()); },
    async getProfile(memberId) { const value = row(await profile(memberId).get()); return value ? scope(value) : null; },
    async findMembers(query, isPhone) {
      const snapshot = await db.collection('memberProfiles').where(isPhone ? 'phone' : 'name', '==', query).limit(11).get();
      requireValue(snapshot.size <= 10, 'SEARCH_TOO_BROAD', '동일한 회원이 많습니다. 전체 전화번호로 조회해 주세요.');
      return snapshot.docs.map(row).filter(value => value.studioId === '5330');
    },
    async getTicketInventory({ forceRefresh = false } = {}) {
      if (!forceRefresh && inventory && now() >= inventory.fetchedAt && now() - inventory.fetchedAt < 300000) {
        return { ...inventory, cacheHit: true };
      }
      if (!inventoryLoading) inventoryLoading = (async () => {
        const snapshot = await db.collection('memberProfiles').where('studioId', '==', '5330')
          .select('studioId', 'memberId', 'name', 'phone', 'status', 'mergedInto', 'canonicalMemberId', 'memberMerge.canonicalMemberId',
            'activeTickets', 'syncedAt', 'sourceObservedAt', 'sourceUpdatedAt', 'studiomateMemberId', 'studiomateMemberIdResolvedAt').limit(2001).get();
        requireValue(snapshot.size <= 2000, 'SOURCE_LIMIT', '동기화 회원이 조회 한도를 넘었습니다. 일부를 전체 목록으로 표시하지 않았습니다.');
        const profiles = snapshot.docs.map(row).map(scope), byId = new Map(profiles.map(p => [p._id, p]));
        const pairs = profiles.filter(p => /^excel_/.test(p._id) && /^[1-9]\d*$/.test(p.studiomateMemberId || '')
          && byId.has(p.studiomateMemberId)).slice(0, 20);
        const receipts = pairs.length ? await db.getAll(...pairs.map(p => db.collection('studiomateMemberIdLookupJobs')
          .doc(`studiomate_member_id_lookup_${id(p._id)}`))) : [];
        const verifiedLinks = [];
        for (const [index, alias] of pairs.entries()) {
          const native = byId.get(alias.studiomateMemberId), proof = row(receipts[index]);
          if (alias._id === alias.memberId && native._id === native.memberId && proof?.status === 'done'
            && proof.studioId === '5330' && proof.memberId === alias.memberId && proof.studiomateMemberId === native.memberId
            && proof.memberName === alias.name && native.name === alias.name && phone(alias.phone)
            && phone(proof.memberPhone) === phone(alias.phone) && phone(native.phone) === phone(alias.phone)
            && millis(proof.resolvedAt) && millis(proof.resolvedAt) === millis(alias.studiomateMemberIdResolvedAt)) {
            verifiedLinks.push({ aliasId: alias.memberId, nativeId: native.memberId });
          }
        }
        inventory = { profiles, verifiedLinks, fetchedAt: now() };
        clearTimeout(inventoryExpiry);
        inventoryExpiry = setTimeout(() => { inventory = null; }, 300000);
        inventoryExpiry.unref?.();
        return { ...inventory, cacheHit: false };
      })().catch(error => { clearTimeout(inventoryExpiry); inventory = null; throw error; }).finally(() => { inventoryLoading = null; });
      return inventoryLoading;
    },
    async getLookup(memberId) { return row(await db.collection('studiomateMemberIdLookupJobs').doc(`studiomate_member_id_lookup_${id(memberId)}`).get()); },
    async getRows(collection, memberIds, range = null) {
      requireValue(MEMBER_COLLECTIONS.has(collection), 'INVALID_ARGUMENT', '허용된 원장만 조회할 수 있습니다.');
      const all = [];
      let remainingReadBudget = 400;
      const fields = collection === 'studiomateMembershipContracts'
        ? ['binding.memberId', 'selection.memberId', 'completion.memberId', 'memberId'] : ['memberId'];
      for (const memberId of [...new Set(memberIds)]) for (const field of fields) {
        requireValue(remainingReadBudget > 0, 'SOURCE_LIMIT', '원장 조회 예산을 넘었습니다. 범위를 좁혀 확인해 주세요.');
        let query = db.collection(collection).where('studioId', '==', '5330').where(field, '==', id(memberId));
        if (collection === 'bookings' && range) query = query
          .where('lectureDate', '>=', range.startDate).where('lectureDate', '<=', range.endDate);
        const cap = Math.min(201, remainingReadBudget + 1);
        const snapshot = await query.limit(cap).get();
        remainingReadBudget -= snapshot.size;
        requireValue(snapshot.size < cap, 'SOURCE_LIMIT', '원장 조회 한도를 넘었습니다. 일부를 전체 결과로 표시하지 않았습니다.');
        all.push(...snapshot.docs.map(row).map(scope));
      }
      const unique = [...new Map(all.map(value => [value._id, value])).values()];
      requireValue(unique.length <= 200, 'SOURCE_LIMIT', '연결된 원장 조회 한도를 넘었습니다. 전체 결과를 확인해 주세요.');
      if (collection === 'studiomateMembershipContracts') unique.forEach(value => validateContract(value, memberIds));
      return unique;
    },
    async getMessageRows(collection, memberIds, range) {
      requireValue(['alimtalkCandidates', 'alimtalkSends'].includes(collection), 'INVALID_ARGUMENT', '알림톡 원장만 조회할 수 있습니다.');
      const start = Timestamp.fromMillis(Date.parse(`${range.startDate}T00:00:00+09:00`));
      const end = Timestamp.fromMillis(Date.parse(`${range.endDate}T00:00:00+09:00`) + 86400000);
      const all = [], coverage = { queryMode: 'source_date_range', needsIndexDeployment: false, unknownDateCoverage: 'not_checked' };
      let remaining = 400;
      for (const memberId of [...new Set(memberIds)]) {
        requireValue(remaining > 0, 'SOURCE_LIMIT', '알림톡 원장 조회 한도를 넘었습니다. 원본 확인이 필요합니다.');
        const base = db.collection(collection).where('studioId', '==', '5330').where('memberId', '==', id(memberId));
        const cap = Math.min(201, remaining + 1);
        let snapshot;
        try {
          snapshot = await base.where('createdAt', '>=', start).where('createdAt', '<', end).limit(cap).get();
        } catch (error) {
          // Only a missing composite index permits a disclosed, bounded compatibility query.
          if (error.code !== 9 || !/index/i.test(String(error.message || ''))) throw error;
          coverage.queryMode = 'bounded_member_history_fallback';
          coverage.needsIndexDeployment = true;
          snapshot = await base.limit(cap).get();
        }
        remaining -= snapshot.size;
        requireValue(snapshot.size < cap, 'SOURCE_LIMIT', coverage.needsIndexDeployment
          ? '알림톡 날짜 인덱스가 미배포이고 기존 이력이 조회 한도를 넘었습니다. 날짜 축소로 해결되지 않으므로 인덱스 배포가 필요합니다.'
          : '선택 기간의 알림톡 원장이 조회 한도를 넘었습니다. 기간을 좁혀 주세요.');
        all.push(...snapshot.docs.map(row).map(scope));
      }
      const rows = [...new Map(all.map(value => [value._id, value])).values()];
      requireValue(rows.length <= 200, 'SOURCE_LIMIT', '연결된 알림톡 원장 한도를 넘었습니다. 전체 결과로 표시하지 않았습니다.');
      return { rows, coverage };
    },
    async getJob(kind, jobId) {
      requireValue(Object.hasOwn(JOB_COLLECTIONS, kind), 'INVALID_ARGUMENT', '지원하는 업무 종류를 선택해 주세요.');
      const value = row(await db.collection(JOB_COLLECTIONS[kind]).doc(id(jobId)).get());
      return value ? scope(value) : null;
    },
    async getMemo(memoId) { const value = row(await memo(memoId).get()); return value ? scope(value) : null; },
    async commitMemo({ proposal, actor, sourceHash, validateProfile, now }) {
      // Both canonical records are created atomically; the existing worker is the only StudioMate writer.
      return db.runTransaction(async tx => {
        const staff = row(await tx.get(db.collection('staffs').doc(id(actor.staffId))));
        requireValue(staff?.active === true && ['owner', 'manager'].includes(staff.role) && staff.studioId === '5330',
          'PERMISSION_DENIED', '운영자 권한을 다시 확인해 주세요.');
        const current = row(await tx.get(profile(proposal.memberId)));
        validateProfile(current, true);
        requireValue(sourceHash(current) === proposal.sourceHash, 'SOURCE_CHANGED', '회원 원본이 변경됐습니다. 계획을 다시 준비해 주세요.');
        const existingMemo = row(await tx.get(memo(proposal.jobId)));
        const existingJob = row(await tx.get(job(proposal.jobId)));
        if (existingMemo || existingJob) {
          requireValue(existingMemo && existingJob && [existingMemo, existingJob].every(value => value.studioId === '5330'
            && value.memberId === proposal.memberId && value.content === proposal.content),
          'INCOMPLETE_OPERATION', '기존 메모·작업 원장이 일치하지 않습니다. 자동 복구하지 않았습니다.');
          return { jobId: proposal.jobId, status: existingJob.status, duplicate: true };
        }
        const at = Timestamp.fromMillis(now);
        const common = { studioId: '5330', memberId: proposal.memberId, memberName: current.name,
          content: proposal.content, createdByUid: actor.uid || `local:${actor.staffId}`, createdAt: at, updatedAt: at };
        tx.create(memo(proposal.jobId), { ...common, memoId: proposal.jobId, memoType: 'member_note', visibility: 'staff_and_manager',
          staffId: actor.staffId, staffName: staff.name || '', lectureId: '', bookingId: '', lectureDate: '',
          source: 'archivepilates_mcp', syncStatus: 'pending',
          approval: { proposalId: proposal.proposalId, sourceHash: proposal.sourceHash, confirmedAt: at, method: 'local_operator_terminal' } });
        tx.create(job(proposal.jobId), { ...common, jobId: proposal.jobId, memberPhone: current.phone,
          studiomateMemberId: current.memberId, source: 'archivepilates_mcp', status: 'pending', writeMode: 'playwright',
          attempts: 0, maxAttempts: 1, lastError: null });
        return { jobId: proposal.jobId, status: 'pending', duplicate: false };
      });
    },
  };
}
