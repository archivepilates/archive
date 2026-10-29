import { createHash } from 'node:crypto';
import { assert, CoreError, bounded } from './safety.mjs';

const ROOT = 'projects/archive-pilates/databases/(default)/documents';
const COMMIT = `https://firestore.googleapis.com/v1/${ROOT}:commit`;
const STATUSES = ['contacted', 'considering', 'snoozed', 'resolved', 'excluded'];
const STAGES = ['warm', 'main', 'cool'];
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const HASH = /^[a-f0-9]{64}$(?![\s\S])/;
const DAY = 86400000;
const EXCLUDED = ['강사레슨', '강사용', '직원', '상담', '체험', '락커', '양말', '토삭스', '상품권', '쿠폰'];

export const DIRECT_ACTIONS = [
  { name: 'coreSequenceGet', mode: 'read', label: '시퀀스 원본 조회', memberFacing: false,
    required: ['noteId'], sources: [{ collection: 'sequenceNotes', key: 'noteId' }],
    notes: 'Local Firebase-ID-token REST read; own or manager-readable nondeleted notes only. Returns state/revision/readOnly with hash-only image refs; no image data URLs.' },
  { name: 'coreRenewalWorkflowUpdate', mode: 'write', label: '재등록 상담 상태 저장', memberFacing: false,
    required: ['caseId', 'workflowStatus'], sources: [{ collection: 'renewalCases', key: 'caseId' }],
    notes: 'Local REST adapter; existing 5330 case and canonical memberProfiles read required. Five UI statuses only; no message dispatch.' },
  { name: 'coreSequenceSave', mode: 'write', label: '본인 시퀀스 저장', memberFacing: false,
    required: ['state', 'expectedRevision'], sources: [{ collection: 'sequenceNotes', key: 'state.id', optional: true }],
    notes: 'Local REST adapter; sources key state.id is nested. Own UID only; revision/updateTime CAS. Existing image attachments only; image changes rejected.' },
  { name: 'coreSequenceRemove', mode: 'write', label: '본인 시퀀스 삭제 표시', memberFacing: false,
    required: ['noteId', 'expectedRevision'], sources: [{ collection: 'sequenceNotes', key: 'noteId' }],
    notes: 'Local REST adapter; own UID only; tombstone with revision/updateTime CAS, never hard delete. Image assets retained; no cleanup writes.' },
];
const ACTION_NAMES = new Set(DIRECT_ACTIONS.map(action => action.name));

const invalid = (ok) => assert(ok, 'INVALID_ARGUMENT', 'Unsupported or invalid direct CORE arguments.');
function object(value, keys) {
  invalid(value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  invalid(Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)));
  invalid(Object.values(Object.getOwnPropertyDescriptors(value)).every(d => Object.hasOwn(d, 'value') && d.enumerable));
}
function text(value, max) { invalid(typeof value === 'string' && value.length <= max); }
function id(value) { invalid(typeof value === 'string' && value.trim() === value && ID.test(value)); return value; }
function revision(value) { invalid(Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER); }
function array(value, length) {
  invalid(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
    && value.length <= length && Reflect.ownKeys(value).length === value.length + 1
    && Object.keys(value).every((k, index) => k === String(index))
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => Object.hasOwn(d, 'value')));
}
function stateSchema(state) {
  const lengths = { title: 70, teacher: 30, equipment: 30, equipmentOther: 35, date: 10,
    duration: 3, audience: 50, goal: 180, memo: 220, source: 120 };
  object(state, ['schema', 'id', ...Object.keys(lengths), 'cues', 'sketchSpace', 'moves']);
  invalid(state.schema === 'archive.sequence.v1'); id(state.id);
  for (const [key, max] of Object.entries(lengths)) text(state[key], max);
  invalid(!state.duration || (/^\d+$/.test(state.duration) && +state.duration >= 1 && +state.duration <= 240));
  invalid(!state.date || (/^\d{4}-\d{2}-\d{2}$/.test(state.date)
    && Number.isFinite(Date.parse(state.date)) && new Date(state.date).toISOString().slice(0, 10) === state.date));
  invalid(typeof state.sketchSpace === 'boolean');
  array(state.cues, 3); invalid(state.cues.length === 3);
  state.cues.forEach(cue => text(cue, 65));
  object(state.moves, STAGES);
  const ids = new Set();
  for (const stage of STAGES) {
    array(state.moves[stage], 30);
    for (const move of state.moves[stage]) {
      object(move, ['id', 'name', 'description', 'muscles', 'purpose', 'image']);
      id(move.id); invalid(!ids.has(move.id)); ids.add(move.id);
      for (const [key, max] of Object.entries({ name: 80, description: 160, muscles: 80, purpose: 120 })) text(move[key], max);
      text(move.image, 90000);
      assert(!move.image || HASH.test(move.image) || move.image.startsWith('data:image/jpeg;base64,'),
        'IMAGES_UNSUPPORTED', 'Only unchanged existing JPEG attachments are supported.');
    }
  }
}

// Do not round Admin Timestamp updateTime to milliseconds: CAS needs its full precision.
function timestamp(value) {
  assert(value && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)
    && value.nanoseconds >= 0 && value.nanoseconds < 1e9, 'SOURCE_INVALID', 'A precise source timestamp is required.');
  const date = new Date(value.seconds * 1000);
  assert(Number.isFinite(date.getTime()), 'SOURCE_INVALID', 'Invalid source timestamp.');
  return date.toISOString().replace(/\.\d{3}Z$/, `.${String(value.nanoseconds).padStart(9, '0')}Z`);
}
function ms(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime() || 0;
  const seconds = value.seconds ?? value._seconds;
  if (Number.isFinite(Number(seconds))) return Number(seconds) * 1000 + Math.floor(Number(value.nanoseconds ?? value._nanoseconds ?? 0) / 1e6);
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
const ticketName = t => String(t.name || t.ticketName || t.title || '').trim();
const managed = t => ticketName(t) && !EXCLUDED.some(word => ticketName(t).includes(word));
function kind(t) {
  const s = `${t.classType || t.ticketClassType || t.lessonType || t.ticketType || ''} ${ticketName(t)}`.toLowerCase();
  return /프라이빗|개인|1:1|private|semi|세미|duet|듀엣/.test(s) ? 'private' : /그룹|group|소그룹/.test(s) ? 'group' : 'lesson';
}
const expiry = t => ms(t.expiresAt || t.expireAt || t.endAt || t.expiryDate);
const numeric = v => v === null || v === undefined || v === '' ? NaN : Number(v);
function healthy(t, time) {
  const remaining = numeric(t.remainingCount ?? t.remaining ?? t.remainCount);
  const end = expiry(t);
  // KST calendar days, independent of the host's timezone.
  const days = end ? Math.floor((end + 9 * 3600000) / DAY) - Math.floor((time + 9 * 3600000) / DAY) : Infinity;
  return managed(t) && (Number.isFinite(remaining) || Number.isFinite(days))
    && !(Number.isFinite(remaining) && remaining <= (kind(t) === 'private' ? 3 : 5))
    && !(Number.isFinite(days) && days <= 30);
}
function verifyRenewal(item, profile, caseId, time) {
  assert(item.studioId === '5330' && profile?.studioId === '5330', 'SOURCE_SCOPE', 'The canonical studio must be 5330.');
  assert((item.caseId === undefined || item.caseId === caseId) && profile.memberId === item.memberId
    && Array.isArray(profile.activeTickets), 'SOURCE_UNVERIFIED', 'Canonical member profile and activeTickets are required.');
  assert(item.active !== false && !['resolved', 'excluded'].includes(item.workflowStatus)
    && managed({ name: item.ticketName || '' }), 'SOURCE_NOT_CURRENT', 'This renewal case is not editable in the current UI.');
  const ticketKind = item.kind || 'lesson';
  assert(['private', 'group', 'lesson'].includes(ticketKind), 'SOURCE_INVALID', 'Unknown renewal ticket kind.');
  const tickets = profile.activeTickets;
  assert(tickets.length <= 1000 && tickets.every(t => t && typeof t === 'object' && !Array.isArray(t)),
    'SOURCE_UNVERIFIED', 'Canonical ticket details are required.');
  const current = tickets.filter(t => !(expiry(t) && expiry(t) + DAY < time) && kind(t) === ticketKind && managed(t));
  // Both a healthy exact ticket and a healthy alternative make the UI row historical.
  assert(!current.some(t => healthy(t, time)), 'SOURCE_NOT_CURRENT', 'A renewed or healthy ticket is already present.');
  assert(!item.ticketIdentity || typeof item.ticketIdentity === 'string', 'SOURCE_INVALID', 'Invalid renewal source identity.');
}

const value = v => v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v }
  : typeof v === 'boolean' ? { booleanValue: v } : { integerValue: String(v) };
const serverTime = fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' });
function write(collection, noteId, fields, snapshot, times = ['updatedAt']) {
  return { update: { name: `${ROOT}/${collection}/${noteId}`, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, value(v)])) },
    updateMask: { fieldPaths: Object.keys(fields) }, updateTransforms: times.map(serverTime),
    currentDocument: snapshot.exists ? { updateTime: timestamp(snapshot.updateTime) } : { exists: false } };
}
const moves = state => STAGES.flatMap(stage => state.moves[stage]);
const imageHash = image => HASH.test(image) ? image : createHash('sha256').update(image).digest('hex');
function jpeg(dataUrl) {
  assert(typeof dataUrl === 'string' && dataUrl.length <= 90000
    && /^data:image\/jpeg;base64,\/9j\/([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataUrl)
    && Buffer.from(dataUrl.slice(23), 'base64').length <= 64 * 1024,
  'SOURCE_INVALID', 'The existing attachment must be a bounded JPEG.');
}

function sequenceView(data, noteId, current) {
  const own = data?.ownerUid === current.staff.uid;
  assert(own || ['owner', 'manager'].includes(current.staff.role), 'PERMISSION_DENIED', 'This sequence is not readable by the current actor.');
  assert(data?.deleted === false, 'NOT_FOUND', 'Deleted sequences are not returned.');
  assert(Number.isSafeInteger(data.revision) && data.revision >= 1, 'SOURCE_INVALID', 'Invalid sequence revision.');
  let state;
  try { state = JSON.parse(data.payload); stateSchema(state); }
  catch { throw new CoreError('SOURCE_INVALID', 'Invalid stored sequence state.'); }
  assert(state.id === noteId && moves(state).every(m => !m.image || HASH.test(m.image)),
    'SOURCE_INVALID', 'Stored sequence identity or image reference is invalid.');
  return { state, revision: data.revision, readOnly: !own };
}

export function createDirect({ db, access, fetcher = fetch, now = Date.now }) {
  async function read(collection, docId) {
    try { return await db.collection(collection).doc(docId).get(); }
    catch { throw new CoreError('SOURCE_UNAVAILABLE', 'Canonical source read failed; nothing was dispatched.'); }
  }
  async function preserveImages(state, old, uid) {
    const prior = new Map(moves(old).filter(m => m.image).map(m => [m.id, m.image]));
    const next = moves(state).filter(m => m.image);
    assert(next.length === prior.size && next.every(m => prior.has(m.id) && imageHash(m.image) === prior.get(m.id)),
      'IMAGES_UNSUPPORTED', 'Image additions, replacements, removals and copies are unsupported; preserve existing attachments.');
    const assets = new Map();
    for (const move of next) {
      const hash = imageHash(move.image);
      assert(HASH.test(prior.get(move.id)), 'SOURCE_INVALID', 'Invalid existing image reference.');
      if (!assets.has(hash)) {
        const snap = await read('sequenceNoteImages', `${state.id}_${hash}`);
        const asset = snap.data();
        assert(snap.exists && asset?.ownerUid === uid && asset.noteId === state.id, 'SOURCE_UNVERIFIED', 'Existing image ownership must match the note.');
        jpeg(asset.dataUrl);
        assert(imageHash(asset.dataUrl) === hash, 'SOURCE_INVALID', 'Existing JPEG hash mismatch.');
        assets.set(hash, asset.dataUrl);
      }
      assert(HASH.test(move.image) || move.image === assets.get(hash), 'IMAGES_UNSUPPORTED', 'Image content changes are unsupported.');
      move.image = hash;
    }
  }
  return async function invoke(name, params, current, signal, { beforeDispatch } = {}) {
    assert(ACTION_NAMES.has(name), 'UNKNOWN_ACTION', 'Unknown local CORE action.');
    object(params, name === 'coreRenewalWorkflowUpdate' ? ['caseId', 'workflowStatus']
      : name === 'coreSequenceSave' ? ['state', 'expectedRevision'] : name === 'coreSequenceGet' ? ['noteId'] : ['noteId', 'expectedRevision']);
    if (name === 'coreRenewalWorkflowUpdate') { id(params.caseId); invalid(STATUSES.includes(params.workflowStatus)); }
    else if (name === 'coreSequenceGet') id(params.noteId);
    else {
      revision(params.expectedRevision);
      if (name === 'coreSequenceSave') stateSchema(params.state);
      else { id(params.noteId); invalid(params.expectedRevision > 0); }
    }
    bounded(params, 180000);
    params = JSON.parse(JSON.stringify(params));
    const uid = current?.staff?.uid;
    assert(typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && current.staff.studioId === '5330'
      && ['owner', 'manager', 'instructor'].includes(current.staff.role), 'OWNER_REQUIRED', 'A current CORE actor in studio 5330 is required.');
    const cancelled = () => assert(!signal?.aborted, 'CANCELLED', 'Cancelled before direct commit.');
    cancelled();
    if (name === 'coreSequenceGet') {
      const snap = await read('sequenceNotes', params.noteId);
      assert(snap.exists, 'NOT_FOUND', 'Sequence source is missing.');
      sequenceView(snap.data(), params.noteId, current);
      const token = await access.token(current);
      assert(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'AUTH_UNAVAILABLE', 'Existing Firebase ID token is required.');
      cancelled();
      const url = `https://firestore.googleapis.com/v1/${ROOT}/sequenceNotes/${params.noteId}`;
      const request = { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) };
      await beforeDispatch?.();
      cancelled();
      let response, document;
      try { response = await fetcher(url, request); document = await response.json(); }
      catch { throw new CoreError('SOURCE_UNAVAILABLE', 'Authenticated sequence read failed; no retry was attempted.'); }
      assert(response.ok && !document?.error, 'SOURCE_UNAVAILABLE', 'Authenticated sequence read was rejected; no Admin read fallback.');
      assert(document?.name === `${ROOT}/sequenceNotes/${params.noteId}`, 'SOURCE_INVALID', 'Unexpected sequence document.');
      const fields = document.fields;
      assert(typeof fields?.payload?.stringValue === 'string' && Buffer.byteLength(fields.payload.stringValue) <= 180000
        && typeof fields.ownerUid?.stringValue === 'string' && typeof fields.deleted?.booleanValue === 'boolean'
        && typeof fields.revision?.integerValue === 'string' && /^[1-9]\d{0,15}$/.test(fields.revision.integerValue),
      'SOURCE_INVALID', 'Invalid authenticated sequence document.');
      return sequenceView({ payload: fields.payload.stringValue, ownerUid: fields.ownerUid.stringValue,
        deleted: fields.deleted.booleanValue, revision: Number(fields.revision.integerValue) }, params.noteId, current);
    }
    let writes, result;
    if (name === 'coreRenewalWorkflowUpdate') {
      assert(['owner', 'manager'].includes(current.staff.role), 'PERMISSION_DENIED', 'Renewal workflow requires manager access.');
      const snap = await read('renewalCases', params.caseId);
      assert(snap.exists, 'SOURCE_MISSING', 'An existing renewal case is required.');
      const item = snap.data();
      assert(item?.studioId === '5330', 'SOURCE_SCOPE', 'The renewal case must belong to 5330.');
      id(item.memberId);
      const member = await read('memberProfiles', item.memberId);
      assert(member.exists, 'SOURCE_UNVERIFIED', 'Canonical member profile is missing.');
      const time = now();
      assert(Number.isSafeInteger(time) && time > 0 && time < 8640000000000000 - 7 * DAY, 'SOURCE_INVALID', 'Invalid clock.');
      verifyRenewal(item, member.data(), params.caseId, time);
      const change = write('renewalCases', params.caseId, { workflowStatus: params.workflowStatus,
        operatorUpdatedByUid: uid, nextActionAt: null }, snap, ['operatorUpdatedAt', 'updatedAt']);
      if (params.workflowStatus === 'snoozed') change.update.fields.nextActionAt = { timestampValue: new Date(time + 7 * DAY).toISOString() };
      writes = [change]; result = { caseId: params.caseId, workflowStatus: params.workflowStatus };
    } else {
      const noteId = name === 'coreSequenceSave' ? params.state.id : params.noteId;
      const snap = await read('sequenceNotes', noteId);
      const old = snap.data();
      if (snap.exists) {
        assert(old?.ownerUid === uid, 'PERMISSION_DENIED', 'Only the exact owner UID can edit a sequence, including for managers.');
        assert(old.deleted === false && Number.isSafeInteger(old.revision) && old.revision >= 1
          && old.revision === params.expectedRevision, 'CONFLICT', 'Deleted note or stale sequence revision.');
      } else assert(name === 'coreSequenceSave' && params.expectedRevision === 0, 'CONFLICT', 'Sequence source is missing or the revision is stale.');
      const next = params.expectedRevision + 1;
      if (name === 'coreSequenceRemove') {
        writes = [write('sequenceNotes', noteId, { deleted: true, revision: next, payload: '{}' }, snap)];
      } else {
        let previous = { moves: { warm: [], main: [], cool: [] } };
        if (snap.exists) {
          try { previous = JSON.parse(old.payload); stateSchema(previous); }
          catch { throw new CoreError('SOURCE_INVALID', 'Invalid sequence source payload; no replacement is allowed.'); }
          assert(previous.id === noteId, 'SOURCE_INVALID', 'Sequence payload identity does not match the document.');
        }
        await preserveImages(params.state, previous, uid);
        const payload = JSON.stringify(params.state);
        bounded(params.state, 180000);
        writes = [write('sequenceNotes', noteId, { ownerUid: uid, revision: next, deleted: false, payload,
          title: params.state.title, teacher: params.state.teacher,
          equipment: params.state.equipment === '기타' ? params.state.equipmentOther : params.state.equipment,
          date: params.state.date, goal: params.state.goal, moveCount: moves(params.state).length }, snap,
        snap.exists ? ['updatedAt'] : ['updatedAt', 'createdAt'])];
      }
      result = { noteId, revision: next, deleted: name === 'coreSequenceRemove' };
    }
    const body = JSON.stringify(bounded({ writes }, 180000));
    const token = await access.token(current);
    assert(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'AUTH_UNAVAILABLE', 'Existing Firebase ID token is required.');
    cancelled();
    const request = { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) };
    await beforeDispatch?.();
    cancelled();
    let response, receipt;
    try { response = await fetcher(COMMIT, request); receipt = await response.json(); }
    catch { throw new CoreError('OUTCOME_UNKNOWN', 'Direct commit outcome unknown. Inspect canonical records and main plan intent; never automatically retry.'); }
    if (!response.ok || receipt?.error) {
      const status = receipt?.error?.status;
      const known = ['PERMISSION_DENIED', 'UNAUTHENTICATED', 'INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'NOT_FOUND', 'ALREADY_EXISTS', 'ABORTED', 'RESOURCE_EXHAUSTED'];
      throw new CoreError(!response.ok && response.status >= 400 && response.status < 500 && known.includes(status) ? status : 'OUTCOME_UNKNOWN',
        'Direct commit rejected or uncertain. Inspect canonical source and main plan intent; no automatic retry.');
    }
    const validTime = t => typeof t === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(t) && Number.isFinite(Date.parse(t));
    assert(validTime(receipt?.commitTime) && Array.isArray(receipt.writeResults) && receipt.writeResults.length === writes.length
      && receipt.writeResults.every(r => validTime(r?.updateTime)), 'OUTCOME_UNKNOWN', 'Missing commit proof; do not replay the plan.');
    return { ...result, commitTime: receipt.commitTime };
  };
}
