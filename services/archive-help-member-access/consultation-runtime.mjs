import {timingSafeEqual} from 'node:crypto';
import {createMemberAccounts,ORIGIN} from './accounts.mjs';
import {readCloudConfig} from './cloud-config.mjs';
import {createConsultationOtp,createWebMemberConsultationOtp} from './consultation-otp.mjs';
import {createConsultationCardLookup,createConsultationMemberHandler} from './consultation-http.mjs';
import {createSupabaseCurrentPassLookup,createSupabasePassSessionIssuer,currentPassMemberKey} from './current-pass-snapshot.mjs';
import {assertMemberDatabasePools} from './hosted-runtime.mjs';
import {createPostgresAuthStore} from './postgres-auth-store.mjs';
import {createPostgresEnrollmentLoaders} from './postgres-enrollment-loader.mjs';
import {createMemberCodeSender} from './solapi-code.mjs';
import {createHostedSolapiTransport} from './solapi-http.mjs';

export function readConsultationConfig(env){
  const cfg=readCloudConfig(env);
  if(!cfg.enabled)return cfg;
  const pilotId=env.HELP_MEMBER_PILOT_ID;
  if(typeof pilotId!=='string'||!/^[1-9]\d{0,15}$/u.test(pilotId)
    ||!timingSafeEqual(cfg.pilotMemberKey,Buffer.from(currentPassMemberKey(cfg.memberKeySecret,pilotId),'hex')))
    throw Error('Private pilot identity not verified');
  return {...cfg,pilotId};
}

export async function createFirebaseConsultationRuntime({config,makePool,now=Date.now,origin=ORIGIN,memberWebOtp=false}){
  if(!config?.enabled)return {handle:createConsultationMemberHandler(),async close(){}};
  const pools={};
  const close=()=>Promise.allSettled(Object.values(pools).map(pool=>pool.end()));
  try{
    for(const [name,options] of Object.entries(config.pools))pools[name]=makePool(options);
    await assertMemberDatabasePools(pools);
    const {pilotId,contactKey,memberKeySecret,pilotMemberKey,otpSecret,provider}=config;
    const loaders=createPostgresEnrollmentLoaders({pool:pools.auth,key:contactKey,memberKeySecret,pilotMemberKey});
    const loadPilotBinding=({needContact,signal})=>loaders.loadCurrentBinding({studioId:'5330',memberId:pilotId,needContact,signal});
    if(!await loadPilotBinding({}))throw Error('Canonical pilot binding not ready');
    const sendCode=createMemberCodeSender({...provider,request:createHostedSolapiTransport(provider)});
    const store=createPostgresAuthStore({pool:pools.auth});
    const limits=createMemberAccounts({store,now});
    const web=memberWebOtp===true&&origin===ORIGIN;
    const createOtp=web?createWebMemberConsultationOtp:createConsultationOtp;
    const consultation=createOtp({store,loadPilotBinding,sendCode,secret:otpSecret,now});
    const issuer=createSupabasePassSessionIssuer({query:(...args)=>pools.issuer.query(...args),secret:memberKeySecret,now});
    const reader=createSupabaseCurrentPassLookup({query:(...args)=>pools.reader.query(...args),now});
    const lookup=createConsultationCardLookup({consultation,issuer,reader,now});
    return {handle:createConsultationMemberHandler({enabled:true,memberWebOtp:web,consultation,allowRequest:limits.allowRequest,
      lookup,stepSecret:otpSecret,origin}),close};
  }catch(error){await close();throw error;}
}
