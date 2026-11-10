import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildInquiryGuidance} from '../build-member-inquiry-guidance.mjs';

test('published guidance copies match the curated source exactly',()=>assert.equal(buildInquiryGuidance({check:true}).length,2));
test('matched public rules are visible before member details and resolution never submits a request',async()=>{
  const browser=await chromium.launch({headless:true});
  const root=path.resolve('help');let posts=0;
  try{for(const width of [320,390,768,1366]){
    const context=await browser.newContext({viewport:{width,height:950}});
    try{
      const page=await context.newPage();
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());if(url.origin!=='https://inquiry.test')return route.abort();
        if(url.pathname==='/api/inquiries'){posts++;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,notAccepted:true,message:'Synthetic only'})});}
        const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
        if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
        const type=file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'text/html';
        return route.fulfill({status:200,contentType:type,body:fs.readFileSync(file)});
      });
      await page.goto('https://inquiry.test/');
      await page.locator('[data-category="booking"]').click();
      await page.getByRole('radio',{name:'자유예약',exact:true}).check();
      assert((await page.locator('#guidance-rules').textContent()).includes('6시간'));
      await page.getByRole('radio',{name:'고정예약',exact:true}).check();
      assert((await page.locator('#guidance-rules').textContent()).includes('취소·변경이 불가'));
      assert(!(await page.locator('#guidance-rules').textContent()).includes('6시간'));
      await page.locator('#back-categories').click();await page.locator('[data-category="holding"]').click();
      await page.getByRole('radio',{name:'기간권',exact:true}).check();await page.getByRole('radio',{name:'1주',exact:true}).check();
      assert((await page.locator('#guidance-rules').textContent()).includes('월요일부터 일요일'));
      await page.locator('#guidance-resolved').click();assert.equal(posts,0);
      assert(await page.locator('#guidance-resolution').isVisible());assert((await page.locator('#guidance-resolution').textContent()).includes('접수되지 않았으며'));
      await page.locator('#guidance-continue').click();assert(await page.getByRole('radio',{name:'기간권',exact:true}).isChecked());
      assert(await page.getByRole('radio',{name:'1주',exact:true}).isChecked());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const output='output/playwright/member-inquiry-guidance';fs.mkdirSync(output,{recursive:true});
      await page.screenshot({path:path.join(output,`${width}.png`),fullPage:true});
    }finally{await context.close();}
  }}finally{await browser.close();}
  assert.equal(posts,0);
});
