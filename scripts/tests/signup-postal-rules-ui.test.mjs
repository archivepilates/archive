import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {MEAL_RELEASE_TARGETS,mealReleaseManifest} from '../release-team-instructor-intake-20261029.mjs';

test('postal-readback release changes only the rules resource',()=>{
  assert.deepEqual(MEAL_RELEASE_TARGETS.signupPostalReadback.files,{'/rules/index.html':'core/rules/index.html'});
  const before='a'.repeat(64),after='b'.repeat(64),files=[{path:'/rules/index.html',hash:before},{path:'/assets/app.js',hash:before}];
  const manifest=mealReleaseManifest(files,{'/rules/index.html':after},'signupPostalReadback');
  assert.equal(manifest['/assets/app.js'],before);
  assert.throws(()=>mealReleaseManifest(files,{'/rules/index.html':after,'/assets/app.js':after},'signupPostalReadback'));
});
test('postal operating note fits mobile/tablet/desktop with inert local CSS',async t=>{
  const root=new URL('../../',import.meta.url),html=await readFile(new URL('core/rules/index.html',root),'utf8');
  const css=(await Promise.all(['styles.css','interface.css'].map(n=>readFile(new URL('core/assets/'+n,root),'utf8')))).join('\n');
  const dir=new URL('artifacts/signup-postal-rules/',root);await mkdir(dir,{recursive:true});
  const browser=await chromium.launch({headless:true});
  try{const ctx=await browser.newContext({offline:true,serviceWorkers:'block'});
    try{await ctx.route('**/*',r=>r.abort());const page=await ctx.newPage();
      const note=await page.evaluate(s=>new DOMParser().parseFromString(s,'text/html').querySelector('#instructor-signup-address-readback-20261101').outerHTML,html);
      for(const width of [320,390,768,1440])await t.test(`${width}px`,async()=>{
        await page.setViewportSize({width,height:1000});
        await page.setContent('<!doctype html><meta charset="utf-8"><style>'+css+'</style><main style="padding:16px;max-width:900px;margin:auto"><ul>'+note+'</ul></main>');
        const item=page.locator('#instructor-signup-address-readback-20261101');
        const result=await item.evaluate(n=>{const b=n.getBoundingClientRect(),bad=[];const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let x;
          while((x=w.nextNode())){if(!x.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(x);for(const a of r.getClientRects())if(a.left<b.left-1||a.right>b.right+1)bad.push('text overflow');}
          return {left:b.left,right:b.right,client:n.clientWidth,scroll:n.scrollWidth,bad,text:n.textContent};});
        assert(result.left>=0&&result.right<=width);assert(result.scroll<=result.client+1);assert.deepEqual(result.bad,[]);
        assert.match(result.text,/다른 행·여러 후보·부분 문자열/);assert.match(result.text,/기존 회원정보는 자동 덮어쓰기하지 않으며/);
        await page.screenshot({path:new URL(`rules-${width}.png`,dir).pathname});
      });assert.equal(await page.locator('script').count(),0);
    }finally{await ctx.close();}
  }finally{await browser.close();}
});
