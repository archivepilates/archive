const string = (maxLength = 160) => ({ type: 'string', minLength: 1, maxLength });
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const tool = (name, description, inputSchema, annotations = read) => ({ name, description, inputSchema, annotations });
const member = { memberId: string() };
export const TOOLS = [
  tool('members_find', '이름 또는 전체 휴대폰 번호 완전일치로 회원 후보를 찾습니다. 동기화 자료이며 실시간 원본이 아닙니다.', schema({ query: string(50) })),
  tool('members_get_overview', '선택 회원의 동기화 수강권과 원본 ID 연결·기준시각을 조회합니다.', schema(member)),
  tool('bookings_list', '선택 회원의 최대 31일 예약 원장을 조회합니다. 중복 원본은 표시하며 예약을 생성·취소하지 않습니다.', schema({ ...member, startDate: string(10), endDate: string(10) })),
  tool('contracts_get_progress', '회원 계약의 생성·발송·서명·웰컴 원장 상태를 구분해 조회합니다. 기록 없음은 미서명을 뜻하지 않습니다.', schema(member)),
  tool('messages_get_delivery', '회원의 최대 31일 알림톡 후보와 발송 기록을 조회합니다. 공급자 최종 조회가 아닌 저장된 증거입니다.', schema({ ...member, startDate: string(10), endDate: string(10) })),
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
    return rule && typeof value === 'string' && value.length >= (rule.minLength || 1)
      && value.length <= (rule.maxLength || 160) && (!rule.enum || rule.enum.includes(value));
  });
}
