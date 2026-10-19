import { enqueueDeliveredHoldingMemo, enqueuePendingHoldingMemos } from './holding-delivery-memo.mjs';

export const MEMBER_OPERATION_SERVICE_VERSION = 'member-operation-service-v1';

/** Only canonical holding memo side effects are supported; never sends or source mutations. */
export async function continueMemberOperation({ db, stamp, kind, operationId }) {
  if (kind !== 'holding' || !/^holding_operator_notice_[a-f0-9]{64}$/.test(operationId || '')) {
    throw new Error('member_operation_unsupported');
  }
  return { version: MEMBER_OPERATION_SERVICE_VERSION, kind, operationId,
    ...await enqueueDeliveredHoldingMemo({ db, stamp, id: operationId }) };
}

/** The existing memo worker owns discovery. No new timer, transport, or independent queue. */
export async function preparePendingMemberOperations({ db, stamp, limit = 10 }) {
  return enqueuePendingHoldingMemos({ db, stamp, limit });
}
