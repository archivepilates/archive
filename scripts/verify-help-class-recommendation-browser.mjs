import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname,join} from 'node:path';

const {chromium,webkit}=createRequire(process.env.ARCHIVE_PLAYWRIGHT_PACKAGE??import.meta.url)('playwright');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
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
          await page.waitForFunction(()=>{
            const icons=[...document.querySelectorAll('#prompts .prompt-art use,.welcome-art use')];
            return icons.length===6&&icons.every(use=>use.getAttribute('href').startsWith('/assets/chat-icons.svg#')
              &&use.getBBox().width>0&&use.getBBox().height>0&&getComputedStyle(use).stroke!=='none');
          });
          assert.equal(await page.evaluate(()=>{
            const stream=document.querySelector('#conversation').getBoundingClientRect();
            const input=document.querySelector('#question').getBoundingClientRect();
            return stream.height>=96&&input.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth;
          }),true);
          if(process.env.ARCHIVE_HELP_QA_SHOTS&&name==='chromium'&&[390,1440].includes(width)){
            await page.screenshot({path:join(process.env.ARCHIVE_HELP_QA_SHOTS,'illustrated-'+width+'.png')});
          }
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
          await page.getByRole('button',{name:'시간표',exact:true}).click();
          assert(await page.getByText('명지점 시간표 보여줘',{exact:true}).isVisible());
          assert(await trigger.isVisible());
          const shortcuts=page.getByRole('group',{name:'추천 질문',exact:true});
          const topics=['시간표','수강료','홀딩 규정','내 수강권'];
          assert.equal(await shortcuts.getByRole('button').count(),5);
          await chat.fill('작성 중인 질문');
          for(const label of topics){
            const choice=shortcuts.getByRole('button',{name:label,exact:true});
            await choice.focus();
            await choice.press('Enter');
            const focused=await choice.evaluate(node=>node===document.activeElement
              ? null : document.activeElement?.id||document.activeElement?.tagName||'none');
            assert.equal(focused,null,`${name} @ ${width}: ${label} moved focus to ${focused}`);
            assert.equal(await chat.inputValue(),'작성 중인 질문');
            assert.equal(await shortcuts.getByRole('button').count(),5);
            for(const next of topics)assert(await shortcuts.getByRole('button',{name:next,exact:true}).isVisible());
          }
          assert.equal(await chat.getAttribute('enterkeyhint'),'send');
          assert.equal(await page.evaluate(()=>{
            const buttons=[...document.querySelectorAll('#prompts button')].map(button=>button.getBoundingClientRect());
            return document.documentElement.scrollWidth<=innerWidth
              &&buttons.every(rect=>rect.width>=44&&rect.height>=44)
              &&buttons.every(rect=>rect.bottom<=document.querySelector('#question').getBoundingClientRect().top);
          }),true);
          await page.getByRole('button',{name:'새 대화',exact:true}).click();
          assert.equal(await shortcuts.getByRole('button').count(),5);
          assert.equal(await chat.inputValue(),'');
          const staff=page.getByRole('link',{name:'직원 문의',exact:true});
          assert(await staff.isVisible());
          assert.equal(await staff.getAttribute('href'),'https://pf.kakao.com/_KxdDWxj/chat');
          assert.equal(await staff.evaluate(a=>a.getBoundingClientRect().height>=44),true);
          assert.equal(await page.locator('#intake').count(),0);
          for(const [question,expected] of [
            ['안녕','안녕하세요! 시간표, 수강료, 예약 등 궁금한 내용을 편하게 물어보세요.'],
            ['주차는 몇 시간 무료예요?',/2시간 무료 주차/],
            ['예약은 언제 열려요?',/월요일 13시/]
          ]){
            await chat.fill(question);
            await chat.press('Enter');
            await page.locator('.turn.assistant').last().getByText(expected).waitFor();
          }
          await page.getByRole('button',{name:'새 대화',exact:true}).click();
          if(!live){
            const requests=[];
            await page.route('**/api/public-chat-intent',async route=>{
              assert.equal(route.request().method(),'POST');
              requests.push(route.request().postDataJSON());
              if(requests.length>2)return route.fulfill({status:503,json:{ok:false}});
              return route.fulfill({json:{ok:true,answer:requests.length===1?'목요일 시간표를 모아 봤어요.':'앞에서 말씀하신 목요일 저녁으로 좁혀 봤어요.'}});
            });
            await page.clock.setFixedTime(new Date('2026-11-24T01:00:00Z'));
            await chat.fill('목요일에 수업은 몇 시에 열려요?');
            await chat.press('Enter');
            await page.getByText('명지점 상담 · AI 답변',{exact:true}).waitFor();
            await page.getByRole('list',{name:'목요일 예정 수업'}).waitFor();
            await chat.fill('그럼 저녁엔요?');
            await chat.press('Enter');
            await page.getByText('앞에서 말씀하신 목요일 저녁으로 좁혀 봤어요.',{exact:true}).waitFor();
            assert.deepEqual(requests.map(({topic,previousTopic,day,time})=>[topic,previousTopic,day,time]),[
              ['schedule','',4,0],['schedule','schedule',4,3]]);
            assert(requests.every(r=>Object.keys(r).length===8&&r.version===2));
            await chat.fill('내 수강권 몇 회 남았어?');
            await chat.press('Enter');
            await page.getByRole('link',{name:'회원 앱에서 확인하는 방법'}).waitFor();
            assert.equal(requests.length,2);
            await page.getByRole('button',{name:'새 대화',exact:true}).click();
            await chat.fill('목요일에 수업은 몇 시에 열려요?');
            await chat.press('Enter');
            await page.getByText(/명지점 월간 예정표예요/).waitFor();
            assert.equal(requests.length,3);
            assert.equal(await page.getByText('명지점 상담 · AI 답변',{exact:true}).count(),0);
          }
          assert.deepEqual(writes,[]);
          assert.deepEqual(errors,[]);
          checks.push(name+'@'+width);
        }finally{await ctx.close();}
      }
    }finally{await browser.close();}
  }
}finally{if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({origin,checks,writes:0,twoRecommendations:true,expiredScheduleBlocked:true,persistentQuestions:true,lineIconsRendered:true,mockAiVerified:!live}));
