const string = (maxLength = 160) => ({ type: 'string', minLength: 1, maxLength });
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const tool = (name, description, inputSchema, annotations = read) => ({ name, description, inputSchema, annotations });
const member = { memberId: string() };
const querySource = { type: 'string', enum: ['live', 'snapshot'], default: 'live' };
export const TOOLS = [
  tool('members_find', '맥미니 StudioMate 화면에서 이름 또는 전체 휴대폰 번호 완전일치 회원을 실시간 검색합니다. 동명이인은 선택이 필요합니다.', schema({ query: string(50) })),
  tool('members_get_overview', '선택 회원의 StudioMate 현재 수강권·등급을 실시간 화면에서 재확인합니다. 잠금·로그인·조회 실패는 저장 자료로 대체하지 않습니다.', schema(member)),
  tool('members_list_expiring', '한국 날짜 기준 오늘부터 지정 일수 이하 남은 수강권 보유 회원을 기본 실시간 StudioMate 전체 회원 화면에서 조회합니다. 실패 시 저장 자료로 대체하지 않습니다. source=snapshot은 저장 원장만 조회하며 최신성은 미확인입니다. 이 결과로 예약·발송 대상을 확정하지 않습니다.', schema({
    daysRemainingMax: { type: 'integer', minimum: 0, maximum: 366 },
    classType: { type: 'string', enum: ['all', 'group', 'private', 'instructor'] },
    forceRefresh: { type: 'boolean' },
    source: querySource,
  }, ['daysRemainingMax'])),
  tool('bookings_list', '선택 회원의 최대 31일 예약 이력을 기본 실시간 StudioMate 화면에서 조회합니다. 실패 시 저장 자료로 대체하지 않습니다. source=snapshot은 최신성 미확인의 저장 원장입니다. 예약을 생성·취소하지 않습니다.', schema({ ...member, startDate: string(10), endDate: string(10), source: querySource }, ['memberId', 'startDate', 'endDate'])),
  tool('contracts_get_progress', '회원 계약의 생성·발송·서명·웰컴 원장 상태를 구분해 조회합니다. 기록 없음은 미서명을 뜻하지 않습니다.', schema(member)),
  tool('messages_get_delivery', '회원의 최대 31일 알림톡 후보와 발송 기록을 조회합니다. 공급자 최종 조회가 아닌 저장된 증거입니다.', schema({ ...member, startDate: string(10), endDate: string(10) })),
  tool('messages_validate_target', '정확한 알림톡 후보 ID의 저장 원장을 읽기 전용으로 사전 검증합니다. 스냅샷 점검일 뿐 실시간 원본 확인·발송 허가·승인·큐 접수·발송이 아닙니다.', schema({ candidateId: { ...string(), pattern: '^[A-Za-z0-9_-]{1,160}$' } })),
  tool('operations_get_job', '허용된 업무 종류와 정확한 작업 ID로 상태를 조회합니다. 재실행·수정은 하지 않습니다.', schema({ kind: { type: 'string', enum: ['memo', 'membership_contract', 'instructor_registration', 'refund_sms', 'refund_agreement', 'holding'] }, jobId: string() })),
  tool('memos_prepare', '새 회원 메모 추가 계획을 로컬에 준비합니다. 승인이나 실제 저장·큐 접수가 아닙니다.', schema({ ...member, content: string(1000) }), { ...read, readOnlyHint: false }),
  tool('memos_commit', '별도 운영자 터미널에서 승인한 메모 계획만 기존 큐에 한 번 접수합니다. 기본 비활성이며 StudioMate 반영 완료가 아닙니다.', schema({ proposalId: string() }), { ...read, readOnlyHint: false }),
];

export function validate(name, args) {
  const definition = TOOLS.find(tool => tool.name === name);
  if (!definition || !args || typeof args !== 'object' || Array.isArray(args)) return false;
  const { properties, required } = definition.inputSchema;
  return required.every(key => Object.hasOwn(args, key)) && Object.keys(args).every(key => {
    const rule = Object.hasOwn(properties, key) ? properties[key] : null, value = args[key];
    if (!rule) return false;
    if (rule.type === 'boolean') return typeof value === 'boolean';
    if (rule.type === 'integer') return Number.isSafeInteger(value) && value >= rule.minimum && value <= rule.maximum;
    return typeof value === 'string' && value.length >= (rule.minLength || 1)
      && value.length <= (rule.maxLength || 160) && (!rule.enum || rule.enum.includes(value))
      && (!rule.pattern || new RegExp(rule.pattern).test(value));
  });
}
