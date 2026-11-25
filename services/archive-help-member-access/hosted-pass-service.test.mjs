import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {digest,ORIGIN,STUDIO_ID} from './accounts.mjs';
import {createHostedHelpMemberService,createHostedPassLookup} from './hosted-pass-service.mjs';
import {currentPassMemberKey} from './current-pass-snapshot.mjs';
import {createMemberHttpHandler} from './http.mjs';

const time=Date.parse('2026-11-25T06:00:00Z');
const now=()=>time;
const token=()=>randomBytes(32).toString('base64url');
const memberSession=token();
const makeBinding=(memberId='417')=>({memberId,accountId:'account-'+memberId,studioId:STUDIO_ID,
  revision:'a'.repeat(64),expiresAt:time+600_000,identityVerified:true,active:true,signupComplete:true});
const card={category:'group',type:'count',status:'active',startsOn:'2026-11-03',expiresOn:'2026-12-19',remaining:5,bookable:3};
const snapshot={cards:[card],checkedAt:new Date(time-1000).toISOString(),expiresAt:time+600_000};
const post=(path,body={},session=memberSession)=>new Request(ORIGIN+'/api/member-access/'+path,{
  method:'POST',headers:{origin:ORIGIN,'content-type':'application/json',cookie:session?'__session=-.'+session:''},body:JSON.stringify(body)
});

test('hosted service is disabled by default and refuses missing or shared query adapters',async()=>{
  assert.equal((await createHostedHelpMemberService().handle(post('availability',{},null))).status,404);
  const query=async()=>{};
  assert.throws(()=>createHostedHelpMemberService({enabled:true,issuerQuery:query,readerQuery:query}),/scoped hosted/);
});

test('reader sees only session digest, while issuer receives exact verified binding',async()=>{
  const secret=randomBytes(32), bob=token(), sessions=new Map(), issued=[], reads=[];
  const a=makeBinding(), b=makeBinding('418');
  sessions.set(memberSession,a);sessions.set(bob,b);
  const {createSupabaseCurrentPassLookup,createSupabasePassSessionIssuer}=await import('./current-pass-snapshot.mjs');
  const version=new Map();
  const issuer=createSupabasePassSessionIssuer({now,secret,query:async (sql,args)=>{
    assert.match(sql,/\.issue_read_session\(/);
    issued.push(args);version.set(args[0],args[1]);
  }});
  const reader=createSupabaseCurrentPassLookup({now,query:async (sql,args)=>{
    assert.match(sql,/\.read_own\(/);
    reads.push(args);
    const key=version.get(args[0]);
    const own=key===currentPassMemberKey(secret,'417');
    return {rows:[{result:{cards:[{...card,remaining:own?5:17}],expiresAt:a.expiresAt,observedAt:snapshot.checkedAt}}]};
  }});
  const accounts={resolveSession:async t=>sessions.get(t),allowRequest:async()=>true};
  const lookup=createHostedPassLookup({accounts,issuer,reader,now});
  const handle=createMemberHttpHandler({enabled:true,accounts,lookup});
  assert.equal((await handle(post('cards',{memberId:'418'}))).status,400);
  assert.equal((await handle(post('cards?memberId=418'))).status,404);
  assert.equal((await handle(post('cards',{},null))).status,403);
  assert.equal((await handle(post('cards',{},token()))).status,403);
  assert.equal((await handle(post('history'))).status,403);
  assert.deepEqual(reads,[]);
  const own=await (await handle(post('cards'))).json();
  const other=await (await handle(post('cards',{},bob))).json();
  assert.deepEqual(own,{ok:true,...snapshot});
  assert.equal(other.cards[0].remaining,17);
  assert.deepEqual(reads,[[digest(memberSession)],[digest(bob)]]);
  assert.deepEqual(issued.map(x=>x.slice(0,3)),[
    [digest(memberSession),currentPassMemberKey(secret,'417'),a.revision],
    [digest(bob),currentPassMemberKey(secret,'418'),b.revision]
  ]);
  assert.ok(!JSON.stringify(own).includes(memberSession));
});

test('a revocation during lookup or failed issuer never returns cards',async()=>{
  let binding=makeBinding(), issued=0, revoked=0, reads=0;
  const accounts={resolveSession:async()=>binding,allowRequest:async()=>true};
  const issuer={issue:async()=>{issued++;},revoke:async()=>{revoked++;}};
  const reader=async()=>{reads++;binding={...binding,revision:'b'.repeat(64)};return snapshot;};
  const lookup=createHostedPassLookup({accounts,issuer,reader,now});
  assert.equal(await lookup(memberSession,'cards'),null);
  assert.deepEqual([issued,revoked,reads],[1,1,1]);
  const failed=createHostedPassLookup({accounts,now,reader,issuer:{issue:async()=>{throw Error('unavailable');}}});
  const handle=createMemberHttpHandler({enabled:true,accounts,lookup:failed});
  assert.deepEqual(await (await handle(post('cards'))).json(),{ok:false});
  assert.equal(reads,1);
  const empty=createHostedPassLookup({accounts,issuer,now,reader:async()=>null});
  assert.equal(await empty(memberSession,'cards'),null);
});

test('logout closes the durable auth session before best-effort downstream revocation',async()=>{
  const events=[];
  const accounts={allowRequest:async()=>true,logout:async(step,session)=>{
    assert.equal(step,null);assert.equal(session,memberSession);events.push('auth closed');
  }};
  const onSessionClosed=async session=>{
    assert.equal(session,memberSession);events.push('reader revoke attempted');throw Error('unavailable');
  };
  const handle=createMemberHttpHandler({enabled:true,accounts,onSessionClosed});
  const response=await handle(post('logout'));
  assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
  assert.deepEqual(events,['auth closed','reader revoke attempted']);
});
