import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {ORIGIN} from '../../services/archive-help-member-access/accounts.mjs';
import {createWebRosterConsultationOtp} from '../../services/archive-help-member-access/consultation-otp.mjs';
import {createConsultationMemberHandler,createConsultationCardLookup,CONVERSATION_HEADER} from '../../services/archive-help-member-access/consultation-http.mjs';
import {createHelpRosterBindingLoader,rosterPhoneKey} from '../../services/archive-help-member-access/help-roster-binding.mjs';
import {createPostgresAuthStore} from '../../services/archive-help-member-access/postgres-auth-store.mjs';
import {createSupabaseCurrentPassLookup,createSupabasePassSessionIssuer} from '../../services/archive-help-member-access/current-pass-snapshot.mjs';

const require=createRequire(process.env.ARCHIVE_HELP_PGLITE_PACKAGE_JSON||
  '/Users/archivepilates/archive-automation/operations/2026-11-20-supabase-history-pilot/package.json');
const {PGlite}=require('@electric-sql/pglite');
const key=randomBytes(32), token=()=>randomBytes(32).toString('base64url');
const first='a'.repeat(64),second='b'.repeat(64),unknown='c'.repeat(64);
const firstPhone='01000000011',secondPhone='01000000022',otherPhone='01000000033';
const firstPhoneKey=rosterPhoneKey(key,firstPhone),secondPhoneKey=rosterPhoneKey(key,secondPhone);
const format=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const day=format.format(Date.now()),end=format.format(Date.now()+20*86400000);
const cards=remaining=>[{category:'group',type:'count',status:'active',startsOn:day,expiresOn:end,remaining,bookable:remaining}];
const fixture=()=>[
  {memberKey:first,phoneKey:firstPhoneKey,cards:cards(2)},
  {memberKey:second,phoneKey:secondPhoneKey,cards:cards(6)},
  {memberKey:unknown,phoneKey:rosterPhoneKey(key,otherPhone),cards:cards(9)}
];
const writer='archive_help_pass_writer',approve='archive_help_enrollment_writer',issuer='archive_help_pass_session_issuer',
  auth='archive_help_member_auth_runtime',reader='archive_help_pass_reader';

let db, serial=0;
before(async()=>{
  db=await PGlite.create();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role');
  for(const migration of ['help-current-pass','help-member-auth-store','help-member-enrollment-authority','help-member-roster',
    'help-member-roster-native-registration','help-member-roster-recent-attendance'])
    await db.exec(await readFile(new URL('../../services/archivepilates-mcp/sql/'+migration+'.sql',import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});

async function asRole(role,sql,params){
  await db.exec('SET ROLE '+role);
  try{return await db.query(sql,params);}finally{await db.exec('RESET ROLE');}
}
async function scalar(role,sql,params){
  return (await asRole(role,sql,params)).rows[0].value;
}
async function publish(rows){
  await new Promise(resolve=>setTimeout(resolve,3));
  const date=new Date().toISOString(),checksum=createHash('sha256').update('fixture-'+ ++serial).digest('hex');
  return scalar(writer,'SELECT archive_help_roster.publish($1,$2,$3) AS value',[date,checksum,JSON.stringify(rows)]);
}
function post(path,conversation,body={},cookie=''){
  return new Request(ORIGIN+'/api/member-access/'+path,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',
    [CONVERSATION_HEADER]:conversation,Cookie:cookie},body:JSON.stringify(body)});
}
const cookie=r=>r.headers.getSetCookie()[0].split(';')[0];

test('two members authenticate, each gets distinct cards, and a contact change invalidates only its old access',async()=>{
  assert.equal(await scalar(approve,'SELECT archive_help_roster.approve_contact($1,$2) AS value',[first,firstPhoneKey]),true);
  assert.equal(await scalar(approve,'SELECT archive_help_roster.approve_contact($1,$2) AS value',[second,secondPhoneKey]),true);
  assert.equal(await scalar(approve,'SELECT archive_help_roster.approve_contact($1,$2) AS value',[unknown,firstPhoneKey]),false);
  const output=await publish(fixture());
  assert.deepEqual({members:output.members,cards:output.cards,held:output.held},{members:2,cards:2,held:1});
  assert.equal(await scalar(auth,'SELECT archive_help_roster.find_binding($1) AS value',[rosterPhoneKey(key,otherPhone)]),null);
  await assert.rejects(scalar(writer,'SELECT archive_help_roster.approve_contact($1,$2) AS value',[unknown,firstPhoneKey]),{code:'42501'});
  await assert.rejects(scalar(reader,'SELECT archive_help_roster.find_binding($1) AS value',[firstPhoneKey]),{code:'42501'});
  await assert.rejects(asRole(auth,'SELECT * FROM archive_help_roster.member_projection'),{code:'42501'});
  await assert.rejects(asRole('anon','SELECT archive_help_roster.read_own($1)',[first]),{code:'42501'});

  const pool={async connect(){return {async query(sql,args){
    const r=await db.query(sql,args);
    return {...r,command:sql.split(' ')[0]};
  },release(){}};}};
  const sent=new Map(), sends=[];
  const store=createPostgresAuthStore({pool});
  const oldId=createHmac('sha256',key).update(['archive-help-consultation-otp:v1','budget','5330','101'].join('\0')).digest('hex');
  const time=Date.now(),cap=[time+86400000-400000,time+86400000-300000,time+86400000-200000];
  await store.transaction(tx=>tx.put('otp-budget',oldId,{deadlines:cap},cap.at(-1)));
  const consultation=createWebRosterConsultationOtp({store,secret:key,previousPilot:{nativeId:'101',subject:first},
    canaryAllowance:{from:time-1000,until:time+10000},
    loadRosterBinding:createHelpRosterBindingLoader({pool,contactKey:key}),sendCode:async ({to,code,mayDispatch})=>{
      assert(mayDispatch());sent.set(to,code);sends.push(to);return {accepted:true};
    }});
  const grants=createSupabasePassSessionIssuer({query:(sql,args)=>asRole(issuer,sql,args),roster:true});
  const read=createSupabaseCurrentPassLookup({query:(sql,args)=>asRole(reader,sql,args),roster:true});
  const handle=createConsultationMemberHandler({enabled:true,memberWebOtp:true,stepSecret:key,
    consultation,lookup:createConsultationCardLookup({consultation,issuer:grants,reader:read,sourceTtl:3600000}),allowRequest:async()=>true});
  const a=token(),b=token();
  const startA=cookie(await handle(post('otp-start',a,{phone:firstPhone})));
  const startB=cookie(await handle(post('otp-start',b,{phone:secondPhone})));
  assert.equal(sent.size,2);
  await handle(post('otp-start',token(),{phone:firstPhone}));
  assert.equal(sends.filter(p=>p===firstPhone).length,1);
  assert.deepEqual((await store.read('otp-budget',oldId,Date.now())).deadlines,cap);
  assert.equal((await handle(post('otp-verify',b,{code:sent.get(firstPhone)},startA))).status,403);
  const aSigned=await handle(post('otp-verify',a,{code:sent.get(firstPhone)},startA));
  const bSigned=await handle(post('otp-verify',b,{code:sent.get(secondPhone)},startB));
  assert.equal(aSigned.status,200);assert.equal(bSigned.status,200);
  const aCookie=cookie(aSigned),bCookie=cookie(bSigned);
  assert.equal((await handle(post('otp-verify',a,{code:sent.get(firstPhone)},startA))).status,403);
  assert.deepEqual((await (await handle(post('cards',a,{},aCookie))).json()).cards,cards(2));
  assert.deepEqual((await (await handle(post('cards',b,{},bCookie))).json()).cards,cards(6));
  assert.equal((await handle(post('cards',a,{},bCookie))).status,403);
  assert.equal((await handle(post('cards',b,{},aCookie))).status,403);
  assert.equal((await handle(post('cards',a,{memberId:second},aCookie))).status,400);

  const changed=fixture();changed[0].phoneKey=rosterPhoneKey(key,'01000000044');
  assert.equal((await publish(changed)).members,1);
  assert.equal((await handle(post('cards',a,{},aCookie))).status,403);
  assert.deepEqual((await (await handle(post('cards',b,{},bCookie))).json()).cards,cards(6));
  assert.equal((await publish(fixture())).members,1);
  assert.equal((await handle(post('cards',a,{},aCookie))).status,403);
  assert.equal(await scalar(approve,'SELECT archive_help_roster.revoke_contact($1,$2) AS value',[second,secondPhoneKey]),true);
  assert.equal((await handle(post('cards',b,{},bCookie))).status,403);
  assert.equal((await publish(fixture())).members,0);
  assert.equal((await scalar(writer,'SELECT archive_help_roster.status() AS value')).members,0);
});

test('native registration publishing is atomic, role-scoped and never transfers an old number',async()=>{
  const a='d'.repeat(64),b='e'.repeat(64),c='f'.repeat(64);
  const p=rosterPhoneKey(key,'01000000111'),q=rosterPhoneKey(key,'01000000122'),r=rosterPhoneKey(key,'01000000133');
  const aRow={memberKey:a,phoneKey:p,cards:cards(3)}, bRow={memberKey:b,phoneKey:q,cards:cards(7)};
  const contacts=(...rows)=>rows.map(({memberKey,phoneKey})=>({memberKey,phoneKey}));
  const sql='SELECT archive_help_roster.publish_native_registration($1,$2,$3,$4) AS value';
  const args=async (rows,observations)=>{
    await new Promise(resolve=>setTimeout(resolve,3));
    return [new Date().toISOString(),createHash('sha256').update('native-'+ ++serial).digest('hex'),
      JSON.stringify(rows),JSON.stringify(observations)];
  };
  const initial=await args([aRow,bRow],contacts(aRow,bRow));
  for(const role of [writer,auth,reader,'anon'])await assert.rejects(scalar(role,sql,initial),{code:'42501'});
  assert.equal((await scalar(approve,sql,initial)).members,2);
  const find=k=>scalar(auth,'SELECT archive_help_roster.find_binding($1) AS value',[k]);
  const first=await find(p),second=await find(q);
  assert.equal(first.subject,a);
  assert.equal(second.subject,b);
  assert.equal((await scalar(approve,sql,initial)).members,2);

  const incompatible=await args([{...bRow,cards:[]}],contacts(bRow));
  await assert.rejects(scalar(approve,sql,incompatible),{code:'22023'});
  assert.equal((await find(p)).revision,first.revision);
  await assert.rejects(scalar(approve,sql,await args([aRow],contacts(bRow))),{code:'22023'});
  await assert.rejects(scalar(approve,sql,await args([aRow],contacts(aRow,{memberKey:c,phoneKey:p}))),{code:'22023'});

  const changed={...aRow,phoneKey:r}, recycle={memberKey:c,phoneKey:p,cards:cards(1)};
  const outcome=await scalar(approve,sql,await args([changed,bRow,recycle],contacts(changed,bRow,recycle)));
  assert.deepEqual({members:outcome.members,held:outcome.held},{members:1,held:2});
  assert.equal(await find(p),null);
  assert.equal(await find(r),null);
  assert.equal((await find(q)).revision,second.revision);
  assert.equal((await scalar(approve,sql,await args([aRow,bRow],contacts(aRow,bRow)))).members,1);
  assert.equal(await find(p),null);
  await assert.rejects(scalar(approve,sql,initial),{code:'22023'});
});

test('recent attendance is private, follows the active roster grant, and vanishes on replacement',async()=>{
  // Isolated subject unrelated to other test cases (same role setup as production).
  const subject='1'.repeat(64),phoneKey='2'.repeat(64);
  const hoursAgo=()=>new Date().toISOString();
  await new Promise(r=>setTimeout(r,3));
  const observed=hoursAgo(),windowThrough=format.format(Date.parse(observed));
  const members=[{memberKey:subject,phoneKey,cards:cards(4)}],contacts=[{memberKey:subject,phoneKey}];
  const summary={windowThrough,lastOn:windowThrough,byCategory:{group:3,private:0,duet:0,triple:0}};
  const report=[{memberKey:subject,attendance:summary}];
  const sql='SELECT archive_help_roster.publish_native_registration_with_attendance($1,$2,$3,$4,$5) AS value';
  const checksum='a'.repeat(64);
  await assert.rejects(scalar(approve,sql,[observed,checksum,JSON.stringify(members),JSON.stringify(contacts),
    JSON.stringify([{memberKey:subject,attendance:{...summary,memberId:'411'}}])]),/Invalid attendance projection/);
  await scalar(approve,sql,[observed,checksum,JSON.stringify(members),JSON.stringify(contacts),JSON.stringify(report)]);
  const binding=await scalar(auth,'SELECT archive_help_roster.read_binding($1) AS value',[subject]);
  const digest='7'.repeat(64);
  assert.equal(await scalar(issuer,'SELECT archive_help_roster.issue_read_session($1,$2,$3,$4) AS value',
    [digest,subject,binding.revision,new Date(Date.now()+60_000).toISOString()]),true);
  const own='SELECT archive_help_roster.read_own_recent_attendance($1,$2) AS value';
  assert.deepEqual(await scalar(reader,own,[digest,observed]),summary);
  assert.equal(await scalar(reader,own,['6'.repeat(64),observed]),null);
  assert.equal(await scalar(reader,own,[digest,new Date(Date.parse(observed)-1).toISOString()]),null);
  await assert.rejects(scalar('anon',own,[digest,observed]),/permission denied/);
  await assert.rejects(asRole(reader,'SELECT * FROM archive_help_roster.recent_attendance'),/permission denied/);
  await asRole(issuer,'SELECT archive_help_roster.revoke_read_session($1)',[digest]);
  assert.equal(await scalar(reader,own,[digest,observed]),null);
  await new Promise(r=>setTimeout(r,3));
  const newer=hoursAgo();
  await scalar(approve,'SELECT archive_help_roster.publish_native_registration($1,$2,$3,$4) AS value',
    [newer,'b'.repeat(64),JSON.stringify(members),JSON.stringify(contacts)]);
  const freshDigest='8'.repeat(64);
  assert.equal(await scalar(issuer,'SELECT archive_help_roster.issue_read_session($1,$2,$3,$4) AS value',
    [freshDigest,subject,binding.revision,new Date(Date.now()+60_000).toISOString()]),true);
  assert.equal(await scalar(reader,own,[freshDigest,newer]),null);
});
