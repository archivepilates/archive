export function firestoreRestDenied(response) {
  if (response.status !== 403) return false;
  const body = response.body;
  if (!Array.isArray(body)) return body?.error?.status === 'PERMISSION_DENIED';
  return body.length === 1 && !body[0]?.document && body[0]?.error?.status === 'PERMISSION_DENIED';
}
