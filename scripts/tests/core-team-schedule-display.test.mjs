import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url);
const source = await fs.readFile(new URL('core/assets/app.js', root), 'utf8');
const functions = new Map([...source.matchAll(/^(?:async )?function (\w+)\([^]*?^\}/gm)].map(m => [m[1],m[0]]));
const names = ['qs','setText','escapeHtml','toNumber','instructorLessonScheduleTimeLabel',
  'instructorLessonScheduleDateLabel','instructorLessonScheduleSourceLabel','instructorLessonMethodTitle',
  'instructorLessonSchedulePresentation','renderInstructorLessonSchedule','renderInstructorLessonRoster',
  'instructorLessonCancellationKey','instructorLessonCancellationStatusLabel','canCancelInstructorLesson'];
for (const name of names) assert.ok(functions.has(name),name);
const code = names.map(name => functions.get(name)).join('\n');
const fixture = () => ({items:[],schedule:{items:[
  {date:'2026-11-20',courseKind:'team',lessonTime:'14:00',metadataSource:'registration',capacitySource:'default',
    lessonTopic:'ARCHIVE METHOD #1 직장인 증후군',occupiedCount:6,capacity:10,remainingSeats:4,countSource:'registrations',roster:[]},
  {date:'2026-11-21',startAt:'2026-11-21T13:30:00+09:00',endAt:'2026-11-21T15:20:00+09:00',
    capacitySource:'lecture',occupiedCount:5,capacity:5,remainingSeats:0,countSource:'tickets',roster:[]},
  ...['2026-11-28','2026-11-29'].map(date => ({date,capacitySource:'lecture',occupiedCount:4,capacity:10,remainingSeats:6,countSource:'tickets',roster:[]})),
]}});
function bootstrap(data) {
  return `const state={instructorLessonRegistrationDashboard:${JSON.stringify(data)}};
    let selectedInstructorLessonDate='2026-11-20',instructorLessonCancellationBusy=false;
    const instructorLessonCancellationReceipts=new Map(),readUnavailable=()=>false,coreHref=p=>'/core/'+p;
    ${code}
    globalThis.qa={state,render:renderInstructorLessonSchedule,roster:renderInstructorLessonRoster,presentation:instructorLessonSchedulePresentation};`;
}
test('approved dates are display-only, preserve times, capacities and conflict guards',()=>{
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:''});return elements.get(id);};
  const data=fixture(),before=JSON.stringify(data);
  const ctx={document:{getElementById:element,documentElement:{dataset:{coreAccess:'manager'}}}};
  vm.runInNewContext(bootstrap(data),ctx);
  ctx.qa.render();
  const html=element('instructorLessonScheduleList').innerHTML;
  assert.equal((html.match(/instructor-seat-item is-team/g)||[]).length,2);
  assert.equal((html.match(/instructor-seat-item is-standard/g)||[]).length,2);
  assert.match(html,/14:00~15:50/);assert.match(html,/13:30–15:20/);
  assert.match(html,/ARCHIVE METHOD #9 외부피드백2/);
  assert.match(element('instructorLessonScheduleDetail').innerHTML,/팀레슨.*14:00~15:50/);
  assert.equal(element('instructorLessonScheduleSummary').textContent,'4개 일정 · 잔여 12석 · 팀 1개 정원 확인 전');
  assert.equal(JSON.stringify(ctx.qa.state.instructorLessonRegistrationDashboard),before);
  assert.equal(ctx.qa.presentation({date:'2026-11-20',startAt:'2026-11-20T15:00:00+09:00'}).timeLabel,'시간 확인 필요');
  assert.equal(ctx.qa.presentation({date:'2027-11-20'}).isTeam,false);
  assert.equal(ctx.qa.presentation({date:'2026-12-01',courseKind:'team'}).isTeam,true);
  ctx.qa.state.instructorLessonRegistrationDashboard.schedule.items[0].metadataSource='conflict';
  ctx.qa.render();
  assert.match(element('instructorLessonScheduleDetail').innerHTML,/접수 정보 확인필요/);
  assert.doesNotMatch(element('instructorLessonScheduleDetail').innerHTML,/14:00~15:50/);
});
test('actual HTML and CSS: distinct Team cards fit 320/390/768/1440', {timeout:60000},async()=>{
  const output=new URL('artifacts/team-schedule-display-qa/',root);await fs.mkdir(output,{recursive:true});
  const html=(await fs.readFile(new URL('core/instructor-lessons/index.html',root),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'');
  const css=(await fs.readFile(new URL('core/assets/styles.css',root),'utf8'))+'\n'+await fs.readFile(new URL('core/assets/interface.css',root),'utf8');
  const browser=await chromium.launch({headless:true});const results=[];
  try{for(const width of [320,390,768,1440]){
    const context=await browser.newContext({viewport:{width,height:1000},offline:true,serviceWorkers:'block',locale:'ko-KR'});
    try{
      await context.route('**/*',r=>r.abort());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setContent(html);await page.addStyleTag({content:css});
      await page.addScriptTag({content:bootstrap(fixture())+`document.documentElement.dataset.coreAccess='manager';qs('coreAccessLoading').remove();document.querySelectorAll('details').forEach(n=>n.open=true);qa.render();`});
      assert.equal(await page.locator('.instructor-seat-item.is-team').count(),2);
      assert.equal(await page.locator('.instructor-seat-item.is-standard').count(),2);
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
        cards:[...document.querySelectorAll('.instructor-seat-item')].map(n=>({text:n.innerText,bg:getComputedStyle(n).backgroundColor,width:n.clientWidth,scroll:n.scrollWidth,
          overflow:[...n.querySelectorAll('*')].filter(c=>c.scrollWidth>c.clientWidth+1).map(c=>c.className)}))}));
      assert.ok(layout.scroll<=width,JSON.stringify(layout));
      assert.notEqual(layout.cards[0].bg,layout.cards[2].bg);
      assert.deepEqual(layout.cards.flatMap(c=>c.overflow),[],JSON.stringify(layout));
      assert.match(layout.cards[0].text,/팀레슨.*11월 20일/s);assert.match(layout.cards[1].text,/팀레슨.*11월 21일/s);
      assert.match(layout.cards[2].text,/정규레슨/);assert.deepEqual(errors,[]);
      await page.screenshot({path:new URL(`${width}.png`,output).pathname,fullPage:true});results.push(layout);
    }finally{await context.close();}
  }}finally{await browser.close();}
  await fs.writeFile(new URL('layout.json',output),JSON.stringify({syntheticOnly:true,results,browserClosed:true},null,2));
});
