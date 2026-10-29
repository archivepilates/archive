import assert from 'node:assert/strict';
import { COMMON_STAFF_ACCESS_MODE, SITE, UNIT } from './imweb-staff-video-policy.mjs';

// Historical activation evidence is separate from the fresh native ACL check on every run.
export function commonStaffAccess(config) {
  if (config?.commonAccess === undefined) return null;
  const value = config.commonAccess, proof = value?.activation;
  assert.ok(value?.mode === COMMON_STAFF_ACCESS_MODE && value.approved === true
    && value.siteCode === SITE && value.unitCode === UNIT, 'Unapproved common STAFF activation');
  assert.ok(Array.isArray(value.baselineMenus) && value.baselineMenus.length > 0
    && value.baselineMenus.length <= 1000, 'Original protected ACL baseline required');
  assert.ok(proof && /^[a-f0-9]{64}$/.test(proof.nativeAclFingerprint || '')
    && Number.isFinite(Date.parse(proof.verifiedAt)) && Date.parse(proof.verifiedAt) <= Date.now()
    && ['staffOnlyAllowed', 'buyerAllowed', 'ordinaryDenied', 'loggedOutDenied',
      'testAccountRestored', 'classroomStaffDiscovery'].every(key => proof[key] === true),
  'Verified common STAFF member matrix required');
  return value;
}
