import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {archiveAutomationPath} from './lib/archive-automation-paths.mjs';
import {createLessonVideoSolapiTransport} from './lib/lesson-video-notice-solapi.mjs';
import {readConsultationConfig} from '../services/archive-help-member-access/consultation-runtime.mjs';
import {MEMBER_CODE_TEMPLATE,sameMemberCodeTemplate} from '../services/archive-help-member-access/solapi-code.mjs';

const project='archive-pilates', region='asia-northeast3', operator='home@archivepilates.com';
const runtime='archive-help-member@archive-pilates.iam.gserviceaccount.com';
const role='roles/secretmanager.secretAccessor', serviceMember='serviceAccount:'+runtime;
const newKeys=['HELP_MEMBER_POSTGRES','HELP_MEMBER_CONTACT_KEY','HELP_MEMBER_SNAPSHOT_KEY','HELP_MEMBER_OTP_KEY',
  'HELP_MEMBER_PILOT_KEY','HELP_MEMBER_PILOT_ID','HELP_MEMBER_SOLAPI_TEMPLATE'];
const existingKeys=['SOLAPI_API_KEY','SOLAPI_API_SECRET','SOLAPI_PFID'];
const g=(args,input)=>execFileSync('gcloud',[...args,'--quiet','--project='+project,'--account='+operator],
  {input,encoding:'utf8',stdio:[input===undefined?'ignore':'pipe','pipe','pipe'],timeout:30000}).trim();
const getValue=name=>g(['secrets','versions','access','latest','--secret='+name]);
const access=name=>{
  const policy=JSON.parse(g(['secrets','get-iam-policy',name,'--format=json']));
  assert(!policy.bindings?.some(binding=>binding.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers')));
  return !!policy.bindings?.some(binding=>binding.role===role&&!binding.condition&&binding.members?.includes(serviceMember));
};

async function privateConfig(){
  const fd=await open(archiveAutomationPath('secrets','supabase','help-member-pilot-runtime.json'),
    constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const info=await fd.stat();
    assert(info.isFile()&&info.uid===process.getuid()&&!(info.mode&0o077)&&info.size<16384);
    return JSON.parse(await fd.readFile('utf8')).env;
  }finally{await fd.close();}
}

async function exactTemplate(env){
  const get=createLessonVideoSolapiTransport({key:env.SOLAPI_API_KEY,apiSecret:env.SOLAPI_API_SECRET});
  const channelId=env.SOLAPI_PFID, seen=new Set(), matches=[];
  let startKey='';
  for(let page=0;page<20;page++){
    const response=await get('/kakao/v2/templates?'+new URLSearchParams({channelId,limit:'100',...(startKey?{startKey}:{})}));
    const rows=Array.isArray(response)?response:response.templateList??response.templates??response.items;
    assert(Array.isArray(rows));
    matches.push(...rows.filter(row=>row.name===MEMBER_CODE_TEMPLATE.name&&row.status==='APPROVED'&&!row.isDeleted));
    startKey=response.nextKey;
    if(!startKey)break;
    assert(!seen.has(startKey)&&page<19);seen.add(startKey);
  }
  assert(matches.length===1&&/^KA01TP[A-Za-z0-9]+$/u.test(matches[0].templateId));
  const row=await get('/kakao/v2/templates/'+matches[0].templateId);
  assert(row.status==='APPROVED'&&sameMemberCodeTemplate(row,channelId));
  return row.templateId;
}

let stage='exact project and runtime account';
try{
  const mode=process.argv[2];
  assert(process.argv.length===3&&['--check','--apply'].includes(mode));
  const identity=JSON.parse(g(['iam','service-accounts','describe',runtime,'--format=json']));
  assert(identity.email===runtime&&identity.disabled!==true&&identity.projectId===project);
  stage='private TLS configuration and approved template';
  const env=await privateConfig();
  for(const name of existingKeys)env[name]=getValue(name);
  env.HELP_MEMBER_SOLAPI_TEMPLATE=await exactTemplate(env);
  assert(readConsultationConfig(env).enabled);

  stage='secret scope and current versions';
  const names=new Set(g(['secrets','list','--format=value(name)']).split(/\n/u).map(name=>name.split('/').at(-1)));
  assert(existingKeys.every(name=>names.has(name)));
  for(const name of newKeys){
    if(names.has(name))assert.equal(getValue(name),env[name]);
    assert(typeof env[name]==='string'&&env[name].length>0);
  }
  if(mode==='--apply'){
    stage='dedicated Help secret creation; no version rotation';
    for(const name of newKeys){
      if(!names.has(name))g(['secrets','create',name,'--data-file=-','--replication-policy=user-managed',
        '--locations='+region,'--labels=purpose=help-member-pilot'],env[name]);
      assert.equal(getValue(name),env[name]);
    }
    stage='runtime-only named secret access';
    for(const name of [...newKeys,...existingKeys]){
      if(!access(name))g(['secrets','add-iam-policy-binding',name,'--member='+serviceMember,'--role='+role,'--condition=None']);
      assert(access(name));
    }
  }
  console.log(JSON.stringify({ok:true,mode,runtimeOnly:true,verifiedApprovedTemplate:true,
    dedicatedSecretCount:newKeys.length,existingProviderSecrets:existingKeys.length}));
}catch{
  console.error('Stopped at '+stage+'. Read back the exact secret state before retry; values were not printed.');
  process.exitCode=1;
}
