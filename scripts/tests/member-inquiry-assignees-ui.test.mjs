import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

test('current assignees refresh on detail open; historical assignments are never silently replaced', async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const html = fs.readFileSync('core/inquiries/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'');
    const css = fs.readFileSync('core/assets/member-inquiries.css','utf8');
    const icons = fs.readFileSync('core/assets/ui-icons.js','utf8').replace('export function uiIcon','function uiIcon');
    const source = icons+'\n'+fs.readFileSync('core/assets/member-inquiries.js','utf8')
      .replace(/^import .*\n/gm, '').replace('initCoreNavigationDocument();','')
      .replace(/initialize\(\)\.catch\([\s\S]*$/, '');
    for (const width of [320,390,768,1366]) {
      const page = await browser.newPage({viewport:{width,height:950}});
      try {
        await page.route('**/*', route => route.abort());
        await page.setContent(`<style>${css}</style>${html}`);
        await page.evaluate(source + `
          schema={categories:{}};
          access={manager:true,staffId:'manager',assignees:[{staffId:'retired',name:'기존 담당자'}]};
          const row={id:'synthetic',category:'other',answers:{},memberName:'가상 회원',memberPhone:'테스트 연락처',assignedStaffId:'retired',assignedStaffName:'기존 담당자',status:'received',revision:1};
          call=async data=>data.action==='get'?{row,events:[]}:{...access,assignees:[{staffId:'current',name:'현재 재직 중인 테스트 직원'}]};
          window.openSynthetic=()=>open(row.id);
          window.emptySynthetic=()=>{access.assignees=[];showRow(row,[]);};
          $('workspace').hidden=false;
        `);
        await page.evaluate(() => window.openSynthetic());
        assert.deepEqual(await page.locator('#assignee option').allTextContents(),['담당자를 선택해 주세요','현재 재직 중인 테스트 직원']);
        assert.equal(await page.locator('#assignee').inputValue(),'');
        assert.equal(await page.locator('#assign').isDisabled(),true);
        assert((await page.locator('#member-request').textContent()).includes('기존 담당자'));
        await page.locator('#assignee').selectOption('current');
        assert.equal(await page.locator('#assign').isDisabled(),true);
        await page.locator('#assignment-reason').fill('재직 담당자 인계');
        assert.equal(await page.locator('#assign').isEnabled(),true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),false);
        await page.evaluate(() => window.emptySynthetic());
        assert.equal(await page.locator('#assignee').isDisabled(),true);
        assert.equal(await page.locator('#assign').isDisabled(),true);
        const output='output/playwright/member-inquiry-assignees'; fs.mkdirSync(output,{recursive:true});
        await page.screenshot({path:path.join(output,`${width}.png`),fullPage:true});
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
