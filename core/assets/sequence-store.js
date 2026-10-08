export const IMAGE_MAX_BYTES = 64 * 1024;
const imagePattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const safeId = /^[A-Za-z0-9_-]{1,100}$/;
const copy = (value) => JSON.parse(JSON.stringify(value));
const conflict = () => Object.assign(new Error('다른 기기에서 변경됐습니다. 최신 기록을 열거나 사본으로 저장하세요.'), { code: 'sequence/conflict' });

export async function compressSequenceImage(source) {
  const image = new Image();
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    if (!image.width || !image.height || image.width * image.height > 40000000) throw Error('이미지가 너무 큽니다.');
    const canvas = document.createElement('canvas');
    for (const edge of [640, 512, 384, 256]) {
      const scale = Math.min(1, edge / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.68, 0.5]) {
        const data = canvas.toDataURL('image/jpeg', quality);
        if (atob(data.split(',')[1]).length <= IMAGE_MAX_BYTES) return data;
      }
    }
    throw Error('이미지를 충분히 줄이지 못했습니다. 다른 사진을 선택하세요.');
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}

export function createSequenceStore(runtime, user) {
  const { db, doc, collection, query, where, orderBy, limit, onSnapshot,
    getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp, writeBatch } = runtime;
  const knownImages = new Set();
  const assertSession = () => {
    if (runtime.authClient && runtime.authClient.currentUser?.uid !== user.uid) {
      throw Object.assign(new Error('운영자 계정이 변경됐습니다. 다시 로그인하세요.'), { code: 'permission-denied' });
    }
  };
  const noteRef = (id) => {
    if (!safeId.test(id)) throw Error('노트 ID가 올바르지 않습니다.');
    return doc(db, 'sequenceNotes', id);
  };
  const checkOwner = (data) => {
    if (data.ownerUid !== user.uid || data.deleted) throw conflict();
  };
  async function get(id) {
    assertSession();
    const snapshot = await getDocFromServer(noteRef(id));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    checkOwner(data);
    const state = JSON.parse(data.payload);
    if (state.id !== id || !state.moves || typeof state.moves !== 'object' || Array.isArray(state.moves)) {
      throw Error('노트 원본 확인이 필요합니다. 다른 기록에 저장하지 않습니다.');
    }
    await Promise.all(Object.values(state.moves).flat().map(async (move) => {
      if (!move.image) return;
      const assetId = `${id}_${move.image}`;
      const asset = await getDocFromServer(doc(db, 'sequenceNoteImages', assetId));
      if (!asset.exists() || asset.data().ownerUid !== user.uid || asset.data().noteId !== id) throw Error('첨부 이미지 확인이 필요합니다.');
      knownImages.add(assetId);
      move.image = asset.data().dataUrl;
    }));
    return { state, revision: data.revision };
  }
  async function save(input, revision) {
    assertSession();
    const state = copy(input);
    const assets = new Map();
    for (const move of Object.values(state.moves).flat()) {
      if (!move.image) continue;
      if (!imagePattern.test(move.image) || atob(move.image.split(',')[1]).length > IMAGE_MAX_BYTES) throw Error('사진 크기를 줄인 뒤 다시 저장하세요.');
      const bytes = new TextEncoder().encode(move.image);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
      assets.set(`${state.id}_${hash}`, move.image);
      move.image = hash;
    }
    const payload = JSON.stringify(state);
    if (new TextEncoder().encode(payload).length > 180000) throw Error('노트 내용이 너무 많습니다. 두 개의 노트로 나눠주세요.');
    const pending = [...assets].filter(([id]) => !knownImages.has(id));
    const nextRevision = await runTransaction(db, async (transaction) => {
      const ref = noteRef(state.id);
      const snapshot = await transaction.get(ref);
      if (snapshot.exists()) {
        checkOwner(snapshot.data());
        if (snapshot.data().revision !== revision) throw conflict();
      } else if (revision !== 0) throw conflict();
      const assetSnapshots = await Promise.all(pending.map(([id]) => transaction.get(doc(db, 'sequenceNoteImages', id))));
      pending.forEach(([id, dataUrl], index) => {
        const old = assetSnapshots[index];
        if (old.exists()) {
          if (old.data().ownerUid !== user.uid || old.data().noteId !== state.id || old.data().dataUrl !== dataUrl) throw conflict();
        } else transaction.set(doc(db, 'sequenceNoteImages', id), { ownerUid: user.uid, noteId: state.id, dataUrl });
      });
      transaction.set(ref, {
        ownerUid: user.uid, revision: revision + 1, updatedAt: serverTimestamp(), deleted: false,
        ...(!snapshot.exists() ? { createdAt: serverTimestamp() }
          : snapshot.data().createdAt ? { createdAt: snapshot.data().createdAt } : {}),
        payload, title: state.title, teacher: state.teacher,
        equipment: state.equipment === '기타' ? state.equipmentOther : state.equipment,
        date: state.date, goal: state.goal, moveCount: Object.values(state.moves).flat().length,
      });
      return revision + 1;
    });
    for (const id of assets.keys()) knownImages.add(id);
    return nextRevision;
  }
  async function remove(id, revision) {
    assertSession();
    await runTransaction(db, async (transaction) => {
      const ref = noteRef(id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw conflict();
      checkOwner(snapshot.data());
      if (snapshot.data().revision !== revision) throw conflict();
      transaction.update(ref, { deleted: true, revision: revision + 1, updatedAt: serverTimestamp(), payload: '{}' });
    });
    // Keep the tombstone so stale devices cannot recreate a deleted note.
    await cleanupImages(id);
  }
  async function cleanupImages(id) {
    assertSession();
    const assets = await getDocsFromServer(query(collection(db, 'sequenceNoteImages'), where('ownerUid', '==', user.uid), where('noteId', '==', id)));
    for (let start = 0; start < assets.docs.length; start += 400) {
      const batch = writeBatch(db);
      for (const asset of assets.docs.slice(start, start + 400)) batch.delete(asset.ref);
      await batch.commit();
    }
  }
  function subscribe(next, error) {
    assertSession();
    return onSnapshot(query(collection(db, 'sequenceNotes'), where('ownerUid', '==', user.uid), where('deleted', '==', false), orderBy('updatedAt', 'desc'), limit(100)), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    }, error);
  }
  async function list() {
    assertSession();
    const snapshot = await getDocsFromServer(query(collection(db, 'sequenceNotes'), where('ownerUid', '==', user.uid), where('deleted', '==', false), orderBy('updatedAt', 'desc'), limit(100)));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }
  function watch(id, next, error) {
    assertSession();
    return onSnapshot(noteRef(id), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      next(snapshot.exists() ? snapshot.data() : { deleted: true, revision: Infinity });
    }, error);
  }
  return { get, save, remove, cleanupImages, list, subscribe, watch, compressImage: compressSequenceImage, uid: user.uid };
}
