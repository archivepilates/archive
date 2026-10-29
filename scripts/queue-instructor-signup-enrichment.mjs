import assert from 'node:assert/strict';
import { readFile,lstat,realpath,mkdir,open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { buildSignupEnrichmentPlan,applySignupEnrichmentPlan } from './lib/instructor-signup-enrichment-queue.mjs';

const args=process.argv.slice(2),apply=args.includes('--apply'),file=args.find(x=>x.startsWith('--sources='))?.slice(10),memberId=args.find(x=>x.startsWith('--member-id='))?.slice(12);
assert(file&&args.every(x=>['--apply',`--sources=${file}`,`--member-id=${memberId}`].includes(x)));
const dir='/Users/archivepilates/ArchiveIN/operations/instructor-signup-enrichment-20261030';
assert((await realpath(file)).startsWith(dir+'/'));const stat=await lstat(file);assert(stat.isFile()&&(stat.mode&0o077)===0&&!stat.isSymbolicLink());
const audit=JSON.parse(await readFile(file,'utf8'));assert(audit.ok===true&&audit.coverage?.complete===true&&Array.isArray(audit.rows));
const rows=audit.rows.filter(row=>row.status==='verified'&&(!memberId||row.member.memberId===memberId));
assert(rows.length>0&&rows.length<=200&&new Set(rows.map(x=>x.member.memberId)).size===rows.length);
const require=createRequire(import.meta.url),admin=require('../firebase/kangsain-functions/functions/node_modules/firebase-admin');
const app=admin.initializeApp({credential:admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json','utf8'))),projectId:'archive-pilates'});
const db=app.firestore(),sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const results=[];
try{
  for(const row of rows){
    const plan=buildSignupEnrichmentPlan(row);
    results.push(await applySignupEnrichmentPlan({db,plan,stamp:()=>admin.firestore.FieldValue.serverTimestamp(),apply}));
  }
  await mkdir(dir,{recursive:true,mode:0o700});const output=dir+`/${apply?'queue':'plan'}-${Date.now()}.json`,f=await open(output,'wx',0o600);
  try{await f.writeFile(JSON.stringify({ok:true,apply,sourceFile:file,sourceHash:sha(audit),results,createdAt:new Date().toISOString()},null,2));await f.sync();}finally{await f.close();}
  console.log(JSON.stringify({ok:true,apply,selected:rows.length,counts:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),output,memberSends:0,nativeWrites:0}));
}finally{await app.delete();}
