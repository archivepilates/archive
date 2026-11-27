import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const app = await fs.readFile(new URL("core/assets/app.js", root), "utf8");
const html = await fs.readFile(new URL("core/instructor-lessons/index.html", root), "utf8");
const css = await fs.readFile(new URL("core/assets/styles.css", root), "utf8")
  + await fs.readFile(new URL("core/assets/interface.css", root), "utf8");
const functions = new Map([...app.matchAll(/^(?:async )?function (\w+)\([^]*?^\}/gm)].map(m => [m[1], m[0]]));
const names = ["qs", "setText", "escapeHtml", "instructorLessonStepStatusLabel", "instructorLessonScheduleSourceLabel",
  "instructorLessonScheduleDateLabel", "instructorLessonMethodTitle", "renderInstructorLessonRoster", "instructorLessonCancellationKey",
  "instructorLessonCancellationStatusLabel", "canCancelInstructorLesson", "findInstructorLessonCancellationTarget",
  "setInstructorLessonCancellationMessage", "handleInstructorLessonCancellationOpen", "closeInstructorLessonCancellation",
  "handleInstructorLessonCancellationClose", "refreshInstructorLessonCancellationDashboard", "handleInstructorLessonCancellationSubmit",
  "loadInstructorLessonRegistrationDashboard", "compactDateTime", "instructorLessonSchedulePresentation",
  "instructorLessonScheduleTimeLabel", "canPromoteInstructorWaitlist", "findInstructorWaitlistPromotion",
  "handleInstructorWaitlistPromotionOpen", "handleInstructorWaitlistPromotionClose", "handleInstructorWaitlistPromotionSubmit"];
for (const name of names) assert.ok(functions.has(name), name);
const clean = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<link\b[^>]*>/g, "");
const output = new URL("artifacts/instructor-lesson-cancellation/", root);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage(); await page.route("**/*", route => route.abort());
      await page.setContent(clean); await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: `
        document.documentElement.dataset.coreAccess = "manager";
        document.getElementById("coreAccessLoading").remove();
        const member = { memberKey: "synthetic", memberId: "101", memberName: "합성 강사 이름", canCancel: true };
        const waiter = { registrationId:"ilr_"+"0".repeat(24), memberName:"합성 대기자", position:1, alreadyOnRoster:false };
        const schedule={date:"2026-11-28", startAt:"2099-11-28T04:00:00Z", roster:[member], countSource:"tickets",
          waitlist:[waiter], waitlistCount:1, waitlistPromotionCapacity:1};
        const state = { instructorLessonRegistrationDashboard: { items: [], schedule: { items: [schedule] } } };
        let selectedInstructorLessonDate="2026-11-28", instructorLessonCancellationTarget=null, instructorLessonCancellationBusy=false;
        const instructorLessonCancellationReceipts=new Map();
        let instructorWaitlistPromotionTarget=null,instructorWaitlistPromotionBusy=false;
        const instructorWaitlistPromotionAttempts=new Set();
        const readUnavailable=()=>false, setReadState=()=>{}, coreHref=p=>"/"+p;
        const renderInstructorLessonRegistrationDashboard=()=>renderInstructorLessonRoster(state.instructorLessonRegistrationDashboard.schedule.items[0]);
        let queueCount=0,promotionCount=0,promotionPayload;
        const initFirebase=async()=>({functionsClient:{},httpsCallable:(_client,name)=>async(payload)=>{
          if(name==="getInstructorLessonRegistrationDashboard")return {data:state.instructorLessonRegistrationDashboard};
          if(name==="operatorCreateInstructorLessonRegistration"){
            promotionCount++; promotionPayload=payload;
            schedule.waitlist=[];schedule.waitlistCount=0;
            return {data:{ok:true,registrationId:waiter.registrationId,status:"queued"}};
          }
          queueCount++; member.cancellation={jobId:"synthetic-job",status:"pending"};member.canCancel=false;
          return {data:{ok:true,jobId:"synthetic-job",status:"pending"}};
        }});
        ${names.map(name => functions.get(name)).join("\n")}
        document.getElementById("instructorLessonScheduleDetail").addEventListener("click",handleInstructorLessonCancellationOpen);
        document.getElementById("instructorLessonCancellationForm").addEventListener("submit",handleInstructorLessonCancellationSubmit);
        document.getElementById("instructorLessonCancellationClose").addEventListener("click",closeInstructorLessonCancellation);
        document.getElementById("instructorLessonCancellationDialog").addEventListener("close",handleInstructorLessonCancellationClose);
        document.getElementById("instructorLessonScheduleDetail").addEventListener("click",handleInstructorWaitlistPromotionOpen);
        document.getElementById("instructorWaitlistPromotionForm").addEventListener("submit",handleInstructorWaitlistPromotionSubmit);
        document.getElementById("instructorWaitlistPromotionClose").onclick=()=>qs("instructorWaitlistPromotionDialog").close();
        document.getElementById("instructorWaitlistPromotionDialog").addEventListener("close",handleInstructorWaitlistPromotionClose);
        renderInstructorLessonRegistrationDashboard();
      ` });
      const cancel = page.getByRole("button", { name: "합성 강사 이름 · 2026-11-28 예약 취소", exact: true });
      await cancel.scrollIntoViewIfNeeded();
      assert.ok((await cancel.boundingBox()).height >= 44);
      await cancel.click();
      const dialog = page.getByRole("dialog", { name: "예약 취소 확인" });
      await dialog.waitFor({ state: "visible" });
      assert.match(await dialog.innerText(), /실제 결제 환불은 진행되지 않습니다/);
      await page.getByLabel("취소 사유", { exact: true }).fill("합성 화면 테스트");
      await page.screenshot({ path: new URL(`dialog-${width}.png`, output).pathname });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        dialog: (()=>{const r=document.querySelector("dialog").getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})() }));
      assert.ok(layout.scrollWidth <= width, JSON.stringify(layout));
      assert.ok(layout.dialog.left >= 0 && layout.dialog.right <= width);
      await page.getByRole("button", { name: "예약 취소 요청", exact: true }).click();
      await page.getByRole("dialog").getByRole("status").filter({ hasText: "취소 처리중" }).waitFor();
      assert.equal(await page.evaluate(() => queueCount), 1);
      assert.equal(await page.getByRole("button", { name: "예약 취소 요청", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "닫기", exact: true }).click();
      assert.equal(await dialog.isVisible(), false);
      await page.getByRole("status", { name: "합성 강사 이름 취소 상태" }).filter({ hasText: "취소 처리중" }).waitFor();
      assert.equal(await page.locator("[data-instructor-cancel-key]").count(), 0);

      const promote = page.getByRole("button", { name: "합성 대기자 · 2026-11-28 예약 확정", exact: true });
      assert.ok((await promote.boundingBox()).height >= 44);
      await promote.click();
      const promotion = page.getByRole("dialog", { name: "대기자 예약 확정" });
      assert.equal(await promotion.getByLabel("결제수단").evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Escape");
      await promotion.waitFor({ state: "hidden" });
      assert.equal(await promote.evaluate(el => el === document.activeElement), true);
      await promote.click();
      await promotion.getByLabel("결제수단").selectOption("wiretransfer");
      const confirm = promotion.getByRole("button", { name: "반배정·예약 요청" });
      await confirm.click();
      assert.equal(await page.evaluate(() => promotionCount), 0);
      await promotion.getByRole("checkbox", { name: /결제 내역/ }).check();
      assert.equal(await promotion.getByRole("checkbox", { name: /횟수 초과/ }).isChecked(), false);
      await promotion.getByRole("checkbox", { name: /횟수 초과/ }).check();
      await page.screenshot({ path: new URL(`promotion-${width}.png`, output).pathname });
      assert.ok(await page.evaluate(() => {
        const r = qs("instructorWaitlistPromotionDialog").getBoundingClientRect();
        const row = document.querySelector(".instructor-waitlist-row");
        return r.left >= 0 && r.right <= innerWidth && row.scrollWidth <= row.clientWidth;
      }));
      await confirm.click();
      await promotion.getByRole("status").filter({ hasText: "반배정·예약 요청 접수" }).waitFor();
      assert.equal(await page.evaluate(() => promotionCount), 1);
      assert.deepEqual(await page.evaluate(() => Object.keys(promotionPayload).sort()),
        ["bookingDailyLimitAcknowledged", "lessonDate", "paymentConfirmed", "paymentMethod", "seatConfirmed", "waitlistRegistrationId"]);
      assert.equal(await page.evaluate(() => promotionPayload.bookingDailyLimitAcknowledged), true);
      assert.ok(await confirm.isDisabled());
      await promotion.getByRole("button", { name: "닫기" }).click();
      assert.equal(await promote.count(), 0);
      results.push({ width, overflow: false, dialog: true, singleRequest: true, pendingNotCompleted: true, waitlistPromotion: true });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await fs.writeFile(new URL("ui-verification.json", output), JSON.stringify({ syntheticOnly: true, results, browserClosed: true }, null, 2));
console.log(JSON.stringify({ syntheticOnly: true, results, browserClosed: true }, null, 2));
