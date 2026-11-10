import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

test('operator queue, stored context, draft application and separate completion gates stay independent',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const html=fs.readFileSync('core/inquiries/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'');
    const css=fs.readFileSync('core/assets/member-inquiries.css','utf8');
    const icons=fs.readFileSync('core/assets/ui-icons.js','utf8').replace('export function uiIcon','function uiIcon');
    const source=icons+'\n'+fs.readFileSync('core/assets/member-inquiries.js','utf8').replace(/^import .*\n/gm,'').replace('initCoreNavigationDocument();','').replace(/initialize\(\)\.catch\([\s\S]*$/,'');
    const schema=JSON.parse(fs.readFileSync('core/assets/member-inquiry-schema.json'));
    const guidance=JSON.parse(fs.readFileSync('core/assets/member-inquiry-guidance.json'));
    for(const width of [320,390,768,1366]){
      const context=await browser.newContext({viewport:{width,height:950}});
      try{
        const page=await context.newPage();await page.route('**/*',route=>route.abort());await page.setContent(`<style>${css}</style>${html}`);
        await page.evaluate(source+`
          schema=${JSON.stringify(schema)};guidance=${JSON.stringify(guidance)};
          access={manager:true,staffId:'manager',responseDelayHours:24,assignees:[{staffId:'current',name:'재직 테스트 직원'}]};
          const base={id:'synthetic',category:'holding',memberName:'가상회원',memberPhone:'테스트 연락처',maskedPhone:'테스트 연락처',answers:{ticket:'기간권',duration:'1주'},assignedStaffId:'current',assignedStaffName:'재직 테스트 직원',revision:1,status:'received',createdAt:new Date(Date.now()-25*3600000).toISOString()};
          rows=[base,{...base,id:'unassigned',assignedStaffId:'',assignedStaffName:'',createdAt:new Date().toISOString()},{...base,id:'retired',assignmentIssue:'not_current_staff'}];
          const calls=[];call=async data=>{calls.push(data);if(data.action==='context')return{ok:true,context:{status:'unique_stored_match',source:'memberProfiles',observedAt:new Date().toISOString(),profile:{memberId:'test',name:'가상회원',maskedPhone:'테스트 연락처'},tickets:[{name:'가상 수강권',remainingCount:null,usableCount:null}],holds:[],bookings:[],coverage:{bookingsLimited:true},note:'저장자료이며 실시간 조회가 아닙니다.'}};throw Error('Unexpected action '+data.action);};
          window.synthetic={show:patch=>showRow({...base,...patch},[]),calls,contacted:()=>{rows[0].contactRecorded=true;renderList();},readonly:()=>{access={...access,manager:false,staffId:'other'};showRow(base,[]);},noThreshold:()=>{access.responseDelayHours=null;renderList();}};
          $('workspace').hidden=false;showRow(base,[]);
        `);
        await page.locator('#work-filter').selectOption('reassignment');assert.equal(await page.locator('#request-list button').count(),1);
        await page.locator('#work-filter').selectOption('unassigned');assert.equal(await page.locator('#request-list button').count(),1);
        await page.locator('#work-filter').selectOption('delayed');assert.equal(await page.locator('#request-list button').count(),2);
        await page.evaluate(()=>window.synthetic.contacted());assert.equal(await page.locator('#request-list button').count(),1);
        assert((await page.locator('#work-counts').textContent()).includes('현재 불러온 3건 기준'));
        await page.locator('#preview-guidance').click();assert.equal(await page.locator('#plan').inputValue(),'');
        await page.locator('#apply-guidance').click();assert((await page.locator('#plan').inputValue()).includes('20%'));
        assert.deepEqual(await page.evaluate(()=>window.synthetic.calls),[]);
        await page.locator('#plan').fill('직원이 작성한 내용');page.once('dialog',dialog=>dialog.dismiss());await page.locator('#apply-guidance').click();assert.equal(await page.locator('#plan').inputValue(),'직원이 작성한 내용');
        await page.evaluate(()=>window.synthetic.show({status:'approved',reviewHash:'h',review:{plan:'승인 처리안',memberReply:'승인 답변',policyFit:'within_policy',resolutionKind:'guidance'}}));
        assert(await page.locator('#complete').isDisabled());
        await page.evaluate(()=>window.synthetic.show({status:'approved',reviewHash:'h',execution:{reviewHash:'h',note:'확인'},notification:{reviewHash:'old'},review:{plan:'승인 처리안',memberReply:'승인 답변',policyFit:'within_policy',resolutionKind:'guidance'}}));
        assert(await page.locator('#complete').isDisabled());
        await page.evaluate(()=>window.synthetic.show({status:'approved',reviewHash:'h',execution:{reviewHash:'h',note:'확인'},notification:{reviewHash:'h',outcome:'not_required',channel:'none'},review:{plan:'승인 처리안',memberReply:'승인 답변',policyFit:'within_policy',resolutionKind:'guidance'}}));
        assert(await page.locator('#complete').isEnabled());
        await page.evaluate(()=>window.synthetic.readonly());assert(await page.locator('#submit-review').isDisabled());
        await page.locator('#stored-context-panel summary').click();
        await page.locator('#load-context').click();await page.getByText('저장자료 1건 일치 · 본인 확인 전',{exact:true}).waitFor();
        assert((await page.locator('#member-context').textContent()).includes('잔여 확인 불가'));
        assert((await page.locator('#member-context').textContent()).includes('예약 검색 범위 제한'));
        assert.deepEqual((await page.evaluate(()=>window.synthetic.calls)).map(call=>call.action),['context']);
        await page.evaluate(()=>window.synthetic.noThreshold());assert.equal(await page.locator('#work-filter option[value="delayed"]').count(),0);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        const output='output/playwright/member-inquiry-workflow';fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,`${width}.png`),fullPage:true});
      }finally{await context.close();}
    }
  }finally{await browser.close();}
});
