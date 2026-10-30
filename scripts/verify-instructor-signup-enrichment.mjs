import assert from 'node:assert/strict';
import { readFile,lstat,realpath,open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { normalizeInstructorLessonPhone as phone,normalizeInstructorLessonName as name } from './lib/instructor-lesson-registration-contract.mjs';
import { signupProfileMemoPresent } from './lib/instructor-signup-profile.mjs';
import { normalizeSignupBirthDateV2,resolveSignupBirthDateV2,SIGNUP_SIX_DIGIT_BIRTH_POLICY } from './lib/instructor-signup-profile-v2-policy.mjs';
import { splitSignupPostalAddress,signupPostalAddressKey } from './lib/instructor-signup-profile-v2-writer.mjs';

const args=process.argv.slice(2),file=args.find(x=>x.startsWith('--queue='))?.slice(8);
const dir='/Users/archivepilates/ArchiveIN/operations/instructor-signup-enrichment-20261030';
assert(args.length===1&&file&&(await realpath(file)).startsWith(dir+'/'));
const stat=await lstat(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0);
const input=JSON.parse(await readFile(file,'utf8'));assert(input.ok&&input.apply&&Array.isArray(input.results)&&input.results.length>0&&input.results.length<=200);
const ids=input.results.map(x=>x.jobId);assert(new Set(ids).size===ids.length&&ids.every(x=>/^instructor_member_completion_[a-f0-9]{32}$/.test(x)));
const require=createRequire(import.meta.url),admin=require('../firebase/kangsain-functions/functions/node_modules/firebase-admin');
const app=admin.initializeApp({projectId:'archive-pilates',credential:admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json','utf8')))});
const db=app.firestore(),sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const report={ok:false,checkedAt:new Date().toISOString(),rows:[],operationalWrites:0,cleanup:{contextClosed:false,lockReleased:false}};
let context,release;
try{
  release=await acquireStudioMateBrowserLock({owner:'instructor-signup-enrichment-verification',waitMs:120000,staleMs:Number.MAX_SAFE_INTEGER});
  const {chromium}=await import('playwright');
  context=await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/browser-profile',{headless:true,serviceWorkers:'block',acceptDownloads:false});
  await context.route('**/*',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort());
  const page=await context.newPage();
  for(const jobId of ids){
    const job=(await db.doc('studiomateMemoWriteJobs/'+jobId).get()).data(),memo=(await db.doc('memberMemos/'+jobId).get()).data();
    assert(job?.jobId===jobId&&job.profileUpdate?.version===2&&job.status==='done'&&memo?.syncStatus==='synced'&&memo.content===job.content);
    const id=String(job.memberId),progress=job.profileStatus;assert(/^[1-9]\d*$/.test(id)&&progress?.beforeFieldHashes);
    await page.goto('https://arcpilates.studiomate.kr/users/detail?id='+id,{waitUntil:'networkidle',timeout:60000});
    const memoBody=await page.locator('body').innerText();
    assert(signupProfileMemoPresent(memoBody,job.content));
    const normalize=s=>s.replace(/\s+/g,' ').trim();
    assert(normalize(memoBody).split(normalize(job.content)).length-1===1,'Completion note is not uniquely visible');
    await page.getByRole('heading',{name:job.memberName,exact:true}).waitFor({state:'visible'});
    await page.getByRole('button',{name:'회원정보 수정',exact:true}).click();
    await page.waitForFunction(expected=>{
      const inputs=[...document.querySelectorAll('input')].filter(n=>n.getClientRects().length);
      return inputs.some(n=>n.getAttribute('placeholder')==='휴대폰 번호'&&n.value.replace(/\D/g,'')===expected)
        &&inputs.some(n=>n.value==='강사회원');
    },phone(job.memberPhone),{timeout:20000});
    const field=p=>page.getByRole('textbox').and(page.getByPlaceholder(p,{exact:true})).filter({visible:true});
    assert(new URL(page.url()).origin==='https://arcpilates.studiomate.kr'&&new URL(page.url()).pathname==='/users/create'
      &&new URL(page.url()).searchParams.get('id')===id&&phone(await field('휴대폰 번호').inputValue())===phone(job.memberPhone)&&name(await field('이름을 입력해주세요').inputValue())===name(job.memberName));
    const values={birthDate:await field('생년월일 (YYYY-MM-DD)').inputValue(),address:await field('주소를 입력해 주세요').inputValue(),detail:await field('상세 주소를 입력해 주세요').inputValue()};
    const protectedFields=await page.locator('input').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&['이름을 입력해주세요','휴대폰 번호','등록일을 입력해주세요','선택'].includes(n.getAttribute('placeholder'))).map(n=>({placeholder:n.getAttribute('placeholder'),value:n.value})));
    assert(sha(protectedFields)===progress.beforeFieldHashes.protectedHash);
    if(['verified','already_equal'].includes(progress.birthDate.status)){
      const resolution=progress.birthDate.resolution;
      if(resolution){
        assert(resolution.policy===SIGNUP_SIX_DIGIT_BIRTH_POLICY&&['native_full_match','current_year_rule'].includes(resolution.source));
        const reference=new Date(resolution.referenceAt);
        assert(Number.isFinite(reference.getTime())&&reference.getTime()<=Date.now());
        const expected=resolveSignupBirthDateV2({expected:job.profileUpdate.birthDateRaw,
          current:resolution.source==='native_full_match'?values.birthDate:'',now:reference});
        assert(expected.status==='verified'&&expected.resolution?.source===resolution.source
          &&values.birthDate===expected.value&&sha(values.birthDate)===progress.birthDate.expectedHash);
      }else assert(values.birthDate===normalizeSignupBirthDateV2(job.profileUpdate.birthDateRaw).value);
    }
    else assert(sha(values.birthDate)===progress.beforeFieldHashes.birthDate);
    if(progress.address.status==='verified'){
      const parts=splitSignupPostalAddress(job.profileUpdate.addressRaw);assert(parts&&values.address&&values.detail===parts.detail);
      assert(signupPostalAddressKey(values.address)===signupPostalAddressKey(parts.base));
    }else assert(sha(values.address)===progress.beforeFieldHashes.address&&sha(values.detail)===progress.beforeFieldHashes.detail);
    report.rows.push({jobId,memberId:id,status:'verified',birthDate:progress.birthDate.status,address:progress.address.status,memo:'synced',checkedAt:new Date().toISOString()});
  }
  report.ok=true;
}catch{report.error='Native enrichment verification incomplete; inspect exact canonical job before any retry';process.exitCode=1;}
finally{
  if(context){await context.close();report.cleanup.contextClosed=true;}
  if(release){await release();report.cleanup.lockReleased=true;}
  await app.delete();
  const output=dir+'/verified-'+Date.now()+'.json',f=await open(output,'wx',0o600);
  try{await f.writeFile(JSON.stringify(report,null,2));await f.sync();}finally{await f.close();}
  console.log(JSON.stringify({ok:report.ok,verified:report.rows.length,total:ids.length,output,cleanup:report.cleanup,error:report.error}));
}
