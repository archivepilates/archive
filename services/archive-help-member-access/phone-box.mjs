import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

const associated=(memberId,revision)=>Buffer.from('archive-help:contact:v1:5330:'+memberId+':'+revision);
const valid=(key,memberId,revision)=>Buffer.isBuffer(key)&&key.length===32
  &&typeof memberId==='string'&&/^[1-9]\d{0,15}$/u.test(memberId)&&/^[a-f0-9]{64}$/u.test(revision??'');

export function sealEnrollmentPhone({phone,memberId,revision,key}){
  if(!valid(key,memberId,revision)||typeof phone!=='string'||!/^010\d{8}$/u.test(phone))
    throw Error('Invalid binding contact');
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(associated(memberId,revision));
  const data=Buffer.concat([cipher.update(phone,'ascii'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
}

export function openEnrollmentPhone({phoneBox,memberId,revision,key}){
  if(!valid(key,memberId,revision)||typeof phoneBox!=='string'||!/^[A-Za-z0-9_-]{52}$/u.test(phoneBox))return null;
  try{
    const bytes=Buffer.from(phoneBox,'base64url');
    const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
    decipher.setAAD(associated(memberId,revision));
    decipher.setAuthTag(bytes.subarray(12,28));
    const phone=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('ascii');
    return /^010\d{8}$/u.test(phone)?phone:null;
  }catch{return null;}
}
