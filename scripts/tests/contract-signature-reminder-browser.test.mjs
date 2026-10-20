import test from "node:test";
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {sendContractReminderSms} from "../lib/contract-signature-reminder-browser.mjs";

const plan={memberId:"701",memberName:"Synthetic Member",memberPhone:"01000000701",studioId:"5330",
  smsTitle:"Synthetic signature reminder",smsMessage:"Synthetic contract link"};

test("real SMS UI fixture never dispatches before source/claim callback and validates single recipient",async t=>{
  const browser=await chromium.launch({headless:true});
  try {
    for(const mode of ["accepted","callback_rejects","wrong_recipient","multiple_recipients","wrong_phone","bad_receipt"]) {
      await t.test(mode,async()=>{
        const context=await browser.newContext(),page=await context.newPage();
        let posts=0,checked=false,unexpected=0;
        try {
          await page.route("**/*",async route=>{
            const request=route.request(),url=request.url();
            if(url===`https://arcpilates.studiomate.kr/users/detail?id=${plan.memberId}`) {
              const html=`<!doctype html><meta charset="utf-8"><main>${plan.memberName} ${mode==="wrong_phone"?"01099999999":plan.memberPhone}</main>
              <button id="open">메시지 보내기</button>
              <div role="dialog" id="compose" hidden><input readonly placeholder="받는 사람을 선택해주세요." value="${mode==="wrong_recipient"?"Other Member":plan.memberName}">
              <input id="title" placeholder="제목을 입력해주세요."><textarea id="message" placeholder="메시지를 입력해주세요."></textarea><button id="send">보내기</button></div>
              <div role="dialog" id="confirm" hidden>${mode==="multiple_recipients"?2:1}건을 즉시 발송합니다! 메시지를 보내시겠습니까?<button id="yes">확인</button></div>
              <script>document.querySelector('#open').onclick=()=>document.querySelector('#compose').hidden=false;
              document.querySelector('#send').onclick=()=>document.querySelector('#confirm').hidden=false;
              document.querySelector('#yes').onclick=async()=>{
                await fetch('https://api.studiomate.kr/v2/staff/sms',{method:'POST',headers:{'Content-Type':'application/json'},
                  body:JSON.stringify({users:[701],title:document.querySelector('#title').value,message:document.querySelector('#message').value})});
              };</script>`;
              return route.fulfill({status:200,contentType:"text/html",body:html});
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
          });
          if(mode==="accepted") assert.deepEqual(await send(),{smsId:1234});
          else await assert.rejects(send());
          assert.equal(posts,["accepted","bad_receipt"].includes(mode)?1:0);
          assert.equal(unexpected,0,"fixture must not contact any other service");
        }finally{await context.close();}
      });
    }
  }finally{await browser.close();}
});
