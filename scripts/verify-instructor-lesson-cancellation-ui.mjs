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
  "loadInstructorLessonRegistrationDashboard"];
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
        const state = { instructorLessonRegistrationDashboard: { items: [], schedule: { items: [{date:"2026-11-28", roster:[member], countSource:"tickets"}] } } };
        let selectedInstructorLessonDate="2026-11-28", instructorLessonCancellationTarget=null, instructorLessonCancellationBusy=false;
        const instructorLessonCancellationReceipts=new Map();
        const readUnavailable=()=>false, setReadState=()=>{}, coreHref=p=>"/"+p;
        const renderInstructorLessonRegistrationDashboard=()=>renderInstructorLessonRoster(state.instructorLessonRegistrationDashboard.schedule.items[0]);
        let queueCount=0;
        const initFirebase=async()=>({functionsClient:{},httpsCallable:(_client,name)=>async()=>{
          if(name==="getInstructorLessonRegistrationDashboard")return {data:state.instructorLessonRegistrationDashboard};
          queueCount++; member.cancellation={jobId:"synthetic-job",status:"pending"};member.canCancel=false;
          return {data:{ok:true,jobId:"synthetic-job",status:"pending"}};
        }});
        ${names.map(name => functions.get(name)).join("\n")}
        document.getElementById("instructorLessonScheduleDetail").addEventListener("click",handleInstructorLessonCancellationOpen);
        document.getElementById("instructorLessonCancellationForm").addEventListener("submit",handleInstructorLessonCancellationSubmit);
        document.getElementById("instructorLessonCancellationClose").addEventListener("click",closeInstructorLessonCancellation);
        document.getElementById("instructorLessonCancellationDialog").addEventListener("close",handleInstructorLessonCancellationClose);
        renderInstructorLessonRegistrationDashboard();
      ` });
      const cancel = page.getByRole("button", { name: "합성 강사 이름 · 2026-11-28 수강 취소", exact: true });
      await cancel.scrollIntoViewIfNeeded();
      assert.ok((await cancel.boundingBox()).height >= 44);
      await cancel.click();
      const dialog = page.getByRole("dialog", { name: "수강 취소 확인" });
      await dialog.waitFor({ state: "visible" });
      assert.match(await dialog.innerText(), /실제 결제 환불은 진행되지 않습니다/);
      await page.getByLabel("취소 사유", { exact: true }).fill("합성 화면 테스트");
      await page.screenshot({ path: new URL(`dialog-${width}.png`, output).pathname });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        dialog: (()=>{const r=document.querySelector("dialog").getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})() }));
      assert.ok(layout.scrollWidth <= width, JSON.stringify(layout));
      assert.ok(layout.dialog.left >= 0 && layout.dialog.right <= width);
      await page.getByRole("button", { name: "수강 취소 요청", exact: true }).click();
      await page.getByRole("dialog").getByRole("status").filter({ hasText: "취소 처리중" }).waitFor();
      assert.equal(await page.evaluate(() => queueCount), 1);
      assert.equal(await page.getByRole("button", { name: "수강 취소 요청", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "닫기", exact: true }).click();
      assert.equal(await dialog.isVisible(), false);
      await page.getByRole("status", { name: "합성 강사 이름 취소 상태" }).filter({ hasText: "취소 처리중" }).waitFor();
      assert.equal(await page.locator("[data-instructor-cancel-key]").count(), 0);
      results.push({ width, overflow: false, dialog: true, singleRequest: true, pendingNotCompleted: true });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await fs.writeFile(new URL("ui-verification.json", output), JSON.stringify({ syntheticOnly: true, results, browserClosed: true }, null, 2));
console.log(JSON.stringify({ syntheticOnly: true, results, browserClosed: true }, null, 2));
