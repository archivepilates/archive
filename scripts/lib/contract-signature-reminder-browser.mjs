// StudioMate's existing single-recipient SMS UI; never calls a send API directly.
export async function sendContractReminderSms(page, plan, beforeFinalSend) {
  const url=`https://arcpilates.studiomate.kr/users/detail?id=${plan.memberId}`;
  await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000});
  // StudioMate member details have no main landmark and paint the toolbar first.
  try {
    await page.waitForFunction(({url,name,phone})=>location.href===url
      && document.body.innerText.includes(name)
      && document.body.innerText.replace(/\D/g,"").includes(phone),
    {url,name:plan.memberName,phone:plan.memberPhone},{timeout:15000});
  } catch {
    throw new Error("contract_reminder_member_page_not_ready");
  }
  const body=await page.locator("body").innerText();
  if(page.url()!==url || !body.includes(plan.memberName) || !body.replace(/\D/g,"").includes(plan.memberPhone))
    throw new Error("contract_reminder_member_page_mismatch");
  await page.getByRole("button",{name:"메시지 보내기",exact:true}).click({timeout:15000})
    .catch(()=>{throw new Error("contract_reminder_message_action_unavailable");});
  const dialog=page.getByRole("dialog").last();
  await dialog.waitFor({state:"visible",timeout:15000})
    .catch(()=>{throw new Error("contract_reminder_compose_unavailable");});
  const tab=dialog.getByRole("button",{name:"SMS 보내기",exact:true});
  if(await tab.isVisible().catch(()=>false)) await tab.click();
  const box=async placeholder=>{
    const boxes=dialog.getByRole("textbox");
    for(let i=0;i<await boxes.count();i++) if(await boxes.nth(i).getAttribute("placeholder")===placeholder) return boxes.nth(i);
    throw new Error("contract_reminder_sms_input_missing");
  };
  const recipient=await box("받는 사람을 선택해주세요.");
  if(await recipient.getAttribute("readonly")===null || await recipient.inputValue()!==plan.memberName)
    throw new Error("contract_reminder_recipient_mismatch");
  await (await box("제목을 입력해주세요.")).fill(plan.smsTitle);
  await (await box("메시지를 입력해주세요.")).fill(plan.smsMessage);
  await dialog.getByRole("button",{name:"보내기",exact:true}).click();
  const confirmation=page.getByRole("dialog").filter({hasText:"메시지를 보내시겠습니까?"}).filter({visible:true});
  await confirmation.waitFor({state:"visible",timeout:15000})
    .catch(()=>{throw new Error("contract_reminder_confirmation_unavailable");});
  const text=await confirmation.innerText(),counts=text.match(/\d+\s*건/g)||[];
  if(await confirmation.count()!==1 || !/^(?:메시지\s*보내기\s*)?1\s*건을\s*즉시\s*발송합니다!/.test(text.trim())
    || !counts.length || counts.some(v=>v.replace(/\s/g,"")!=="1건")) throw new Error("contract_reminder_recipient_count_mismatch");
  await beforeFinalSend();
  const resultPromise=page.waitForResponse(r=>r.request().method()==="POST"&&r.url()==="https://api.studiomate.kr/v2/staff/sms",{timeout:20000})
    .then(async r=>({url:r.url(),status:r.status(),body:await r.json(),payload:r.request().postDataJSON()}))
    .then(result=>({result}),error=>({error}));
  await confirmation.getByRole("button",{name:"확인",exact:true}).click();
  const {result,error}=await resultPromise;
  if(error) throw error;
  assertContractReminderSmsResponse(result,plan);
  return {smsId:result.body.id};
}

export function assertContractReminderSmsResponse(result,plan) {
  const body=result?.body,p=result?.payload;
  if(result?.url!=="https://api.studiomate.kr/v2/staff/sms" || result.status!==200
    || !Number.isSafeInteger(body?.id) || body.id<=0 || String(body.studio_id)!==plan.studioId || body.type!=="send"
    || Object.hasOwn(body,"is_sent")&&body.is_sent!==1 || body.title!==plan.smsTitle || body.message!==plan.smsMessage
    || !Array.isArray(p?.users) || p.users.length!==1 || String(p.users[0])!==plan.memberId
    || p.title!==plan.smsTitle || p.message!==plan.smsMessage) throw new Error("contract_reminder_sms_receipt_unverified");
}
