import test from 'node:test';
import assert from 'node:assert/strict';
import { commonStaffAccess } from '../lib/imweb-staff-common-config.mjs';
import { SITE, UNIT, COMMON_STAFF_ACCESS_MODE } from '../lib/imweb-staff-video-policy.mjs';
const config = () => ({ commonAccess: { mode: COMMON_STAFF_ACCESS_MODE, approved: true,
  siteCode: SITE, unitCode: UNIT, baselineMenus: [{ menuCode: 'original' }], activation: {
    nativeAclFingerprint: 'a'.repeat(64), verifiedAt: '2026-10-29T03:00:00Z', staffOnlyAllowed: true,
    buyerAllowed: true, ordinaryDenied: true, loggedOutDenied: true, testAccountRestored: true,
    classroomStaffDiscovery: true } } });
test('legacy remains legacy; common activation requires independent member matrix', () => {
  assert.equal(commonStaffAccess({}), null);
  const c = config(); assert.equal(commonStaffAccess(c), c.commonAccess);
  for (const mutate of [c => c.commonAccess.mode = 'other', c => c.commonAccess.approved = false,
    c => c.commonAccess.siteCode = 'other', c => c.commonAccess.unitCode = 'other',
    c => c.commonAccess.baselineMenus = [], c => c.commonAccess.activation = {},
    c => c.commonAccess.activation.nativeAclFingerprint = 'bad',
    c => c.commonAccess.activation.verifiedAt = new Date(Date.now()+60000).toISOString(),
    ...['staffOnlyAllowed','buyerAllowed','ordinaryDenied','loggedOutDenied','testAccountRestored','classroomStaffDiscovery']
      .map(key => c => c.commonAccess.activation[key] = false)]) {
    const c = config(); mutate(c); assert.throws(() => commonStaffAccess(c));
  }
});
