import { assert, hash, identifier, publicResult } from './safety.mjs';
import { AREAS } from './records.mjs';

export function createStore(db) {
  function area(name) {
    assert(Object.hasOwn(AREAS, name), 'UNKNOWN_AREA', '등록된 CORE 원장 영역만 조회할 수 있습니다.');
    return AREAS[name];
  }
  function scoped(data, spec) {
    if (spec.studioField) assert(String(data[spec.studioField]) === '5330', 'SOURCE_SCOPE', '센터 원본 연결을 확인하세요.');
    else assert(spec.allowUnscoped === true, 'SOURCE_SCOPE', '센터 범위가 확인되지 않은 영역입니다.');
  }
  function project(snapshot, spec) {
    const data = snapshot.data();
    scoped(data, spec);
    const selected = spec.allowedFields ? Object.fromEntries(spec.allowedFields.filter(k => Object.hasOwn(data, k)).map(k => [k, data[k]])) : data;
    return { id: snapshot.id, sourceHash: hash(data), data: publicResult(selected) };
  }
  return {
    areas() { return Object.entries(AREAS).map(([name, a]) => ({ name, collection: a.collection, filters: a.filters, sensitive: !!a.sensitive })); },
    async get(name, id) {
      const spec = area(name);
      const snapshot = await db.collection(spec.collection).doc(identifier(id)).get();
      assert(snapshot.exists, 'NOT_FOUND', '원본 기록이 없습니다.');
      return project(snapshot, spec);
    },
    async list(name, filters = {}, count = 20, afterId) {
      const spec = area(name);
      assert(filters && typeof filters === 'object' && !Array.isArray(filters) && Object.keys(filters).length <= 3,
        'INVALID_ARGUMENT', '최대 3개의 정확한 조회 조건을 사용하세요.');
      assert(Number.isInteger(count) && count >= 1 && count <= 50, 'INVALID_ARGUMENT', '조회 수는 1~50입니다.');
      let query = db.collection(spec.collection);
      if (spec.studioField) query = query.where(spec.studioField, '==', '5330');
      else assert(spec.allowUnscoped === true, 'SOURCE_SCOPE', '조회 범위 확인이 필요합니다.');
      for (const [key, value] of Object.entries(filters)) {
        assert(spec.filters.includes(key) && ['string', 'number', 'boolean'].includes(typeof value)
          && (typeof value !== 'string' || value.length <= 160), 'INVALID_ARGUMENT', '지원되는 정확 일치 조건만 사용할 수 있습니다.');
        query = query.where(key, '==', value);
      }
      query = query.orderBy('__name__');
      if (afterId) query = query.startAfter(identifier(afterId));
      const snapshot = await query.limit(count + 1).get();
      const docs = snapshot.docs.slice(0, count);
      return { rows: docs.map(doc => project(doc, spec)), hasMore: snapshot.docs.length > count,
        nextAfterId: snapshot.docs.length > count ? docs.at(-1).id : null, count: docs.length };
    },
    async fingerprints(action, params) {
      const sources = [];
      const loaded = new Map();
      for (const source of action.sources || []) {
        const id = source.key.split('.').reduce((value, key) => value?.[key], params);
        if (source.optional && !id) continue;
        identifier(id);
        const snap = await db.collection(source.collection).doc(id).get();
        assert(snap.exists || source.optional, 'SOURCE_MISSING', '수정 대상의 현재 원본이 없습니다.');
        const data = snap.data() || null;
        loaded.set(source.collection + '/' + id, data);
        if (data?.studioId !== undefined) assert(String(data.studioId) === '5330', 'SOURCE_SCOPE', '센터 원본이 일치하지 않습니다.');
        sources.push({ collection: source.collection, id, hash: hash(data) });
      }
      if (['submitMemberMemo', 'submitKioskCheckin'].includes(action.name)) {
        const booking = loaded.get('bookings/' + params.bookingId);
        assert(booking && booking.memberId === params.memberId
          && (!params.lectureId || booking.lectureId === params.lectureId),
        'SOURCE_RELATIONSHIP', '예약·회원·수업의 원본 연결이 일치하지 않습니다.');
      }
      if (['submitMemberMemo', 'submitKioskCheckin', 'submitBookingAttendance'].includes(action.name)) {
        assert(!/^(excel_|usage_booking_)/.test(params.bookingId), 'CANONICAL_SOURCE_REQUIRED',
          'Excel·대체 예약 자료만으로 쓰기를 실행하지 않습니다. 실제 원본 예약 연결을 확인하세요.');
      }
      if (action.name === 'coreRenewalWorkflowUpdate') {
        const item = loaded.get('renewalCases/' + params.caseId);
        const memberId = identifier(item?.memberId);
        const snap = await db.collection('memberProfiles').doc(memberId).get();
        assert(snap.exists && snap.data()?.studioId === '5330', 'SOURCE_SCOPE', '재등록 상담의 현재 회원 원본이 필요합니다.');
        sources.push({ collection: 'memberProfiles', id: memberId, hash: hash(snap.data()) });
      }
      return sources;
    },
  };
}
