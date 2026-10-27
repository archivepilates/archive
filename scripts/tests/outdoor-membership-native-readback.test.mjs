import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNativeContractCompletionReadback } from '../lib/studiomate-native-contract-source.mjs';

function fixture(title) {
  const binding={contractId:'a'.repeat(64),memberId:'100',studioId:'5330',memberPhone:'01000000001',userTicketId:'200',productId:'300'};
  return {binding,checkedAt:'2026-10-27T01:00:00.000Z',
    memberResult:{status:'verified',matchCount:1,member:{memberId:'100',phone:binding.memberPhone,inactive:false}},
    contract:{...binding,verified:true,status:'signed',signedAt:'2026-10-27T00:30:00.000Z',memberSignaturePresent:true,centerSignaturePresent:true},
    ticketRead:{status:'verified',tickets:[{...binding,title,status:'active',refunded:false,cancelled:false,
      payment:{verified:true,complete:true,status:'paid',totalAmount:100000,paidAmount:100000,outstandingAmount:0,refundedAmount:0}}]}};
}
for(const title of ['야외수업 1회권','야 외 수 업','OUTDOOR class','그룹 체험권','그룹 1회권']) {
  test(`native completion cannot promote a bound single-use product: ${title}`,()=>{
    const input=fixture(title), before=structuredClone(input);
    assert.deepEqual(buildNativeContractCompletionReadback(input),{status:'review',reason:'one_off_product_excluded'});
    assert.deepEqual(input,before);
  });
}
test('regular bound readback preserves title and ignores unrelated outdoor holdings',()=>{
  const input=fixture('10주(주1회)');
  input.ticketRead.tickets.push({...input.ticketRead.tickets[0],title:'야외수업 1회권',userTicketId:'201'});
  const result=buildNativeContractCompletionReadback(input);
  assert.equal(result.status,'verified');assert.equal(result.nativeReadback.ticket.title,'10주(주1회)');
  assert.equal(result.nativeReadback.ticket.userTicketId,'200');
});
test('outdoor product cannot hide a wrong member/contract binding',()=>{
  const input=fixture('야외수업 1회권');input.contract.memberId='101';
  assert.deepEqual(buildNativeContractCompletionReadback(input),{status:'review',reason:'native_completion_identity_mismatch'});
});
