import assert from 'node:assert/strict';
import test from 'node:test';
import {selectNativeMembershipContractCandidate as select} from './studiomate-membership-contract-native-selection.mjs';
import {firestoreJournal} from './studiomate-membership-contract-processor.mjs';
const NOW = '2026-11-15T00:05:00.000Z';
function fixture() {
  const ticket = {source:'studiomate_native_ticket',verified:true,complete:true,studioId:'5330',memberId:'100',
    userTicketId:'200',productId:'300',title:'그룹 50회권',issuedAt:'2026-10-02T03:00:00.000Z',
    availabilityStartAt:'2026-10-05',expireAt:'2027-03-03',status:'active',refunded:false,cancelled:false,payment:{verified:true,complete:true,status:'paid',
      totalAmount:100000,paidAmount:100000,outstandingAmount:0,refundedAmount:0,
      transactions:[{paymentId:'synthetic',method:'card',status:'paid',amount:100000,paidAt:'2026-10-02T03:00:00.000Z'}]}};
  return {group:{phone:'01000000001',rows:[]},member:{memberId:'100',phone:'01000000001'},
    ticketRead:{status:'verified',tickets:[ticket]},contractHistory:{status:'verified',records:[]},
    previousDownloadedAt:null,sourceDownloadedAt:NOW,config:{studioId:'5330',regularProductIds:['300'],
      termsVersion:'synthetic-v1',cutoverAt:'2026-09-23T03:00:00.000Z',maxSourceAgeMs:3600000,maxIssuanceAgeMs:7200000,signExpirationDays:7},
    recoveryApproval:{policy:'operator_exact_purchase_contract_recovery_v1',reference:'synthetic-explicit-approval',
      memberId:'100',userTicketId:'200',productId:'300',issuedAt:ticket.issuedAt,sourceComplete:true,sourceRow:3,
      sourceSha256:'a'.repeat(64),manifestSha256:'b'.repeat(64),approvedAt:'2026-11-14T14:00:00.000Z',
      expiresAt:'2026-11-15T11:00:00.000Z',purchaseStartAt:'2026-09-30T15:00:00.000Z',purchaseEndAt:'2026-11-14T15:00:00.000Z'}};
}
test('exact historical purchase recovery keeps real source time and normal policy unchanged',()=>{
  const input=fixture(),before=structuredClone(input),r=select(input);
  assert.equal(r.status,'eligible');assert.equal(r.selection.action,'first_purchase_contract');
  assert.equal(r.selection.now,NOW);assert.equal(r.selection.policy.maxIssuanceAgeMs,7200000);
  assert.equal(r.selection.history.baselineCapturedAt,null);assert.deepEqual(input,before);
});
for(const field of ['memberId','userTicketId','productId','issuedAt','sourceSha256','manifestSha256','sourceComplete','sourceRow','approvedAt','expiresAt','purchaseStartAt','purchaseEndAt']) {
  test(`recovery requires exact approval field ${field}`,()=>{const i=fixture();delete i.recoveryApproval[field];assert.notEqual(select(i).status,'eligible');});
}
for(const [label,change] of [
  ['expired',i=>{i.recoveryApproval.expiresAt=NOW;}],
  ['future approval',i=>{i.recoveryApproval.approvedAt='2026-11-15T01:00:00.000Z';}],
  ['wide approval',i=>{i.recoveryApproval.expiresAt='2026-11-16T11:00:00.000Z';}],
  ['wide purchase scope',i=>{i.recoveryApproval.purchaseStartAt='2026-01-01T00:00:00.000Z';}],
  ['other issuance',i=>{i.recoveryApproval.userTicketId='201';}],
  ['other product',i=>{i.recoveryApproval.productId='301';}],
  ['outside scope',i=>{i.recoveryApproval.purchaseStartAt='2026-10-03T00:00:00.000Z';}],
  ['cancelled',i=>{i.ticketRead.tickets[0].cancelled=true;}],
  ['refund',i=>{i.ticketRead.tickets[0].refunded=true;}],
  ['trial grade',i=>{i.member.memberGrade='체험회원';}],
  ['unallowed',i=>{i.config.regularProductIds=['301'];}],
  ['unverified payment',i=>{i.ticketRead.tickets[0].payment.verified=false;}],
  ['existing same issuance',i=>{i.contractHistory.records=[{contractId:'c'.repeat(64),verified:true,categoryId:1,title:'아카이브 회원가입',status:'sent',ticket:{userTicketId:'200'}}];}],
]) test(`recovery blocks ${label}`,()=>{const i=fixture();change(i);assert.notEqual(select(i).status,'eligible');});
test('normal discovery never receives the recovery exception',()=>{const i=fixture();delete i.recoveryApproval;i.previousDownloadedAt='2026-10-02T02:00:00.000Z';assert.equal(select(i).reason,'stale_issuance');});
test('fresh unregistered regular product becomes review, not silent no-fresh-issuance',()=>{const i=fixture();delete i.recoveryApproval;i.previousDownloadedAt='2026-10-02T02:00:00.000Z';i.sourceDownloadedAt='2026-10-02T04:00:00.000Z';i.ticketRead.tickets[0].productId='301';const r=select(i);assert.equal(r.status,'review');assert.equal(r.reason,'unregistered_regular_product_requires_review');assert.deepEqual(r.productIds,['301']);});
test('unregistered trial and outdoor products remain excluded from this alert',()=>{for(const title of ['그룹 체험권','야외수업 1회권','그룹 1회권']){const i=fixture();delete i.recoveryApproval;i.previousDownloadedAt='2026-10-02T02:00:00.000Z';i.sourceDownloadedAt='2026-10-02T04:00:00.000Z';Object.assign(i.ticketRead.tickets[0],{productId:'301',title});assert.equal(select(i).reason,'no_fresh_native_issuance');}});
test('Black Friday pass omission is surfaced without treating it as allowlisted',()=>{const i=fixture();delete i.recoveryApproval;i.previousDownloadedAt='2026-10-02T02:00:00.000Z';i.sourceDownloadedAt='2026-10-02T04:00:00.000Z';Object.assign(i.ticketRead.tickets[0],{productId:'301',title:'*블랙프라이데이 50회권'});assert.equal(select(i).reason,'unregistered_regular_product_requires_review');});
for(const productId of ['364319','388592','412180'])test(`verified retired product ${productId} establishes renewal without becoming a send target`,()=>{const i=fixture();i.ticketRead.tickets.unshift({...structuredClone(i.ticketRead.tickets[0]),userTicketId:'199',productId,issuedAt:'2025-04-30T03:00:00.000Z',status:'inactive'});const r=select(i);assert.equal(r.status,'eligible');assert.equal(r.selection.action,'renewal_purchase_confirmation');assert.deepEqual(r.selection.history.purchases.priorRegularIssuanceIds,['199']);assert.deepEqual(r.selection.policy.regularProductIds,['300']);});
for(const status of ['draft','sent','signed','expired','cancelled'])test(`same issuance contract ${status} cannot be recreated by renewed approval`,()=>{const i=fixture();i.contractHistory.records=[{contractId:'c'.repeat(64),verified:true,categoryId:1,title:'아카이브 재등록',status,ticket:{userTicketId:'200',productId:'300'}}];assert.equal(select(i).reason,'existing_or_ambiguous_contract_for_purchase');});
for(const status of ['expired','signed'])test(`legacy unbound ${status} contract with overlapping purchase period blocks recovery`,()=>{const i=fixture();i.contractHistory.records=[{contractId:'c'.repeat(64),verified:true,categoryId:1,title:'아카이브 재등록',status,ticket:{userTicketId:'',productId:'300',availabilityStartAt:'2026-10-01',expireAt:'2027-04-01'}}];assert.equal(select(i).reason,'existing_or_ambiguous_contract_for_purchase');});
test('legacy contract with missing purchase metadata is not proof of absence',()=>{const i=fixture();i.contractHistory.records=[{contractId:'c'.repeat(64),verified:true,categoryId:1,title:'아카이브 재등록',status:'expired',ticket:null}];assert.equal(select(i).reason,'existing_or_ambiguous_contract_for_purchase');});
test('new approval cannot change the canonical issuance job key',()=>{const i=fixture(),first=select(i);i.recoveryApproval.reference='another-approved-reference';i.recoveryApproval.manifestSha256='d'.repeat(64);assert.equal(select(i).selection.jobKey,first.selection.jobKey);});
for(const title of ['그룹 5개월 무제한','듀엣 3개월권','그룹 50 회권','프라이빗 30일권'])test(`unknown regular product title is reviewed: ${title}`,()=>{const i=fixture();delete i.recoveryApproval;i.previousDownloadedAt='2026-10-02T02:00:00.000Z';i.sourceDownloadedAt='2026-10-02T04:00:00.000Z';Object.assign(i.ticketRead.tickets[0],{productId:'301',title});assert.equal(select(i).reason,'unregistered_regular_product_requires_review');});
for(const [start,end] of [['2026-02-30','2027-01-01'],['2026-12-01','2026-10-01']])test(`invalid legacy purchase period ${start}/${end} remains held`,()=>{const i=fixture();i.contractHistory.records=[{contractId:'c'.repeat(64),verified:true,categoryId:1,title:'아카이브 재등록',status:'expired',ticket:{productId:'300',userTicketId:'',availabilityStartAt:start,expireAt:end}}];assert.equal(select(i).reason,'existing_or_ambiguous_contract_for_purchase');});
for(const stage of ['claimed','deferred_create','created','prepared','signature_requested','unknown','review','complete'])test(`operator purchase recovery cannot resume a competing or previous ${stage} job`,async()=>{
  let writes=0;const db={collection:()=>({doc:()=>({})}),runTransaction:fn=>fn({get:async()=>({exists:true,data:()=>({stage,payloadHash:'same'})}),create:()=>writes++,update:()=>writes++})};
  const result=await firestoreJournal(db,{policy:'operator_exact_purchase_contract_recovery_v1'}).claim({jobKey:'synthetic',payloadHash:'same',selection:{}});
  assert.equal(result.status,'rejected');assert.equal(result.reason,'purchase_recovery_existing_job_no_replay');assert.equal(writes,0);
});
