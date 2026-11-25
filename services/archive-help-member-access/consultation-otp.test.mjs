import assert from 'node:assert/strict';
import test from 'node:test';
import {createConsultationOtp} from './consultation-otp.mjs';

const MINUTE=60_000, HOUR=60*MINUTE, DAY=24*HOUR;
const timeAt=(time='10:00:00.000')=>Date.parse(`2026-11-25T${time}+09:00`);
const token=n=>Buffer.alloc(32,n).toString('base64url');
const step=token(1), conversation=token(2), otherTab=token(3);
const phone='01000000001', revision='a'.repeat(64), denied={ok:false}, generic={ok:true};

function memoryStore(){
  let records=new Map(), tail=Promise.resolve();
  const id=(kind,key)=>`${kind}:${key}`;
  const read=(source,kind,key,time)=>{
    const row=source.get(id(kind,key));
    return row&&(row.expires===null||row.expires>time)?structuredClone(row.value):null;
  };
  const store={
    read:(...args)=>tail.then(()=>read(records,...args)),
    transaction(run){
      const result=tail.then(async()=>{
        const draft=new Map(records);
        const value=await run({read:async(...args)=>read(draft,...args),
          async put(kind,key,value,expires=null){
            assert.match(kind,/^(otp|otp-budget|session)$/u);
            assert.match(key,/^[a-f0-9]{64}$/u);
            if(kind==='session'&&store.failSessionWrite)throw Error('rolled back');
            draft.set(id(kind,key),{value:structuredClone(value),expires});
          },
          async remove(kind,key){draft.delete(id(kind,key));},
        });
        records=draft;
        if(store.loseNextCommit){
          store.loseNextCommit=false;
          throw Error('commit acknowledgement lost');
        }
        return value;
      });
      tail=result.catch(()=>{});
      return result;
    },
    records:()=>[...records.entries()],
  };
  return store;
}

function fixture({time=timeAt()}={}){
  const store=memoryStore(), requests=[], delivered=[], authorityReads=[];
  const context={time,store,requests,delivered,authorityReads,binding:{}};
  context.otp=createConsultationOtp({store,secret:Buffer.alloc(32,9),now:()=>context.time,
    async loadPilotBinding(input){
      assert.deepEqual(Object.keys(input).sort(),['needContact','signal']);
      assert.ok(input.signal instanceof AbortSignal);
      authorityReads.push(input.needContact);
      if(context.beforeAuthority)await context.beforeAuthority(input);
      const {needContact}=input;
      return {authority:'verified_studiomate_in_person_signup',studioId:'5330',memberId:'101',revision,
        sourceObservedAt:context.time-1,registeredContactVerified:true,active:true,revoked:false,signupComplete:true,
        ...(needContact?{phone}:{}),...context.binding};
    },
    async sendCode(request){
      requests.push(request);
      if(context.beforeSend)await context.beforeSend(request);
      if(!request.mayDispatch()||request.signal.aborted)return {accepted:false};
      delivered.push(request);
      if(context.sendError)throw Error('receipt unavailable');
      return {accepted:!context.unconfirmed};
    },
  });
  context.signIn=async()=>{
    assert.deepEqual(await context.otp.start(step,conversation,phone),generic);
    const result=await context.otp.verify(step,conversation,delivered.at(-1).code);
    assert.equal(result.ok,true);
    return result;
  };
  return context;
}

test('only the configured pilot can receive a code; start is generic and does not store raw credentials',async()=>{
  const ctx=fixture(), {otp,store,authorityReads,delivered}=ctx;
  assert.deepEqual(await otp.start(step,conversation,'01090000001'),generic);
  assert.deepEqual(await otp.start(step,conversation,`${phone}\n`),generic);
  assert.deepEqual(await otp.start(step.slice(0,-1)+'B',conversation,phone),generic);
  assert.deepEqual(authorityReads,[true]);
  assert.equal(delivered.length,0);
  ctx.beforeSend=({dispatchKey,expiresAt})=>{
    const entries=store.records();
    assert.ok(entries.some(([key,{value}])=>key.startsWith('otp-budget:')&&value.deadlines.length===1));
    assert.equal(entries.filter(([key,{value}])=>key.startsWith('otp:')&&value.claim===dispatchKey).length,2);
    assert.equal(expiresAt,ctx.time+5*MINUTE);
  };
  assert.deepEqual(await otp.start(step,conversation,phone),generic);
  assert.deepEqual(await otp.start(step,conversation,phone),generic);
  assert.equal(delivered.length,1);
  assert.equal(delivered[0].to,phone);
  const verified=await otp.verify(step,conversation,delivered[0].code);
  assert.deepEqual(Object.keys(verified).sort(),['expiresAt','ok','token']);
  const storage=JSON.stringify(store.records());
  for(const raw of [phone,step,conversation,verified.token,`"${delivered[0].code}"`])assert.ok(!storage.includes(raw));
  assert.deepEqual(authorityReads,[true,true,true,false]);
});

test('malformed or stale cloud evidence and binding changes before dispatch fail closed',async()=>{
  for(const binding of [
    {authority:'verified_cloud_member_binding'},{studioId:'5331'},{memberId:'0101'},{revision:'old'},
    {sourceObservedAt:timeAt()+1},{sourceObservedAt:timeAt()-HOUR},{registeredContactVerified:false},
    {active:false},{revoked:true},{signupComplete:false},{phone:101},
  ]){
    const ctx=fixture();
    ctx.binding=binding;
    assert.deepEqual(await ctx.otp.start(step,conversation,phone),generic);
    assert.equal(ctx.requests.length,0);
  }
  for(const binding of [{revision:'b'.repeat(64)},{phone:'01000000002'},{revoked:true}]){
    const ctx=fixture();
    ctx.beforeAuthority=()=>{if(ctx.authorityReads.length===2)ctx.binding=binding;};
    assert.deepEqual(await ctx.otp.start(step,conversation,phone),generic);
    assert.equal(ctx.requests.length,0);
  }
});

test('KST 09:00 is inclusive and 23:00 is exclusive, including after an adapter await',async()=>{
  for(const [clock,expected] of [['08:59:59.999',0],['09:00:00.000',1],['22:59:59.999',1],['23:00:00.000',0]]){
    const ctx=fixture({time:timeAt(clock)});
    assert.deepEqual(await ctx.otp.start(step,conversation,phone),generic);
    assert.equal(ctx.delivered.length,expected);
  }
  const crossed=fixture({time:timeAt('22:59:59.999')});
  crossed.beforeSend=()=>{crossed.time++;};
  assert.deepEqual(await crossed.otp.start(step,conversation,phone),generic);
  assert.equal(crossed.requests.length,1);
  assert.equal(crossed.delivered.length,0);
  await crossed.otp.start(step,conversation,phone);
  assert.equal(crossed.requests.length,1);
});

test('the serialized budget caps concurrent requests and slides by individual send deadlines',async()=>{
  const ctx=fixture();
  const start=n=>ctx.otp.start(token(n),conversation,phone);
  await start(10);
  ctx.time+=HOUR;
  ctx.binding.revision='b'.repeat(64);
  await Promise.all(Array.from({length:8},(_,index)=>start(11+index)));
  assert.equal(ctx.delivered.length,3);
  ctx.time=timeAt()+DAY+14_999;
  await start(20);
  assert.equal(ctx.delivered.length,3);
  ctx.time++;
  await Promise.all([start(20),start(21)]);
  assert.equal(ctx.delivered.length,4);
  ctx.time+=HOUR;
  await Promise.all([start(22),start(23),start(24)]);
  assert.equal(ctx.delivered.length,6);
});

test('an uncertain dispatch is never retried for its conversation, even after expiry and logout',async()=>{
  for(const mode of ['sendError','unconfirmed']){
    const ctx=fixture();
    ctx[mode]=true;
    await ctx.otp.start(step,conversation,phone);
    await ctx.otp.start(step,conversation,phone);
    assert.equal(ctx.requests.length,1);
    const {code}=ctx.delivered[0];
    // If the actual recipient got the code, possession is still proof, not a transport retry.
    const result=await ctx.otp.verify(step,conversation,code);
    assert.equal(result.ok,true);
    assert.equal(await ctx.otp.logout(result.token,conversation,step),true);
    ctx.time+=DAY+HOUR;
    await ctx.otp.start(step,conversation,phone);
    assert.equal(ctx.requests.length,1);
    assert.deepEqual(await ctx.otp.verify(step,conversation,code),denied);
  }
});

test('logout during dispatch invalidates the code without releasing an uncertain claim',async()=>{
  const ctx=fixture(), {otp}=ctx;
  ctx.sendError=true;
  const entered=Promise.withResolvers(), release=Promise.withResolvers();
  ctx.beforeSend=()=>{entered.resolve();return release.promise;};
  const pending=otp.start(step,conversation,phone);
  await entered.promise;
  await otp.start(step,conversation,phone);
  assert.equal(ctx.requests.length,1);
  assert.equal(await otp.logout(null,conversation,step),true);
  release.resolve();
  assert.deepEqual(await pending,generic);
  assert.deepEqual(await otp.verify(step,conversation,ctx.delivered[0].code),denied);
  await otp.start(step,conversation,phone);
  assert.equal(ctx.requests.length,1);
});

test('store commit uncertainty prevents transport and never exposes an unconfirmed session token',async()=>{
  const ctx=fixture();
  ctx.store.loseNextCommit=true;
  assert.deepEqual(await ctx.otp.start(step,conversation,phone),generic);
  await ctx.otp.start(step,conversation,phone);
  assert.equal(ctx.requests.length,0);
  await ctx.otp.start(step,otherTab,phone);
  const {code}=ctx.delivered[0];
  ctx.store.loseNextCommit=true;
  assert.deepEqual(await ctx.otp.verify(step,otherTab,code),denied);
  assert.deepEqual(await ctx.otp.verify(step,otherTab,code),denied);
});

test('verification binds step, tab and fresh current revision, and code expires at five minutes',async()=>{
  const ctx=fixture(), {otp}=ctx;
  await otp.start(step,conversation,phone);
  const {code}=ctx.delivered[0];
  assert.deepEqual(await otp.verify(token(4),conversation,code),denied);
  assert.deepEqual(await otp.verify(step,otherTab,code),denied);
  ctx.binding.revision='b'.repeat(64);
  assert.deepEqual(await otp.verify(step,conversation,code),denied);
  ctx.binding.revision=revision;
  ctx.time+=5*MINUTE;
  assert.deepEqual(await otp.verify(step,conversation,code),denied);
  await otp.start(step,conversation,phone);
  assert.equal(ctx.delivered.length,2);
  assert.equal((await otp.verify(step,conversation,ctx.delivered[1].code)).ok,true);
});

test('five wrong codes consume the challenge without blocking the legitimate tab on cross-tab attempts',async()=>{
  const {otp,delivered}=fixture();
  await otp.start(step,conversation,phone);
  const {code}=delivered[0], wrong=code==='000000'?'000001':'000000';
  for(let i=0;i<5;i++)assert.deepEqual(await otp.verify(step,otherTab,wrong),denied);
  for(let i=0;i<4;i++)assert.deepEqual(await otp.verify(step,conversation,wrong),denied);
  assert.equal((await otp.verify(step,conversation,code)).ok,true);
  await otp.start(token(4),otherTab,phone);
  const newCode=delivered[1].code, otherWrong=newCode==='000000'?'000001':'000000';
  for(let i=0;i<5;i++)assert.deepEqual(await otp.verify(token(4),otherTab,otherWrong),denied);
  assert.deepEqual(await otp.verify(token(4),otherTab,newCode),denied);
});

test('session write and code consumption roll back together and concurrent verifies mint only one token',async()=>{
  const {otp,store,delivered}=fixture();
  await otp.start(step,conversation,phone);
  const {code}=delivered[0];
  store.failSessionWrite=true;
  assert.deepEqual(await otp.verify(step,conversation,code),denied);
  store.failSessionWrite=false;
  const results=await Promise.all([otp.verify(step,conversation,code),otp.verify(step,conversation,code)]);
  assert.equal(results.filter(row=>row.ok).length,1);
  assert.equal(store.records().filter(([key])=>key.startsWith('session:')).length,1);
  assert.deepEqual(await otp.verify(step,conversation,code),denied);
});

test('same-tab activity rolls the 24-hour idle deadline; resolution is read-only and has no 20-minute ceiling',async()=>{
  const ctx=fixture(), {otp}=ctx;
  const signed=await ctx.signIn();
  assert.equal(signed.expiresAt,ctx.time+DAY);
  ctx.time+=21*MINUTE;
  const binding=await otp.resolveSession(signed.token,conversation);
  assert.deepEqual(binding,{accountId:binding.accountId,memberId:'101',studioId:'5330',revision,
    active:true,signupComplete:true,identityVerified:true,expiresAt:signed.expiresAt});
  assert.equal(Buffer.from(binding.accountId,'base64url').length,32);
  const reads=ctx.authorityReads.length;
  assert.equal(await otp.resolveSession(signed.token,otherTab),null);
  assert.equal(await otp.touch(signed.token,otherTab),null);
  assert.equal(ctx.authorityReads.length,reads);
  ctx.time=signed.expiresAt-1;
  const touched=await otp.touch(signed.token,conversation);
  assert.equal(touched.expiresAt,ctx.time+DAY);
  ctx.time=touched.expiresAt-1;
  assert.deepEqual(await otp.resolveSession(signed.token,conversation),touched);
  ctx.time++;
  assert.equal(await otp.touch(signed.token,conversation),null);
  assert.equal(await otp.resolveSession(signed.token,conversation),null);
});

test('resolve and touch each reread authority without contact and fail closed on revocation, drift or outages',async()=>{
  const ctx=fixture(), {otp}=ctx;
  const signed=await ctx.signIn();
  ctx.time+=HOUR;
  for(const flags of [{revoked:true},{active:false},{registeredContactVerified:false},{signupComplete:false},
    {revision:'b'.repeat(64)},{memberId:'102'},{sourceObservedAt:ctx.time-26*HOUR}]){
    ctx.binding=flags;
    assert.equal(await otp.resolveSession(signed.token,conversation),null);
    assert.equal(await otp.touch(signed.token,conversation),null);
  }
  ctx.binding={};
  ctx.beforeAuthority=()=>{throw Error('unavailable');};
  assert.equal(await otp.resolveSession(signed.token,conversation),null);
  assert.equal(await otp.touch(signed.token,conversation),null);
  ctx.beforeAuthority=null;
  assert.equal((await otp.resolveSession(signed.token,conversation)).expiresAt,signed.expiresAt);
  assert.ok(ctx.authorityReads.slice(2).every(needContact=>needContact===false));
});

test('logout reports only same-conversation session or OTP removal',async()=>{
  const ctx=fixture(), {otp}=ctx;
  await otp.start(step,conversation,phone);
  assert.equal(await otp.logout(null,otherTab,step),false);
  assert.equal(await otp.logout(null,conversation,step),true);
  assert.equal(await otp.logout(null,conversation,step),false);
  assert.deepEqual(await otp.verify(step,conversation,ctx.delivered[0].code),denied);
  const signed=await ctx.signIn();
  assert.equal(await otp.logout(signed.token,otherTab,step),false);
  assert.ok(await otp.resolveSession(signed.token,conversation));
  assert.equal(await otp.logout(signed.token,conversation),true);
  assert.equal(await otp.logout(signed.token,conversation),false);
  assert.equal(await otp.touch(signed.token,conversation),null);
});

test('authority await cannot resurrect a logged-out session; concurrent touches preserve the same session',async()=>{
  for(const method of ['resolveSession','touch']){
    const ctx=fixture(), {otp}=ctx;
    const signed=await ctx.signIn();
    const entered=Promise.withResolvers(), release=Promise.withResolvers();
    ctx.beforeAuthority=()=>{entered.resolve();return release.promise;};
    const pending=otp[method](signed.token,conversation);
    await entered.promise;
    assert.equal(await otp.logout(signed.token,conversation),true);
    release.resolve();
    assert.equal(await pending,null);
  }
  const ctx=fixture(), {otp}=ctx;
  const signed=await ctx.signIn();
  const entered=Promise.withResolvers(), release=Promise.withResolvers();
  ctx.beforeAuthority=()=>{entered.resolve();return release.promise;};
  const pending=otp.touch(signed.token,conversation);
  await entered.promise;
  ctx.beforeAuthority=null;
  ctx.time+=MINUTE;
  const concurrent=await otp.touch(signed.token,conversation);
  release.resolve();
  assert.deepEqual(await pending,concurrent);
});

test('touch cannot extend a session that reached its idle deadline during the authority read',async()=>{
  const ctx=fixture(), {otp}=ctx;
  const signed=await ctx.signIn();
  ctx.time=signed.expiresAt-1;
  ctx.beforeAuthority=()=>{ctx.time++;};
  assert.equal(await otp.touch(signed.token,conversation),null);
  assert.equal(await otp.resolveSession(signed.token,conversation),null);
});
