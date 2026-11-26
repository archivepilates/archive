import {timingSafeEqual} from 'node:crypto';
import {createMemberAccounts,ORIGIN} from './accounts.mjs';
import {readCloudConfig} from './cloud-config.mjs';
import {createConsultationOtp,createWebMemberConsultationOtp,createWebRosterConsultationOtp} from './consultation-otp.mjs';
import {createConsultationCardLookup,createConsultationMemberHandler} from './consultation-http.mjs';
import {createSupabaseCurrentPassLookup,createSupabasePassSessionIssuer,currentPassMemberKey} from './current-pass-snapshot.mjs';
import {assertMemberDatabasePools} from './hosted-runtime.mjs';
import {createPostgresAuthStore} from './postgres-auth-store.mjs';
import {createPostgresEnrollmentLoaders} from './postgres-enrollment-loader.mjs';
import {createMemberCodeSender} from './solapi-code.mjs';
import {createHostedSolapiTransport} from './solapi-http.mjs';
import {createHelpRosterBindingLoader,scopeHelpRosterBinding} from './help-roster-binding.mjs';

export function readConsultationConfig(env){
  const cfg=readCloudConfig(env);
  if(!cfg.enabled)return cfg;
  const pilotId=env.HELP_MEMBER_PILOT_ID;
  const pilotMemberKey=cfg.roster&&/^[a-f0-9]{64}$/u.test(env.HELP_MEMBER_PILOT_KEY??'')?
    Buffer.from(env.HELP_MEMBER_PILOT_KEY,'hex'):cfg.pilotMemberKey;
  if(typeof pilotId!=='string'||!/^[1-9]\d{0,15}$/u.test(pilotId)
    ||!pilotMemberKey||!timingSafeEqual(pilotMemberKey,Buffer.from(currentPassMemberKey(cfg.memberKeySecret,pilotId),'hex')))
    throw Error('Private pilot identity not verified');
  const canaryAllowance=cfg.roster&&!cfg.rosterPublic?{
    from:Date.parse(env.HELP_MEMBER_CANARY_EXTRA_FROM??''),until:Date.parse(env.HELP_MEMBER_CANARY_EXTRA_UNTIL??'')
  }:undefined;
  const secondSubject=cfg.roster?env.HELP_MEMBER_CANARY_SECOND_KEY:undefined;
  if(secondSubject!==undefined&&(!/^[a-f0-9]{64}$/u.test(secondSubject)||secondSubject===pilotMemberKey.toString('hex')))
    throw Error('Private secondary canary identity not verified');
  return {...cfg,pilotId,pilotMemberKey,secondSubject,...(canaryAllowance?{canaryAllowance}:{})};
}

export async function createFirebaseConsultationRuntime({config,makePool,now=Date.now,origin=ORIGIN,memberWebOtp=false}){
  if(!config?.enabled)return {handle:createConsultationMemberHandler(),async close(){}};
  const pools={};
  const close=()=>Promise.allSettled(Object.values(pools).map(pool=>pool.end()));
  try{
    for(const [name,options] of Object.entries(config.pools))pools[name]=makePool(options);
    await assertMemberDatabasePools(pools);
    const {pilotId,contactKey,memberKeySecret,pilotMemberKey,otpSecret,provider,roster=false}=config;
    const web=memberWebOtp===true&&origin===ORIGIN;
    if(roster&&!web)throw Error('Roster is restricted to member Help web service');
    let bindingOptions;
    if(roster)bindingOptions={loadRosterBinding:scopeHelpRosterBinding(
      createHelpRosterBindingLoader({pool:pools.auth,contactKey}),
      {publicRoster:config.rosterPublic===true,pilotSubject:pilotMemberKey.toString('hex'),secondSubject:config.secondSubject}),
      canaryAllowance:config.rosterPublic===true?undefined:config.canaryAllowance,
      previousPilot:{nativeId:pilotId,subject:pilotMemberKey.toString('hex')}};
    else{
      const loaders=createPostgresEnrollmentLoaders({pool:pools.auth,key:contactKey,memberKeySecret,pilotMemberKey});
      const loadPilotBinding=({needContact,signal})=>loaders.loadCurrentBinding({studioId:'5330',memberId:pilotId,needContact,signal});
      if(!await loadPilotBinding({}))throw Error('Canonical pilot binding not ready');
      bindingOptions={loadPilotBinding};
    }
    const sendCode=createMemberCodeSender({...provider,request:createHostedSolapiTransport(provider)});
    const store=createPostgresAuthStore({pool:pools.auth});
    const limits=createMemberAccounts({store,now});
    const createOtp=roster?createWebRosterConsultationOtp:web?createWebMemberConsultationOtp:createConsultationOtp;
    const consultation=createOtp({store,...bindingOptions,sendCode,secret:otpSecret,now});
    const issuer=createSupabasePassSessionIssuer({query:(...args)=>pools.issuer.query(...args),secret:memberKeySecret,now,roster});
    const reader=createSupabaseCurrentPassLookup({query:(...args)=>pools.reader.query(...args),now,roster});
    const lookup=createConsultationCardLookup({consultation,issuer,reader,now,...(roster?{sourceTtl:60*60_000}:{})});
    return {handle:createConsultationMemberHandler({enabled:true,memberWebOtp:web,publicRoster:roster&&config.rosterPublic===true,
      consultation,allowRequest:limits.allowRequest,
      lookup,stepSecret:otpSecret,origin}),close};
  }catch(error){await close();throw error;}
}
