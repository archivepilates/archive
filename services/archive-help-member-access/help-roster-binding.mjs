import {createHmac} from 'node:crypto';

const phoneFormat=/^010[0-9]{8}$/u;
const keyFormat=/^[a-f0-9]{64}$/u;
const authRole='archive_help_member_auth_runtime';

export function rosterPhoneKey(key,phone){
  if(!Buffer.isBuffer(key)||key.length!==32||!phoneFormat.test(phone??''))throw Error('Invalid contact key input');
  return createHmac('sha256',key).update('archive-help-roster-phone:v1:5330:'+phone).digest('hex');
}

export function scopeHelpRosterBinding(load,{publicRoster,pilotSubject,secondSubject}={}){
  if(typeof load!=='function'||!keyFormat.test(pilotSubject??'')
    ||secondSubject!==undefined&&(!keyFormat.test(secondSubject)||secondSubject===pilotSubject))
    throw Error('Explicit canary subjects are required');
  return async input=>{
    const binding=await load(input);
    if(!keyFormat.test(binding?.memberId??''))return null;
    return publicRoster===true||binding.memberId===pilotSubject||binding.memberId===secondSubject?binding:null;
  };
}

export function createHelpRosterBindingLoader({pool,contactKey}={}){
  if(typeof pool?.connect!=='function'||!Buffer.isBuffer(contactKey)||contactKey.length!==32)
    throw Error('Dedicated roster authorizer required');

  return async ({phone,memberId,needContact,signal}={})=>{
    if(signal?.aborted||needContact===true&&!phoneFormat.test(phone??'')
      ||needContact!==true&&!keyFormat.test(memberId??''))return null;
    const query=needContact===true?'find_binding':'read_binding';
    const input=needContact===true?rosterPhoneKey(contactKey,phone):memberId;
    let client,committed=false;
    try{
      client=await pool.connect();
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3s'");
      await client.query('SET LOCAL ROLE '+authRole);
      const {rows}=await client.query('SELECT archive_help_roster.'+query+'($1::text) AS value',[input]);
      await client.query('COMMIT');
      committed=true;
      const value=rows?.length===1?rows[0].value:null;
      if(signal?.aborted||!keyFormat.test(value?.subject??'')||!keyFormat.test(value?.revision??'')
        ||!Number.isSafeInteger(value.observedAt)||!needContact&&value.subject!==memberId)return null;
      return {authority:'verified_studiomate_in_person_signup',studioId:'5330',memberId:value.subject,
        revision:value.revision,sourceObservedAt:value.observedAt,registeredContactVerified:true,
        active:true,revoked:false,signupComplete:true,...(needContact?{phone}:{})};
    }catch{
      try{await client?.query('ROLLBACK');}catch{/* Discard incomplete clients. */}
      return null;
    }finally{client?.release(!committed);}
  };
}
