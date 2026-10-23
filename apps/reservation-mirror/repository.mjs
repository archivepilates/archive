import {ENTITIES, publicRow} from './view-model.mjs';
const valid = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id);
export class ApiError extends Error { constructor(status, code, message) { super(message); Object.assign(this, {status, code}); } }
export class MirrorRepository {
  constructor(db) { this.db = db; }
  async current() {
    const pointer = await this.db.doc('mirrorMeta/current').get();
    const id = pointer.data()?.snapshotId;
    if (!valid(id)) throw new ApiError(503, 'NO_VERIFIED_SNAPSHOT', '검증된 미러 데이터가 아직 준비되지 않았습니다.');
    const snap = await this.db.doc(`mirrorSnapshots/${id}`).get();
    if (snap.data()?.status !== 'VERIFIED') throw new ApiError(503, 'SNAPSHOT_NOT_VERIFIED', '데이터 검증 중입니다.');
    return {id, ...snap.data()};
  }
  async summary() { const s = await this.current(); return {mode: 'read_only_mirror', snapshot: {id: s.id, capturedAt: s.capturedAt, sourceUpdatedAt: s.sourceUpdatedAt || null, counts: s.counts, coverage: s.coverage, complete: false}, rea: {version: '6.7.0', applied: ['전체·잔여·예약가능·취소가능 분리', '예약 상태 3종 구분', '예약/수업 후 상태 필터 분리', '조회 기간·페이지 분리', '취소·원본 변경 비활성']}}; }
  async list(params, snapshot) {
    const entity = params.get('entity'); if (!ENTITIES.includes(entity)) throw new ApiError(400, 'ENTITY_INVALID', '조회 종류를 확인해 주세요.');
    const n = Number(params.get('limit') || 50); if (!Number.isInteger(n) || n < 1 || n > 100) throw new ApiError(400, 'LIMIT_INVALID', '조회 개수를 확인해 주세요.');
    const s = snapshot || await this.current();
    const col = this.db.collection(`mirrorSnapshots/${s.id}/${entity}`);
    const search = (params.get('search') || '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
    if (search.length > 60) throw new ApiError(400, 'SEARCH_INVALID', '검색어를 줄여 주세요.');
    let q = col;
    const memberId = params.get('memberId');
    if (memberId && !['entitlements', 'bookings'].includes(entity)) throw new ApiError(400, 'FILTER_INVALID', '이 조회에는 회원 필터를 사용할 수 없습니다.');
    if (memberId && (search || (params.get('status') && params.get('status') !== 'all'))) throw new ApiError(400, 'FILTER_COMBINATION_UNSUPPORTED', '회원별 조회와 이름·상태 필터는 별도로 사용해 주세요.');
    if (memberId) { if (!valid(memberId)) throw new ApiError(400, 'ID_INVALID', '회원 연결을 확인해 주세요.'); q = q.where('memberId', '==', memberId); }
    const status = params.get('status');
    if (entity === 'bookings' && status && status !== 'all') { if (!['booked', 'after'].includes(status)) throw new ApiError(400, 'STATUS_INVALID', '상태를 확인해 주세요.'); q = q.where('statusGroup', '==', status); }
    const dates = ['bookings', 'occurrences'].includes(entity);
    for (const [k, op] of [['from', '>='], ['to', '<=']]) if (dates && params.get(k)) { const v = params.get(k); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ApiError(400, 'DATE_INVALID', '날짜를 확인해 주세요.'); q = q.where('localDate', op, v); }
    if (search) q = q.where('nameKey', '>=', search).where('nameKey', '<', search + '\uf8ff');
    q = q.orderBy(search ? 'nameKey' : dates ? 'localDate' : 'nameKey');
    const after = params.get('after');
    if (after) {
      let cursor; try { if (after.length > 1000) throw new Error(); cursor = JSON.parse(Buffer.from(after, 'base64url').toString()); } catch { throw new ApiError(400, 'CURSOR_INVALID', '다시 조회해 주세요.'); }
      const binding = new URLSearchParams(params); binding.delete('after');
      if (cursor.snapshot !== s.id || cursor.query !== binding.toString() || !valid(cursor.id)) throw new ApiError(409, 'CURSOR_STALE', '데이터가 갱신됐습니다. 처음부터 다시 조회해 주세요.');
      const doc = await col.doc(cursor.id).get(); if (!doc.exists) throw new ApiError(409, 'CURSOR_STALE', '처음부터 다시 조회해 주세요.');
      q = q.startAfter(doc);
    }
    const result = await q.limit(n + 1).get();
    const docs = result.docs.slice(0, n); const binding = new URLSearchParams(params); binding.delete('after');
    return {items: docs.map((d) => publicRow({id: d.id, ...d.data()})), nextCursor: result.size > n ? Buffer.from(JSON.stringify({snapshot: s.id, query: binding.toString(), id: docs.at(-1).id})).toString('base64url') : null, snapshotId: s.id};
  }
  async member(id) {
    if (!valid(id)) throw new ApiError(400, 'ID_INVALID', '회원 식별자를 확인해 주세요.');
    const s = await this.current(), doc = await this.db.doc(`mirrorSnapshots/${s.id}/members/${id}`).get();
    if (!doc.exists) throw new ApiError(404, 'MEMBER_NOT_FOUND', '현재 미러에서 회원을 찾지 못했습니다.');
    const entitlements = await this.list(new URLSearchParams({entity: 'entitlements', memberId: id, limit: '100'}), s);
    const bookings = await this.list(new URLSearchParams({entity: 'bookings', memberId: id, limit: '50'}), s);
    return {member: publicRow({id, ...doc.data()}), entitlements: entitlements.items, entitlementsNextCursor: entitlements.nextCursor, bookings};
  }
}
