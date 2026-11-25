import {createHash,createHmac} from 'node:crypto';

const dayFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const HEX=/^[a-f0-9]{64}$/u;
const CATEGORY=new Set(['group','private','duet','triple']);
const TYPE=new Set(['count','period']);
const STATUS=new Set(['active','held','future']);
const MAX_AGE=26*60*60_000;
const isDay=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/u.test(value)
  &&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const isCount=value=>Number.isSafeInteger(value)&&value>=0&&value<=100000;
const exact=(record,keys)=>record&&typeof record==='object'&&!Array.isArray(record)
  &&Object.keys(record).sort().join(',')===keys;
const sha=value=>createHash('sha256').update(value).digest('hex');
const validMemberId=value=>typeof value==='string'&&/^[1-9]\d{0,15}$/u.test(value);
const validPhone=value=>typeof value==='string'&&/^010\d{8}$/u.test(value);
const validName=value=>typeof value==='string'&&value.length>0&&value.length<=120&&value===value.normalize('NFC').trim();

export function shouldPublishHelpCurrentPasses({enabled,apply,download,scheduledRun,notificationRefresh,steps,memberDownload,manualSources}){
  if(enabled!==true||!apply||!download||!scheduledRun||notificationRefresh||manualSources||memberDownload?.ok!==true
    ||!HEX.test(memberDownload.sha256??'')||steps.some(step=>step.exitCode!==0||step.requiredFailed))return false;
  return ['download','memberProfiles','memberPhoneDedupe','reservations'].every(name=>
    steps.some(step=>step.name===name&&step.exitCode===0&&step.stdoutOk===true));
}

export function currentPassMemberKey(secret,memberId){
  if(!Buffer.isBuffer(secret)||secret.length!==32||!validMemberId(memberId))throw Error('member_key_unverified');
  return createHmac('sha256',secret).update('archive-help-current-pass:v1:5330:'+memberId).digest('hex');
}

export function validSnapshotCard(card){
  return exact(card,'bookable,category,expiresOn,remaining,startsOn,status,type')&&CATEGORY.has(card.category)&&TYPE.has(card.type)
    &&STATUS.has(card.status)&&isDay(card.startsOn)&&isDay(card.expiresOn)&&card.startsOn<=card.expiresOn
    &&(card.type==='period'?card.remaining===null&&card.bookable===null:
      isCount(card.remaining)&&(card.bookable===null||isCount(card.bookable)));
}

function projectCards(tickets,policy,sourceDay){
  const cards=[],seen=new Set();
  for(const row of tickets){
    const product=policy.find(item=>item.sourceName===row?.name&&item.sourceType===row?.type);
    if(!product||!TYPE.has(product.type)||!CATEGORY.has(product.category)
      ||!product.statuses||!Object.hasOwn(product.statuses,row?.status??''))throw Error('ticket_policy_unverified');
    const status=product.statuses[row.status];
    if(status==='excluded')continue;
    const card={category:product.category,type:product.type,status,startsOn:row.availableFromDate,expiresOn:row.expiresOn,
      remaining:product.type==='period'?null:row.remainingCount,
      bookable:product.type==='period'?null:row.reservableCount};
    if(!validSnapshotCard(card)||card.expiresOn<sourceDay
      ||(status==='future')!==(card.startsOn>sourceDay))throw Error('ticket_state_unverified');
    const identity=JSON.stringify([row.name,row.type,card]);
    if(seen.has(identity))throw Error('ticket_state_unverified');
    seen.add(identity);
    cards.push(card);
  }
  return cards;
}

export function makeDailyPassBatch({targets,observations,sourceDigest,secret,now=Date.now()}){
  if(!HEX.test(sourceDigest??'')||!Array.isArray(targets)||targets.length===0||targets.length>5
    ||!Array.isArray(observations)||observations.length!==targets.length
    ||new Set(targets.map(row=>row.memberId)).size!==targets.length
    ||new Set(targets.map(row=>row.phone)).size!==targets.length)throw Error('approved_pilot_scope_unverified');
  const samples=[];
  const members=targets.map((target,index)=>{
    const row=observations[index],checkedAt=Date.parse(row?.checkedAt??'');
    if(!validMemberId(target.memberId)||!validPhone(target.phone)||!validName(target.name)||!HEX.test(target.bindingRevision??'')
      ||!Array.isArray(target.products)||new Set(target.products.map(p=>JSON.stringify([p.sourceName,p.sourceType]))).size!==target.products.length
      ||row?.memberId!==target.memberId||row.name!==target.name||row.phone!==target.phone||row.coverage!=='current_ticket_cards'
      ||!Number.isFinite(checkedAt)||checkedAt>now||now-checkedAt>120*60_000
      ||dayFormat.format(checkedAt)!==dayFormat.format(now)
      ||!Array.isArray(row.tickets)||row.tickets.length>100)throw Error('native_member_readback_unverified');
    samples.push(checkedAt);
    return {memberKey:currentPassMemberKey(secret,target.memberId),bindingRevision:target.bindingRevision,
      cards:projectCards(row.tickets,target.products,dayFormat.format(checkedAt))};
  }).sort((a,b)=>a.memberKey.localeCompare(b.memberKey));
  return {observedAt:new Date(Math.min(...samples)).toISOString(),
    sourceDigest:sha('archive-help-current-pass:v1\0'+sourceDigest+'\0'+JSON.stringify(members)),members};
}

export function createSupabaseCurrentPassLookup({query,now=Date.now}={}){
  if(typeof query!=='function')throw Error('dedicated_reader_query_required');
  return async (session,scope)=>{
    if(scope!=='cards'||typeof session!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(session))return null;
    try{
      const result=await query('select archive_help_pass_snapshot.read_own($1::text) as result',[sha(session)]);
      const row=result?.rows?.[0]?.result;
      const checked=Date.parse(row?.observedAt??'');
      const time=now();
      if(!exact(row,'cards,expiresAt,observedAt')||!Number.isFinite(checked)||checked>time||time-checked>MAX_AGE
        ||!Number.isSafeInteger(row.expiresAt)||row.expiresAt<=time||row.expiresAt>time+20*60_000
        ||!Array.isArray(row.cards)||row.cards.length>100||!row.cards.every(validSnapshotCard))return null;
      return {cards:row.cards,checkedAt:new Date(checked).toISOString(),expiresAt:Math.min(row.expiresAt,checked+MAX_AGE)};
    }catch{return null;}
  };
}

export function createSupabasePassSessionIssuer({query,secret,now=Date.now}={}){
  if(typeof query!=='function'||!Buffer.isBuffer(secret)||secret.length!==32)throw Error('dedicated_session_issuer_required');
  const digest=token=>{
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(token))throw Error('invalid_server_session');
    return sha(token);
  };
  return Object.freeze({
    async issue({token,binding}){
      const time=now(),expiry=binding?.expiresAt;
      if(binding?.studioId!=='5330'||!HEX.test(binding.revision??'')||!Number.isSafeInteger(expiry)
        ||expiry<=time||expiry>time+20*60_000)throw Error('unverified_session_binding');
      await query('select archive_help_pass_snapshot.issue_read_session($1::text,$2::text,$3::text,$4::timestamptz)',
        [digest(token),currentPassMemberKey(secret,binding.memberId),binding.revision,new Date(expiry).toISOString()]);
    },
    async revoke(token){
      await query('select archive_help_pass_snapshot.revoke_read_session($1::text)',[digest(token)]);
    }
  });
}
