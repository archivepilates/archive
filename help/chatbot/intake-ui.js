import {active,categoryKeys,cleanAnswers,dateOk,phoneOk,methods,payload,opaqueKey,savedKey,saveKey,forgetKey,inquire,refundDraft} from './intake.js';
const el=id=>document.getElementById(id),box=el('intake'), choices=el('intake-choices'), prompt=el('intake-prompt'), status=el('intake-status');
const back=el('intake-back'),cancel=el('intake-cancel');
const storage={getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)};
let schema,mode='category',draft,questionId=null,lastQuery='',answerHistory=[],pending=null,key=savedKey(storage),busy=false,conflict=false,lastButton=null;
const schemaReady=fetch('/assets/inquiry-schema.json',{cache:'no-store',referrerPolicy:'no-referrer'}).then(r=>r.ok?r.json():null).catch(()=>null);
window.addEventListener('archive:help-question',e=>{lastQuery=typeof e.detail==='string'?e.detail.slice(0,160):'';});
window.addEventListener('archive:help-mode',()=>{lastQuery='';});
const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
function btn(text,action){const b=node('button',text);b.type='button';b.addEventListener('click',action);return b;}
function clear(next){mode=next;choices.replaceChildren();status.textContent='';back.hidden=!['question','details','contact','review'].includes(next)||!!key;cancel.hidden=!!key||busy;}
function form(next){const f=node('form');f.addEventListener('submit',e=>{e.preventDefault();next(f);});choices.append(f);return f;}
function proceedLabel(f,label='다음'){const b=node('button',label);b.type='submit';f.append(b);return b;}
function field(f,label,tag='input',props={}){
 const l=node('label',label),v=node(tag);
 for(const [attr,p] of Object.entries(props))v[attr]=p;
 l.append(v);f.append(l);return v;
}
function opened(){box.hidden=false;el('intake-title').focus();}
function emptyDraft(){return {category:'',answers:{},details:'',memberName:'',memberPhone:'',contact:'',privacyConsent:false,website:''};}
function category(){
 clear('category');prompt.textContent='어떤 문의를 접수할까요?';
 for(const id of categoryKeys){if(schema.categories[id])choices.append(btn(schema.categories[id].title,()=>{
  draft={...emptyDraft(),category:id};
  answerHistory=[];question(0);
 }));}
}
function question(start){
 clear('question');const qs=schema.categories[draft.category].questions;
 const index=qs.findIndex((q,i)=>i>=start&&active(q,draft.answers));
 if(index<0){details();return;}
 const q=qs[index];questionId=index;prompt.textContent=q.label+(q.optional?' · 선택':'');
 const next=val=>{if(val===undefined||val===''||Array.isArray(val)&&!val.length)delete draft.answers[q.id];else draft.answers[q.id]=val;
  for(const child of qs.slice(index+1))if(!active(child,draft.answers))delete draft.answers[child.id];
  if(answerHistory.at(-1)!==index)answerHistory.push(index);question(index+1);
 };
 if(q.type){
  const f=form(()=>{if(input.value&&!dateOk(q.type,input.value)){status.textContent='날짜 또는 시간을 확인해 주세요.';return;}next(input.value);});
  const input=field(f,q.label,'input',{type:q.type,required:!q.optional,value:draft.answers[q.id]??''});proceedLabel(f);
 }else if(q.multiple){
  const f=form(()=>{
   const selected=inputs.filter(x=>x.checked).map(x=>x.value);if(!selected.length&&!q.optional){status.textContent='하나 이상 선택해 주세요.';return;}next(selected);
  });const inputs=[];
  for(const option of q.options){
   const input=field(f,option,'input',{type:'checkbox',value:option,checked:(draft.answers[q.id]??[]).includes(option)});inputs.push(input);
   input.addEventListener('change',()=>{if(input.checked)for(const other of inputs)if(other!==input&&(option==='상담 후 결정'||other.value==='상담 후 결정'))other.checked=false;});
  }proceedLabel(f);
 }else for(const option of q.options)choices.append(btn(option,()=>next(option)));
 if(q.optional)choices.append(btn('건너뛰기',()=>next(undefined)));
}
function details(){
 clear('details');prompt.textContent='직원에게 더 전할 내용이 있나요? (선택)';
 const f=form(()=>{draft.details=input.value;contact();});
 const input=field(f,'추가 내용','textarea',{value:draft.details,maxLength:200,rows:3});
 if(lastQuery&&!draft.details)f.append(btn('방금 질문 넣기 (직접 확인)',()=>{input.value=lastQuery.slice(0,160);input.focus();}));
 f.append(node('p','주민등록번호, 건강 정보, 민감한 증빙은 입력하지 마세요. 필요하면 담당자가 별도로 안내해요.'));proceedLabel(f);
}
function contact(){
 clear('contact');prompt.textContent='직원이 문의를 확인하고 답변할 수 있도록 성함과 연락처를 알려 주세요.';
 const f=form(()=>{
  if(!name.value.trim()||!phoneOk(phone.value.trim())){status.textContent='성함이나 휴대폰번호를 확인해 주세요.';return;}
  if(!method.value){status.textContent='답변 방법을 선택해 주세요.';return;}
  draft={...draft,memberName:name.value.trim(),memberPhone:phone.value.trim(),contact:method.value,privacyConsent:agree.checked,website:website.value};
  review();
 });
 const name=field(f,'성함','input',{required:true,maxLength:40,value:draft.memberName,autocomplete:'name'});
 const phone=field(f,'연락처','input',{required:true,type:'tel',inputMode:'tel',maxLength:20,value:draft.memberPhone,autocomplete:'tel'});
 const method=field(f,'답변 방법','select',{required:true});
 for(const value of ['',...methods]){const o=node('option',value||'선택해 주세요');o.value=value;method.append(o);}method.value=draft.contact;
 const consent=node('p');const link=node('a','개인정보 수집·이용 안내');link.href='/privacy.html';link.target='_blank';link.rel='noopener noreferrer';consent.append(link);f.append(consent);
 const agree=field(f,'개인정보 수집·이용에 동의합니다 (필수)','input',{type:'checkbox',required:true,checked:draft.privacyConsent});
 const trap=node('div');trap.className='intake-trap';trap.setAttribute('aria-hidden','true');f.append(trap);
 const website=field(trap,'Website','input',{type:'text',tabIndex:-1,autocomplete:'off'});proceedLabel(f,'내용 확인');
}
function review(){
 clear('review');prompt.textContent='이 내용으로 직원에게 문의를 접수할까요?';
 const c=schema.categories[draft.category],answers=cleanAnswers(c,draft.answers);
 const list=node('dl');function row(label,value){list.append(node('dt',label),node('dd',value));}
 row('문의 유형',c.title);for(const q of c.questions)if(answers[q.id])row(q.label,[answers[q.id]].flat().join(', '));
 if(draft.details.trim())row('추가 내용',draft.details.trim());
 row('성함',draft.memberName);row('연락처',draft.memberPhone);row('답변 방법',draft.contact);choices.append(list);
 choices.append(node('p','접수만으로 예약·수강권이 바뀌지는 않아요. 직원이 확인 후 안내드려요.'));
 choices.append(btn('확인하고 접수하기',submit));
}
async function submit(){
 if(busy||key)return;
 const existing=savedKey(storage);if(existing){key=existing;await send({action:'lookup',requestKey:key});return;}
 try{
  const nextKey=opaqueKey(), body=payload(schema,draft,nextKey);
  if(!saveKey(storage,nextKey)){status.textContent='접수번호를 안전하게 보관할 수 없어 보내지 않았어요. 기존 문의 양식을 이용해 주세요.';return;}
  key=nextKey;pending=body;await send(body);
 }catch(error){status.textContent=error.message;}
}
async function send(body){
 if(busy||conflict)return;busy=true;clear('pending');prompt.textContent='접수 결과를 확인하는 중이에요.';
 const result=await inquire(fetch,body);busy=false;
 if(result.status==='confirmed'){confirmed(result.receiptId);return;}
 if(result.status==='not-accepted'&&pending){forgetKey(storage);key=null;pending=null;review();status.textContent='접수되지 않았어요. 내용을 확인한 후 다시 시도할 수 있어요.';return;}
 conflict=result.status==='conflict';recovery();
}
function recovery(){
 clear('pending');prompt.textContent=conflict?'접수 정보를 확인할 수 없어요.':'접수 결과가 아직 확인되지 않았어요.';
 if(conflict){status.textContent='중복 접수를 막기 위해 다시 보내지 않았어요. 센터에 연락해 결과를 확인해 주세요.';return;}
 status.textContent='새 문의로 다시 접수하지 말고, 같은 요청의 결과를 확인해 주세요.';
 choices.append(btn('접수 결과 확인',()=>send({action:'lookup',requestKey:key})));
 if(pending)choices.append(btn('같은 문의로 다시 확인',()=>send(pending)));
}
function confirmed(receiptId){
 forgetKey(storage);key=null;pending=null;draft=null;lastQuery='';clear('confirmed');prompt.textContent='문의가 접수됐어요.';
 choices.append(node('p','접수번호: '+receiptId));status.textContent='담당자 확인 대기 중이에요. 접수만으로 예약·수강권이 바뀌지는 않아요.';
 choices.append(btn('다른 문의하기',start));
}
async function start(event,{refund=false}={}){
 lastButton=event?.currentTarget??lastButton;opened();
 if(key){if(!busy)recovery();return;}
 // The old form and this screen share the same opaque recovery record.
 key=savedKey(storage);
 if(key){await send({action:'lookup',requestKey:key});return;}
 schema=await schemaReady;
 if(!schema?.categories||!schema.version||!schema.privacyVersion){clear('unavailable');prompt.textContent='문의 화면을 불러오지 못했어요. 기존 문의 양식을 이용해 주세요.';return;}
 if(refund){
  const prefill=refundDraft(schema);
  if(prefill){
   draft={...emptyDraft(),...prefill};
   answerHistory=schema.categories.other.questions.map((_,i)=>i);
   details();
   status.textContent='선택한 문의: 환불 상담. 접수 전에 내용을 확인할 수 있어요.';
   return;
  }
 }
 category();
}
el('refund-intake').addEventListener('click',event=>start(event,{refund:true}));
window.addEventListener('archive:help-open-intake',event=>{
 const trigger=event.detail?.trigger;
 if(trigger instanceof HTMLButtonElement)void start({currentTarget:trigger},{refund:event.detail.refund===true});
});
for(const id of ['start-intake','inline-intake'])el(id).addEventListener('click',start);
cancel.addEventListener('click',()=>{if(key||busy)return;box.hidden=true;draft=null;lastButton?.focus();});
back.addEventListener('click',()=>{
 if(key||busy)return;
 if(mode==='review')contact();
 else if(mode==='contact')details();
 else if(mode==='details'){const p=answerHistory.pop();if(p===undefined)category();else question(p);}
 else if(mode==='question'){if(answerHistory.at(-1)===questionId)answerHistory.pop();const p=answerHistory.pop();if(p===undefined)category();else question(p);}
});
if(key){opened();schemaReady.then(s=>{schema=s;});send({action:'lookup',requestKey:key});}

window.addEventListener('pageshow',event=>{if(event.persisted&&savedKey(storage)!==key)window.location.reload();});
