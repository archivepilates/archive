import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const normalizeAuthor = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateAssignmentIdentity({ author, staffId, sourceUid, staff, source, auth }) {
  assert(normalizeAuthor(author) && normalizeAuthor(staff.name) === normalizeAuthor(author), 'Author/staff mismatch');
  assert(staff.staffId === staffId && staff.studiomateStaffId === staffId && staff.studioId === '5330', 'Canonical staff required');
  assert(staff.active === true && staff.employmentStatus === 'current' && staff.role === 'instructor' && staff.coreAccessEnabled === true && staff.coreMustChangePassword === false, 'Ready current instructor required');
  assert(staff.uid && staff.uid !== sourceUid && auth.uid === staff.uid && !auth.disabled, 'Target identity mismatch');
  assert(auth.customClaims?.staffId === staffId && auth.customClaims?.studioId === staff.studioId && auth.customClaims?.role === 'instructor', 'Auth claims mismatch');
  assert(source.uid === sourceUid && source.studioId === staff.studioId && ['owner', 'manager'].includes(source.role) && source.active === true, 'Legacy manager owner required');
}

export function buildAssignmentPlan({ author, staffId, sourceUid, targetUid, notes, images }) {
  const selected = notes.filter(row => row.data.ownerUid === sourceUid && row.data.deleted === false && normalizeAuthor(row.data.teacher) === normalizeAuthor(author));
  assert(selected.length <= 100, 'Assignment exceeds scoped limit');
  for (const row of selected) {
    const state = JSON.parse(row.data.payload);
    assert(state.id === row.id && normalizeAuthor(state.teacher) === normalizeAuthor(author), 'Payload author/identity mismatch');
    assert(Number.isSafeInteger(row.data.revision) && row.data.revision >= 1, 'Invalid revision');
    assert(state.moves && typeof state.moves === 'object' && !Array.isArray(state.moves), 'Invalid moves');
    const linked = Object.values(state.moves).flat().filter(move => move.image).map(move => `${row.id}_${move.image}`);
    for (const id of linked) assert(images.some(image => image.id === id && image.data.noteId === row.id && image.data.ownerUid === sourceUid), 'Missing or wrong-owner image');
  }
  const ids = new Set(selected.map(row => row.id));
  const assets = images.filter(row => ids.has(row.data.noteId));
  for (const asset of assets) assert(asset.data.ownerUid === sourceUid, 'Unexpected image owner');
  assert(selected.length + assets.length <= 400, 'Atomic migration exceeds limit');
  const record = row => ({ id: row.id, beforeHash: fingerprint(row.data), updateTime: row.updateTime });
  return { schema: 'sequence-author-assignment.v1', author: normalizeAuthor(author), staffId, sourceUid, targetUid,
    notes: selected.map(record).sort((a, b) => a.id.localeCompare(b.id)), images: assets.map(record).sort((a, b) => a.id.localeCompare(b.id)) };
}

export function assignmentPatch(kind, before, targetUid) {
  assert(['note', 'image'].includes(kind), 'Unknown record type');
  return kind === 'note' ? { ownerUid: targetUid, revision: before.revision + 1 } : { ownerUid: targetUid };
}

export function verifyAssignment(kind, before, after, targetUid) {
  assert.deepEqual(after, { ...before, ...assignmentPatch(kind, before, targetUid) }, 'Unexpected data change');
}
