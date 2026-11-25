import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {ORIGIN} from './accounts.mjs';
import {createHostedHelpMemberRuntime} from './hosted-runtime.mjs';

const roles={auth:'archive_help_member_auth_runtime',issuer:'archive_help_pass_session_issuer',reader:'archive_help_pass_reader'};
const loader=async()=>null;
function config(){
  const rows={};
  const pools=Object.fromEntries(Object.entries(roles).map(([key,role])=>{
    rows[key]={name:'dedicated_'+key,restricted:true,isolated:true,auth:key==='auth',issuer:key==='issuer',reader:key==='reader'};
    return [key,{connect(){},async query(sql,args){
      assert.match(sql,/current_user = session_user/);assert.deepEqual(args,[role]);
      return {rows:[rows[key]]};
    }}];
  }));
  return {rows,pools,enabled:true,loadEnrollment:loader,loadCurrentBinding:loader,sendCode:loader,
    otpSecret:randomBytes(32),memberKeySecret:randomBytes(32)};
}

test('disabled startup needs no database or transport; distinct restricted capabilities are accepted',async()=>{
  const disabled=await createHostedHelpMemberRuntime();
  assert.equal((await disabled.handle(new Request(ORIGIN))).status,404);
  const runtime=await createHostedHelpMemberRuntime(config());
  assert.equal(typeof runtime.handle,'function');
  assert.equal(typeof runtime.issueInvite,'function');
});

test('connection identity, cross-role inheritance or an elevated login blocks startup',async()=>{
  const same=config();same.pools.reader=same.pools.issuer;
  await assert.rejects(createHostedHelpMemberRuntime(same),/Dedicated member/);
  for(const change of [{issuer:true},{isolated:false},{restricted:false},{name:'dedicated_issuer'}]){
    const cfg=config();Object.assign(cfg.rows.reader,change);
    await assert.rejects(createHostedHelpMemberRuntime(cfg),/role preflight failed: reader/);
  }
  const cfg=config();cfg.pools.reader.query=async()=>{throw Error('private connection string');};
  await assert.rejects(createHostedHelpMemberRuntime(cfg),{message:'Member database role preflight failed: reader'});
});
