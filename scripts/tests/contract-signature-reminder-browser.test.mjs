import test from "node:test";
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {sendContractReminderSms} from "../lib/contract-signature-reminder-browser.mjs";

const plan={memberId:"701",memberName:"Synthetic Member",memberPhone:"01000000701",studioId:"5330",
  smsTitle:"Synthetic signature reminder",smsMessage:"Synthetic contract link"};

test("real SMS UI fixture never dispatches before source/claim callback and validates single recipient",async t=>{
  const browser=await chromium.launch({headless:true});
  try {
    for(const mode of ["accepted","without_main","delayed_identity","callback_rejects","wrong_recipient","multiple_recipients","wrong_phone","bad_receipt","crossing_20"]) {
      await t.test(mode,async()=>{
        const context=await browser.newContext(),page=await context.newPage();
        let posts=0,checked=false,unexpected=0,profileRequested,releaseProfile;
        let clock=Date.parse("2026-10-28T01:00:00.000Z");
        const requested=new Promise(resolve=>{profileRequested=resolve;});
        const released=new Promise(resolve=>{releaseProfile=resolve;});
        try {
          await page.route("**/*",async route=>{
            const request=route.request(),url=request.url();
            if(url===`https://arcpilates.studiomate.kr/users/detail?id=${plan.memberId}`) {
              const tag=mode==="accepted"?"main":"section";
              const profile=`${plan.memberName} ${mode==="wrong_phone"?"01099999999":plan.memberPhone}`;
              const html=`<!doctype html><meta charset="utf-8"><${tag} id="profile">${mode==="delayed_identity"?"":profile}</${tag}>
              <button id="open">메시지 보내기</button>
              <div role="dialog" id="compose" hidden><input readonly placeholder="받는 사람을 선택해주세요." value="${mode==="wrong_recipient"?"Other Member":plan.memberName}">
              <input id="title" placeholder="제목을 입력해주세요."><textarea id="message" placeholder="메시지를 입력해주세요."></textarea><button id="send">보내기</button></div>
              <div role="dialog" id="confirm" hidden>${mode==="multiple_recipients"?2:1}건을 즉시 발송합니다! 메시지를 보내시겠습니까?<button id="yes">확인</button></div>
              <script>${mode==="delayed_identity"?"fetch('/synthetic-profile').then(r=>r.text()).then(text=>document.querySelector('#profile').textContent=text);":""}
              document.querySelector('#open').onclick=()=>document.querySelector('#compose').hidden=false;
              document.querySelector('#send').onclick=()=>document.querySelector('#confirm').hidden=false;
              document.querySelector('#yes').onclick=async()=>{
                await fetch('https://api.studiomate.kr/v2/staff/sms',{method:'POST',headers:{'Content-Type':'application/json'},
                  body:JSON.stringify({users:[701],title:document.querySelector('#title').value,message:document.querySelector('#message').value})});
              };</script>`;
              return route.fulfill({status:200,contentType:"text/html",body:html});
            }
            if(url==="https://arcpilates.studiomate.kr/synthetic-profile"&&request.method()==="GET") {
              profileRequested();await released;
              return route.fulfill({status:200,contentType:"text/plain",body:`${plan.memberName} ${plan.memberPhone}`});
            }
            if(url==="https://api.studiomate.kr/v2/staff/sms"&&request.method()==="POST") {
              assert.equal(checked,true,"source callback must finish before outgoing request");
              posts++;
              const payload=request.postDataJSON();
              assert.deepEqual(payload,{users:[701],title:plan.smsTitle,message:plan.smsMessage});
              return route.fulfill({status:200,headers:{"Access-Control-Allow-Origin":"*"},contentType:"application/json",
                body:JSON.stringify({id:mode==="bad_receipt"?0:1234,studio_id:5330,type:"send",is_sent:1,title:plan.smsTitle,message:plan.smsMessage})});
            }
            if(request.method()==="OPTIONS"&&url==="https://api.studiomate.kr/v2/staff/sms") return route.fulfill({status:204,
              headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"content-type"}});
            unexpected++;await route.abort();
          });
          const send=()=>sendContractReminderSms(page,plan,async()=>{
            if(mode==="callback_rejects")throw new Error("changed_signature");checked=true;
            if(mode==="crossing_20")clock=Date.parse("2026-10-28T11:00:00.000Z");
          },{now:()=>clock});
          if(mode==="delayed_identity") {
            const pending=send().then(result=>({result}),error=>({error}));
            await requested;
            await page.getByRole("button",{name:"메시지 보내기",exact:true}).waitFor({state:"visible"});
            assert.equal(posts,0);assert.equal(checked,false);
            releaseProfile();
            const completed=await pending;
            if(completed.error)throw completed.error;
            assert.deepEqual(completed.result,{smsId:1234});
          } else if(["accepted","without_main"].includes(mode)) assert.deepEqual(await send(),{smsId:1234});
          else await assert.rejects(send());
          assert.equal(posts,["accepted","without_main","delayed_identity","bad_receipt"].includes(mode)?1:0);
          assert.equal(unexpected,0,"fixture must not contact any other service");
        }finally{releaseProfile();await context.close();}
      });
    }
  }finally{await browser.close();}
});
