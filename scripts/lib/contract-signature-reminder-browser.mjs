// Historical receipt parsing remains; direct StudioMate SMS dispatch is retired.
import { assertContractReminderDispatchAllowed } from "./contract-signature-reminder-window.mjs";

export async function sendContractReminderSms(page, plan, beforeFinalSend, { now = Date.now } = {}) {
  assertContractReminderDispatchAllowed(now());
  throw Object.assign(new Error('member_sms_studiomate_transport_disabled'), { code: 'member_sms_studiomate_transport_disabled' });
}

export function assertContractReminderSmsResponse(result,plan) {
  const body=result?.body,p=result?.payload;
  if(result?.url!=="https://api.studiomate.kr/v2/staff/sms" || result.status!==200
    || !Number.isSafeInteger(body?.id) || body.id<=0 || String(body.studio_id)!==plan.studioId || body.type!=="send"
    || Object.hasOwn(body,"is_sent")&&body.is_sent!==1 || body.title!==plan.smsTitle || body.message!==plan.smsMessage
    || !Array.isArray(p?.users) || p.users.length!==1 || String(p.users[0])!==plan.memberId
    || p.title!==plan.smsTitle || p.message!==plan.smsMessage) throw new Error("contract_reminder_sms_receipt_unverified");
}
