import {defineSecret} from 'firebase-functions/params';
import {onRequest} from 'firebase-functions/v2/https';
import pg from 'pg';
import {createFirebaseConsultationRuntime,readConsultationConfig} from './consultation-runtime.mjs';
import {createFirebaseMemberBridge} from './firebase-bridge.mjs';
import {createConsultationMemberHandler} from './consultation-http.mjs';

const secretNames=['HELP_MEMBER_POSTGRES','HELP_MEMBER_CONTACT_KEY','HELP_MEMBER_SNAPSHOT_KEY','HELP_MEMBER_OTP_KEY',
  'HELP_MEMBER_PILOT_KEY','HELP_MEMBER_PILOT_ID','HELP_MEMBER_SOLAPI_TEMPLATE','SOLAPI_API_KEY','SOLAPI_API_SECRET','SOLAPI_PFID'];
const secrets=secretNames.map(name=>defineSecret(name));
const disabled=createConsultationMemberHandler();
let service;

function getHandler(){
  if(process.env.HELP_MEMBER_MODE!=='pilot')return disabled;
  // Do not reuse a failed initialization. None of the credentials or request data is logged.
  service??=createFirebaseConsultationRuntime({config:readConsultationConfig(process.env),memberWebOtp:true,makePool:options=>{
    const pool=new pg.Pool(options);
    pool.on('error',()=>console.error('Help OTP database connection unavailable'));
    return pool;
  }}).catch(error=>{service=undefined;throw error;});
  return service.then(result=>result.handle);
}

// This runtime is not part of the default or secret-free probe deployment.
export const helpMemberConsultation=onRequest({
  region:'asia-northeast3',serviceAccount:'archive-help-member@archive-pilates.iam.gserviceaccount.com',
  invoker:'private',timeoutSeconds:50,concurrency:8,minInstances:0,maxInstances:2,memory:'256MiB',cors:false,secrets
},createFirebaseMemberBridge({getHandler}));
