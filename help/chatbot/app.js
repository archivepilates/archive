import { reusableQuestion } from './engine.js';
import {conversationTurn} from './conversation.js';
import {applyNaturalReply,publicNaturalPacket,requestNaturalReply,supportsNaturalChat} from './public-natural.js';

const staffChat='https://pf.kakao.com/_KxdDWxj/chat';

const get=id=>document.getElementById(id);
const stream=get('conversation'), input=get('query'), prompts=get('prompts');
const sendButton=get('chat-send'), basicSend=get('chat-basic-send');
const shell=stream.closest('.help'), viewport=window.visualViewport;
const atLatest=()=>stream.scrollHeight-stream.clientHeight-stream.scrollTop<=32;
let viewportFrame=0, followOnFocus=false;
let state={},rules=null,lastChoices,pendingAi=null;
let naturalEnabled=false,naturalHistory=[];
void supportsNaturalChat().then(enabled=>{
  if(!enabled)return;
  get('chat-gpt-notice').hidden=false;
  get('chat-gpt-label').hidden=false;
  basicSend.hidden=false;
  sendButton.setAttribute('aria-label','GPT로 보내기');
  sendButton.title='GPT로 보내기';
  naturalEnabled=enabled;
});
fetch('/assets/member-inquiry-guidance.json',{cache:'no-store',referrerPolicy:'no-referrer'})
  .then(r=>r.ok?r.json():null).then(v=>{if(Array.isArray(v?.rules)&&v?.sources)rules=v;}).catch(()=>{});

function syncChatViewport(){
  if(viewportFrame)return;
  viewportFrame=requestAnimationFrame(()=>{
    viewportFrame=0;
    const follow=followOnFocus||atLatest(), zoomed=viewport?.scale>1.01;
    followOnFocus=false;
    // Mobile keyboards can move and shrink the visual viewport without resizing the page.
    const fitsKeyboard=viewport&&!zoomed&&document.activeElement===input&&innerHeight-viewport.height>80;
    if(fitsKeyboard){
      shell.style.setProperty('--chat-viewport-height',viewport.height+'px');
      shell.style.setProperty('--chat-viewport-top',viewport.offsetTop+'px');
    }else{
      shell.style.removeProperty('--chat-viewport-height');
      shell.style.removeProperty('--chat-viewport-top');
    }
    shell.classList.toggle('keyboard-open',Boolean(fitsKeyboard));
    if(follow&&!zoomed)stream.scrollTop=stream.scrollHeight;
  });
}
input.addEventListener('focus',()=>{followOnFocus=true;syncChatViewport();});
input.addEventListener('blur',syncChatViewport);
viewport?.addEventListener('resize',syncChatViewport);
viewport?.addEventListener('scroll',syncChatViewport);

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
function showTimetable(data){
  const panel=element('section',null,'timetable');
  panel.setAttribute('aria-label',data.title);
  const title=element('h2',data.title), period=element('p',data.period,'schedule-period');
  const days=element('div',null,'timetable-days');
  days.setAttribute('role','group');days.setAttribute('aria-label','요일별 수업');
  const list=element('ul',null,'schedule-slots');
  list.setAttribute('aria-live','polite');
  function select(day){
    for(const control of days.children)control.setAttribute('aria-pressed',String(control.dataset.day===day));
    list.setAttribute('aria-label',day+'요일 예정 수업');
    list.replaceChildren(...data.byDay[day].map(([start,staff])=>{
      const item=element('li'), time=element('time',start);
      time.dateTime=start;item.append(time,element('span',staff));return item;
    }));
  }
  for(const day of Object.keys(data.byDay)){
    const control=button(day,()=>select(day));
    control.dataset.day=day;control.setAttribute('aria-label',day+'요일');days.append(control);
  }
  const original=element('details',null,'timetable-original');
  original.append(element('summary','시간표 원본 이미지'),link('공식 게시물',data.source));
  original.addEventListener('toggle',()=>{
    if(!original.open||original.querySelector('img'))return;
    const img=element('img');
    img.alt='2026년 11월 명지점 공식 시간표 이미지. 위의 요일별 목록에서 시간과 강사를 읽을 수 있어요.';
    img.width=data.image.width;img.height=data.image.height;img.src=data.image.src;
    original.querySelector('summary').after(img);
  });
  panel.append(title,period,days,list,original);select(data.selectedDay);return panel;
}
function append(role,result,follow=true){
  const row=element('article',null,'turn '+role);
  const body=element('div',null,'turn-body');
  if(role==='assistant'){
    const logo=element('img',null,'avatar');logo.src='/favicon.png';logo.alt='';logo.width=24;logo.height=24;row.append(logo);
  }
  body.append(element('span',role==='user'?'나':result.aiAssisted?'명지점 상담 · AI 답변':result.officialOnly?'명지점 상담 · 공식 안내':result.aiUnavailable?'명지점 상담 · 기본 안내':'명지점 상담','speaker'));
  if(result.welcome){
    const greeting=element('div',null,'welcome-turn');
    const drawing=greetingArt();
    const text=element('div',null,'welcome-copy');
    text.append(element('h2','오늘은 무엇을 도와드릴까요?'),element('p',result.text));
    greeting.append(text,drawing);
    body.append(greeting);
  }else body.append(element('p',result.aiUnavailable?'GPT 답변을 지금 받을 수 없어 기본 안내로 답해요.\n\n'+result.text:result.text,'bubble'));
  if(result.timetable){row.classList.add('has-timetable');body.append(showTimetable(result.timetable));}
  const links=element('div',null,'chat-actions');
  if(result.source&&!result.timetable)links.append(link(result.sourceLabel??'안내 원문',result.source));
  if(result.appGuide)links.append(link(result.memberLookup?'회원 앱에서 확인하는 방법':'공식 앱 이용 안내',result.appGuide));
  if(result.inquiry)links.append(link(result.inquiry==='refund'?'카카오톡으로 환불 문의':'카카오톡으로 직원 문의',staffChat));
  if(links.children.length)body.append(links);
  if(result.choices?.length){
    lastChoices=element('div',null,'quick follow-up');
    for(const choice of result.choices)lastChoices.append(button(choice,()=>ask(choice)));
    body.append(lastChoices);
  }
  row.append(body);stream.append(row);
  while(stream.children.length>40)stream.firstElementChild.remove();
  if(follow){
    if(result.timetable&&row.offsetHeight>stream.clientHeight)stream.scrollTop+=row.getBoundingClientRect().top-stream.getBoundingClientRect().top-10;
    else stream.scrollTop=stream.scrollHeight;
  }
}
function greetingArt(){
  const ns='http://www.w3.org/2000/svg';
  const art=document.createElementNS(ns,'svg'), symbol=document.createElementNS(ns,'use');
  art.setAttribute('class','welcome-art');
  art.setAttribute('viewBox','0 0 24 24');
  art.setAttribute('width','24');
  art.setAttribute('height','24');
  art.setAttribute('aria-hidden','true');
  art.setAttribute('focusable','false');
  symbol.setAttribute('href','/assets/chat-icons.svg#message-circle');
  art.append(symbol);
  return art;
}
function clearChoices(){lastChoices?.remove();lastChoices=null;}
function finishTurn(q,result,focusInput,userShown=false,follow=true){
  state=result.state;
  clearChoices();
  if(!userShown&&reusableQuestion(q)&&!result.hideInput)append('user',{text:q});
  append('assistant',result,follow);
  if(focusInput)input.focus({preventScroll:true});
}
function basicReply(q){return conversationTurn(q,state,{rules});}
function finishPending(){
  if(!pendingAi)return;
  const previous=pendingAi;pendingAi=null;
  previous.controller.abort();
  previous.loading.remove();
  finishTurn(previous.q,basicReply(previous.q),false,true);
}
function ask(question,{focusInput=true,useAi=false}={}){
  const q=question.trim();
  if(!q)return;
  finishPending();
  const packet=publicNaturalPacket(q,naturalHistory);
  const natural=useAi&&naturalEnabled?packet:null;
  if(!natural){
    naturalHistory=[];
    const reply=basicReply(q);
    finishTurn(q,!packet?{...reply,hideInput:true}:reply,focusInput);return;
  }
  clearChoices();
  append('user',{text:q});
  const loading=element('p','답변을 작성하고 있어요.','chat-pending');
  loading.setAttribute('role','status');stream.append(loading);stream.scrollTop=stream.scrollHeight;
  const request={q,controller:new AbortController(),loading};
  pendingAi=request;
  if(focusInput)input.focus({preventScroll:true});
  void requestNaturalReply(natural,request.controller).then(answer=>{
    if(pendingAi!==request)return;
    const follow=atLatest();
    pendingAi=null;loading.remove();
    if(answer){
      naturalHistory=[...natural.history,{role:'user',text:natural.question},
        {role:'assistant',text:answer.answer.normalize('NFKC')}].slice(-4);
    }
    const reply=answer?applyNaturalReply(state,answer):{...basicReply(q),aiUnavailable:true};
    finishTurn(q,reply,false,true,follow);
  });
}
function welcome(){
  pendingAi?.controller.abort();pendingAi=null;
  state={};naturalHistory=[];clearChoices();input.value='';prompts.scrollLeft=0;stream.replaceChildren();
  append('assistant',{welcome:true,text:'안녕하세요! ARCHIVE PILATES 명지점이에요.'});
}
for(const btn of prompts.querySelectorAll('[data-question]')){
  btn.addEventListener('click',()=>ask(btn.dataset.question,{focusInput:false}));
}
get('question').addEventListener('submit',e=>{
  e.preventDefault();const q=input.value;input.value='';
  ask(q,{useAi:e.submitter!==basicSend});
});
get('reset-chat').addEventListener('click',()=>{welcome();input.focus({preventScroll:true});});
welcome();
