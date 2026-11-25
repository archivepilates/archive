#!/usr/bin/env node
import {createRequire} from 'node:module';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {archiveAutomationPath} from './lib/archive-automation-paths.mjs';
import {makeDailyPassBatch} from '../services/archive-help-member-access/current-pass-snapshot.mjs';

const project='vrmtkewdqgcrhpbeijhr';
const role='archive_help_pass_writer';
const hex=/^[a-f0-9]{64}$/u;
const require=createRequire(import.meta.url);

async function readWriterConfig(){
  const path=archiveAutomationPath('secrets/supabase/help-current-pass-writer.json');
  const fd=await open(path,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  try{
    const info=await fd.stat();
    if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o077)||info.size>32768)throw Error('writer_config_invalid');
    const buffer=Buffer.alloc(32769);
    const {bytesRead}=await fd.read(buffer,0,buffer.length,0);
    if(bytesRead>32768)throw Error('writer_config_invalid');
    return JSON.parse(buffer.toString('utf8',0,bytesRead));
  }finally{await fd.close();}
}

async function main(){
  const [mode,hashFlag,sourceDigest]=process.argv.slice(2);
  if(process.argv.length!==5||mode!=='--scheduled-run'||hashFlag!=='--source-sha256'||!hex.test(sourceDigest)
    ||process.env.HELP_CURRENT_PASS_SNAPSHOT_ENABLED!=='enabled')throw Error('scheduled_apply_required');
  const config=await readWriterConfig();
  const direct=config.host==='db.'+project+'.supabase.co';
  if(config.project!==project||!direct&&!/^aws-[0-9]+-ap-northeast-2\.pooler\.supabase\.com$/u.test(config.host??'')
    ||config.role!==role||typeof config.password!=='string'||config.password.length<24
    ||typeof config.ca!=='string'||!config.ca.startsWith('-----BEGIN CERTIFICATE-----')
    ||!hex.test(config.ownerHmacKey??'')||!Array.isArray(config.approvedTargets)||config.approvedTargets.length<1
    ||config.approvedTargets.length>5)throw Error('writer_config_invalid');
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
    native=createLiveReader({budgetMs:22_000});
    const signal=AbortSignal.timeout(90_000),observations=[];
    for(const {memberId,name,phone} of config.approvedTargets){
      signal.throwIfAborted();
      observations.push(await native.getOverview({memberId,name,phone},signal));
    }
    const batch=makeDailyPassBatch({targets:config.approvedTargets,observations,sourceDigest,
      secret:Buffer.from(config.ownerHmacKey,'hex')});
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
    'native_member_readback_unverified','ticket_policy_unverified','ticket_state_unverified','member_key_unverified']);
  const note=known.has(error?.message)?error.message:error?.code==='ENOENT'?'writer_config_missing':'snapshot_not_verified';
  console.log(JSON.stringify({ok:false,status:'held',reason:note}));
  process.exitCode=1;
}
