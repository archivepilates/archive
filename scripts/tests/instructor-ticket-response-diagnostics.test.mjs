import test from 'node:test';
import assert from 'node:assert/strict';
import { instructorTicketResponseDiagnostics, issuedInstructorTicketId } from '../lib/instructor-ticket-issue-evidence.mjs';

test('diagnostics distinguish absent response, non-JSON wrapper and structured results without values', () => {
  const absent = instructorTicketResponseDiagnostics({ observed: false, payload: null });
  assert.equal(absent.responseObserved, false); assert.equal(absent.httpStatus, null); assert.equal(absent.bodyKind, 'null');
  const raw = instructorTicketResponseDiagnostics({ observed: true, ok: true, status: 200, contentType: 'text/plain', payload: { raw: 'PRIVATE_PHONE_OR_TOKEN' } });
  assert.deepEqual(raw.topLevelKeys, ['raw']); assert.equal(JSON.stringify(raw).includes('PRIVATE'), false);
  const nested = instructorTicketResponseDiagnostics({ observed: true, ok: true, status: 201, contentType: 'application/json', payload: { data: [{ id: '123', memberPhone: 'PRIVATE' }] } });
  assert.equal(nested.dataKind, 'array'); assert.equal(nested.rowCount, 1); assert.equal(JSON.stringify(nested).includes('123'), false);
});
test('structure diagnostics never weaken receipt parsing or include arbitrary keys and headers', () => {
  const result = instructorTicketResponseDiagnostics({ observed: true, ok: true, status: 900,
    contentType: 'application/json\nPRIVATE', payload: { 'PRIVATE/value': 'PRIVATE', data: { userTicketId: 'PRIVATE', token: 'PRIVATE' } } });
  assert.equal(result.httpStatus, null); assert.equal(result.contentType, null);
  assert.deepEqual(result.topLevelKeys, ['data']); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.throws(() => issuedInstructorTicketId({ data: { userTicketId: '123' } }));
  assert.throws(() => issuedInstructorTicketId(null));
  assert.throws(() => issuedInstructorTicketId([{ id: '123' }, { id: '456' }]));
});
