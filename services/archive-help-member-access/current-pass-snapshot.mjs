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

export function auditCurrentPassRoster(inventory) {
  const { profiles, coverage, checkedAt } = inventory ?? {};
  const pages = coverage?.pagesTraversed;
  if (coverage?.kind !== 'native_member_pages' || coverage.scope !== 'member_roster'
    || coverage.ticketScope !== 'member_list_userTickets' || coverage.complete !== true
    || coverage.traversalComplete !== true || !Array.isArray(profiles)
    || coverage.nativeTotal !== profiles.length || coverage.scannedMembers !== profiles.length
    || !Number.isSafeInteger(pages) || pages < 1 || coverage.pageCount !== pages
    || (pages > 1 && coverage.pagesRechecked !== pages)
    || !Number.isFinite(Date.parse(checkedAt ?? ''))) throw Error('native_roster_unverified');

  const memberIds = new Set(), issuedIds = new Set(), phones = new Map();
  const summary = {
    checkedAt, members: profiles.length, pages, recheckedPages: coverage.pagesRechecked,
    membersWithIssuedRecords: 0, missingRegisteredPhone: 0, membersSharingPhone: 0,
    issuedRecords: 0, inactiveOrUnknownState: 0, using: 0, future: 0, held: 0,
    classPassCandidates: 0, otherIssuedRecords: 0, sharedClassPassCandidates: 0,
    classPassCandidateHolders: 0, classPassCandidateHoldersMissingPhone: 0, missingSourceCounts: 0,
    missingClassPassCandidateDates: 0, missingCandidateOwnerProof: 0,
  };
  for (const profile of profiles) {
    if (profile?.studioId !== '5330' || !validMemberId(profile.memberId)
      || profile._id !== profile.memberId || memberIds.has(profile.memberId)
      || !Array.isArray(profile.activeTickets)) throw Error('native_roster_unverified');
    memberIds.add(profile.memberId);
    if (!profile.phone) summary.missingRegisteredPhone++;
    else phones.set(profile.phone, (phones.get(profile.phone) ?? 0) + 1);
    if (profile.activeTickets.length) summary.membersWithIssuedRecords++;
    let hasClassPassCandidate = false;
    for (const pass of profile.activeTickets) {
      if (!validMemberId(pass?.userTicketId) || issuedIds.has(pass.userTicketId)
        || !validMemberId(pass.productId)) throw Error('native_roster_unverified');
      issuedIds.add(pass.userTicketId);
      summary.issuedRecords++;
      const classPassCandidate = ['G', 'P'].includes(pass.sourceClass) && ['T', 'P'].includes(pass.type);
      if (!classPassCandidate) {
        summary.otherIssuedRecords++;
        continue;
      }
      hasClassPassCandidate = true;
      summary.classPassCandidates++;
      if (pass.shared) summary.sharedClassPassCandidates++;
      if (!pass.ownerVerified) summary.missingCandidateOwnerProof++;
      if (!pass.availableFrom || !pass.expiresAt) summary.missingClassPassCandidateDates++;
      if (pass.type === 'T' && (!isCount(pass.remainingCount) || !isCount(pass.usableCoupon))) summary.missingSourceCounts++;
      if (pass.usableStatus === 'using') summary.using++;
      else if (pass.usableStatus === 'to_use') summary.future++;
      else if (pass.usableStatus === 'stopped') summary.held++;
      else summary.inactiveOrUnknownState++;
    }
    if (hasClassPassCandidate) {
      summary.classPassCandidateHolders++;
      if (!profile.phone) summary.classPassCandidateHoldersMissingPhone++;
    }
  }
  summary.membersSharingPhone = [...phones.values()].reduce((n, size) => size > 1 ? n + size : n, 0);
  return summary;
}

const NATIVE_STATUS = new Map([['using','active'],['to_use','future'],['stopped','held']]);

export function makeVerifiedRosterPassBatch({inventory, authority, sourceDigest, secret, now = Date.now()}) {
  const audit = auditCurrentPassRoster(inventory);
  const observed = Date.parse(inventory.startedAt ?? '');
  const authorityTime = Date.parse(authority?.checkedAt ?? '');
  if (!HEX.test(sourceDigest ?? '') || !Number.isFinite(observed) || observed > Date.parse(audit.checkedAt)
    || Date.parse(audit.checkedAt) > now || now - observed > 120 * 60_000
    || dayFormat.format(observed) !== dayFormat.format(now)
    || authority?.studioId !== '5330' || !Number.isFinite(authorityTime)
    || authorityTime > now || now - authorityTime > 26 * 60 * 60_000
    || !Array.isArray(authority.bindings) || !Array.isArray(authority.products)
    || audit.membersSharingPhone) throw Error('verified_roster_authority_required');

  const bindings = new Map(authority.bindings.map(binding => [binding.memberId,binding]));
  const products = new Map(authority.products.map(product => [product.productId,product]));
  if (bindings.size !== authority.bindings.length || products.size !== authority.products.length)
    throw Error('verified_roster_authority_required');

  const sourceDay = dayFormat.format(observed);
  const members = [];
  for (const profile of inventory.profiles) {
    const cards = [];
    for (const row of [...profile.activeTickets].sort((a,b) => a.userTicketId.localeCompare(b.userTicketId))) {
      const product = products.get(row.productId);
      if (!product || product.sourceType !== row.type || product.sourceClass !== row.sourceClass)
        throw Error('ticket_policy_unverified');
      if (product.category === 'excluded') continue;
      const status = NATIVE_STATUS.get(row.usableStatus);
      if (!status || (status === 'held' ? row.status !== '정지' : row.status !== 'active')
        || !row.ownerVerified)
        throw Error('ticket_state_unverified');
      const card = {
        category: product.category, type: product.type, status,
        startsOn: row.availableFrom && dayFormat.format(Date.parse(row.availableFrom)),
        expiresOn: row.expiresAt && dayFormat.format(Date.parse(row.expiresAt)),
        remaining: product.type === 'period' ? null : row.remainingCount,
        bookable: product.type === 'period' ? null : row.usableCoupon,
      };
      if (!validSnapshotCard(card) || card.expiresOn < sourceDay
        || (status === 'future') !== (card.startsOn > sourceDay)
        || (card.type === 'count' && card.bookable === null))
        throw Error('ticket_state_unverified');
      cards.push(card);
    }
    const binding = bindings.get(profile.memberId);
    if (!binding && !profile.phone && !cards.length) continue;
    if (!/^(?:010\d{8}|01[16789]\d{7,8})$/u.test(profile.phone ?? '')
      || !binding || binding.name !== profile.name || binding.phone !== profile.phone
      || !HEX.test(binding.revision ?? '')) throw Error('verified_roster_authority_required');
    members.push({memberKey: currentPassMemberKey(secret,profile.memberId),bindingRevision:binding.revision,cards});
    bindings.delete(profile.memberId);
  }
  if (members.length === 0 || bindings.size) throw Error('verified_roster_authority_required');
  members.sort((a,b) => a.memberKey.localeCompare(b.memberKey));
  return {observedAt:new Date(observed).toISOString(),
    sourceDigest:sha('archive-help-current-pass:roster-v1\0'+sourceDigest+'\0'+JSON.stringify(members)),members};
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
