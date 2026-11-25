import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createSupabaseCurrentPassLookup,createSupabasePassSessionIssuer,currentPassMemberKey,makeDailyPassBatch,
  shouldPublishHelpCurrentPasses} from './current-pass-snapshot.mjs';

const now=Date.parse('2026-11-25T09:30:00Z');
const observedAt=new Date(now-1000).toISOString(),expiresAt=now+600000;
const target={memberId:'1234',phone:'01000000001',name:'Test Only',bindingRevision:'a'.repeat(64),
  products:[{sourceName:'Synthetic product',sourceType:'count fixture',type:'count',category:'group',
    statuses:{'사용 중':'active','만료':'excluded'}}]};
const ticket={name:'Synthetic product',type:'count fixture',status:'사용 중',
  availableFromDate:'2026-11-01',expiresOn:'2026-12-10',remainingCount:0,reservableCount:null,paymentAmount:100000};
const observation={memberId:target.memberId,phone:target.phone,name:target.name,coverage:'current_ticket_cards',
  checkedAt:observedAt,tickets:[ticket]};
const secret=Buffer.alloc(32,27), sourceDigest='b'.repeat(64);
const payload={targets:[target],observations:[observation],secret,sourceDigest,now};
const basicCard={category:'group',type:'count',status:'active',startsOn:'2026-11-01',expiresOn:'2026-12-10',remaining:0,bookable:null};

test('only an existing successful scheduled download can trigger the sidecar',()=>{
  const evidence={enabled:true,apply:true,download:true,scheduledRun:true,
    memberDownload:{ok:true,sha256:sourceDigest},steps:['download','memberProfiles','memberPhoneDedupe','reservations']
      .map(name=>({name,exitCode:0,stdoutOk:true}))};
  assert.equal(shouldPublishHelpCurrentPasses(evidence),true);
  for(const extra of [{enabled:false},{apply:false},{download:false},{scheduledRun:false},{notificationRefresh:true},
    {manualSources:true},{memberDownload:{ok:true,sha256:'not-a-source'}},{steps:evidence.steps.slice(1)},
    {steps:[...evidence.steps,{name:'critical',exitCode:1,stdoutOk:false}]}]){
    assert.equal(shouldPublishHelpCurrentPasses({...evidence,...extra}),false);
  }
});

test('exact native member read projects only allowed fields, no workbook or identity',()=>{
  const batch=makeDailyPassBatch(payload);
  assert.equal(batch.observedAt,observedAt);
  assert.match(batch.sourceDigest,/^[a-f0-9]{64}$/);
  assert.deepEqual(batch.members,[{memberKey:currentPassMemberKey(secret,target.memberId),
    bindingRevision:target.bindingRevision,cards:[basicCard]}]);
  const serialized=JSON.stringify(batch);
  for(const value of [target.phone,target.name,ticket.name,'paymentAmount','memberId','reservableCount'])
    assert.equal(serialized.includes(value),false);
  const separateProducts=makeDailyPassBatch({...payload,
    targets:[{...target,products:[...target.products,{...target.products[0],sourceName:'Second product'}]}],
    observations:[{...observation,tickets:[ticket,{...ticket,name:'Second product'}]}]});
  assert.equal(separateProducts.members[0].cards.length,2);
  assert.deepEqual(makeDailyPassBatch({...payload,observations:[{...observation,tickets:[]}]}).members[0].cards,[]);
});

test('identity mismatch, incomplete source, unknown ticket state or missing count never publishes',()=>{
  for(const bad of [{memberId:'1235'},{phone:'01000000002'},{name:'Other Test'},{coverage:'partial'},
    {checkedAt:new Date(now-121*60_000).toISOString()},{tickets:[{...ticket,status:'unknown'}]},
    {tickets:[{...ticket,remainingCount:null}]},{tickets:[{...ticket,availableFromDate:'2026-11-26'}]},
    {tickets:[ticket,ticket]}]){
    assert.throws(()=>makeDailyPassBatch({...payload,observations:[{...observation,...bad}]}),/unverified/);
  }
  assert.throws(()=>makeDailyPassBatch({...payload,targets:[target,target],
    observations:[observation,observation]}),/scope_unverified/);
});

test('hosted lookup only passes the opaque session hash, rejects stale projections and never calls a Mac adapter',async()=>{
  const token='x'.repeat(43), hash=createHash('sha256').update(token).digest('hex'), calls=[];
  let row={observedAt,expiresAt,cards:[basicCard]};
  const lookup=createSupabaseCurrentPassLookup({now:()=>now,query:async(sql,args)=>{
    calls.push({sql,args});return {rows:[{result:row}]};
  }});
  assert.equal(await lookup('1234','cards'),null);
  assert.equal(await lookup(token,'history'),null);
  assert.equal(calls.length,0);
  assert.deepEqual(await lookup(token,'cards'),{cards:[basicCard],checkedAt:observedAt,expiresAt});
  assert.deepEqual(calls,[{sql:'select archive_help_pass_snapshot.read_own($1::text) as result',args:[hash]}]);
  row={observedAt:new Date(now-27*3600000).toISOString(),expiresAt,cards:[basicCard]};
  assert.equal(await lookup(token,'cards'),null);
  row={observedAt,expiresAt,cards:[{...basicCard,paymentAmount:100000}]};
  assert.equal(await lookup(token,'cards'),null);
  row=null;
  assert.equal(await lookup(token,'cards'),null);
});

test('only the trusted hosted issuer binds a verified user session to a pseudonymous key',async()=>{
  const token='q'.repeat(43),hash=createHash('sha256').update(token).digest('hex'),calls=[];
  const issuer=createSupabasePassSessionIssuer({secret,now:()=>now,query:async(sql,args)=>calls.push({sql,args})});
  const binding={memberId:target.memberId,studioId:'5330',revision:target.bindingRevision,expiresAt};
  await assert.rejects(issuer.issue({token,binding:{...binding,studioId:'other'}}),/unverified/);
  assert.equal(calls.length,0);
  await issuer.issue({token,binding});
  await issuer.revoke(token);
  assert.deepEqual(calls.map(row=>row.args),[[hash,currentPassMemberKey(secret,target.memberId),target.bindingRevision,
    new Date(expiresAt).toISOString()],[hash]]);
});
