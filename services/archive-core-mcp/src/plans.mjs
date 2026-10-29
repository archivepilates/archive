import { mkdir, lstat, open, unlink, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { assert, CoreError, hash, bounded } from './safety.mjs';

export async function createPlans(directory, { now = Date.now } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0,
    'LOCAL_STATE_UNSAFE', 'MCP 작업 기록 폴더 소유자와 권한을 확인하세요.');
  const file = (id, suffix) => {
    assert(/^[a-z0-9-]{16,80}$/.test(id), 'INVALID_ARGUMENT', '정확한 MCP 계획 ID가 필요합니다.');
    return path.join(directory, id + '.' + suffix + '.json');
  };
  async function read(filename) {
    let handle;
    try { handle = await open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const s = await handle.stat();
      assert(s.isFile() && s.uid === process.getuid() && !(s.mode & 0o077) && s.size <= 550000,
        'LOCAL_STATE_UNSAFE', '작업 기록 파일 소유자와 권한을 확인하세요.');
      return JSON.parse(await handle.readFile('utf8'));
    } finally { await handle.close(); }
  }
  async function exclusive(filename, data) {
    const handle = await open(filename, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(bounded(data, 500000))); await handle.sync(); }
    finally { await handle.close(); }
  }
  const normalizedPhone = value => String(value).replace(/\D/g, '').replace(/^82/, '0');
  const scopeKeys = {
    operatorControlCoreAirConditioner: ['deviceId'], operatorReconcileCoreAirConditioner: ['deviceId'],
    submitBookingAttendance: ['bookingId'], submitMemberMemo: ['bookingId'], submitKioskCheckin: ['bookingId'],
    removeParkingVehicle: ['vehicleId'], runParkingAutoApplyNow: ['date'], operatorApproveHoldingNotice: ['candidateId'],
    generateRecommendedMealProgramDraft: ['requestId'], saveRecommendedMealProgramDraft: ['requestId'],
    operatorPublishRecommendedMealPlan: ['requestId'], queueRefundStudioMateSms: ['memberId', 'ticketKey', 'ticketKind'],
    sendRefundAgreement: ['memberId', 'ticketKey', 'ticketKind'], operatorCreateInstructorLessonRegistration: ['lessonDate'],
    operatorQueueInstructorLessonCancellation: ['memberId', 'lessonDate'], confirmInstructorLessonBookingAndQueueAlimtalk: ['registrationId'],
    submitInstructorEvaluationQuiz: ['targetStaffId'], adjustInstructorEvaluationEssayScore: ['submissionId'],
    saveInstagramContentDraft: ['contentId'], approveInstagramContent: ['contentId'], holdInstagramContent: ['contentId'],
    coreRenewalWorkflowUpdate: ['caseId'], coreSequenceSave: ['noteId'], coreSequenceRemove: ['noteId'],
  };
  function semanticParams(plan) {
    const value = { ...plan.params };
    if (value.phone || value.memberPhone) {
      value.phone = normalizedPhone(value.phone || value.memberPhone); delete value.memberPhone;
    }
    if (value.carNumber) value.carNumber = String(value.carNumber).replace(/\s/g, '').toUpperCase();
    return value;
  }
  function scopeId(plan) {
    const p = semanticParams(plan);
    const identity = {};
    for (const key of scopeKeys[plan.operation] || []) {
      const value = key === 'noteId' ? p.noteId || p.state?.id : key === 'targetStaffId' ? p.targetStaffId || p.staffId : p[key];
      if (value !== undefined) identity[key] = value;
    }
    if (['operatorSendPricingInquiryAlimtalk', 'operatorSendRecommendedMealProgramAlimtalk',
      'operatorCreateInstructorLessonRegistration', 'queueRefundStudioMateSms', 'sendRefundAgreement'].includes(plan.operation) && p.phone)
      identity.phone = p.phone;
    if (plan.operation === 'registerParkingVehicle') identity.carNumber = p.carNumber;
    return hash({ operation: plan.operation, actorId: plan.actorId, identity });
  }
  return {
    async prepare({ operation, params, actionKey, actorId, actorHash, sources }) {
      assert(/^[A-Za-z0-9_-]{16,128}$/.test(actionKey), 'INVALID_ARGUMENT', '업무별 고정 actionKey가 필요합니다.');
      const value = { version: 1, planId: randomUUID(), operation, params, actionKey, actorId, actorHash, sources,
        issuedAt: now(), expiresAt: now() + 600000 };
      const planHash = hash(value);
      await exclusive(file(value.planId, 'plan'), { ...value, planHash });
      return { ...value, planHash };
    },
    async load(planId, planHash) {
      const stored = await read(file(planId, 'plan'));
      assert(stored, 'PLAN_NOT_FOUND', '준비된 계획이 없습니다.');
      const { planHash: actual, ...value } = stored;
      assert(value.version === 1 && value.planId === planId && actual === planHash && hash(value) === actual,
        'PLAN_CHANGED', '준비한 내용과 승인하려는 계획이 다릅니다.');
      assert(Number.isSafeInteger(value.issuedAt) && value.issuedAt <= now() && value.expiresAt > now()
        && value.expiresAt - value.issuedAt === 600000, 'PLAN_EXPIRED', '계획이 만료됐습니다. 현재 원본으로 다시 준비하세요.');
      return stored;
    },
    async lock() {
      const filename = path.join(directory, 'execution.lock');
      try { await exclusive(filename, { pid: process.pid, startedAt: now() }); }
      catch (error) {
        if (error.code === 'EEXIST') throw new CoreError('WRITE_BUSY', '다른 CORE 수정이 진행 중이거나 결과 확인이 필요합니다. 잠금을 강제 해제하지 않습니다.');
        throw error;
      }
      return () => unlink(filename);
    },
    intentId(plan) { return hash({ operation: plan.operation, actionKey: plan.actionKey, actorId: plan.actorId }); },
    async existingIntent(intentId) { return read(file(intentId, 'intent')); },
    async claim(plan) {
      const intentId = this.intentId(plan);
      assert(!await this.existingIntent(intentId), 'REPLAY_BLOCKED', '기존 실행 기록이 있습니다. 다시 실행하지 말고 원본을 조회하세요.');
      const scopeFile = file(scopeId(plan), 'scope');
      const semanticHash = hash(semanticParams(plan));
      const effectFile = file(hash({ kind: 'effect', scope: scopeId(plan), semanticHash }), 'scope');
      const previous = await read(scopeFile);
      if (previous) {
        const receipt = await this.receipt(previous.intentId);
        assert(receipt?.status === 'request_completed', 'CANONICAL_OUTCOME_UNKNOWN', '같은 원본 업무의 이전 결과가 불명확합니다. 업무 키를 바꿔 재시도하지 말고 원장을 대조하세요.');
        assert(receipt.paramsHash !== hash(plan.params) && previous.semanticHash !== semanticHash,
          'CANONICAL_DUPLICATE', '같은 원본과 입력으로 완료된 작업이 있습니다. 새 업무 키로 반복하지 않습니다.');
      }
      const previousEffect = await read(effectFile);
      if (previousEffect) {
        const receipt = await this.receipt(previousEffect.intentId);
        assert(receipt?.status === 'request_completed', 'CANONICAL_OUTCOME_UNKNOWN', '같은 입력의 이전 실행 결과가 불명확합니다. 원장을 확인하세요.');
        assert(false, 'CANONICAL_DUPLICATE', '이 입력으로 완료된 이전 작업이 있습니다. 이후 변경이 있어도 이전 입력을 반복하지 않습니다.');
      }
      const value = { version: 1, intentId, planId: plan.planId, planHash: plan.planHash,
        operation: plan.operation, paramsHash: hash(plan.params), actionKey: plan.actionKey,
        status: 'outcome_unknown', attemptedAt: new Date(now()).toISOString() };
      // Reserve the canonical scope first: a crash before the intent is also fail-closed.
      const scope = { intentId, operation: plan.operation, paramsHash: value.paramsHash, semanticHash };
      await exclusive(effectFile, scope);
      if (!previous) await exclusive(scopeFile, scope);
      else {
        const temporary = scopeFile + '.' + randomUUID();
        await exclusive(temporary, scope);
        await rename(temporary, scopeFile);
      }
      try { await exclusive(file(intentId, 'intent'), value); }
      catch (error) {
        if (error.code === 'EEXIST') throw new CoreError('REPLAY_BLOCKED', '기존 실행 기록이 있습니다. 다시 실행하지 말고 기록과 원본을 조회하세요.');
        throw error;
      }
      return value;
    },
    async complete(intent, result) {
      // Never overwrite an uncertain intent. The independent result receipt closes it.
      await exclusive(file(intent.intentId, 'result'), { ...intent, status: 'request_completed',
        result, completedAt: new Date(now()).toISOString() });
    },
    async receipt(intentId) {
      const intent = await read(file(intentId, 'intent'));
      const result = await read(file(intentId, 'result'));
      assert(!result || intent && result.planHash === intent.planHash && result.paramsHash === intent.paramsHash,
        'LOCAL_STATE_UNSAFE', '실행과 결과 기록의 연결이 일치하지 않습니다.');
      return result || intent;
    },
  };
}
