#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets,
  readCompleteStudioMateContractHistory } from "./lib/studiomate-native-contract-source.mjs";

const targets=[
  {memberId:"4683927",name:"주현지",profileId:"excel_10381ac7275d7df1",hintId:"e2633c3a16c0a5678c83342a8eb4b802d248f31b620487f60df7deb966068a02"},
  {memberId:"2714972",name:"윤혜진",profileId:"2714972",contractId:"60b32a60a88a63eb4bb955e853aa2cde699fbf77c03c609586be3ce463f370c5"},
];
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==3||args[0]!=="--member-id"||!["--dry-run","--apply"].includes(args[2]))throw new Error("legacy_invalid_arguments");
  const target=targets.find(t=>t.memberId===args[1]);if(!target)throw new Error("legacy_target_not_approved");
  const key=JSON.parse(await readFile("/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json","utf8"));
  if(key.project_id!=="archive-pilates"||key.client_email!=="archive-codex-operator@archive-pilates.iam.gserviceaccount.com"||process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("legacy_operator_identity_mismatch");
  const require=createRequire(new URL("../firebase/kangsain-functions/functions/package.json",import.meta.url));
  const admin=require("firebase-admin"),app=admin.initializeApp({projectId:"archive-pilates",credential:admin.credential.cert(key)}),db=app.firestore();
  let context,release;
  try{
    const settings=await db.doc("systemSettings/membershipContractAutomation").get(),config=settings.data();
    const profile=await db.doc(`memberProfiles/${target.profileId}`).get();
    if(profile.data()?.name!==target.name||config.studioId!=="5330"||!Number.isFinite(Date.parse(config.cutoverAt)))throw new Error("legacy_identity_config_mismatch");
    const ref=db.doc(target.contractId?`studiomateMembershipContracts/${target.contractId}`:`workLanes/studiomate-membership-contract-automation/purchaseHints/${target.hintId}`);
    const source=await ref.get();if(!source.exists)throw new Error("legacy_canonical_source_missing");
    release=await acquireStudioMateBrowserLock({owner:`legacy-registration-review-${target.memberId}`,waitMs:60000});
    const {chromium}=await import("playwright");context=await chromium.launchPersistentContext(path.join(os.homedir(),"ArchiveIN/automation/browser-profile"),{headless:true});
    const page=context.pages()[0]||await context.newPage();
    const client=await captureStudioMateNativeApiClient(page,{ensureLoggedIn:p=>ensureStudioMateLoggedIn(p,{headless:true})});
    const api={get:(...args)=>client.get(...args)};
    const exact=await readExactStudioMateMember(api,profile.data().phone);
    if(exact.status!=="verified"||exact.matchCount!==1||exact.member.memberId!==target.memberId||exact.member.name!==target.name||
      exact.member.inactive||!Number.isFinite(Date.parse(exact.member.registeredAt))||Date.parse(exact.member.registeredAt)>Date.parse(config.cutoverAt))throw new Error("legacy_native_existing_member_not_verified");
    const tickets=await readStudioMateUserTickets(api,target.memberId);
    const history=await readCompleteStudioMateContractHistory(api,{phone:exact.member.phone,startDate:"2023-01-01"});
    if(tickets.status!=="verified"||history.status!=="verified"||!history.allTime)throw new Error("legacy_complete_native_history_required");
    // This retired product is independently identified in this member's native issuance history.
    // Do not expand the global send catalog or infer an old product from its name alone.
    const reviewedRetired=target.memberId==="2714972"?new Map([["5576299","268320"],["7665681","338610"],["8844450","375406"],["9884473","412181"]]):new Map();
    const prior=tickets.tickets.filter(t=>(config.regularProductIds.includes(t.productId)||reviewedRetired.get(t.userTicketId)===t.productId)&&Date.parse(t.issuedAt)<Date.parse(config.cutoverAt)&&t.refunded===false&&t.cancelled===false);
    if(!prior.length)throw new Error("legacy_prior_regular_ticket_required");
    if(target.contractId){
      const native=history.records.find(c=>c.contractId===target.contractId);
      if(!native||native.memberId!==target.memberId||native.status!=="signed"||!native.memberSignaturePresent||!native.centerSignaturePresent||
        source.data().status!=="signed"||source.data().binding?.memberId!==target.memberId||source.data().binding?.memberPhone!==exact.member.phone)
        throw new Error("legacy_signed_contract_mismatch");
    }
    const disposition={verified:true,reason:"legacy_member_before_contract_cutover",source:"studiomate_native_member_ticket",memberId:target.memberId,
      ...(target.contractId?{contractId:target.contractId}:{}),registeredAt:exact.member.registeredAt,cutoverAt:config.cutoverAt,
      priorRegularIssuanceIds:prior.map(t=>t.userTicketId),checkedAt:new Date().toISOString()};
    if(args[2]==="--apply")await db.runTransaction(async tx=>{
      const current=await tx.getAll(ref,profile.ref,settings.ref);
      if(current.some((d,i)=>!d.updateTime.isEqual([source,profile,settings][i].updateTime)))throw new Error("legacy_source_changed");
      const at=admin.firestore.Timestamp.now();
      tx.update(ref,target.contractId?{welcomeStatus:"not_required",welcomeReason:disposition.reason,welcomeDisposition:disposition,updatedAt:at}:
        {status:"ignored",reason:disposition.reason,registrationDisposition:disposition,updatedAt:at});
      if(target.profileId.startsWith("excel_"))tx.update(profile.ref,{studiomateMemberId:target.memberId,studiomateMemberIdResolvedAt:at,updatedAt:at});
    });
    console.log(JSON.stringify({memberId:target.memberId,name:target.name,status:args[2]==="--apply"?"existing_member_excluded":"verified_no_write",priorRegularCount:prior.length,
      contractPreserved:Boolean(target.contractId),providerPostCount:0,studioMateWrites:0}));
  }finally{try{await context?.close();}finally{await release?.();await app.delete();}}
}
main().catch(e=>{console.error(JSON.stringify({status:"blocked",reason:/^[a-z][a-z0-9_]+$/.test(e.message)?e.message:"legacy_read_failed_no_private_details_logged"}));process.exitCode=1;});
