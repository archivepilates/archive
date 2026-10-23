export const browserSessionPersistence = {};
let callback;
const user = {getIdToken: async () => 'synthetic-preview-token'};
export const getAuth = () => ({});
export const setPersistence = async () => {};
export function onAuthStateChanged(_, cb) { callback = cb; queueMicrotask(() => cb(user)); return () => {}; }
export const signInWithEmailAndPassword = async () => { callback?.(user); return {user}; };
export const signOut = async () => callback?.(null);
