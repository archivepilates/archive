import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const runtime='/Users/archivepilates/dev/archive-in-runtime';
const secrets='/Users/archivepilates/archive-automation/secrets/supabase';
const project='vrmtkewdqgcrhpbeijhr', role='archive_lesson_history_writer';
const area='/Users/archivepilates/archive-automation/operations/2026-11-20-supabase-history-pilot';
const { checkLogging }=await import(area+'/import-october-partial-postgres.mjs');
const sha=x=>createHash('sha256').update(x).digest('hex');
const day=/^20\d{2}-\d{2}-\d{2}$/;
const hex=/^[a-f0-9]{64}$/;

async function readPrivate(path, bytes) {
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {const d=await f.stat();assert(d.isFile()&&d.uid===process.getuid()&&!(d.mode&0o077)&&d.size<=bytes);
    return await f.readFile();}
  finally{await f.close();}
}

async function readManifest(dir, name) {
  const m=JSON.parse(await readPrivate(join(dir,name),20000));
  assert(m.from+'.manifest.json'===name&&day.test(m.from)&&day.test(m.through)&&
    m.from>='2025-01-01'&&m.from<=m.through&&m.from.slice(0,7)===m.through.slice(0,7)&&
    Number.isSafeInteger(m.sourceRows)&&m.sourceRows>0&&Number.isSafeInteger(m.acceptedRows)&&m.acceptedRows>0&&m.acceptedRows<=m.sourceRows&&
    hex.test(m.sourceSha)&&hex.test(m.payloadSha)&&Number.isFinite(Date.parse(m.observedAt)));
  assert(Object.values(m.held??{}).every(Number.isSafeInteger));
  assert.equal(m.sourceRows,m.acceptedRows+Object.values(m.held??{}).reduce((a,b)=>a+b,0));
  const body=await readPrivate(join(dir,m.from+'.payload.json'),4000000);
  assert.equal(sha(body),m.payloadSha);
  if(m.kind==='reservation_excel') {
    assert.equal(sha(await readPrivate(join(dir,m.from+'.source.xlsx'),20000000)),m.sourceSha);
  } else assert.equal(m.kind,'member_usage_excel');
  const rows=JSON.parse(body.toString('utf8'));
  const allowed=new Set(['attendance','absence','noshow','cancel','booked','booking_confirmed','booking_waiting','wait_cancel']);
  assert(Array.isArray(rows)&&rows.length===m.acceptedRows&&new Set(rows.map(row=>row.key)).size===rows.length);
  const clock=x=>x===null||/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
  assert(rows.every(r=>Object.keys(r).length===7&&hex.test(r.key)&&hex.test(r.member_key)&&day.test(r.service_day)&&
    r.service_day>=m.from&&r.service_day<=m.through&&clock(r.start_time)&&clock(r.end_time)&&
    ['group','private',null].includes(r.lesson_type)&&allowed.has(r.status)));
  return {m, rows, body:body.toString('utf8')};
}

async function connect(){
  const c=JSON.parse(await readPrivate(join(secrets,'lesson-history-writer.json'),40000));
  assert(c.project===project&&c.role===role&&/^aws-\d+-ap-northeast-2\.pooler\.supabase\.com$/.test(c.host)&&
    /^[a-zA-Z0-9_-]{64}$/.test(c.password)&&new X509Certificate(c.ca).ca);
  const {Client}=createRequire(runtime+'/services/archivepilates-mcp/package.json')('pg');
  const db=new Client({host:c.host,port:5432,database:'postgres',user:c.role+'.'+project,password:c.password,
    ssl:{ca:c.ca,rejectUnauthorized:true},connectionTimeoutMillis:8000,query_timeout:20000,application_name:'archive-lesson-history-import'});
  db.on('error',()=>{});
  try{
    await db.connect();
    const {rows:[r]}=await db.query("SELECT current_user AS actor,session_user AS login,NOT has_table_privilege(current_user,'archive_lesson_history.booking','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS restricted");
    assert(r?.actor===role&&r.login===role&&r.restricted);
    return db;
  }catch(e){await db.end().catch(()=>{});throw e;}
}

async function receipt(db,day){
  return (await db.query('SELECT archive_lesson_history.receipt($1::date) AS r',[day])).rows[0].r;
}

function requireSame(r,m) {
  assert(r&&r.from===m.from&&r.through===m.through&&r.sourceKind===m.kind&&r.sourceRows===m.sourceRows&&
    r.acceptedRows===m.acceptedRows&&r.sourceSha===m.sourceSha&&r.digest===m.payloadSha);
}

async function upload(dir, batches){
  let connection=await connect();
  try{
    for(const name of batches){
      const {m,rows,body}=await readManifest(dir,name), before=await receipt(connection,m.from);
      requireSame(before,m);
      let sent=false;
      if(!before.loaded) {
        await connection.query('BEGIN');
        try{
          await connection.query("SET LOCAL lock_timeout='3s'");
          await connection.query("SET LOCAL statement_timeout='4s'");
          await connection.query("SET LOCAL plan_cache_mode='force_generic_plan'");
          await checkLogging(connection);
          const sentResult=(await connection.query('SELECT archive_lesson_history.publish($1::date,$2::text) AS r',
            [m.from,body])).rows[0].r;
          requireSame(sentResult,m);
          assert(sentResult.loaded&&sentResult.verified);
          sent=true;
          await connection.query('COMMIT');
        }catch(error){
          await connection.query('ROLLBACK').catch(()=>{});
          if(!sent)throw error;
        }
        await connection.end().catch(()=>{});
        connection=await connect();
      }
      const after=await receipt(connection,m.from);
      requireSame(after,m);
      assert(after.loaded&&after.verified&&after.bookings===m.acceptedRows&&hex.test(after.rowsDigest));
      const status=rows.reduce((out,x)=>{out[x.status]=(out[x.status]??0)+1;return out;},{});
      assert.deepEqual(after.statuses,status);
      console.log(JSON.stringify({from:m.from,through:m.through,stored:after.bookings,alreadyStored:before.loaded,
        sourceRows:m.sourceRows,held:m.held,verified:true}));
    }
  }finally{await connection.end().catch(()=>{});}
}

const [mode, path, ...only]=process.argv.slice(2);
try {
  assert(['--plan','--apply'].includes(mode)&&path);
  const dir=resolve(path), d=await lstat(dir);
  assert(d.isDirectory()&&d.uid===process.getuid()&&!(d.mode&0o077));
  const all=(await readdir(dir)).filter(n=>/^20\d{2}-\d{2}-\d{2}\.manifest\.json$/.test(n)).sort();
  const batches=only.length?only.map(n=>n+'.manifest.json'):all;
  assert(batches.length>0&&batches.length<=30&&new Set(batches).size===batches.length&&batches.every(x=>all.includes(x)));
  if(mode==='--plan'){
    const manifests=[];for(const name of batches)manifests.push((await readManifest(dir,name)).m);
    console.log(JSON.stringify(manifests));
  }else await upload(dir,batches);
}catch(error){console.log(JSON.stringify({ok:false,error:/^[A-Z0-9_]{3,45}$/.test(error?.code??'')?error.code:'IMPORT_NOT_VERIFIED'}));process.exitCode=1;}
