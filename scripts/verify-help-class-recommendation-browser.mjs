import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname,join} from 'node:path';

const {chromium,webkit}=createRequire(process.env.ARCHIVE_PLAYWRIGHT_PACKAGE??import.meta.url)('playwright');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg'};
const live=process.argv.includes('--live');
let server, origin='https://help.archivepilates.com';
if(!live){
  server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=pathname.endsWith('/')?pathname+'index.html':pathname;
    try{
      assert.equal(req.method,'GET');
      assert.match(file,/^\/[\w./-]+$/);
      assert(!file.includes('..'));
      const body=await readFile(new URL('../help'+file,import.meta.url));
      res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});
      res.end(body);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;
}

const sizes=live?[[390,844]]:[[320,640],[390,844],[768,1024],[1440,900]];
const checks=[];
try{
  for(const [name,type] of (live?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]])){
    const browser=await type.launch();
    try{
      for(const [width,height] of sizes){
        const ctx=await browser.newContext({viewport:{width,height},isMobile:width<500,hasTouch:width<500,serviceWorkers:'block'});
        try{
          const page=await ctx.newPage(), writes=[],errors=[];
          page.on('pageerror',err=>errors.push(err.message));
          await ctx.route('**/*',route=>{
            const req=route.request();
            if(!['GET','HEAD'].includes(req.method())){writes.push(req.method());return route.abort();}
            return new URL(req.url()).origin===origin?route.continue():route.abort();
          });
          await page.clock.setFixedTime(new Date('2026-11-24T01:00:00Z'));
          await page.goto(origin+(width===768?'/chatbot/':'/'),{waitUntil:'networkidle'});
          const trigger=page.getByRole('button',{name:'30초 수업 추천',exact:true});
          await trigger.click();
          const modal=page.getByRole('dialog',{name:'30초 수업 추천'});
          const overflow=()=>page.evaluate(()=>{
            const modal=document.querySelector('#class-recommendation');
            return document.documentElement.scrollWidth>innerWidth||modal.scrollWidth>modal.clientWidth;
          });
          assert.equal(await overflow(),false);
          for(const option of ['평일 저녁','운동 습관 만들기','가볍게'])await modal.getByRole('radio',{name:option,exact:true}).check();
          assert.equal(await modal.locator('form').evaluate(form=>form.checkValidity()),true);
          await modal.getByRole('button',{name:'추천 수업 보기'}).click();
          const entries=modal.locator('.recommendation-results li');
          assert.equal(await entries.count(),2);
          assert.match(await entries.first().innerText(),/11월 24일\(화\) 18:30\s+유리 강사 · 선택한 평일 저녁/);
          assert.match(await modal.innerText(),/가볍게 시작/);
          assert.match(await modal.innerText(),/남은 자리는 회원 앱에서/);
          assert.equal(await modal.getByRole('link',{name:'StudioMate 예약 안내'}).getAttribute('href'),
            'https://archivepilates.notion.site/studiomate');
          assert.equal(await modal.locator('h3').evaluate(node=>node===document.activeElement),true);
          assert.equal(await overflow(),false);
          if(process.env.ARCHIVE_HELP_QA_SHOTS&&name==='chromium'&&width===390){
            await page.screenshot({path:join(process.env.ARCHIVE_HELP_QA_SHOTS,live?'live-mobile.png':'mobile-results.png')});
          }
          await modal.getByRole('button',{name:'조건 바꾸기'}).click();
          assert(await modal.getByRole('radio',{name:'평일 저녁'}).isChecked());
          await page.clock.setFixedTime(new Date('2026-11-30T15:00:00Z'));
          await modal.getByRole('button',{name:'추천 수업 보기'}).click();
          assert.equal(await entries.count(),0);
          assert.match(await modal.innerText(),/최신 공개 시간표가 확인되지 않아/);
          await page.keyboard.press('Escape');
          assert.equal(await modal.isVisible(),false);
          assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);
          await trigger.click();
          assert.equal(await modal.locator('form').evaluate(form=>form.checkValidity()),false);
          await modal.getByRole('button',{name:'수업 추천 닫기'}).click();
          const chat=page.getByRole('textbox',{name:'궁금한 내용'});
          await chat.fill('명지점 시간표 보여줘');
          await chat.press('Enter');
          assert(await page.getByText('명지점 시간표 보여줘',{exact:true}).isVisible());
          assert(await trigger.isVisible());
          assert(await page.getByRole('button',{name:'직원 문의',exact:true}).isVisible());
          assert.deepEqual(writes,[]);
          assert.deepEqual(errors,[]);
          checks.push(name+'@'+width);
        }finally{await ctx.close();}
      }
    }finally{await browser.close();}
  }
}finally{if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({origin,checks,writes:0,twoRecommendations:true,expiredScheduleBlocked:true}));
