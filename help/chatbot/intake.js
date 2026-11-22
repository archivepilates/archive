export const pendingKey='archive_help_pending_v1';
export const methods=Object.freeze(['카카오톡','문자','전화','상관없어요']);
export const categoryKeys=Object.freeze(['renewal','booking','holding','conversion','fixed','other']);
const requestKeyPattern=/^[a-f0-9]{48}$/;
export const receiptKeyPattern=/^mi_[a-f0-9]{32}$/;
export function active(q,answers){
 const matched=q.when&&answers[q.when[0]];
 return !q.when||(Array.isArray(matched)?matched.includes(q.when[1]):matched===q.when[1]);
}
export function refundDraft(schema){
 const questions=schema?.categories?.other?.questions;
 if(!questions?.find(q=>q.id==='topic')?.options?.includes('환불·양도 상담')||!questions?.find(q=>q.id==='reply')?.options?.includes('담당자 상담'))return null;
 return {category:'other',answers:{topic:'환불·양도 상담',reply:'담당자 상담'}};
}
export const phoneOk=phone=>typeof phone==='string'&&phone.length<=20&&/^[0-9+() -]+$/.test(phone)&&/^010\d{8}$/.test(phone.replace(/[() -]/g,'').replace(/^\+82/,'0'));
export function dateOk(type,value){
 if(type==='time')return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
 if(type==='month')return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
 if(type==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){const date=new Date(value+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().startsWith(value+'T');}
 return false;
}
export function cleanAnswers(category,raw){
 const cleaned={};
 for(const q of category.questions){
  if(!active(q,cleaned))continue;
  const value=raw[q.id];
  if(q.type){if(value){if(!dateOk(q.type,value))throw Error('날짜 또는 시간을 확인해 주세요.');cleaned[q.id]=value;}continue;}
  if(q.multiple&&Array.isArray(value)&&value.length&&value.every(v=>q.options.includes(v))&&new Set(value).size===value.length&&!(value.includes('상담 후 결정')&&value.length>1))cleaned[q.id]=[...value];
  else if(!q.multiple&&q.options.includes(value))cleaned[q.id]=value;
  else if(!q.optional)throw Error(q.label+' 선택지를 확인해 주세요.');
 }
 return cleaned;
}
export function payload(schema,draft,requestKey){
 const category=categoryKeys.includes(draft.category)&&schema?.categories?.[draft.category];
 if(!category||!requestKeyPattern.test(requestKey))throw Error('문의 유형을 확인해 주세요.');
 if(!schema.version||!schema.privacyVersion)throw Error('문의 양식 버전을 확인할 수 없어요.');
 const memberName=draft.memberName?.trim()??'',memberPhone=draft.memberPhone?.trim()??'',details=draft.details?.trim()??'';
 if(!memberName||memberName.length>40)throw Error('성함을 확인해 주세요.');
 if(!phoneOk(memberPhone))throw Error('휴대폰번호를 확인해 주세요.');
 if(details.length>200)throw Error('추가 내용은 200자까지 입력해 주세요.');
 if(!methods.includes(draft.contact))throw Error('답변 방법을 선택해 주세요.');
 if(draft.privacyConsent!==true)throw Error('개인정보 수집·이용에 동의해 주세요.');
 return {requestKey,category:draft.category,memberName,memberPhone,answers:cleanAnswers(category,draft.answers),details,contact:draft.contact,privacyConsent:true,privacyVersion:schema.privacyVersion,policyVersion:schema.version,website:draft.website??''};
}
export const opaqueKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,'0')).join('');
export function savedKey(storage){try{const value=storage.getItem(pendingKey);return requestKeyPattern.test(value)?value:null;}catch{return null;}}
export function saveKey(storage,key){try{storage.setItem(pendingKey,key);return storage.getItem(pendingKey)===key;}catch{return false;}}
export function forgetKey(storage){try{storage.removeItem(pendingKey);}catch{}}
export async function inquire(fetcher,body,{timeoutMs=15000}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const r=await fetcher('/api/inquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'same-origin',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});
  const v=await r.json();
  if(r.ok&&v.ok===true&&receiptKeyPattern.test(v.receiptId))return {status:'confirmed',receiptId:v.receiptId};
  if(r.status===409)return {status:'conflict'};
  if(!r.ok&&v.notAccepted===true&&body.action!=='lookup')return {status:'not-accepted'};
  return {status:'unknown'};
 }catch{return {status:'unknown'};}
 finally{clearTimeout(timer);}
}
