import {prompts} from './content.js';
import {respond,reusableQuestion} from './engine.js';
const get=id=>document.getElementById(id);
let mode='',context='',rules=null;
fetch('/assets/member-inquiry-guidance.json',{cache:'no-store',referrerPolicy:'no-referrer'})
  .then(r=>r.ok?r.json():null).then(v=>{if(Array.isArray(v?.rules)&&v?.sources)rules=v;}).catch(()=>{});
function link(label,href){
 const a=document.createElement('a');a.textContent=label;a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;
}
function append(result){
 const p=document.createElement('p');p.className='chat';p.textContent=result.text;
 if(result.source){p.append(document.createElement('br'),link('안내 원문',result.source));}
 if(result.memberLookup){
  p.append(document.createElement('br'),link('회원 앱에서 확인하는 방법','https://archivepilates.notion.site/studiomate'));
 }else if(result.memberApp){
  p.append(document.createElement('br'),link('스튜디오메이트 iPhone 설치','https://apps.apple.com/kr/app/id1400126585'),document.createTextNode(' · '),link('Android 설치','https://play.google.com/store/apps/details?hl=ko&id=kr.studiomate.user'));
 }
 if(Array.isArray(result.choices)){
  const row=document.createElement('span');row.className='quick';row.hidden=false;
  for(const choice of result.choices){const button=document.createElement('button');button.type='button';button.textContent=choice;button.onclick=()=>{row.remove();ask(choice);};row.append(button);}
  get('conversation').append(p,row);
 } else get('conversation').append(p);
 while(get('conversation').children.length>12)get('conversation').firstElementChild.remove();
 get('conversation').scrollTop=get('conversation').scrollHeight;
}
function ask(question){
 get('conversation').querySelectorAll('.quick').forEach(row=>row.remove());
 const result=respond(question,{mode,context,rules});
 context=result.context||'';append(result);return result;
}
function setMode(next){
 window.dispatchEvent(new CustomEvent('archive:help-mode'));
 mode=next;context='';get('query').value='';get('conversation').replaceChildren();
 const title=get('mode-title');title.textContent=mode==='member'?'회원 문의 안내':'처음 오신 분 안내';
 for(const button of document.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
 const panel=get('prompts');panel.replaceChildren(...prompts[mode].map(([label,question])=>{
  const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{context='';ask(question);};return b;
 }));
 get('question').hidden=false;title.focus();
 append({text:mode==='member'?'예약·홀딩·재등록 등 공통 기준을 안내해요. 개인 예약이나 잔여 횟수는 회원 앱에서 확인해 주세요.':'수강권 비교나 처음 듣는 수업이 궁금하신가요? 가능한 요일·시간과 주당 운동 횟수를 알려 주세요.'});
}
for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>{if(button.dataset.mode!==mode)setMode(button.dataset.mode);});
get('question').addEventListener('submit',e=>{e.preventDefault();const query=get('query');const q=query.value;query.value='';const result=ask(q);window.dispatchEvent(new CustomEvent('archive:help-question',{detail:!result.memberLookup&&reusableQuestion(q)?q:''}));query.focus();});
