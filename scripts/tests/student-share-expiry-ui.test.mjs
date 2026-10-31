import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

test('expiry operating note fits mobile, tablet and desktop without external requests',async t=>{
  const root=new URL('../../',import.meta.url);
  const html=await readFile(new URL('core/rules/index.html',root),'utf8');
  const css=(await Promise.all(['styles.css','interface.css'].map(name=>readFile(new URL('core/assets/'+name,root),'utf8')))).join('\n');
  const output=new URL('artifacts/student-share-expiry-ui/',root);await mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({offline:true,serviceWorkers:'block',reducedMotion:'reduce'});
    try{
      await context.route('**/*',route=>route.abort());
      const page=await context.newPage();
      const inert=await page.evaluate(source=>{
        const doc=new DOMParser().parseFromString(source,'text/html');
        const note=doc.querySelector('#student-share-expiry-worker');
        if(!note)throw Error('Missing note');return note.outerHTML;
      },html);
      for(const width of [320,390,768,1440])await t.test(`${width}px`,async()=>{
        await page.setViewportSize({width,height:1100});
        await page.setContent('<!doctype html><meta charset="utf-8"><style>'+css+'</style><main style="padding:16px;max-width:900px;margin:auto">'+inert+'</main>');
        const box=page.locator('#student-share-expiry-worker');
        const data=await box.evaluate(node=>{
          const r=node.getBoundingClientRect(),issues=[];
          const w=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let n;
          while((n=w.nextNode())){
            if(!n.textContent.trim())continue;
            const range=document.createRange();range.selectNodeContents(n);
            for(const line of range.getClientRects())if(line.left<r.left-1||line.right>r.right+1)issues.push('text overflow');
          }
          return {left:r.left,right:r.right,client:node.clientWidth,scroll:node.scrollWidth,issues,text:node.textContent};
        });
        assert(data.left>=0&&data.right<=width);assert(data.scroll<=data.client+1);assert.deepEqual(data.issues,[]);
        assert.match(data.text,/960시간/);assert.match(data.text,/e-2/);assert.match(data.text,/만료 전에는 아임웹 원격 조회/);
        await page.screenshot({path:new URL(`rules-${width}.png`,output).pathname});
      });
      assert.equal(await page.locator('script').count(),0);
    }finally{await context.close();}
  }finally{await browser.close();}
});
