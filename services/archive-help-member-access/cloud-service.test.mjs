import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import test from 'node:test';
import {ORIGIN} from './accounts.mjs';
import {readCloudConfig} from './cloud-config.mjs';
import {currentPassMemberKey} from './current-pass-snapshot.mjs';
import {createHelpCloudServer} from './node-http.mjs';
import {openEnrollmentPhone,sealEnrollmentPhone} from './phone-box.mjs';
import {createPostgresEnrollmentLoaders} from './postgres-enrollment-loader.mjs';
import {createHostedSolapiTransport} from './solapi-http.mjs';

const project='vrmtkewdqgcrhpbeijhr';
const hex=()=>randomBytes(32).toString('hex');
function config(){
  return {HELP_MEMBER_MODE:'pilot',HELP_MEMBER_CONTACT_KEY:hex(),HELP_MEMBER_SNAPSHOT_KEY:hex(),HELP_MEMBER_OTP_KEY:hex(),
    HELP_MEMBER_PILOT_KEY:hex(),HELP_MEMBER_POSTGRES:JSON.stringify({project,host:'db.'+project+'.supabase.co',
      ca:'-----BEGIN CERTIFICATE----- fixture',logins:{
        auth:{role:'archive_help_member_auth_app',password:hex()},
        issuer:{role:'archive_help_pass_issuer_app',password:hex()},
        reader:{role:'archive_help_pass_reader_app',password:hex()},
      }})};
}

test('only explicit pilot config uses dedicated, TLS-verified connections',()=>{
  assert.deepEqual(readCloudConfig({}),{enabled:false});
  assert.throws(()=>readCloudConfig({HELP_MEMBER_MODE:'all'}));
  const env=config();
  const ok=readCloudConfig(env);
  assert.equal(ok.enabled,true);
  assert.equal(ok.pools.auth.ssl.rejectUnauthorized,true);
  assert.equal(ok.pools.auth.max,3);
  assert.equal(ok.pools.reader.user,'archive_help_pass_reader_app');
  for(const change of [
    b=>{b.project='wrong-project';},
    b=>{b.host='attacker.test';},
    b=>{b.logins.auth.role='postgres';},
    b=>{b.logins.reader.password=b.logins.issuer.password;},
    b=>{b.logins.reader.ssl=false;},
  ]){
    const invalid=JSON.parse(env.HELP_MEMBER_POSTGRES);change(invalid);
    assert.throws(()=>readCloudConfig({...env,HELP_MEMBER_POSTGRES:JSON.stringify(invalid)}),{message:'Help private deployment configuration invalid'});
  }
  assert.throws(()=>readCloudConfig({...env,HELP_MEMBER_CONTACT_KEY:env.HELP_MEMBER_OTP_KEY}));
});

test('encrypted contact belongs only to its exact native subject and revision',()=>{
  const data={phone:'01000000015',memberId:'417',revision:hex(),key:randomBytes(32)};
  const phoneBox=sealEnrollmentPhone(data);
  assert.equal(phoneBox.length,52);
  assert.ok(!phoneBox.includes(data.phone));
  assert.notEqual(sealEnrollmentPhone(data),phoneBox);
  assert.equal(openEnrollmentPhone({...data,phoneBox}),data.phone);
  assert.equal(openEnrollmentPhone({...data,phoneBox,revision:hex()}),null);
  assert.equal(openEnrollmentPhone({...data,phoneBox,memberId:'418'}),null);
  assert.equal(openEnrollmentPhone({...data,phoneBox:phoneBox.slice(0,-1)+(phoneBox.endsWith('a')?'b':'a')}),null);
});

test('pilot enrollment loader performs no other-member query and decrypts only for OTP',async()=>{
  const memberId='417',revision=hex(),key=randomBytes(32),memberKeySecret=randomBytes(32),phone='01000000015';
  const read=[];
  const pool={connect:async()=>({query:async(sql,args)=>{
    read.push([sql,args]);
    return {rows:[{value:{studioId:'5330',memberId,revision,phoneBox:sealEnrollmentPhone({phone,memberId,revision,key})}}]};
  },release:discard=>assert.equal(discard,false)})};
  const adapters=createPostgresEnrollmentLoaders({pool,key,memberKeySecret,
    pilotMemberKey:Buffer.from(currentPassMemberKey(memberKeySecret,memberId),'hex')});
  assert.equal(await adapters.loadCurrentBinding({studioId:'5330',memberId:'418',needContact:true}),null);
  assert.deepEqual(read,[]);
  const ordinary=await adapters.loadCurrentBinding({studioId:'5330',memberId});
  assert.deepEqual(ordinary,{studioId:'5330',memberId,revision});
  assert.equal((await adapters.loadCurrentBinding({studioId:'5330',memberId,needContact:true})).phone,phone);
  assert.deepEqual(read.slice(0,5).map(x=>x[0]),['BEGIN READ ONLY',"SET LOCAL statement_timeout = '3s'",
    'SET LOCAL ROLE archive_help_member_auth_runtime','SELECT archive_help_enrollment.read_binding($1::text,$2::text) AS value','COMMIT']);
});

test('provider transport refuses other routes and never repeats an uncertain request',async()=>{
  let count=0;
  const request=createHostedSolapiTransport({apiKey:'synthetickey',apiSecret:'synthetic-secret-only',fetcher:async(url,init)=>{
    count++;assert.equal(url.origin,'https://api.solapi.com');assert.equal(init.redirect,'error');
    assert.match(init.headers.Authorization,/^HMAC-SHA256 /);
    return new Response(null,{status:429});
  }});
  await assert.rejects(request('//outside.test','POST',{}),/Invalid SOLAPI/);
  await assert.rejects(request('/messages/v4/send-many/detail','POST',{}),/transport unavailable/);
  assert.equal(count,1);
});

test('HTTP server passes an exact same-origin member request and preserves cookie restrictions',async t=>{
  let routed=0;
  const s=createHelpCloudServer({ready:false,handle:async request=>{
    routed++;
    assert.equal(request.url,ORIGIN+'/api/member-access/login-options');
    assert.equal(request.headers.get('cookie'),'__session=fixture');
    assert.deepEqual(await request.json(),{});
    return new Response('{"ok":true}',{headers:{'cache-control':'private, no-store',
      'set-cookie':'__session=fixture; Path=/api/member-access/; Secure; HttpOnly; SameSite=Strict'}});
  }});
  s.listen(0,'127.0.0.1');await once(s,'listening');
  t.after(()=>new Promise(resolve=>s.close(resolve)));
  const root='http://127.0.0.1:'+s.address().port;
  const opts={method:'POST',headers:{origin:ORIGIN,cookie:'__session=fixture','content-type':'application/json'},body:'{}'};
  assert.deepEqual(await (await fetch(root+'/healthz')).json(),{ok:true,enabled:false});
  assert.equal((await fetch(root+'/api/member-access/cards?memberId=418',opts)).status,404);
  assert.equal((await fetch(root+'/api/member-access/cards',{...opts,headers:{origin:'https://other.test'}})).status,403);
  const res=await fetch(root+'/api/member-access/login-options',opts);
  assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');
  assert.match(res.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);
  assert.equal(routed,1);
});
