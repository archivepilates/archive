export function collectCoreAuthTokens(state, { origin, apiKey, uid, decodeIndexedDB }) {
  if (![origin, apiKey, uid].every(value => typeof value === 'string' && value.length > 0)) {
    throw new Error('Explicit auth storage scope required');
  }
  const key = `firebase:authUser:${apiKey}:[DEFAULT]`;
  const tokens = new Set();
  const addUser = user => {
    const token = user?.stsTokenManager?.accessToken;
    if (user?.uid === uid && typeof token === 'string' && token.length > 0) tokens.add(token);
  };
  for (const entry of state.origins || []) {
    if (entry.origin !== origin) continue;
    for (const item of entry.localStorage || []) {
      if (item.name === key) addUser(JSON.parse(item.value));
    }
    for (const database of entry.indexedDB || []) {
      if (database.name !== 'firebaseLocalStorageDb') continue;
      for (const store of database.stores || []) {
        if (store.name !== 'firebaseLocalStorage') continue;
        for (const record of store.records || []) {
          const stored = Object.hasOwn(record, 'value') ? record.value
            : Object.hasOwn(record, 'valueEncoded') ? decodeIndexedDB(record.valueEncoded) : null;
          if (stored?.fbase_key === key) addUser(stored.value);
        }
      }
    }
  }
  return tokens;
}
