import {createRemoteJWKSet, jwtVerify} from 'jose';
import {ApiError} from './repository.mjs';
const endpoint = 'https://getcoreaccesssession-3bmxsf33jq-du.a.run.app';
const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export async function verifyToken(token) {
  const result = await jwtVerify(token, keys, {issuer: 'https://securetoken.google.com/archive-pilates', audience: 'archive-pilates', algorithms: ['RS256']});
  if (!result.payload.sub || result.payload.sub.length > 128) throw new Error('Invalid identity');
  return result.payload;
}
export function assertOperatorSession(session) {
  if (!session || !['manager', 'owner'].includes(session.role) || session.mustChangePassword !== false || !session.staffId) throw new ApiError(403, 'OPERATOR_REQUIRED', '운영자 계정만 미러 자료를 조회할 수 있습니다.');
  return {role: session.role, staffName: String(session.staffName || '운영자').slice(0, 80)};
}
export async function authorize(req, {verify = verifyToken, request = fetch} = {}) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_.-]{100,8000}$/.test(header)) throw new ApiError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
  const token = header.slice(7);
  try { await verify(token); } catch { throw new ApiError(401, 'AUTH_INVALID', '로그인을 다시 해 주세요.'); }
  let response;
  try { response = await request(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: header}, body: '{"data":{}}', signal: AbortSignal.timeout(10000), redirect: 'error'}); }
  catch { throw new ApiError(503, 'AUTH_SOURCE_UNAVAILABLE', '운영자 권한 원본을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
  let body; try { body = await response.json(); } catch { throw new ApiError(503, 'AUTH_SOURCE_UNAVAILABLE', '운영자 권한 확인에 실패했습니다.'); }
  if (!body || typeof body !== 'object' || response.status >= 500) throw new ApiError(503, 'AUTH_SOURCE_UNAVAILABLE', '운영자 권한 원본을 확인할 수 없습니다.');
  if (!response.ok || body.error) throw new ApiError(response.status === 401 ? 401 : 403, 'CORE_SESSION_REQUIRED', '현재 CORE 로그인 권한을 확인해 주세요.');
  return assertOperatorSession(body.result ?? body.data);
}
export const publicConfig = {mode: 'read_only_mirror', loginEmailDomain: 'archivepilates.com', loginEmailPrefix: 'p', firebase: {
  apiKey: 'AIzaSyBhZrWWFgfBr-AIbESeOvD6qA2hHx4xNlQ', authDomain: 'archive-pilates.firebaseapp.com', projectId: 'archive-pilates', appId: '1:904688188103:web:fa356b7f95597c99af5ce2'
}};
