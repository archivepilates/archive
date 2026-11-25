import {createHash,createHmac,pbkdf2Sync,randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {archiveAutomationPath} from './lib/archive-automation-paths.mjs';

const require=createRequire(import.meta.url);
const {Client}=require('../services/archive-help-member-access/node_modules/pg');
const project='vrmtkewdqgcrhpbeijhr';
const host='aws-0-ap-northeast-2.pooler.supabase.com';
const caUrl='https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt';
const roles={
  auth:['archive_help_member_auth_app','archive_help_member_auth_runtime',true],
  issuer:['archive_help_pass_issuer_app','archive_help_pass_session_issuer',false],
  reader:['archive_help_pass_reader_app','archive_help_pass_reader',false],
  enrollment:['archive_help_enrollment_writer_app','archive_help_enrollment_writer',false],
  snapshot:['archive_help_snapshot_writer_app','archive_help_pass_writer',false],
};
const preflight=`SELECT r.rolcanlogin AS login,
  NOT (r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
  AND (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid)=1
  AND EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid
    WHERE m.member=r.oid AND p.rolname=$2 AND NOT m.admin_option
    AND m.set_option=$3 AND m.inherit_option=NOT $3 AND NOT p.rolcanlogin
    AND NOT (p.rolsuper OR p.rolcreaterole OR p.rolcreatedb OR p.rolreplication OR p.rolbypassrls))
  AND NOT EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.member
    WHERE m.roleid=r.oid AND NOT m.admin_option)
  AND NOT EXISTS(SELECT FROM pg_roles o WHERE o.oid<>r.oid AND o.rolname<>$2
    AND pg_has_role(r.oid,o.oid,'MEMBER'))
  AND NOT EXISTS(SELECT FROM pg_namespace s WHERE s.nspname LIKE 'archive_history%'
    AND has_schema_privilege(r.oid,s.oid,'USAGE')) AS isolated
  FROM pg_roles r WHERE r.rolname=$1`;

function verifier(password){
  const salt=randomBytes(16);
  const salted=pbkdf2Sync(password,salt,4096,32,'sha256');
  const hmac=label=>createHmac('sha256',salted).update(label).digest();
  const client=createHash('sha256').update(hmac('Client Key')).digest('base64');
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${client}:${hmac('Server Key').toString('base64')}`;
}

function connect(role,password,ca){
  return new Client({host,port:5432,user:role+'.'+project,password,database:'postgres',
    ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:6000,statement_timeout:8000,
    query_timeout:10000,application_name:'archive-help-dedicated-enrollment'});
}

async function verify(config){
  for(const [kind,[role,parent,explicitSet]] of Object.entries(roles)){
    const db=connect(role,config.logins[kind].password,config.ca);
    db.on('error',()=>{});
    try{
      await db.connect();
      const {rows:[identity]}=await db.query(`SELECT current_user AS name,
        current_user=session_user AS direct,
        pg_has_role(current_user,$1,'USAGE') AS inherited,
        pg_has_role(current_user,$1,'SET') AS settable`,[parent]);
      const {rows:[rights]}=await db.query(preflight,[role,parent,explicitSet]);
      if(identity?.name!==role||identity.direct!==true||identity.inherited===explicitSet
        ||identity.settable!==explicitSet||rights?.isolated!==true||rights.login!==true)throw Error('role mismatch');
    }finally{await db.end();}
  }
}

function validateConfig(config){
  if(config?.project!==project||config.host!==host||!config.ca?.startsWith('-----BEGIN CERTIFICATE-----')
    ||config.ca.length>8192||Object.keys(config.logins??{}).length!==Object.keys(roles).length
    ||Object.entries(roles).some(([kind,[role]])=>config.logins[kind]?.role!==role
      ||!/^[A-Za-z0-9_-]{48}$/u.test(config.logins[kind]?.password??''))
    ||new Set(Object.values(config.logins).map(x=>x.password)).size!==Object.keys(roles).length)throw Error('invalid enrollment config');
}

let stage='local preflight',admin,terminal;
try{
  const mode=process.argv[2];
  if(process.argv.length!==3||!['--activate','--verify'].includes(mode)
    ||mode==='--activate'&&(!process.stdin.isTTY||!process.stdout.isTTY))throw Error('expected local Terminal');
  for(const [path,mask] of [[archiveAutomationPath('secrets'),0o022],[archiveAutomationPath('secrets','supabase'),0o077]]){
    const info=await lstat(path);
    if(!info.isDirectory()||info.uid!==process.getuid()||info.mode&mask)throw Error('unsafe private directory');
  }
  const path=archiveAutomationPath('secrets','supabase','help-member-dedicated-logins.json');
  let config;
  if(mode==='--verify'){
    stage='private candidate readback';
    const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      const info=await fd.stat();
      if(!info.isFile()||info.uid!==process.getuid()||info.mode&0o077||info.size>14000)throw Error('invalid candidate');
      config=JSON.parse(await fd.readFile('utf8'));
    }finally{await fd.close();}
  }else{
    if(await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error;}))throw Error('existing candidate; verify only');
    stage='TLS certificate';
    const response=await fetch(caUrl,{signal:AbortSignal.timeout(6000),redirect:'error'});
    if(!response.ok)throw Error('CA unavailable');
    config={project,host,ca:await response.text(),logins:Object.fromEntries(Object.entries(roles).map(
      ([kind,[role]])=>[kind,{role,password:randomBytes(36).toString('base64url')}]))};
    validateConfig(config);
    stage='existing database authentication';
    const silent=new Writable({write(_chunk,_encoding,done){done();}});
    terminal=createInterface({input:process.stdin,output:silent,terminal:true,historySize:0});
    terminal.on('SIGINT',()=>terminal.close());
    process.stdout.write('Existing Supabase pilot database password (hidden): ');
    let password=await terminal.question('');
    terminal.close();terminal=null;process.stdout.write('\n');
    if(!password)throw Error('missing password');
    admin=connect('postgres',password,config.ca);password='';
    admin.on('error',()=>{});
    await admin.connect();
    await admin.query('BEGIN');
    try{
      stage='staged role and credential log guard';
      for(const tuple of Object.values(roles)){
        const {rows:[row]}=await admin.query(preflight,tuple);
        if(row?.login!==false||row.isolated!==true)throw Error('Unexpected staged role');
      }
      // Supabase credential provisioning fallback: suppress logging only in
      // this transaction. PostgreSQL role DDL cannot bind a password argument.
      await admin.query(`SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic';
        SET LOCAL log_min_messages='fatal'; SET LOCAL pgaudit.log='none';
        SET LOCAL pg_stat_statements.track_utility='off'`);
      stage='save private candidates before any activation';
      const fd=await open(path,'wx',0o600);
      try{await fd.writeFile(JSON.stringify(config)+'\n');await fd.sync();}finally{await fd.close();}
      stage='dedicated role activation';
      for(const [kind,[role]] of Object.entries(roles)){
        const value=verifier(config.logins[kind].password);
        if(!/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/u.test(value))
          throw Error('invalid verifier');
        await admin.query(`ALTER ROLE ${role} LOGIN PASSWORD '${value}'`);
      }
      await admin.query('COMMIT');
    }catch(error){
      await admin.query('ROLLBACK').catch(()=>{});
      throw error;
    }
  }
  stage='dedicated TLS readback';
  validateConfig(config);
  await verify(config);
  console.log('VERIFIED: five isolated DB logins. No member data or messages sent. Tell Codex VERIFIED only.');
}catch(error){
  const code=/^[0-9A-Z]{5}$/u.test(error?.code??'')?' ('+error.code+')':'';
  console.error('Stopped at '+stage+code+'. Do not retry uncertain activation. Report the stage only, never the password.');
  process.exitCode=1;
}finally{
  terminal?.close();
  if(admin)await admin.end().catch(()=>{});
}
