// Run in the SDK owner's frame: Firestore checks arrays with instanceof Array.
export function createRealmSafeWhere(where) {
  return (field, operator, value) => where(
    field,
    operator,
    Array.isArray(value) ? Array.from(value) : value,
  );
}
