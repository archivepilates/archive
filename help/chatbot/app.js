import { reusableQuestion } from './engine.js';
import { conversationTurn } from './conversation.js';

const get=id=>document.getElementById(id);
const stream=get('conversation'), input=get('query'), prompts=get('prompts');
let state={},rules=null,lastChoices;
fetch('/assets/member-inquiry-guidance.json',{cache:'no-store',referrerPolicy:'no-referrer'})
  .then(r=>r.ok?r.json():null).then(v=>{if(Array.isArray(v?.rules)&&v?.sources)rules=v;}).catch(()=>{});

function element(tag,text,className){
  const node=document.createElement(tag);
  if(text)node.textContent=text;
  if(className)node.className=className;
  return node;
}
function link(label,href){
  const a=element('a',label);
  a.href=href;
  if(href.startsWith('https:')){a.target='_blank';a.rel='noopener noreferrer';}
  return a;
}
function button(label,action){
  const btn=element('button',label);btn.type='button';btn.addEventListener('click',action);return btn;
}
function append(role,result){
  const row=element('article',null,'turn '+role);
  const body=element('div',null,'turn-body');
  if(role==='assistant'){
    const logo=element('img',null,'avatar');logo.src='/favicon.png';logo.alt='';logo.width=24;logo.height=24;row.append(logo);
  }
  body.append(element('span',role==='user'?'나':'명지점 상담','speaker'),element('p',result.text,'bubble'));
  const links=element('div',null,'chat-actions');
  if(result.source)links.append(link(result.sourceLabel??'안내 원문',result.source));
  if(result.appGuide)links.append(link(result.memberLookup?'회원 앱에서 확인하는 방법':'공식 앱 이용 안내',result.appGuide));
  if(result.inquiry)links.append(button(result.inquiry==='refund'?'직원에게 환불 문의':'직원에게 문의',event=>{
    window.dispatchEvent(new CustomEvent('archive:help-open-intake',{detail:{trigger:event.currentTarget,refund:result.inquiry==='refund'}}));
  }));
  if(links.children.length)body.append(links);
  if(result.choices?.length){
    lastChoices=element('div',null,'quick follow-up');
    for(const choice of result.choices)lastChoices.append(button(choice,()=>ask(choice)));
    body.append(lastChoices);
  }
  row.append(body);stream.append(row);
  while(stream.children.length>40)stream.firstElementChild.remove();
  stream.scrollTop=stream.scrollHeight;
}
function clearChoices(){lastChoices?.remove();lastChoices=null;}
function ask(question){
  const q=question.trim();
  if(!q)return;
  const result=conversationTurn(q,state,{rules});
  state=result.state;
  clearChoices();
  if(reusableQuestion(q)&&!result.hideInput)append('user',{text:q});
  append('assistant',result);
  prompts.hidden=true;
  window.dispatchEvent(new CustomEvent('archive:help-question',{detail:!result.memberLookup&&!result.hideInput&&reusableQuestion(q)?q:''}));
  input.focus({preventScroll:true});
}
function welcome(){
  state={};clearChoices();input.value='';stream.replaceChildren();prompts.hidden=false;
  window.dispatchEvent(new Event('archive:help-mode'));
  append('assistant',{text:'안녕하세요! ARCHIVE PILATES 명지점이에요. 수업 시간이나 수강료, 예약·홀딩 규정 중 궁금한 게 있으세요?'});
}
for(const btn of prompts.querySelectorAll('button'))btn.addEventListener('click',()=>{input.value='';ask(btn.dataset.question);});
get('question').addEventListener('submit',e=>{e.preventDefault();const q=input.value;input.value='';ask(q);});
get('reset-chat').addEventListener('click',()=>{welcome();input.focus({preventScroll:true});});
welcome();
