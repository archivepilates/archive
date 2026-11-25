import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {archiveAutomationPath} from './lib/archive-automation-paths.mjs';
import {createLiveReader} from '../services/archivepilates-mcp/src/live-browser.mjs';
import {currentPassMemberKey} from '../services/archive-help-member-access/current-pass-snapshot.mjs';
import {makeHelpRosterGeneration} from '../services/archive-help-member-access/help-roster-projection.mjs';
import {createHelpRosterBindingLoader,rosterPhoneKey} from '../services/archive-help-member-access/help-roster-binding.mjs';
import {readConsultationConfig} from '../services/archive-help-member-access/consultation-runtime.mjs';
import {assertMemberDatabasePools} from '../services/archive-help-member-access/hosted-runtime.mjs';

const {Pool}=createRequire(import.meta.url)('../services/archive-help-member-access/node_modules/pg');
const root=archiveAutomationPath('secrets','supabase');
const journalPath=archiveAutomationPath('secrets','supabase','help-member-roster-canary-20261126.jsonl');
const roleName=s=>s==='enrollment'?'archive_help_enrollment_writer_app':'archive_help_snapshot_writer_app';
const roleParent=s=>s==='enrollment'?'archive_help_enrollment_writer':'archive_help_pass_writer';
const hash=value=>createHash('sha256').update(value).digest('hex');
const groupType='\uadf8\ub8f9\ud615\ud69f\uc218\uc81c5:1',using='\uc0ac\uc6a9\uc911';
const pools={};
let native,journal,stage='local pilot and explicit second subject';
async function readPrivate(file){
  const fd=await open(archiveAutomationPath('secrets','supabase',file),constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  try{
    const info=await fd.stat();
    assert(info.isFile()&&info.uid===process.getuid()&&!(info.mode&0o077)&&info.size<16384);
    return JSON.parse(await fd.readFile('utf8'));
  }finally{await fd.close();}
}
async function record(state,extra={}){
  await journal.writeFile(JSON.stringify({state,at:new Date().toISOString(),...extra})+'\n');
  await journal.sync();
}
try{
  const [mode,secondId,secondName]=process.argv.slice(2),apply=mode==='--apply-two';
  assert(process.argv.length===5&&(apply||mode==='--plan-two')&&/^[1-9][0-9]{0,15}$/u.test(secondId)&&secondName);
  const dir=await lstat(root);
  assert(dir.isDirectory()&&dir.uid===process.getuid()&&!(dir.mode&0o077));
  const {env}=await readPrivate('help-member-pilot-runtime.json');
  const {pilotId,memberKeySecret,contactKey,pools:options}=readConsultationConfig(env);
  assert(secondId!==pilotId&&Buffer.isBuffer(memberKeySecret));
  if(apply)assert(!await lstat(journalPath).catch(error=>{if(error.code!=='ENOENT')throw error;}));

  stage='fresh complete source and exact two card readbacks';
  native=createLiveReader({budgetMs:70000});
  const signal=AbortSignal.timeout(160000);
  const inventory=await native.getInventory(signal,{recheckAll:true});
  const ids=new Set([pilotId,secondId]);
  const selected=inventory.profiles.filter(p=>ids.has(p.memberId));
  stage='complete roster contains both authorized IDs';
  assert.equal(selected.length,2);
  const catalog=new Map(), proof=new Map();
  for(const target of selected){
    const label=target.memberId===pilotId?'prior pilot':'second test account';
    stage=label+' exact native identity and unique registered contact';
    assert(target.memberId===pilotId?target.phone?.endsWith('8585'):target.name===secondName);
    assert(/^010[0-9]{8}$/u.test(target.phone??'')&&inventory.profiles.filter(p=>p.phone===target.phone).length===1);
    const view=await native.getOverview(target,signal);
    stage=label+' current active group card';
    assert(view.memberId===target.memberId&&view.phone===target.phone&&view.coverage==='current_ticket_cards'
      &&view.tickets.length===1&&view.tickets[0].type===groupType&&view.tickets[0].status===using);
    const t=view.tickets[0];
    stage=label+' unique catalog and issued ownership';
    const matches=target.activeTickets.filter(row=>row.name===t.name&&row.sourceClass==='G'&&row.type==='T'
      &&row.usableStatus==='using');
    assert.equal(matches.length,1);
    if(!matches[0].ownerVerified){
      assert(matches[0].shared);
      const owned=await native.getOverview(target,signal,{issuedIds:[matches[0].userTicketId]});
      assert.deepEqual(owned.tickets,view.tickets);
      matches[0].ownerVerified=true;
    }
    catalog.set(matches[0].productId,{productId:matches[0].productId,sourceClass:'G',sourceType:'T',category:'group'});
    proof.set(currentPassMemberKey(memberKeySecret,target.memberId),{
      phone:target.phone,balance:t.remainingCount,bookable:t.reservableCount,starts:t.availableFromDate,expires:t.expiresOn
    });
  }
  stage='two-account projection coverage';
  const batch=makeHelpRosterGeneration({inventory,products:[...catalog.values()],sourceDigest:hash(inventory.checkedAt),
    onlyMembers:ids,memberKeySecret,contactKey});
  for(const {memberKey,phoneKey,cards} of batch.members){
    stage='exact list and detail balances and dates';
    const p=proof.get(memberKey);
    assert(p&&cards.length===1&&phoneKey===rosterPhoneKey(contactKey,p.phone)&&cards[0].remaining===p.balance
      &&cards[0].bookable===p.bookable&&cards[0].startsOn===p.starts&&cards[0].expiresOn===p.expires);
  }
  await native.close();native=null;
  if(!apply)console.log(JSON.stringify({ok:true,canaryMembers:2,verifiedCards:2,observedAt:batch.observedAt,sends:0,dbWrites:0}));
  else{
    stage='empty isolated roster and existing dedicated TLS roles';
    for(const [name,opts] of Object.entries(options))pools[name]=new Pool(opts);
    await assertMemberDatabasePools(pools);
    const db=await readPrivate('help-member-dedicated-logins.json');
    const base=options.reader;
    assert(db.host===base.host&&db.ca===base.ssl.ca);
    for(const kind of ['enrollment','snapshot']){
      const item=db.logins[kind],name=roleName(kind);
      assert(item?.role===name&&/^[A-Za-z0-9_-]{32,128}$/u.test(item.password??''));
      pools[kind]=new Pool({...base,user:base.user.includes('.')?name+'.'+db.project:name,password:item.password,
        application_name:'archive-help-two-canary-'+kind});
      const {rows:[actual]}=await pools[kind].query('SELECT current_user::text AS identity, pg_has_role(current_user,$1::name,\'USAGE\') AS scope',[roleParent(kind)]);
      assert(actual?.identity===name&&actual.scope===true);
    }
    const status=async()=> (await pools.snapshot.query('SELECT archive_help_roster.status() AS value')).rows[0]?.value;
    assert.equal(await status(),null);
    journal=await open(journalPath,'wx',0o600);
    await record('ready',{sourceDigest:batch.sourceDigest});
    stage='approved test subjects only';
    for(const {memberKey,phoneKey} of batch.members){
      const {rows:[row]}=await pools.enrollment.query('SELECT archive_help_roster.approve_contact($1,$2,$3) AS approved',
        [memberKey,phoneKey,batch.observedAt]);
      assert.equal(row?.approved,true);
    }
    stage='two-member isolated publication';
    try{
      await pools.snapshot.query('SELECT archive_help_roster.publish($1,$2,$3)',
        [batch.observedAt,batch.sourceDigest,JSON.stringify(batch.members)]);
    }catch{/* Reconcile the exact candidate below; never retry a write. */}
    const saved=await status();
    assert(saved?.sourceDigest===batch.sourceDigest&&saved.members===2&&saved.cards===2);
    const load=createHelpRosterBindingLoader({pool:pools.auth,contactKey});
    for(const [memberId,{phone}] of proof){
      const binding=await load({needContact:true,phone});
      assert(binding?.memberId===memberId);
    }
    await record('verified',{members:2,cards:2,sends:0,observedAt:saved.observedAt});
    console.log(JSON.stringify({ok:true,canaryMembers:2,verifiedCards:2,observedAt:saved.observedAt,sends:0}));
  }
}catch(error){
  if(journal)await record('stopped',{stage}).catch(()=>{});
  const nativeCode=/^LIVE_[A-Z_]+$/u.test(error?.code??'')?' '+error.code:'';
  const knownReason=/^(?:roster_(?:generation|catalog|canary_scope)_unverified|native_roster_unverified)$/u.test(error?.message??'')?
    ' '+error.message:'';
  console.error('Stopped at '+stage+nativeCode+knownReason+'. Inspect existing state before any retry; no messages sent.');
  process.exitCode=1;
}finally{
  try{await native?.close();}finally{
    await Promise.allSettled(Object.values(pools).map(p=>p.end()));
    await journal?.close();
  }
}
