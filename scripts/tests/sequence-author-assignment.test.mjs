import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssignmentPlan, validateAssignmentIdentity, assignmentPatch, verifyAssignment } from '../lib/sequence-author-assignment.mjs';

const note = (id, fields = {}) => ({ id, updateTime: '2026-10-12T00:00:00.000Z', data: { ownerUid: 'manager', teacher: 'Teacher', deleted: false, revision: 3, createdAt: { seconds: 5 }, updatedAt: { seconds: 6 }, payload: JSON.stringify({ id, teacher: 'Teacher', moves: { warm: [{ name: 'Move' }], main: [], cool: [] } }), ...fields } });
const identity = () => ({ author: 'Teacher', staffId: '123', sourceUid: 'manager', staff: { name: 'Teacher', staffId: '123', studiomateStaffId: '123', studioId: '5330', uid: 'teacher_uid', active: true, employmentStatus: 'current', role: 'instructor', coreAccessEnabled: true, coreMustChangePassword: false }, source: { uid: 'manager', studioId: '5330', role: 'manager', active: true }, auth: { uid: 'teacher_uid', disabled: false, customClaims: { staffId: '123', studioId: '5330', role: 'instructor' } } });
const build = (notes, images = []) => buildAssignmentPlan({ author: 'Teacher', staffId: '123', sourceUid: 'manager', targetUid: 'teacher_uid', notes, images });
test('only exact legacy author; do not revive deleted, move other owners or deduplicate titles', () => {
  const plan = build([note('a'), note('b'), note('deleted', { deleted: true, payload: '{}' }), note('other', { teacher: 'Other' }), note('already', { ownerUid: 'teacher_uid' })]);
  assert.deepEqual(plan.notes.map(row => row.id), ['a', 'b']);
  assert.deepEqual(build([note('already', { ownerUid: 'teacher_uid' })]).notes, []);
});
test('payload author and note ID must agree with searchable fields', () => {
  for (const payload of [JSON.stringify({ id: 'wrong', teacher: 'Teacher', moves: {} }), JSON.stringify({ id: 'a', teacher: 'Other', moves: {} }), 'invalid']) assert.throws(() => build([note('a', { payload })]));
});
test('images transfer with notes; missing/wrong owner is blocked', () => {
  const record = note('a', { payload: JSON.stringify({ id: 'a', teacher: 'Teacher', moves: { warm: [{ image: 'hash' }] } }) });
  const image = { id: 'a_hash', updateTime: 'time', data: { ownerUid: 'manager', noteId: 'a', dataUrl: 'unchanged' } };
  assert.equal(build([record], [image]).images.length, 1);
  assert.throws(() => build([record]));
  assert.throws(() => build([record], [{ ...image, data: { ...image.data, ownerUid: 'other' } }]));
});
test('a new attachment changes the reviewed image membership even when unused in payload', () => {
  const records = [note('a')];
  const reviewed = build(records);
  const current = build(records, [{ id: 'a_new', updateTime: 'time', data: { ownerUid: 'manager', noteId: 'a', dataUrl: 'unchanged' } }]);
  assert.notDeepEqual(current.images, reviewed.images);
});
test('only owner/revision change; payload and dates are byte-for-byte preserved', () => {
  const before = note('a').data;
  const after = { ...before, ...assignmentPatch('note', before, 'teacher_uid') };
  verifyAssignment('note', before, after, 'teacher_uid');
  assert.equal(after.revision, 4);
  assert.equal(after.payload, before.payload);
  for (const field of ['payload', 'createdAt', 'updatedAt']) assert.throws(() => verifyAssignment('note', before, { ...after, [field]: 'changed' }, 'teacher_uid'));
});
test('identity must be ready canonical instructor with corresponding Auth claims', () => {
  validateAssignmentIdentity(identity());
  for (const [field, value] of [['active', false], ['employmentStatus', 'former'], ['uid', 'other'], ['staffId', 'wrong'], ['coreMustChangePassword', true], ['coreAccessEnabled', false], ['name', 'Other']]) {
    const data = identity(); data.staff[field] = value; assert.throws(() => validateAssignmentIdentity(data));
  }
  const data = identity(); data.auth.customClaims.role = 'manager'; assert.throws(() => validateAssignmentIdentity(data));
});
test('limits and invalid revisions fail closed', () => {
  assert.throws(() => build(Array.from({ length: 101 }, (_, i) => note(`id_${i}`))));
  assert.throws(() => build([note('a', { revision: null })]));
});
