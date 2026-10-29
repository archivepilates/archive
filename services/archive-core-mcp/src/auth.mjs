import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { assert, CoreError, hash } from './safety.mjs';

export function createOwnerAccess({ db, auth, staffId, configFile, fetcher = fetch, now = Date.now }) {
  let cached;
  async function owner() {
    const snap = await db.collection('staffs').doc(staffId).get();
    const staff = snap.data();
    assert(snap.exists && staff?.staffId === staffId && staff.studioId === '5330'
      && staff.active === true && staff.role === 'owner' && typeof staff.uid === 'string' && staff.uid
      && typeof staff.email === 'string' && staff.email && staff.coreMustChangePassword !== true,
    'OWNER_REQUIRED', '현재 활성 CORE 소유자 계정 확인이 필요합니다.');
    let user;
    try { user = await auth.getUser(staff.uid); }
    catch { throw new CoreError('AUTH_UNAVAILABLE', '기존 CORE 인증 계정 조회에 실패했습니다. 권한을 우회하지 않습니다.'); }
    assert(!user.disabled && user.uid === staff.uid && String(user.email).toLowerCase() === staff.email.toLowerCase(),
      'OWNER_REQUIRED', 'CORE 소유자와 기존 인증 계정이 일치하지 않습니다.');
    const binding = { staffId, uid: staff.uid, studioId: staff.studioId, role: staff.role,
      active: staff.active, coreAuthAfter: staff.coreAuthAfter ?? null, tokensValidAfterTime: user.tokensValidAfterTime || null };
    return { staff, binding, bindingHash: hash(binding) };
  }
  async function token(current) {
    if (cached?.bindingHash === current.bindingHash && cached.expiresAt > now() + 120000) return cached.value;
    const context = { window: {} };
    vm.runInNewContext(await readFile(configFile, 'utf8'), context, { timeout: 1000 });
    const configs = Object.values(context.window).filter(v => v && typeof v === 'object' && v.projectId === 'archive-pilates');
    const config = configs[0];
    assert(configs.length === 1 && typeof config.apiKey === 'string' && /^AIza[A-Za-z0-9_-]+$/.test(config.apiKey),
      'CONFIG_INVALID', '기존 CORE Firebase 설정을 확인하세요.');
    let customToken;
    try {
      customToken = await auth.createCustomToken(current.staff.uid, {
        role: current.staff.role, staffId, studioId: current.staff.studioId, coreMcp: true,
      });
    } catch { throw new CoreError('AUTH_UNAVAILABLE', '기존 CORE 인증 세션을 준비하지 못했습니다. 인증값은 출력하지 않습니다.'); }
    let response, data;
    try {
      response = await fetcher('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + encodeURIComponent(config.apiKey), {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(30000),
      });
      data = await response.json();
    } catch { throw new CoreError('AUTH_UNAVAILABLE', 'CORE 인증 연결을 확인하지 못했습니다. 토큰은 출력하거나 저장하지 않습니다.'); }
    assert(response.ok && data && typeof data.idToken === 'string'
      && (data.localId === undefined || data.localId === current.staff.uid),
      'AUTH_UNAVAILABLE', '기존 CORE 계정으로 인증하지 못했습니다.');
    let claims;
    try { claims = await auth.verifyIdToken(data.idToken); }
    catch { throw new CoreError('AUTH_UNAVAILABLE', 'CORE 인증 세션 검증에 실패했습니다. 인증값은 출력하지 않습니다.'); }
    assert(claims.uid === current.staff.uid && claims.role === 'owner' && claims.staffId === staffId
      && claims.studioId === '5330' && claims.aud === 'archive-pilates'
      && Number(claims.auth_time) >= Number(current.staff.coreAuthAfter || 0),
    'AUTH_UNAVAILABLE', 'CORE 인증 세션과 소유자 연결이 일치하지 않습니다.');
    cached = { bindingHash: current.bindingHash, value: data.idToken, expiresAt: Math.min(now() + 3000000, claims.exp * 1000) };
    return cached.value;
  }
  return { owner, token, clear() { cached = null; } };
}
