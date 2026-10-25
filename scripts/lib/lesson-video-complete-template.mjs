import { isDeepStrictEqual } from 'node:util';

export const LESSON_VIDEO_COMPLETE_TEMPLATE = Object.freeze({
  templateId: 'KA01TP261025172058035A7GWKDTFl7Y',
  referenceTemplateId: 'KA01TP260825074722212ylmndmsB3V4',
  channelId: 'KA01PF260511123407631PSoAflYAVXs',
  name: '강사레슨_수업영상 업로드 완료 v1',
  sourceImageId: 'ST01FZ260513132545295VXxGWrpGVoQ',
  imageId: 'ST01FZ261025172834907hcnuuocG7hz',
  logoSha256: '3820f01c96fb6ddce5d6d67ccda6c360b9a9702e7bb5cb451356da33da5a9e10',
  messageType: 'BA', emphasizeType: 'IMAGE',
  content: `강사레슨 영상 업로드 완료

#{이름}님,
신청하신 강사레슨의
팀별 수업 영상이
업로드되었어요.

수업: #{수업명}
팀: #{팀명}

홈페이지 로그인 후
내 강의실에서 연결된 영상을
확인해 주세요.

아직 홈페이지 회원이 아니시라면
아래 버튼으로 가입해 주세요.
영상 시청은 계정과
시청 권한 확인 후 가능해요.

영상은 최초 권한 부여일부터
40일 동안 시청하실 수 있어요.`,
  buttons: Object.freeze([
    { buttonType: 'WL', buttonName: '내 강의실 바로가기', linkMo: 'https://archivepilates.imweb.me/48', linkPc: 'https://archivepilates.imweb.me/48', targetOut: true },
    { buttonType: 'WL', buttonName: '홈페이지 회원가입', linkMo: 'https://archivepilates.imweb.me/?mode=join&back_url=LzQ4', linkPc: 'https://archivepilates.imweb.me/?mode=join&back_url=LzQ4', targetOut: true },
  ]),
});
export function lessonVideoTemplatePayload(reference) {
  const spec = LESSON_VIDEO_COMPLETE_TEMPLATE;
  if (reference?.templateId !== spec.referenceTemplateId || reference.status !== 'APPROVED'
      || reference.channelId !== spec.channelId || reference.messageType !== 'BA' || reference.emphasizeType !== 'IMAGE'
      || !reference.imageId || !reference.categoryCode) throw Error('Approved instructor-lesson reference required');
  return { channelId: spec.channelId, name: spec.name, content: spec.content, categoryCode: reference.categoryCode,
    buttons: structuredClone(spec.buttons), quickReplies: [], messageType: spec.messageType,
    emphasizeType: spec.emphasizeType, imageId: spec.imageId, securityFlag: Boolean(reference.securityFlag) };
}
export function assertLessonVideoTemplate(actual, payload) {
  for (const field of ['channelId', 'name', 'content', 'categoryCode', 'messageType', 'emphasizeType', 'imageId', 'securityFlag']) {
    if (actual?.[field] !== payload[field]) throw Error(`Template ${field} mismatch`);
  }
  const normalize = buttons => (buttons || []).map(b => Object.fromEntries(['buttonType', 'buttonName', 'linkMo', 'linkPc', 'targetOut'].map(k => [k, b[k]])));
  if (!isDeepStrictEqual(normalize(actual.buttons), normalize(payload.buttons)) || actual.ad || actual.extra
      || (actual.quickReplies || []).length) throw Error('Template links or additional text differ');
  if (!['PENDING', 'INSPECTING', 'APPROVED', 'REJECTED'].includes(actual.status)) throw Error('Unknown template status');
}

export function requireApprovedLessonVideoTemplate(actual, reference) {
  assertLessonVideoTemplate(actual, lessonVideoTemplatePayload(reference));
  if (actual.templateId !== LESSON_VIDEO_COMPLETE_TEMPLATE.templateId || actual.status !== 'APPROVED')
    throw Error('Lesson video template is not approved for dispatch');
  return actual.templateId;
}
