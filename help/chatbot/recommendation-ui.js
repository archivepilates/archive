import {bookingGuide,recommendClasses} from './recommendation.js';

const dialog=document.querySelector('#class-recommendation');
const open=document.querySelector('#start-recommendation');
const close=dialog.querySelector('[data-close-recommendation]');
const form=dialog.querySelector('form');
const results=dialog.querySelector('[data-recommendation-results]');
const heading=dialog.querySelector('[data-results-heading]');
const list=results.querySelector('ol');
const note=results.querySelector('[data-recommendation-note]');
const advice=results.querySelector('[data-recommendation-advice]');
const source=results.querySelector('[data-recommendation-source]');

function switchView(showResults){
  form.hidden=showResults;
  results.hidden=!showResults;
}

open.addEventListener('click',()=>{
  if(dialog.open)return;
  switchView(false);
  dialog.showModal();
  dialog.scrollTop=0;
});
close.addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{
  form.reset();
  list.replaceChildren();
  open.focus({preventScroll:true});
});

function node(tag,text){
  const el=document.createElement(tag);
  el.textContent=text;
  return el;
}

form.addEventListener('submit',event=>{
  event.preventDefault();
  const result=recommendClasses(Object.fromEntries(new FormData(form)));
  if(!result)return;
  list.replaceChildren(...result.classes.map(item=>{
    const row=document.createElement('li');
    const title=node('h4',item.label);
    const detail=node('p',item.staff+' 강사 · '+item.reason);
    row.append(title,detail);
    return row;
  }));
  note.textContent=result.classes.length
    ?result.basis+' 기준 예정 수업이에요. '+(result.classes.length===1?'조건에 맞는 후보가 1개 있어요. ':'')
      +'수업 주제·강도와 남은 자리는 회원 앱에서 확인해 주세요.'
    :result.basis?'공개 시간표에서 조건에 맞는 남은 일정을 찾지 못했어요. 회원 앱에서 다음 일정을 확인해 주세요.'
      :'최신 공개 시간표가 확인되지 않아 날짜와 시간을 추천하지 않았어요. 회원 앱에서 일정을 확인해 주세요.';
  advice.textContent=result.advice.join(' ');
  source.hidden=!result.source;
  if(result.source)source.href=result.source;
  results.querySelector('[data-recommendation-booking]').href=bookingGuide;
  switchView(true);
  dialog.scrollTop=0;
  heading.focus({preventScroll:true});
});

results.querySelector('[data-edit-recommendation]').addEventListener('click',()=>{
  switchView(false);
  dialog.scrollTop=0;
  form.querySelector('input:checked, input').focus({preventScroll:true});
});
