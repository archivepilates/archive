import assert from 'node:assert/strict';
import test from 'node:test';
import { LESSON_VIDEO_COMPLETE_TEMPLATE as spec, lessonVideoTemplatePayload, assertLessonVideoTemplate, requireApprovedLessonVideoTemplate } from '../lib/lesson-video-complete-template.mjs';
const reference = { templateId: spec.referenceTemplateId, status: 'APPROVED', channelId: spec.channelId,
  messageType: 'BA', emphasizeType: 'IMAGE', imageId: 'existing-class-image', categoryCode: '004001', securityFlag: false };
test('copies approved instructor reference without changing it and uses official basic logo', () => {
  const before = structuredClone(reference), payload = lessonVideoTemplatePayload(reference);
  assert.deepEqual(reference, before); assert.equal(payload.imageId, spec.imageId);
  assert.equal(payload.categoryCode, reference.categoryCode); assert.equal(payload.emphasizeType, 'IMAGE');
  assert.equal(payload.buttons.length, 2); assert.equal(payload.quickReplies.length, 0);
  assert.doesNotThrow(() => assertLessonVideoTemplate({ ...payload, templateId: 'synthetic', status: 'INSPECTING' }, payload));
});
test('title, body and required access instructions retain deliberate paragraph breaks', () => {
  assert.ok(spec.content.startsWith('강사레슨 영상 업로드 완료\n\n'));
  for (const variable of ['#{이름}', '#{수업명}', '#{팀명}']) assert.ok(spec.content.includes(variable));
  assert.ok(spec.content.includes('최초 권한 부여일부터\n40일'));
  assert.ok(spec.content.split('\n').every(line => line.length <= 24));
  assert.ok(spec.content.length < 1000); assert.doesNotMatch(spec.content, /내일|youtube|youtu\.be|할인|구매하세요/);
  assert.ok(spec.buttons.every(button => button.linkMo === button.linkPc && button.targetOut === true));
  assert.ok(spec.buttons[0].linkMo.endsWith('/48')); assert.ok(spec.buttons[1].linkMo.includes('mode=join'));
});
test('wrong reference or changed content/links/logo/status cannot be submitted as the approved definition', () => {
  for (const change of [{ status: 'PENDING' }, { channelId: 'other' }, { templateId: 'other' }, { emphasizeType: 'TEXT' }]) assert.throws(() => lessonVideoTemplatePayload({ ...reference, ...change }));
  const payload = lessonVideoTemplatePayload(reference), current = { ...payload, status: 'PENDING' };
  for (const change of [{ content: payload.content + '\nother' }, { imageId: 'other' }, { channelId: 'other' }, { ad: 'promotion' }, { status: 'UNKNOWN' }, { buttons: [] }]) assert.throws(() => assertLessonVideoTemplate({ ...current, ...change }, payload));
});
test('future Alimtalk dispatch requires the exact approved new template', () => {
  const current = { ...lessonVideoTemplatePayload(reference), templateId: spec.templateId, status: 'APPROVED' };
  assert.equal(requireApprovedLessonVideoTemplate(current, reference), spec.templateId);
  for (const status of ['PENDING', 'INSPECTING', 'REJECTED'])
    assert.throws(() => requireApprovedLessonVideoTemplate({ ...current, status }, reference));
  assert.throws(() => requireApprovedLessonVideoTemplate({ ...current, templateId: spec.referenceTemplateId }, reference));
  assert.throws(() => requireApprovedLessonVideoTemplate({ ...current, imageId: spec.sourceImageId }, reference));
});
