import {openEnrollmentPhone} from './phone-box.mjs';
import {timingSafeEqual} from 'node:crypto';
import {currentPassMemberKey} from './current-pass-snapshot.mjs';

const schema='archive_help_enrollment';
export function createPostgresEnrollmentLoaders({pool,key,memberKeySecret,pilotMemberKey}={}){
  if(typeof pool?.connect!=='function'||[key,memberKeySecret,pilotMemberKey].some(value=>!Buffer.isBuffer(value)||value.length!==32))
    throw Error('Private enrollment reader required');

  async function query(statement,params,signal){
    if(signal?.aborted)return null;
    let client,completed=false;
    try{
      client=await pool.connect();
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3s'");
      await client.query('SET LOCAL ROLE archive_help_member_auth_runtime');
      const {rows}=await client.query(statement,params);
      await client.query('COMMIT');
      completed=true;
      return signal?.aborted||rows.length!==1?null:rows[0].value;
    }catch{
      try{await client?.query('ROLLBACK');}catch{/* Discard this connection. */}
      throw Error('Enrollment reader unavailable');
    }finally{client?.release(!completed);}
  }
  return Object.freeze({
    loadEnrollment({referenceDigest,signal}){
      if(typeof referenceDigest!=='string'||!/^[a-f0-9]{64}$/u.test(referenceDigest))return null;
      return query('SELECT '+schema+'.read_enrollment($1::text) AS value',[referenceDigest],signal);
    },
    async loadCurrentBinding({studioId,memberId,needContact,signal}){
      if(studioId!=='5330'||typeof memberId!=='string'||!/^[1-9]\d{0,15}$/u.test(memberId))return null;
      if(!timingSafeEqual(Buffer.from(currentPassMemberKey(memberKeySecret,memberId),'hex'),pilotMemberKey))return null;
      const value=await query('SELECT '+schema+'.read_binding($1::text,$2::text) AS value',[studioId,memberId],signal);
      if(value?.studioId!==studioId||value.memberId!==memberId)return null;
      const {phoneBox,...binding}=value;
      if(needContact)binding.phone=openEnrollmentPhone({phoneBox,memberId,revision:binding.revision,key});
      return binding;
    }
  });
}
