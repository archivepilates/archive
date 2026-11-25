import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {archiveAutomationPath} from './lib/archive-automation-paths.mjs';
import {createLiveReader} from '../services/archivepilates-mcp/src/live-browser.mjs';
import {readCloudConfig} from '../services/archive-help-member-access/cloud-config.mjs';
import {assertMemberDatabasePools} from '../services/archive-help-member-access/hosted-runtime.mjs';
import {createPostgresEnrollmentLoaders} from '../services/archive-help-member-access/postgres-enrollment-loader.mjs';
import {sealEnrollmentPhone} from '../services/archive-help-member-access/phone-box.mjs';
import {createSupabaseCurrentPassLookup,createSupabasePassSessionIssuer,currentPassMemberKey,
  makeDailyPassBatch} from '../services/archive-help-member-access/current-pass-snapshot.mjs';

const {Pool}=createRequire(import.meta.url)('../services/archive-help-member-access/node_modules/pg');
const root=archiveAutomationPath('secrets','supabase');
const path=archiveAutomationPath('secrets','supabase','help-member-pilot-runtime.json');
const project='vrmtkewdqgcrhpbeijhr',host='aws-0-ap-northeast-2.pooler.supabase.com';
const studioId='5330',groupType='\uadf8\ub8f9\ud615\ud69f\uc218\uc81c5:1',activeStatus='\uc0ac\uc6a9\uc911';
const token=()=>randomBytes(32).toString('base64url'),hex=()=>randomBytes(32).toString('hex');
const sha=value=>createHash('sha256').update(value).digest('hex');
const day=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const manifest=archiveAutomationPath('secrets','supabase','help-member-pilot-refresh-'+day()+'.json');

async function readPrivate(file){
  const fd=await open(file,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  try{
    const info=await fd.stat();
    assert(info.isFile()&&info.uid===process.getuid()&&!(info.mode&0o077)&&info.size<16384);
    return JSON.parse(await fd.readFile('utf8'));
  }finally{await fd.close();}
}

async function savePrivate(file,value){
  const fd=await open(file,'wx',0o600);
  try{await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();}finally{await fd.close();}
}

let stage='local preflight',native;
const pools={};
try{
  const [mode,name,last4]=process.argv.slice(2);
  const first=mode==='--apply-first',refresh=mode==='--refresh',applying=first||refresh;
  assert(applying&&process.argv.length===5&&name===name.trim()&&/^[0-9]{4}$/u.test(last4)
    ||mode==='--verify'&&process.argv.length===3);
  const directory=await lstat(root);
  assert(directory.isDirectory()&&directory.uid===process.getuid()&&!(directory.mode&0o077));
  const db=await readPrivate(archiveAutomationPath('secrets','supabase','help-member-dedicated-logins.json'));
  assert(db.project===project&&db.host===host);
  let config=first?null:await readPrivate(path),batch,source;
  let stamp;
  if(applying){
    assert(!await lstat(first?path:manifest).catch(error=>{if(error.code!=='ENOENT')throw error;}));
    stage='exact native identity and current group count card';
    native=createLiveReader({budgetMs:25000});
    const signal=AbortSignal.timeout(100000);
    const byName=await native.findMembers(name,false,signal);
    assert.equal(byName.members.length,1);
    const selected=byName.members[0];
    assert(selected.name===name&&/^010[0-9]{8}$/u.test(selected.phone)&&selected.phone.endsWith(last4));
    const byPhone=await native.findMembers(selected.phone,true,signal);
    assert.deepEqual(byPhone.members,[selected]);
    source=await native.getOverview(selected,signal);
    await native.close();native=null;
    assert(source.tickets.length===1&&source.tickets[0].name&&source.tickets[0].type===groupType
      &&source.tickets[0].status===activeStatus&&Date.now()-Date.parse(source.checkedAt)<300000);
    const {memberId}=selected;
    if(first){
      const snapshotKey=hex();
      const logins=Object.fromEntries(['auth','issuer','reader'].map(kind=>[kind,db.logins[kind]]));
      config={revision:hex(),env:{HELP_MEMBER_MODE:'pilot',HELP_MEMBER_POSTGRES:JSON.stringify({project,host,ca:db.ca,logins}),
        HELP_MEMBER_CONTACT_KEY:hex(),HELP_MEMBER_SNAPSHOT_KEY:snapshotKey,HELP_MEMBER_OTP_KEY:hex(),
        HELP_MEMBER_PILOT_ID:memberId,HELP_MEMBER_PILOT_KEY:currentPassMemberKey(Buffer.from(snapshotKey,'hex'),memberId)}};
    }
    assert.equal(config.env.HELP_MEMBER_PILOT_ID,memberId);
    batch=makeDailyPassBatch({targets:[{...selected,bindingRevision:config.revision,products:[{
      sourceName:source.tickets[0].name,sourceType:groupType,category:'group',type:'count',statuses:{[activeStatus]:'active'},
    }]}],observations:[source],sourceDigest:sha(JSON.stringify([memberId,source.checkedAt])),
      secret:Buffer.from(config.env.HELP_MEMBER_SNAPSHOT_KEY,'hex')});
    stamp={sourceDigest:batch.sourceDigest,cardDigest:sha(JSON.stringify(batch.members[0].cards))};
  }else stamp=await readPrivate(manifest).catch(error=>{if(error.code==='ENOENT')return config;throw error;});
  stage='connected role preflight';
  const cloud=readCloudConfig(config.env);
  const memberId=config.env.HELP_MEMBER_PILOT_ID,{revision}=config;
  assert.equal(currentPassMemberKey(cloud.memberKeySecret,memberId),config.env.HELP_MEMBER_PILOT_KEY);
  for(const [kind,options] of Object.entries(cloud.pools))pools[kind]=new Pool(options);
  await assertMemberDatabasePools(pools);
  for(const [kind,role] of [['enrollment','archive_help_enrollment_writer_app'],['snapshot','archive_help_snapshot_writer_app']]){
    assert.equal(db.logins[kind].role,role);
    pools[kind]=new Pool({...cloud.pools.reader,user:role+'.'+project,password:db.logins[kind].password,
      application_name:'archive-help-pilot-'+kind});
  }
  const loaders=createPostgresEnrollmentLoaders({pool:pools.auth,key:cloud.contactKey,
    memberKeySecret:cloud.memberKeySecret,pilotMemberKey:cloud.pilotMemberKey});
  const status=async()=>(await pools.snapshot.query('select archive_help_pass_snapshot.daily_status() as result')).rows[0]?.result;
  const binding=async()=>loaders.loadCurrentBinding({studioId,memberId});
  if(applying){
    stage='daily snapshot and binding preflight';
    assert.equal(await status(),null);
    let box;
    if(first){
      assert.equal(await binding(),null);
      box=sealEnrollmentPhone({phone:source.phone,memberId,revision,key:cloud.contactKey});
      await savePrivate(path,{...config,...stamp});
    }else{
      // Re-observation must retain the same exact active identity and encrypted
      // contact. A changed contact or a revoked/expired binding needs review.
      const verified=await loaders.loadCurrentBinding({studioId,memberId,needContact:true});
      assert(verified?.phone===source.phone&&verified.revision===revision);
      const conn=await pools.auth.connect();
      try{
        await conn.query('begin read only');
        await conn.query('set local role archive_help_member_auth_runtime');
        const {rows:[row]}=await conn.query('select archive_help_enrollment.read_binding($1,$2) as value',[studioId,memberId]);
        assert(row?.value?.revision===revision&&/^[A-Za-z0-9_-]{52}$/u.test(row.value.phoneBox));
        box=row.value.phoneBox;
        await conn.query('commit');
      }catch(error){await conn.query('rollback').catch(()=>{});throw error;}
      finally{conn.release();}
      await savePrivate(manifest,stamp);
    }
    stage='exact binding publication';
    const {rows:[published]}=await pools.enrollment.query('select archive_help_enrollment.publish_binding($1,$2,$3,$4,$5) as ok',
      [studioId,memberId,revision,batch.observedAt,box]);
    assert.equal(published?.ok,true);
    const verified=await loaders.loadCurrentBinding({studioId,memberId,needContact:true});
    assert(verified?.phone===source.phone&&verified.revision===revision);
    stage='one-member snapshot publication';
    const {rows:[result]}=await pools.snapshot.query('select archive_help_pass_snapshot.publish_daily($1,$2,$3) as result',
      [batch.observedAt,batch.sourceDigest,JSON.stringify(batch.members)]);
    assert.equal(result?.result?.status,'published');
  }
  stage='readback and session isolation';
  const stats=await status();
  assert(stats?.members===1&&stats.cards===1&&stats.sourceDigest===stamp.sourceDigest);
  assert.equal((await binding())?.revision,revision);
  const issuer=createSupabasePassSessionIssuer({query:(...args)=>pools.issuer.query(...args),secret:cloud.memberKeySecret});
  const lookup=createSupabaseCurrentPassLookup({query:(...args)=>pools.reader.query(...args)});
  const own=token(),other=token(),wrong=token();
  const bind={studioId,memberId,revision,expiresAt:Date.now()+90000};
  const otherId=memberId==='9999999999999999'?'9999999999999998':'9999999999999999';
  try{
    await issuer.issue({token:own,binding:bind});
    await issuer.issue({token:other,binding:{...bind,memberId:otherId}});
    assert.equal(await lookup(wrong,'cards'),null);
    assert.equal(await lookup(other,'cards'),null);
    const result=await lookup(own,'cards');
    assert(result?.cards?.length===1&&sha(JSON.stringify(result.cards.map(row=>Object.fromEntries(
      ['category','type','status','startsOn','expiresOn','remaining','bookable'].map(key=>[key,row[key]])))))===stamp.cardDigest);
  }finally{
    await Promise.all([issuer.revoke(own),issuer.revoke(other)]);
  }
  assert.equal(await lookup(own,'cards'),null);
  console.log(JSON.stringify({ok:true,members:1,cards:1,observedAt:stats.observedAt,blockedUnknown:true,blockedOther:true,revoked:true,sent:0}));
}catch(error){
  const code=/^[0-9A-Z_]{4,30}$/u.test(error?.code??'')?' ('+error.code+')':'';
  console.error('Stopped at '+stage+code+'. Check the stored state before any retry. No member message was sent.');
  process.exitCode=1;
}finally{
  try{await native?.close();}finally{await Promise.allSettled(Object.values(pools).map(pool=>pool.end()));}
}
