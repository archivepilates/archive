import test from "node:test";
import assert from "node:assert/strict";
import { RECOVERY_TARGETS, assertRecoveryEvidence, assertRecoveryHistories, assertRecoveryReceipt,
  claimOperatorRecovery } from "../lib/membership-welcome-operator-recovery.mjs";

const now=Date.parse("2026-10-21T15:00:00.000Z"), at=new Date(now-1000).toISOString();
function fixture(){
  const [id,contractId,name]=RECOVERY_TARGETS[0];
  const source={schemaVersion:1,source:"studiomate_native_contract",bindingVerified:true,status:"signed",studioId:"5330",contractId,memberName:name,
    binding:{memberId:id,memberPhone:"01011112222",contractAction:"first_purchase_contract",userTicketId:"11737956",productId:"216339",expectedTotalAmount:200000,expectedPaidAmount:200000},
    selection:{action:"first_purchase_contract",member:{memberId:id},ticket:{userTicketId:"11737956",productId:"216339"}}};
  const ticket={...source.binding,studioId:"5330",status:"active",refunded:false,cancelled:false,issuedAt:"2026-10-18T10:18:11.000Z",
    payment:{verified:true,complete:true,status:"paid",refundedAmount:0,outstandingAmount:0,totalAmount:200000,paidAmount:200000}};
  return {source,memberResult:{status:"verified",matchCount:1,member:{memberId:id,name,phone:"01011112222",registeredAt:"2026-10-08T15:00:00.000Z",inactive:false}},
    ticketRead:{status:"verified",tickets:[ticket]},signature:{status:"signed",receipt:{contractId,memberId:id,userTicketId:ticket.userTicketId,productId:ticket.productId,checkedAt:at,signedAt:"2026-10-18T11:01:10.000Z"}},
    readback:{member:{checkedAt:at},providerSignature:{signedAt:"2026-10-18T11:01:10.000Z"}},
    config:{enabled:true,mode:"live",sourcePromoted:true,nativeE2eVerified:true,activationScope:"production",studioId:"5330",regularProductIds:["216339"],cutoverAt:"2026-09-23T03:50:35.295Z"},now};
}
test("exact historical signature approved without altering ordinary clocks",()=>assert.deepEqual(assertRecoveryEvidence(fixture()),RECOVERY_TARGETS[0]));
for(const [name,change] of [
  ["unknown member",x=>x.source.binding.memberId="42"], ["renewal",x=>x.source.selection.action="renewal_purchase_confirmation"],
  ["inactive",x=>x.memberResult.member.inactive=true], ["staff",x=>x.memberResult.member.memberGrade="스텝"],
  ["old member",x=>x.memberResult.member.registeredAt="2024-01-01T00:00:00.000Z"], ["ambiguous phone",x=>x.memberResult.matchCount=2],
  ["refund",x=>x.ticketRead.tickets[0].refunded=true], ["unpaid",x=>x.ticketRead.tickets[0].payment.outstandingAmount=1],
  ["wrong amount",x=>x.ticketRead.tickets[0].payment.totalAmount=1], ["stale",x=>x.signature.receipt.checkedAt="2026-10-20T00:00:00.000Z"],
  ["signature changed",x=>x.source.signatureReceipt={signedAt:at}], ["prior regular",x=>x.ticketRead.tickets.push({...x.ticketRead.tickets[0],userTicketId:"1",issuedAt:"2026-10-01T00:00:00.000Z"})],
  ["disabled",x=>x.config.enabled=false], ["trial",x=>x.config.regularProductIds=[]],
  ["trial member",x=>x.memberResult.member.memberGrade="체험회원"], ["unknown grade",x=>x.memberResult.member.memberGrade="unknown"],
  ["invalid cutover",x=>x.config.cutoverAt="invalid"],
])test(`reject ${name}`,()=>{const f=fixture();change(f);assert.throws(()=>assertRecoveryEvidence(f));});

function histories(){const source=fixture().source;return {source,candidateId:"same",local:{complete:true,memberIds:[source.binding.memberId],records:[]},provider:{complete:true,records:[]}};}
test("empty complete histories",()=>assert.doesNotThrow(()=>assertRecoveryHistories(histories())));
for(const [name,change] of [
  ["partial local",x=>x.local.complete=false],["partial provider",x=>x.provider.complete=false],
  ["prior welcome",x=>x.provider.records.push({id:"message"})],["extra ledger",x=>x.candidate={status:"queued"}],
])test(`history reject ${name}`,()=>{const f=histories();change(f);assert.throws(()=>assertRecoveryHistories(f));});
function preflight(){const f=histories();f.candidate={candidateId:"same",memberId:f.source.binding.memberId,memberPhone:f.source.binding.memberPhone,studioId:"5330",templateCode:"KA01TP260914091233543JoFDsn7KfCr",status:"failed",attempts:1,maxAttempts:1,lastError:"history_time_limit"};
 f.send={...f.candidate};f.local.records=["alimtalkCandidates","alimtalkSends"].map(sourceCollection=>({sourceCollection,sourceId:"same",status:"failed"}));return f;}
test("diagnosed exact preflight is retained and eligible",()=>assert.doesNotThrow(()=>assertRecoveryHistories(preflight())));
for(const field of ["providerAttemptedAt","solapiMessageId","sentAt","response","receipt"])
test(`preflight outbound marker ${field} blocked`,()=>{const f=preflight();f.send[field]=at;assert.throws(()=>assertRecoveryHistories(f));});
test("other failed rows cannot be retried",()=>{const f=preflight();f.source.binding.memberId="5052201";assert.throws(()=>assertRecoveryHistories(f));});
test("claim blocks an existing permanent claim without writes",async()=>{
 const f=fixture(), snaps=[0,1,2,3].map(i=>({ref:{path:`doc/${i}`},exists:i<2,updateTime:{isEqual:()=>true},data:()=>i===0?f.source:{}}));
 const writes=[];const db={doc:path=>({path}),runTransaction:fn=>fn({getAll:async()=>[...snaps,{exists:true}],create:(...a)=>writes.push(a),update:(...a)=>writes.push(a)})};
 await assert.rejects(()=>claimOperatorRecovery({db,sourceSnap:snaps[0],configSnap:snaps[1],candidateSnap:snaps[2],sendSnap:snaps[3],local:{memberIds:["5041630"]},candidateId:"same",evidence:{checkedAt:at},templateCode:"v6",stamp:()=>at,now:()=>now}),/permanent_claim/);
 assert.equal(writes.length,0);
});
function claimFixture(){
 const source=fixture().source,atStamp={isEqual:other=>other===atStamp},writes=[];
 const snap=(path,data)=>({id:path.split("/").at(-1),ref:{path},exists:Boolean(data),updateTime:atStamp,data:()=>data});
 const sourceSnap=snap("source",source),configSnap=snap("config",fixture().config),candidateSnap=snap("candidate"),sendSnap=snap("send");
 const initial=[sourceSnap,configSnap,candidateSnap,sendSnap];
 const db={doc:path=>({path}),runTransaction:fn=>fn({getAll:async(...refs)=>refs.map(ref=>{
   if(ref.path.startsWith("membershipWelcomeClaims/"))return snap(ref.path);
   if(ref.path.startsWith("memberProfiles/"))return snap(ref.path,{studioId:"5330",phone:source.binding.memberPhone,name:source.memberName});
   return initial.find(s=>s.ref.path===ref.path);
 }),create:(ref,data)=>writes.push({ref,data,create:true}),update:(ref,data)=>writes.push({ref,data,create:false})})};
 return {args:{db,sourceSnap,configSnap,candidateSnap,sendSnap,local:{memberIds:[source.binding.memberId]},candidateId:"same",evidence:{checkedAt:at,signedAt:"2026-10-18T11:01:10.000Z"},templateCode:"v6",profileSnapshots:[{id:source.binding.memberId,updateTime:atStamp}],stamp:()=>at,now:()=>now},writes};
}
test("claim writes exact canonical key and permanent alias claims, no transport",async()=>{
 const f=claimFixture();const result=await claimOperatorRecovery(f.args);
 assert.equal(result.claimRefs.length,2);assert.equal(f.writes.length,5);
 assert.equal(f.writes.find(x=>x.ref.path==="candidate").data.status,"processing");
 assert.equal(f.writes.find(x=>x.ref.path==="send").data.providerAttemptedAt,at);
 assert.ok(f.writes.filter(x=>x.ref.path.startsWith("membershipWelcomeClaims/")).every(x=>x.create));
});
test("claim preserves the full preflight failure evidence without resetting attempts",async()=>{
 const f=claimFixture();const previous={status:"failed",attempts:1,lastError:"history_time_limit"};
 f.args.candidateSnap.exists=true;f.args.candidateSnap.data=()=>previous;
 await claimOperatorRecovery(f.args);
 const patch=f.writes.find(x=>x.ref.path==="candidate").data;
 assert.deepEqual(patch.preRecoveryEvidence,previous);assert.equal(patch.attempts,1);assert.equal(patch.maxAttempts,1);
});
test("stale claim evidence aborts before all writes",async()=>{
 const f=claimFixture();f.args.evidence.checkedAt="2026-10-20T00:00:00.000Z";
 await assert.rejects(()=>claimOperatorRecovery(f.args),/evidence_expired/);assert.equal(f.writes.length,0);
});
test("alias graph changed after history aborts before all writes",async()=>{
 const f=claimFixture();f.args.profileSnapshots[0].updateTime={isEqual:()=>false};
 await assert.rejects(()=>claimOperatorRecovery(f.args),/alias_graph_changed/);assert.equal(f.writes.length,0);
});
test("provider receipt matches content identity channel template and variables",()=>{
 const source=fixture().source,template={templateId:"v6",channelId:"channel",content:"#{이름}님"};
 const row={messageId:"message",to:source.binding.memberPhone,text:source.memberName+"님",status:"COMPLETE",statusCode:"4000",kakaoOptions:{templateId:"v6",pfId:"channel",disableSms:true,variables:{"#{이름}":source.memberName}}};
 assert.equal(assertRecoveryReceipt(row,source,template,"message"),true);
 for(const patch of [{to:"wrong"},{text:"wrong"},{messageId:"wrong"},{kakaoOptions:{...row.kakaoOptions,disableSms:false}}])assert.throws(()=>assertRecoveryReceipt({...row,...patch},source,template,"message"));
});
