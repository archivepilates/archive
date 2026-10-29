import assert from 'node:assert/strict';
import {normalizeInstructorLessonName,normalizeInstructorLessonPhone} from './instructor-lesson-registration-contract.mjs';

export function parseInstructorEformProgress({httpStatus,body,documentName,memberName,memberPhone,now=Date.now()}) {
  assert.equal(httpStatus,200);
  assert(body?.status==='200' && body.code==='-1');
  const status=body.result?.status;
  assert(status?.document_title===documentName && status.steps?.length===3 && status.current_infos?.length===1);
  const [created,participant,completed]=status.steps;
  assert(created.seq===1 && created.action==='doc_create' && created.execute_date>0
    && participant.seq===2 && participant.action==='doc_request_participant' && participant.execute_date===-1
    && completed.seq===3 && completed.action==='' && completed.execute_date===-1);
  const current=status.current_infos[0];
  assert(current.step_seq===participant.seq && Number.isFinite(current.expired_date) && current.expired_date>now);
  const owner=participant.owner;
  assert(Array.isArray(owner?.members) && owner.members.length===1 && !owner.groups?.length && !owner.external_creators?.length);
  const recipient=String(owner.members[0]).match(/^(.+?)\s*\((\+?[\d\s-]+)\)$/);assert(recipient);
  const name=normalizeInstructorLessonName(recipient[1]),phone=normalizeInstructorLessonPhone(recipient[2]);
  assert(name===normalizeInstructorLessonName(memberName) && phone===normalizeInstructorLessonPhone(memberPhone));
  return {name,phone,status:'signature_requested',expiresAt:new Date(current.expired_date).toISOString(),
    providerDeliveryVerified:false,memberSignatureComplete:false};
}
