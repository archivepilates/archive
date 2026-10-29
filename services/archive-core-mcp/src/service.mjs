import { assert, bounded, hash, memberWindow, publicResult, rejectSecrets } from './safety.mjs';
import { ACTIONS, UNSUPPORTED } from './catalog.mjs';
import { mealReview } from './meal-review.mjs';

const object = { type: 'object', additionalProperties: true };
const text = { type: 'string', minLength: 1, maxLength: 160 };
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const definitions = [
  ['core_catalog', 'CORE 조회 영역과 지원 업무·필수 입력·지원하지 않는 작업을 확인합니다.', schema({})],
  ['core_records_list', 'CORE 저장 원장을 제한 조회합니다. StudioMate 실시간 원본이 아니며 부분 목록을 전체로 해석하지 마세요.', schema({ area: text, filters: object, limit: { type: 'integer', minimum: 1, maximum: 50 }, afterId: text }, ['area'])],
  ['core_records_get', 'CORE 저장 원장 한 건과 현재 원본 해시를 조회합니다. 비밀·건강정보는 제외합니다.', schema({ area: text, id: text }, ['area', 'id'])],
  ['core_query', '등록된 CORE 조회 처리기를 호출합니다. 수정 업무는 허용하지 않습니다.', schema({ operation: text, params: object }, ['operation', 'params'])],
  ['core_meal_review', '식단 설문 선호·초안·검토 상태를 조회합니다. 건강·InBody 원문은 제공하지 않습니다.', schema({ requestId: text }, ['requestId'])],
  ['core_action_prepare', '승인된 수정 업무의 정확한 입력과 현재 원본을 10분 유효 계획으로 준비합니다. 실행·발송이 아닙니다.', schema({ operation: text, params: object, actionKey: { type: 'string', minLength: 16, maxLength: 128 } }, ['operation', 'params', 'actionKey'])],
  ['core_action_execute', '사용자가 승인한 정확한 계획을 한 번 실행합니다. 발송·공개·취소는 별도 명시적 사용자 승인이 필요합니다. 결과 불명확은 재실행 금지입니다.', schema({ planId: text, planHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, confirmation: { type: 'string', minLength: 1, maxLength: 400 } }, ['planId', 'planHash', 'confirmation'])],
  ['core_action_status', 'MCP 내부 실행 접수 기록입니다. 업무 원장·최종 전달 완료 증거는 별도로 조회하세요.', schema({ intentId: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, ['intentId'])],
];

export function createService({ access, store, plans, invoke, validate, now = Date.now }) {
  const action = (name, mode, params) => {
    const spec = ACTIONS.find(a => a.name === name && a.mode === mode);
    assert(spec, 'UNKNOWN_ACTION', '이 경로에서 지원하는 CORE 업무가 아닙니다.');
    rejectSecrets(params); bounded(params);
    assert(params && typeof params === 'object' && !Array.isArray(params), 'INVALID_ARGUMENT', '업무 입력 객체가 필요합니다.');
    for (const key of spec.required) assert(Object.hasOwn(params, key) && params[key] !== null
      && (key === 'expectedRevision' || params[key] !== ''), 'INVALID_ARGUMENT', `필수 입력: ${key}`);
    return spec;
  };
  const fresh = async (plan, spec) => {
    const current = await access.owner();
    assert(current.bindingHash === plan.actorHash && current.binding.staffId === plan.actorId, 'ACTOR_CHANGED', '소유자 세션 또는 권한이 변경됐습니다. 다시 준비하세요.');
    assert(hash(await store.fingerprints(spec, plan.params)) === hash(plan.sources), 'SOURCE_CHANGED', '원본이 변경됐습니다. 현재 내용으로 다시 준비하세요.');
    assert(!spec.memberFacing || memberWindow(now()), 'QUIET_HOURS', '회원 대상 실행은 한국시간 09:00~23:00만 가능합니다.');
    return current;
  };
  return {
    listTools() { return definitions.map(([name, description, inputSchema]) => ({ name, description, inputSchema,
      annotations: { readOnlyHint: !['core_action_prepare', 'core_action_execute'].includes(name),
        destructiveHint: name === 'core_action_execute', idempotentHint: name !== 'core_action_execute', openWorldHint: true } })); },
    async callTool(name, args = {}, { signal } = {}) {
      assert(definitions.some(d => d[0] === name), 'UNKNOWN_TOOL', '등록되지 않은 MCP 도구입니다.');
      validate(name, args); rejectSecrets(args); bounded(args);
      const current = await access.owner();
      let output;
      if (name === 'core_catalog') output = { actions: ACTIONS, areas: store.areas(), unsupported: UNSUPPORTED };
      else if (name === 'core_records_get') output = await store.get(args.area, args.id);
      else if (name === 'core_records_list') output = await store.list(args.area, args.filters, args.limit, args.afterId);
      else if (name === 'core_query') {
        action(args.operation, 'read', args.params);
        assert(args.operation !== 'getRecommendedMealProgramReview', 'USE_MEAL_REVIEW', '식단 검토는 core_meal_review를 사용하세요.');
        output = await invoke(args.operation, args.params, current, signal);
      } else if (name === 'core_meal_review') {
        return { ok: true, ...mealReview(await invoke('getRecommendedMealProgramReview', { requestId: args.requestId }, current, signal)) };
      } else if (name === 'core_action_prepare') {
        const spec = action(args.operation, 'write', args.params);
        const plan = await plans.prepare({ operation: spec.name, params: args.params, actionKey: args.actionKey,
          actorId: current.binding.staffId, actorHash: current.bindingHash, sources: await store.fingerprints(spec, args.params) });
        output = { planId: plan.planId, planHash: plan.planHash, operation: plan.operation,
          expiresAt: new Date(plan.expiresAt).toISOString(), intentId: plans.intentId(plan),
          params: publicResult(plan.params), sources: plan.sources,
          requiredConfirmation: `${spec.name}:${plan.planHash}`, memberFacing: spec.memberFacing,
          note: '준비만 완료. 사용자 승인 후 core_action_execute가 필요합니다.' };
      } else if (name === 'core_action_status') output = await plans.receipt(args.intentId);
      else {
        const plan = await plans.load(args.planId, args.planHash);
        const spec = action(plan.operation, 'write', plan.params);
        assert(args.confirmation === `${spec.name}:${plan.planHash}`, 'CONFIRMATION_REQUIRED', '정확한 업무와 계획 해시 승인 문구가 필요합니다.');
        const unlock = await plans.lock();
        try {
          const previous = await plans.existingIntent(plans.intentId(plan));
          if (previous) {
            assert(previous.paramsHash === hash(plan.params), 'ACTION_KEY_CONFLICT', '같은 업무 키가 다른 입력으로 사용됐습니다.');
            output = { reused: true, receipt: await plans.receipt(previous.intentId), replayed: false };
          } else {
            const actor = await fresh(plan, spec);
            let intent;
            const result = await invoke(spec.name, plan.params, actor, signal, { beforeDispatch: async () => {
              assert(!signal?.aborted, 'CANCELLED', '실행 전에 취소됐습니다.');
              await plans.load(args.planId, args.planHash);
              await fresh(plan, spec);
              intent = await plans.claim(plan);
            } });
            assert(intent, 'INTERNAL_ERROR', '실행 선점 기록이 없어 완료로 기록하지 않습니다.');
            await plans.complete(intent, publicResult(result));
            output = { intentId: intent.intentId, requestCompleted: true, result,
              note: '처리기 응답입니다. 발송 접수·최종 전달·외부 동기화 완료는 해당 원장을 확인하세요.' };
          }
        } finally { await unlock(); }
      }
      return { ok: true, source: 'CORE stored records or existing authenticated business handler',
        observedAt: new Date(now()).toISOString(), result: publicResult(output) };
    },
  };
}
