import { isDeepStrictEqual } from 'node:util';

const waitlistLink = 'https://in.archivepilates.com/instructor-waitlist/?id=#{대기ID}#token=#{대기토큰}';
export const INSTRUCTOR_WAITLIST_TEMPLATE = Object.freeze({
  referenceTemplateId: 'KA01TP2608241233353269Jgtoiwnzi6',
  channelId: 'KA01PF260511123407631PSoAflYAVXs',
  name: '강사레슨_수강대기 접수 안내 v1',
  messageType: 'BA',
  emphasizeType: 'NONE',
  content: '#{이름}님,\nARCHIVE PILATES 수강대기가 접수되었습니다.\n\n수업: #{수업명}\n주제: #{수업주제}\n수강일: #{수강일}\n\n현재는 예약 확정 전이며,\n결원 발생 시 별도로 안내드립니다.\n\n아래 버튼에서 현재 대기순번을 확인하거나\n수강대기를 취소하실 수 있습니다.',
  buttons: Object.freeze([
    Object.freeze({ buttonType: 'WL', buttonName: '현재 대기순번 확인', linkMo: waitlistLink, linkPc: waitlistLink, targetOut: true }),
    Object.freeze({ buttonType: 'WL', buttonName: '수강대기 취소', linkMo: `${waitlistLink}&view=cancel`, linkPc: `${waitlistLink}&view=cancel`, targetOut: true }),
  ]),
});

export function instructorWaitlistTemplatePayload(reference) {
  const spec = INSTRUCTOR_WAITLIST_TEMPLATE;
  if (reference?.templateId !== spec.referenceTemplateId || reference.status !== 'APPROVED'
      || reference.isDeleted || reference.channelId !== spec.channelId || reference.messageType !== 'BA'
      || typeof reference.categoryCode !== 'string' || !reference.categoryCode.trim()
      || typeof reference.securityFlag !== 'boolean') throw Error('Approved instructor reference required');
  return { channelId: spec.channelId, name: spec.name, content: spec.content, categoryCode: reference.categoryCode,
    buttons: structuredClone(spec.buttons), quickReplies: [], messageType: spec.messageType,
    emphasizeType: spec.emphasizeType, securityFlag: reference.securityFlag };
}

export function assertInstructorWaitlistTemplate(actual, payload) {
  for (const field of ['channelId', 'name', 'content', 'categoryCode', 'messageType', 'emphasizeType', 'securityFlag']) {
    if (actual?.[field] !== payload[field]) throw Error(`Template ${field} mismatch`);
  }
  const buttonKeys = ['buttonType', 'buttonName', 'linkMo', 'linkPc', 'targetOut'];
  const normalize = buttons => {
    if (!Array.isArray(buttons)) throw Error('Template buttons mismatch');
    return buttons.map(button => {
      if (!button || typeof button !== 'object' || Object.keys(button).some(key =>
        !buttonKeys.includes(key) && button[key] !== '' && button[key] != null)) throw Error('Template button fields differ');
      return Object.fromEntries(buttonKeys.map(key => [key, button[key]]));
    });
  };
  if (!isDeepStrictEqual(normalize(actual.buttons), normalize(payload.buttons))) throw Error('Template links differ');
  for (const field of ['ad', 'extra', 'imageId', 'imageUrl', 'header', 'title', 'subtitle', 'highlight', 'item', 'commerce']) {
    if (actual[field] != null && actual[field] !== '') throw Error('Template additional content differs');
  }
  if (actual.isDeleted || !isDeepStrictEqual(actual.quickReplies ?? [], [])) throw Error('Template deleted or quick replies differ');
  if (!['PENDING', 'INSPECTING', 'APPROVED', 'REJECTED'].includes(actual.status)) throw Error('Unknown template status');
}
