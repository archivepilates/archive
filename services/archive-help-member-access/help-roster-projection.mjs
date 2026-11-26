import {createHash} from 'node:crypto';
import {auditCurrentPassRoster,currentPassMemberKey,validSnapshotCard} from './current-pass-snapshot.mjs';
import {rosterPhoneKey} from './help-roster-binding.mjs';

const localDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const statusByNative=new Map([['using','active'],['stopped','held'],['to_use','future']]);
const categories=new Set(['group','private','duet','triple']);
const isCandidate=row=>['G','P'].includes(row.sourceClass)&&['T','P'].includes(row.type);
const validContact=phone=>/^010[0-9]{8}$/u.test(phone??'');
const productId=id=>/^[1-9][0-9]{0,15}$/u.test(id??'');
const sourceDayFor=value=>Number.isFinite(Date.parse(value??''))?localDay.format(Date.parse(value)):null;
const registrationObserved=(profile,observedAt)=>{
  const proof=profile.helpRegistration;
  const registeredAt=Date.parse(proof?.registeredAt??'');
  return proof?.source==='native_member_registration_v1'&&typeof proof.inactive==='boolean'
    &&Number.isFinite(registeredAt)&&registeredAt<=observedAt;
};
const registrationEligible=(profile,observedAt)=>registrationObserved(profile,observedAt)&&!profile.helpRegistration.inactive;

function countContacts(profiles){
  const counts=new Map();
  for(const {phone} of profiles){
    if(validContact(phone))counts.set(phone,(counts.get(phone)??0)+1);
  }
  return counts;
}

export function auditNativeHelpRegistration(inventory){
  const audit=auditCurrentPassRoster(inventory);
  const observedAt=Date.parse(inventory.startedAt??'');
  if(!Number.isFinite(observedAt)||observedAt>Date.parse(audit.checkedAt))throw Error('native_roster_unverified');
  const counts=countContacts(inventory.profiles);
  const summary={registeredActive:0,registrationAndContactCandidates:0,heldInactive:0,
    heldRegistrationUnverified:0,heldContact:0};
  for(const profile of inventory.profiles){
    const registered=registrationEligible(profile,observedAt);
    if(registered)summary.registeredActive++;
    if(!profile.activeTickets.some(isCandidate))continue;
    if(!registered){
      if(profile.helpRegistration?.inactive===true)summary.heldInactive++;
      else summary.heldRegistrationUnverified++;
    }else if(!validContact(profile.phone)||counts.get(profile.phone)!==1)summary.heldContact++;
    else summary.registrationAndContactCandidates++;
  }
  return summary;
}

export function makeHelpRosterGeneration({inventory,products,sourceDigest,memberKeySecret,contactKey,onlyMembers,now=Date.now()}={}){
  const audit=auditCurrentPassRoster(inventory);
  const began=Date.parse(inventory.startedAt??''),finished=Date.parse(audit.checkedAt);
  if(!/^[a-f0-9]{64}$/u.test(sourceDigest??'')||!Number.isFinite(began)
    ||began>finished||finished>now||now-began>=30*60_000||!Array.isArray(products)
    ||onlyMembers!==undefined&&(!(onlyMembers instanceof Set)||onlyMembers.size!==2))
    throw Error('roster_generation_unverified');
  const productMap=new Map();
  for(const row of products){
    if(!productId(row?.productId)||productMap.has(row.productId)
      ||!['G','P'].includes(row.sourceClass)||!['T','P'].includes(row.sourceType)
      ||!(row.category==='excluded'||categories.has(row.category)&&(row.sourceClass==='G')===(row.category==='group')))
      throw Error('roster_catalog_unverified');
    productMap.set(row.productId,row);
  }
  const contactCounts=countContacts(inventory.profiles);
  const members=[];
  const held={contactMissing:0,contactAmbiguous:0,invalidCard:0,withoutCards:0,registrationUnverified:0};
  const unreviewed=new Set();
  const sourceDay=localDay.format(began);
  for(const profile of inventory.profiles){
    if(onlyMembers&&!onlyMembers.has(profile.memberId))continue;
    const cards=[];
    let invalid=false;
    for(const row of [...profile.activeTickets].sort((a,b)=>a.userTicketId.localeCompare(b.userTicketId))){
      if(!isCandidate(row))continue;
      const product=productMap.get(row.productId);
      if(!product||product.sourceClass!==row.sourceClass||product.sourceType!==row.type
        ||product.sourceTitle!==undefined&&product.sourceTitle!==row.name){
        unreviewed.add(row.productId);invalid=true;continue;
      }
      if(product.category==='excluded')continue;
      const status=statusByNative.get(row.usableStatus);
      const type=row.type==='P'?'period':'count';
      const card={category:product.category,type,status,
        startsOn:sourceDayFor(row.availableFrom),expiresOn:sourceDayFor(row.expiresAt),
        remaining:type==='period'?null:row.remainingCount,bookable:type==='period'?null:row.usableCoupon};
      if(!row.ownerVerified||!status||row.status!==(status==='held'?'\uc815\uc9c0':'active')
        ||!validSnapshotCard(card)||card.expiresOn<sourceDay||(status==='future')!==(card.startsOn>sourceDay)
        ||type==='count'&&card.bookable===null){invalid=true;continue;}
      cards.push(card);
    }
    if(invalid){held.invalidCard++;continue;}
    if(!cards.length){held.withoutCards++;continue;}
    if(!validContact(profile.phone)){held.contactMissing++;continue;}
    if(contactCounts.get(profile.phone)!==1){held.contactAmbiguous++;continue;}
    // Only the two previously scoped canary subjects have a separate enrollment proof.
    if(!onlyMembers&&!registrationEligible(profile,began)){held.registrationUnverified++;continue;}
    members.push({memberKey:currentPassMemberKey(memberKeySecret,profile.memberId),
      phoneKey:rosterPhoneKey(contactKey,profile.phone),cards});
  }
  if(onlyMembers&&members.length!==onlyMembers.size)throw Error('roster_canary_scope_unverified');
  members.sort((a,b)=>a.memberKey.localeCompare(b.memberKey));
  const observedAt=new Date(began).toISOString();
  const nativeContacts=onlyMembers?undefined:inventory.profiles.map(profile=>{
    const memberKey=currentPassMemberKey(memberKeySecret,profile.memberId);
    const phoneKey=registrationObserved(profile,began)&&contactCounts.get(profile.phone)===1
      ?rosterPhoneKey(contactKey,profile.phone):null;
    return {memberKey,phoneKey};
  }).sort((a,b)=>a.memberKey.localeCompare(b.memberKey));
  const material=nativeContacts?{members,nativeContacts}:members;
  return {observedAt,sourceDigest:createHash('sha256').update('archive-help-roster:v1\0'+sourceDigest+'\0'+observedAt+'\0'+JSON.stringify(material)).digest('hex'),
    members,...(nativeContacts?{nativeContacts}:{}),summary:{sourceMembers:audit.members,candidates:audit.classPassCandidateHolders,projected:members.length,
      unreviewedProducts:unreviewed.size,held}};
}
