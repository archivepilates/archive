import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,webkit} from 'playwright';

for(const [engine,browserType]of [['chromium',chromium],['webkit',webkit]])test(`${engine}: member link is primary, safe on mobile and opens a new tab without replacing the inquiry`,async()=>{
  const browser=await browserType.launch({headless:true});
  try{
    const html=fs.readFileSync('core/inquiries/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'');
    const css=fs.readFileSync('core/assets/member-inquiries.css','utf8');
    const icons=fs.readFileSync('core/assets/ui-icons.js','utf8').replace('export function uiIcon','function uiIcon');
    const source=icons+'\n'+fs.readFileSync('core/assets/member-inquiries.js','utf8').replace(/^import .*\n/gm,'').replace('initCoreNavigationDocument();','').replace(/initialize\(\)\.catch\([\s\S]*$/,'');
    for(const width of [320,390,768,1366]){
      const context=await browser.newContext({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768});
      try{
        await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<title>Synthetic member destination</title>'}));
        const page=await context.newPage();await page.setContent(`<style>${css}</style>${html}`);
        await page.evaluate(source+`
          schema={categories:{}};access={manager:true,staffId:'manager',assignees:[]};
          const base={id:'test',category:'other',answers:{},memberName:'가상회원',memberPhone:'테스트 연락처',status:'received',revision:1};
          window.showLink=link=>showRow({...base,memberLink:link},[]);
          window.clearLink=()=>clearPrivate();$('workspace').hidden=false;
          window.showLink({status:'ready',url:'https://arcpilates.studiomate.kr/users/detail?id=123'});
        `);
        const link=page.locator('#open-studiomate-member');
        assert(await page.getByRole('link',{name:'StudioMate 회원 열기',exact:true}).isVisible());
        assert(await link.isVisible());assert.equal(await link.getAttribute('target'),'_blank');
        assert.match(await link.getAttribute('rel'),/noopener/);assert.match(await link.getAttribute('rel'),/noreferrer/);
        assert.equal(await page.locator('#stored-context-panel').evaluate(el=>el.open),false);
        assert.equal(await page.locator('#load-context').isVisible(),false);
        assert((await link.boundingBox()).height>=44);
        const prior=page.url(),opened=context.waitForEvent('page');await link.click();const popup=await opened;
        await popup.waitForLoadState('domcontentloaded');assert.equal(popup.url(),'https://arcpilates.studiomate.kr/users/detail?id=123');
        assert.equal(await popup.evaluate(()=>window.opener===null),true);assert.equal(page.url(),prior);await popup.close();
        for(const value of [{status:'ambiguous'},{status:'incomplete'},{status:'unavailable'},{status:'ready',url:'javascript:alert(1)'},{status:'ready',url:'https://arcpilates.studiomate.kr.evil.test/users/detail?id=123'},{status:'ready',url:'https://arcpilates.studiomate.kr/users/detail?id=123&other=1'}]){
          await page.evaluate(value=>window.showLink(value),value);assert.equal(await link.isVisible(),false);assert.equal(await link.getAttribute('href'),null);
        }
        await page.evaluate(()=>window.showLink({status:'ready',url:'https://arcpilates.studiomate.kr/users/detail?id=123'}));
        await page.locator('#stored-context-panel summary').click();assert(await page.locator('#load-context').isVisible());
        await page.evaluate(()=>window.showLink(null));assert.equal(await link.getAttribute('href'),null);assert.equal(await page.locator('#stored-context-panel').evaluate(el=>el.open),false);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.evaluate(()=>window.showLink({status:'ready',url:'https://arcpilates.studiomate.kr/users/detail?id=123'}));
        fs.mkdirSync('output/playwright/member-inquiry-member-link',{recursive:true});await page.screenshot({path:`output/playwright/member-inquiry-member-link/${engine}-${width}.png`,fullPage:true});
        await page.evaluate(()=>window.clearLink());assert.equal(await link.getAttribute('href'),null);
      }finally{await context.close();}
    }
  }finally{await browser.close();}
});
