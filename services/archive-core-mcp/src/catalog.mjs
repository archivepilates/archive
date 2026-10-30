import { ACTIONS as CALLABLE_ACTIONS, UNSUPPORTED as EXCLUDED } from './actions.mjs';
import { DIRECT_ACTIONS } from './direct.mjs';
import { assert } from './safety.mjs';

export const ACTIONS = Object.freeze([...CALLABLE_ACTIONS, ...DIRECT_ACTIONS]);
export const UNSUPPORTED = EXCLUDED.filter(item => !['renewalCases', 'sequenceNotes / sequenceNoteImages'].includes(item.name));

export function catalog(areas, { view = 'summary', operation, area } = {}) {
  const actions = operation ? ACTIONS.filter(item => item.name === operation) : ACTIONS;
  const records = area ? areas.filter(item => item.name === area) : areas;
  assert(!operation || actions.length === 1, 'UNKNOWN_ACTION', '등록된 정확한 업무 이름이 필요합니다.');
  assert(!area || records.length === 1, 'UNKNOWN_AREA', '등록된 정확한 조회 영역이 필요합니다.');
  const detailed = view === 'detail';
  return {
    view: detailed || operation || area ? 'detail' : 'summary',
    actions: area && !operation ? [] : (detailed || operation ? actions : actions.map(
      ({ name, label, mode, memberFacing, required }) => ({ name, label, mode, memberFacing, required }))),
    areas: operation && !area ? [] : (detailed || area ? records : records.map(({ name }) => ({ name }))),
    unsupported: UNSUPPORTED,
    note: '기본 목록은 요약입니다. 정확한 operation 또는 area로 상세·주의사항을 조회하세요. view=detail은 전체 기존 목록입니다. CORE 저장자료는 StudioMate 실시간 원본이 아닙니다.',
  };
}
