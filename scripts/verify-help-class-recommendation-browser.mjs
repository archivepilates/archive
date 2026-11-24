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
          if(!live&&width<500)await ctx.addInitScript(()=>{
            const viewport=Object.assign(new EventTarget(),{height:innerHeight,offsetTop:0,scale:1});
            Object.defineProperty(window,'visualViewport',{value:viewport});
            window.setTestViewport=(height,offsetTop=0,scale=1)=>{
              const type=viewport.height===height&&viewport.scale===scale?'scroll':'resize';
              Object.assign(viewport,{height,offsetTop,scale});
              viewport.dispatchEvent(new Event(type));
            };
          });
          const page=await ctx.newPage(), writes=[],errors=[];
          if(live)await page.route('**/api/public-chat-intent?capabilities=natural',
            route=>route.fulfill({json:{natural:false}}));
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
          if(process.env.ARCHIVE_HELP_QA_SHOTS&&name==='chromium'){
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
          if(!live){
            assert(await shortcuts.evaluate(node=>{
              const chips=[...node.children].map(child=>child.getBoundingClientRect());
              return chips.every(chip=>chip.top===chips[0].top)&&getComputedStyle(node).overflowX==='auto';
            }));
            if(width===320)assert(await shortcuts.evaluate(node=>{
              if(node.scrollWidth<=node.clientWidth)return false;
              node.scrollLeft=node.scrollWidth;
              const reached=node.lastElementChild.getBoundingClientRect().right<=node.getBoundingClientRect().right;
              node.scrollLeft=0;
              return reached;
            }));
          }
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
            if(width===390){
              await page.clock.setFixedTime(new Date('2026-11-24T12:26:00Z'));
              for(const [question,expected] of [
                ['11월 프로모션 가격 있나요',/870,000원/],
                ['직장인인데 추천 상품은',/일주일에 몇 번/],
                ['요일은 상관없고 오후7시 이후',/요일 무관 · 19:00 이후/],
                ['2-3번',/주 2~3회 방문.*그룹 기간권 주 2회 · 398,000원.*그룹 기간권 주 3회 · 570,000원/su],
                ['추천 상품없어',/먼저 그룹 기간권 주 2회/],
                ['?',/먼저 그룹 기간권 주 2회/]
              ]){
                const turns=page.locator('.turn.assistant');
                const nextIndex=await turns.count();
                await chat.fill(question);
                await chat.press('Enter');
                await turns.nth(nextIndex).getByText(expected).waitFor();
              }
              await page.getByRole('button',{name:'새 대화',exact:true}).click();
            }
            await page.clock.setFixedTime(new Date('2026-11-24T01:00:00Z'));
            await page.getByRole('button',{name:'새 대화',exact:true}).click();
            for(const [question,expected] of [
              ['주 3회 운동하고 싶어요',/주 3회 기준/],
              ['매일운동하려면?',/센터 수업만 매일 듣고 싶으세요/],
              ['매일은?',/수강권 조건과 날짜별 개설·예약 상황/],
              ['오늘은?',/명지점 월간 예정표예요/]
            ]){
              const nextIndex=await page.locator('.turn.assistant').count();
              await chat.fill(question);
              await chat.press('Enter');
              await page.locator('.turn.assistant').nth(nextIndex).getByText(expected).waitFor();
            }
            await page.getByRole('list',{name:'화요일 예정 수업'}).waitFor();
            if(width<500){
              const keyboardHeight=height-300;
              await chat.focus();
              await page.evaluate(h=>window.setTestViewport(h,40),keyboardHeight);
              await page.waitForFunction(h=>{
                const shell=document.querySelector('.help').getBoundingClientRect();
                const input=document.querySelector('#question').getBoundingClientRect();
                return shell.top===40&&shell.height===h&&input.bottom<=40+h;
              },keyboardHeight);
              await chat.fill('안녕');
              await chat.press('Enter');
              await page.getByText('안녕하세요! 시간표, 수강료, 예약 등 궁금한 내용을 편하게 물어보세요.').waitFor();
              await page.waitForFunction(()=>{
                const log=document.querySelector('#conversation');
                const last=log.lastElementChild.getBoundingClientRect(), viewport=log.getBoundingClientRect();
                return log.scrollHeight>log.clientHeight&&last.top>=viewport.top&&last.bottom<=viewport.bottom;
              });
              if(process.env.ARCHIVE_HELP_QA_SHOTS&&name==='webkit'&&width===390){
                await page.screenshot({path:join(process.env.ARCHIVE_HELP_QA_SHOTS,'keyboard-390.png')});
              }
              await page.evaluate(h=>{
                document.querySelector('#conversation').scrollTop=0;
                window.setTestViewport(h,60);
              },keyboardHeight);
              await page.waitForFunction(()=>document.querySelector('.help').getBoundingClientRect().top===60);
              assert(await page.locator('#conversation').evaluate(node=>node.scrollTop===0));
              assert(await page.evaluate(()=>scrollY===0&&document.documentElement.scrollHeight<=innerHeight));
              await page.evaluate(h=>window.setTestViewport(h,0,1.3),keyboardHeight);
              await page.waitForFunction(()=>!document.querySelector('.help').classList.contains('keyboard-open'));
              await chat.blur();
              await page.evaluate(h=>window.setTestViewport(h),height);
              assert(await page.locator('footer').isVisible());
            }
            if(width===390){
              const naturalRequests=[];
              await page.route('**/api/public-chat-intent?capabilities=natural',
                route=>route.fulfill({json:{natural:true}}));
              await page.route(requestUrl=>requestUrl.pathname==='/api/public-chat-intent'&&!requestUrl.search,route=>{
                const packet=route.request().postDataJSON();
                naturalRequests.push(packet);
                if(packet.question==='예약 취소는요?')return route.fulfill({status:503,json:{ok:false}});
                if(packet.question==='2-3번')return route.fulfill({json:{ok:true,
                  answer:'저녁 일곱 시 이후라면 주 2회와 주 3회 상품을 비교해 보세요.',
                  details:['그룹 기간권 주 2회 · 398,000원 · 10주'],link:'pricing',scheduleDay:null}});
                return route.fulfill({json:{ok:true,answer:'처음이라면 가벼운 강도로 시작해 볼까요?',link:'none',details:[],scheduleDay:null}});
              });
              const question='운동이랑 데면데면한데 가볍게부터 할 수 있을까요?';
              const consent=page.getByRole('dialog',{name:'GPT 공개 상담'});
              const ask=async q=>{await chat.fill(q);await chat.press('Enter');};
              await page.reload({waitUntil:'networkidle'});
              await ask(question);
              await consent.getByText(question,{exact:true}).waitFor();
              assert.equal(naturalRequests.length,0);
              await consent.getByRole('button',{name:'질문 수정'}).click();
              await page.waitForFunction(value=>document.querySelector('#query').value===value,question);
              await ask(question);
              await consent.getByRole('button',{name:'기본 안내'}).click();
              await page.getByText(question,{exact:true}).waitFor();
              assert.equal(naturalRequests.length,0);
              await page.getByRole('button',{name:'새 대화',exact:true}).click();
              await ask(question);
              await consent.getByRole('button',{name:'GPT로 보내기'}).click();
              await page.getByText('처음이라면 가벼운 강도로 시작해 볼까요?',{exact:true}).waitFor();
              assert.deepEqual(naturalRequests,[{version:3,consent:true,question,history:[]}]);
              await ask('요일 무관하고 오후7시 이후');
              await page.locator('.turn.assistant').nth(2).getByText('처음이라면 가벼운 강도로 시작해 볼까요?').waitFor();
              await ask('2-3번');
              await page.getByText(/그룹 기간권 주 2회 · 398,000원/).waitFor();
              assert.deepEqual(naturalRequests[2].history.filter(turn=>turn.role==='user').map(turn=>turn.text),
                [question,'요일 무관하고 오후7시 이후']);
              assert.equal(naturalRequests[2].question,'2-3번');
              assert(naturalRequests.every(packet=>Object.keys(packet).sort().join(',')==='consent,history,question,version'));
              await ask('내 수강권은 몇 번 남았어요?');
              await page.getByRole('link',{name:'회원 앱에서 확인하는 방법'}).waitFor();
              await ask('저는 김가람입니다');
              assert.equal(naturalRequests.length,3);
              assert.equal(await page.getByText('저는 김가람입니다',{exact:true}).count(),0);
              assert.equal(await consent.isVisible(),false);
              await ask('예약 취소는요?');
              await page.getByText('고정 예약인가요, 자유 예약인가요?').waitFor();
              await page.getByText('GPT 답변을 지금 받을 수 없어 기본 안내로 답해요.',{exact:false}).waitFor();
              assert(await page.getByText('명지점 상담 · 기본 안내',{exact:true}).isVisible());
              assert.deepEqual(naturalRequests.at(-1).history,[]);
            }
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
