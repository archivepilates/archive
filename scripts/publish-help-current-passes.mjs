#!/usr/bin/env node
import {createRequire} from 'node:module';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {archiveAutomationPath} from './lib/archive-automation-paths.mjs';
import {helpMemberSyncEnabled} from './lib/help-member-sync-activation.mjs';
import {auditCurrentPassRoster,makeDailyPassBatch,makeVerifiedRosterPassBatch} from '../services/archive-help-member-access/current-pass-snapshot.mjs';
import {auditNativeHelpRegistration,makeHelpRosterGeneration} from '../services/archive-help-member-access/help-roster-projection.mjs';

const project='vrmtkewdqgcrhpbeijhr';
const role='archive_help_pass_writer';
const hex=/^[a-f0-9]{64}$/u;
const require=createRequire(import.meta.url);

async function readPrivateConfig(filename,maxBytes){
  const path=archiveAutomationPath('secrets/supabase/'+filename);
  const fd=await open(path,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  try{
    const info=await fd.stat();
    if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o077)||info.size>maxBytes)throw Error('writer_config_invalid');
    const buffer=Buffer.alloc(info.size+1);
    let offset=0;
    while(offset<buffer.length){
      const {bytesRead}=await fd.read(buffer,offset,buffer.length-offset,offset);
      if(!bytesRead)break;
      offset+=bytesRead;
    }
    const checked=await fd.stat();
    if(offset!==info.size||checked.size!==info.size||checked.mtimeMs!==info.mtimeMs)
      throw Error('writer_config_invalid');
    return JSON.parse(buffer.toString('utf8',0,offset));
  }finally{await fd.close();}
}

async function readRoster(native,signal){
  const inventory=await native.getInventory(signal,{recheckAll:true});
  for(const profile of inventory.profiles){
    const shared=profile.activeTickets.filter(pass=>pass.shared&&!pass.ownerVerified
      &&['G','P'].includes(pass.sourceClass)&&['T','P'].includes(pass.type));
    if(!shared.length||!profile.phone)continue;
    try{
      await native.getOverview(profile,signal,{issuedIds:shared.map(pass=>pass.userTicketId)});
      for(const pass of shared)pass.ownerVerified=true;
    }catch(error){
      if(error?.code!=='LIVE_IDENTITY_MISMATCH')throw error;
      // An unowned or missing shared card must fail projection rather than be shown.
      signal.throwIfAborted();
    }
  }
  return inventory;
}

async function checkRoster(){
  const {createLiveReader}=await import('../services/archivepilates-mcp/src/live-browser.mjs');
  const native=createLiveReader({budgetMs:70_000});
  try{
    const roster=await readRoster(native,AbortSignal.timeout(160_000));
    return {ok:true,status:'checked_roster',...auditCurrentPassRoster(roster),registration:auditNativeHelpRegistration(roster)};
  }finally{await native.close();}
}

async function stageGeneralRoster(sourceDigest,apply){
  const catalogue=await readPrivateConfig('help-member-roster-catalog.json',262144);
  const reviewedAt=Date.parse(catalogue.checkedAt??'');
  if(catalogue.studioId!=='5330'||!Number.isFinite(reviewedAt)||reviewedAt>Date.now()
    ||Date.now()-reviewedAt>30*24*60*60_000||!Array.isArray(catalogue.products)
    ||!catalogue.products.length||catalogue.products.some(row=>typeof row?.sourceTitle!=='string'||!row.sourceTitle.trim()))
    throw Error('roster_catalog_unverified');
  const {env}=await readPrivateConfig('help-member-pilot-runtime.json',16384);
  if(!hex.test(env?.HELP_MEMBER_SNAPSHOT_KEY??'')||!hex.test(env?.HELP_MEMBER_CONTACT_KEY??''))
    throw Error('writer_config_invalid');
  const {createLiveReader}=await import('../services/archivepilates-mcp/src/live-browser.mjs');
  const native=createLiveReader({budgetMs:70_000});
  let batch;
  try{
    const inventory=await readRoster(native,AbortSignal.timeout(160_000));
    batch=makeHelpRosterGeneration({inventory,products:catalogue.products,sourceDigest,
      memberKeySecret:Buffer.from(env.HELP_MEMBER_SNAPSHOT_KEY,'hex'),contactKey:Buffer.from(env.HELP_MEMBER_CONTACT_KEY,'hex')});
  }finally{await native.close();}
  if(!apply)return {ok:true,status:'general_plan',...batch.summary};
  if(!batch.members.length||batch.nativeContacts?.length!==batch.summary.sourceMembers
    ||batch.summary.unreviewedProducts>0)throw Error('roster_generation_unverified');
  const db=await readPrivateConfig('help-member-dedicated-logins.json',16384);
  const writer='archive_help_enrollment_writer_app', login=db.logins?.enrollment;
  const capability='archive_help_enrollment_writer';
  const direct=db.host==='db.'+project+'.supabase.co';
  if(db.project!==project||!direct&&!/^aws-[0-9]+-ap-northeast-2\.pooler\.supabase\.com$/u.test(db.host??'')
    ||!db.ca?.startsWith('-----BEGIN CERTIFICATE-----')||login?.role!==writer
    ||!/^[A-Za-z0-9_-]{32,128}$/u.test(login.password??''))throw Error('writer_config_invalid');
  const {Client}=require('../services/archivepilates-mcp/node_modules/pg');
  const client=new Client({host:db.host,port:5432,database:'postgres',user:direct?writer:writer+'.'+project,
    password:login.password,ssl:{ca:db.ca,rejectUnauthorized:true},connectionTimeoutMillis:5000,
    statement_timeout:9000,query_timeout:10000,application_name:'archive-help-roster-publisher'});
  try{
    await client.connect();
    const {rows:[proof]}=await client.query(`SELECT current_user::text=$1 AS expected, EXISTS(
      SELECT FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
        AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
        AND pg_has_role(r.oid,$2::name,'USAGE')
        AND NOT EXISTS (SELECT FROM pg_roles other WHERE other.oid<>r.oid AND other.rolname<>$2::name
          AND pg_has_role(r.oid,other.oid,'MEMBER'))) AS restricted`,[writer,capability]);
    if(!proof?.expected||!proof.restricted)throw Error('writer_config_invalid');
    let result;
    try{
      ({rows:[{value:result}]}=await client.query('SELECT archive_help_roster.publish_native_registration($1,$2,$3,$4) AS value',
        [batch.observedAt,batch.sourceDigest,JSON.stringify(batch.members),JSON.stringify(batch.nativeContacts)]));
    }catch{
      // A lost acknowledgement is checked, never replayed.
      result=null;
    }
    const {rows:[row]}=await client.query('SELECT archive_help_roster.status() AS value');
    const readback=row?.value;
    if(readback?.sourceDigest!==batch.sourceDigest||!(readback.members>=0&&readback.members<=batch.members.length)
      ||!(readback.cards>=readback.members&&readback.cards<=batch.members.reduce((n,m)=>n+m.cards.length,0))
      ||result&&result.sourceDigest!==readback.sourceDigest)throw Error('writer_readback_invalid');
    return {ok:true,status:'general_published',members:readback.members,cards:readback.cards,
      heldApproval:batch.members.length-readback.members,observedAt:readback.observedAt,...batch.summary};
  }finally{await client.end();}
}

async function main(){
  const [mode,hashFlag,sourceDigest]=process.argv.slice(2);
  if(mode==='--check-roster'&&process.argv.length===3)return checkRoster();
  if(mode==='--general-plan'&&process.argv.length===3)return stageGeneralRoster('0'.repeat(64),false);
  if(mode==='--general-scheduled-run'&&process.argv.length===5&&hashFlag==='--source-sha256'
    &&hex.test(sourceDigest)&&helpMemberSyncEnabled())return stageGeneralRoster(sourceDigest,true);
  if(process.argv.length!==5||mode!=='--scheduled-run'||hashFlag!=='--source-sha256'||!hex.test(sourceDigest)
    ||process.env.HELP_CURRENT_PASS_SNAPSHOT_ENABLED!=='enabled')throw Error('scheduled_apply_required');
  const config=await readPrivateConfig('help-current-pass-writer.json',32768);
  const wholeRoster=config.scope==='verified_roster';
  const direct=config.host==='db.'+project+'.supabase.co';
  if(config.project!==project||!direct&&!/^aws-[0-9]+-ap-northeast-2\.pooler\.supabase\.com$/u.test(config.host??'')
    ||config.role!==role||typeof config.password!=='string'||config.password.length<24
    ||typeof config.ca!=='string'||!config.ca.startsWith('-----BEGIN CERTIFICATE-----')
    ||!hex.test(config.ownerHmacKey??'')||(config.scope!==undefined&&!wholeRoster)
    ||(!wholeRoster&&(!Array.isArray(config.approvedTargets)||config.approvedTargets.length<1
      ||config.approvedTargets.length>5)))throw Error('writer_config_invalid');
  const authority=wholeRoster?await readPrivateConfig('help-current-pass-roster-authority.json',2*1024*1024):null;
  const {Client}=require('../services/archivepilates-mcp/node_modules/pg');
  const db=new Client({host:config.host,port:5432,user:direct?role:role+'.'+project,database:'postgres',
    password:config.password,ssl:{ca:config.ca,rejectUnauthorized:true},connectionTimeoutMillis:5000,
    statement_timeout:8000,query_timeout:9000,application_name:'archive-help-current-pass'});
  let native;
  try{
    await db.connect();
    const previous=(await db.query('select archive_help_pass_snapshot.daily_status() as result')).rows[0]?.result;
    if(previous){
      if(!hex.test(previous.sourceDigest??'')||!Number.isSafeInteger(previous.members)||!Number.isSafeInteger(previous.cards))
        throw Error('writer_readback_invalid');
      return {ok:true,status:'already_published',members:previous.members,cards:previous.cards};
    }
    const {createLiveReader}=await import('../services/archivepilates-mcp/src/live-browser.mjs');
    native=createLiveReader({budgetMs:wholeRoster?70_000:22_000});
    const signal=AbortSignal.timeout(wholeRoster?160_000:90_000),secret=Buffer.from(config.ownerHmacKey,'hex');
    let batch;
    if(wholeRoster){
      const inventory=await readRoster(native,signal);
      batch=makeVerifiedRosterPassBatch({inventory,authority,sourceDigest,secret});
    }else{
      const observations=[];
      for(const {memberId,name,phone} of config.approvedTargets){
        signal.throwIfAborted();
        observations.push(await native.getOverview({memberId,name,phone},signal));
      }
      batch=makeDailyPassBatch({targets:config.approvedTargets,observations,sourceDigest,secret});
    }
    signal.throwIfAborted();
    const published=(await db.query('select archive_help_pass_snapshot.publish_daily($1::timestamptz,$2::text,$3::jsonb) as result',
      [batch.observedAt,batch.sourceDigest,JSON.stringify(batch.members)])).rows[0]?.result;
    const readback=(await db.query('select archive_help_pass_snapshot.daily_status() as result')).rows[0]?.result;
    const expectedCards=batch.members.reduce((sum,row)=>sum+row.cards.length,0);
    if(!['published','already_published'].includes(published?.status)||readback?.sourceDigest!==batch.sourceDigest
      ||readback.members!==batch.members.length||readback.cards!==expectedCards)throw Error('writer_readback_invalid');
    return {ok:true,status:published.status,members:readback.members,cards:readback.cards,observedAt:batch.observedAt};
  }finally{
    try{await native?.close();}finally{await db.end();}
  }
}

try{console.log(JSON.stringify(await main()));}
catch(error){
  const known=new Set(['scheduled_apply_required','writer_config_invalid','writer_readback_invalid','approved_pilot_scope_unverified',
    'native_member_readback_unverified','native_roster_unverified','verified_roster_authority_required','ticket_policy_unverified','ticket_state_unverified','member_key_unverified',
    'roster_catalog_unverified','roster_generation_unverified',
    'LIVE_BUSY','LIVE_CHANGED','LIVE_IDENTITY_MISMATCH','LIVE_TIMEOUT','LIVE_LOGIN_REQUIRED','LIVE_CLEANUP_REQUIRED','LIVE_UNAVAILABLE','LIVE_INCOMPLETE']);
  const note=known.has(error?.message)?error.message:known.has(error?.code)?error.code:error?.code==='ENOENT'?'writer_config_missing':'snapshot_not_verified';
  console.log(JSON.stringify({ok:false,status:'held',reason:note}));
  process.exitCode=1;
}
