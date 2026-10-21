#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { readNativeContractPage } from "./lib/studiomate-native-contract-reader.mjs";
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets,
  readStudioMateContract, buildNativeContractCompletionReadback } from "./lib/studiomate-native-contract-source.mjs";
import { normalizeNativeContractSignatureReceipt } from "./lib/studiomate-native-contract-evidence.mjs";
import { buildMembershipContractMemberProfilePatch, membershipContractFallbackAliasIds } from "./lib/studiomate-membership-contract-member-profile.mjs";
import { RECOVERY_TARGETS, RECOVERY_APPROVAL, assertRecoveryEvidence, assertRecoveryHistories,
  claimOperatorRecovery, assertRecoveryReceipt, RECOVERY_APPROVAL_EXPIRES_AT } from "./lib/membership-welcome-operator-recovery.mjs";
import { sourceReader, sourceRoot } from "./lib/alimtalk-catalog-source.mjs";

const operator = "archive-codex-operator@archive-pilates.iam.gserviceaccount.com";
async function main() {
  const args=process.argv.slice(2);
  if (args.length!==3 || args[0]!=="--member-id" || !["--dry-run","--link","--apply","--receipt"].includes(args[2]))
    throw new Error("recovery_invalid_arguments");
  const target=RECOVERY_TARGETS.find(row=>row[0]===args[1]);
  if (!target) throw new Error("recovery_outside_approved_targets");
  const mode=args[2];
  const key=JSON.parse(await readFile("/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json","utf8"));
  if (key.project_id!=="archive-pilates" || key.client_email!==operator ||
      process.env.FIRESTORE_EMULATOR_HOST || [process.env.GCLOUD_PROJECT,process.env.GOOGLE_CLOUD_PROJECT].some(v=>v&&v!=="archive-pilates"))
    throw new Error("recovery_operator_identity_mismatch");
  const require=createRequire(new URL("../firebase/kangsain-functions/functions/package.json",import.meta.url));
  const {require:tsRequire}=require("tsx/cjs/api");
  const ts=relative=>tsRequire(fileURLToPath(new URL(`../firebase/kangsain-functions/functions/src/memberSignup/${relative}.ts`,import.meta.url)),import.meta.url);
  const {loadMembershipWelcomeHistory}=ts("membershipWelcomeHistory");
  const {loadMembershipProviderHistory,loadMembershipWelcomeTemplate}=ts("membershipWelcomeProvider");
  const {membershipWelcomeKey,membershipWelcomeTemplateIssue,MEMBERSHIP_WELCOME_TEMPLATE:template}=ts("membershipWelcomePolicy");
  const admin=require("firebase-admin");
  const app=admin.initializeApp({projectId:"archive-pilates",credential:admin.credential.cert(key)});
  const db=app.firestore(), stamp=()=>admin.firestore.Timestamp.now();
  let context,release,postAllowed=false,postCount=0,transportEvidenceAt=null;
  const secrets=new Map();
  const secret=name=>{
    if (!secrets.has(name)) secrets.set(name,execFileSync("gcloud",["secrets","versions","access","latest",`--secret=${name}`,
      "--project=archive-pilates",`--account=${operator}`,"--quiet"],{encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:20000,
      env:{...process.env,CLOUDSDK_CORE_LOG_HTTP:"false",CLOUDSDK_CORE_VERBOSITY:"error"}}).trim());
    return secrets.get(name);
  };
  const request=async(url,method="GET",body)=>{
    const parsed=new URL(url);
    if(parsed.origin!=="https://api.solapi.com" ||
       !(method==="GET" && (/^\/messages\/v4\/list$/.test(parsed.pathname)||/^\/kakao\/v2\/templates\/[A-Za-z0-9_-]+$/.test(parsed.pathname)) ||
         method==="POST" && parsed.pathname==="/messages/v4/send-many/detail" && postAllowed && postCount===0))
      throw new Error("recovery_provider_request_not_allowed");
    const date=new Date().toISOString(),salt=randomBytes(16).toString("hex");
    const apiKey=secret("SOLAPI_API_KEY"), apiSecret=secret("SOLAPI_API_SECRET");
    const signature=createHmac("sha256",apiSecret).update(date+salt).digest("hex");
    if(method==="POST"){
      if(!transportEvidenceAt||Date.now()-Date.parse(transportEvidenceAt)>=120000||Date.now()>=Date.parse(RECOVERY_APPROVAL_EXPIRES_AT))throw new Error("recovery_evidence_expired_before_transport");
      postCount++;
    }
    const response=await fetch(parsed,{method,redirect:"error",headers:{Authorization:`HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
      ...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error("recovery_provider_request_failed");
    return response.json();
  };
  try {
    let sourceSnap=await db.doc(`studiomateMembershipContracts/${target[1]}`).get();
    const source=sourceSnap.data();
    const candidateId=membershipWelcomeKey("5330",source.binding.memberPhone);
    let [candidateSnap,sendSnap]=await db.getAll(db.doc(`alimtalkCandidates/${candidateId}`),db.doc(`alimtalkSends/${candidateId}`));
    const priorClaim=await db.doc(`membershipWelcomeClaims/${candidateId}`).get();
    const receipt=async()=>{
      const ledger=(await sendSnap.ref.get()).data();
      if(!ledger?.solapiMessageId || ledger.operatorRecovery?.reference!==RECOVERY_APPROVAL)
        throw new Error("recovery_prior_claim_requires_manual_reconciliation");
      const params=new URLSearchParams({to:source.binding.memberPhone,type:"ATA",dateType:"CREATED",startDate:ledger.operatorRecovery.checkedAt,
        endDate:new Date().toISOString(),limit:"500"});
      const response=await request(`https://api.solapi.com/messages/v4/list?${params}`);
      if(response.nextKey)throw new Error("recovery_receipt_page_incomplete");
      const rows=Object.values(response.messageList||{}).filter(row=>row.messageId===ledger.solapiMessageId);
      if(rows.length!==1)throw new Error("recovery_exact_receipt_required");
      const delivered=assertRecoveryReceipt(rows[0],source,template,ledger.solapiMessageId);
      const terminalFailure=["FAILED","REJECTED","DELETED"].includes(rows[0].status)||
        rows[0].status==="COMPLETE"&&!delivered;
      if(terminalFailure && mode!=="--dry-run"){
        const batch=db.batch();
        batch.update(sendSnap.ref,{status:"failed",providerStatus:rows[0].status,providerStatusCode:String(rows[0].statusCode),lastError:"provider_terminal_failure",updatedAt:stamp()});
        batch.update(candidateSnap.ref,{status:"failed",lastError:"provider_terminal_failure",updatedAt:stamp()});
        batch.update(priorClaim.ref,{status:"failed_no_retry",updatedAt:stamp()});
        batch.update(sourceSnap.ref,{welcomeStatus:"review",welcomeReason:"provider_terminal_failure",updatedAt:stamp()});
        await batch.commit();
        throw new Error("recovery_provider_terminal_failure_no_retry");
      }
      if(delivered && mode!=="--dry-run"){
        await db.runTransaction(async tx=>{
          const claimSnap=await tx.get(priorClaim.ref);
          const send=await tx.get(sendSnap.ref);
          const currentSource=await tx.get(sourceSnap.ref);
          const currentCandidate=await tx.get(candidateSnap.ref);
          if(claimSnap.data()?.messageId!==ledger.solapiMessageId||send.data()?.solapiMessageId!==ledger.solapiMessageId||
            currentSource.data()?.binding?.memberId!==target[0]||currentSource.data()?.binding?.memberPhone!==source.binding.memberPhone||
            currentCandidate.data()?.solapiMessageId!==ledger.solapiMessageId)
            throw new Error("recovery_receipt_ledger_changed");
          tx.update(sendSnap.ref,{status:"done",providerStatus:"COMPLETE",providerStatusCode:"4000",providerCheckedAt:stamp(),updatedAt:stamp()});
          tx.update(priorClaim.ref,{status:"delivered",updatedAt:stamp()});
          tx.update(candidateSnap.ref,{status:"sent",lastError:null,updatedAt:stamp()});
          tx.update(sourceSnap.ref,{welcomeStatus:"accepted",welcomeReason:"operator_approved_recovery_delivered",updatedAt:stamp()});
        });
      }
      console.log(JSON.stringify({memberId:target[0],name:target[2],status:delivered?"delivered":"accepted_pending_delivery",messageId:ledger.solapiMessageId,
        providerStatus:rows[0].status,providerStatusCode:rows[0].statusCode,checkedAt:new Date().toISOString(),providerPostCount:postCount}));
    };
    if(priorClaim.exists){await receipt();return;}
    if(mode==="--receipt")throw new Error("recovery_no_existing_claim");
    const configSnap=await db.doc("systemSettings/membershipContractAutomation").get(),config=configSnap.data();
    release=await acquireStudioMateBrowserLock({owner:`approved-welcome-recovery-${target[0]}`,waitMs:60000});
    const {chromium}=await import("playwright");
    context=await chromium.launchPersistentContext(path.join(os.homedir(),"ArchiveIN/automation/browser-profile"),{headless:true});
    const page=context.pages()[0]||await context.newPage();
    const client=await captureStudioMateNativeApiClient(page,{ensureLoggedIn:p=>ensureStudioMateLoggedIn(p,{headless:true})});
    const api=Object.freeze({get:(...args)=>client.get(...args)});
    const memberResult=await readExactStudioMateMember(api,source.binding.memberPhone);
    const ticketRead=await readStudioMateUserTickets(api,target[0]);
    const contract=await readStudioMateContract(api,target[1]);
    const observed=await readNativeContractPage(page,target[1]);
    const dom={...observed,schemaVersion:1,source:"studiomate_contract_dom",verified:true,complete:true,loading:false,matchCount:1};
    const checkedAt=new Date().toISOString();
    const refreshed=buildNativeContractCompletionReadback({memberResult,ticketRead,contract,binding:source.binding,checkedAt});
    if(refreshed.status!=="verified")throw new Error(refreshed.reason);
    const signature=normalizeNativeContractSignatureReceipt(dom,source.binding,contract,checkedAt);
    assertRecoveryEvidence({source,memberResult,ticketRead,signature,readback:refreshed.nativeReadback,config,now:Date.now()});
    const exclusions=sourceReader().constant(`${sourceRoot}alimtalk/templates.ts`,"ALIMTALK_MEMBER_EXCLUSION_REASONS");
    const staff=await db.collection("staffs").where("studioId","==","5330").where("active","==",true).get();
    const staffPhones=new Set(staff.docs.map(d=>String(d.data().phone||"").replace(/\D/g,"")));
    const exclusion=exclusions[target[0]]||staffPhones.has(memberResult.member.phone);
    const {isAlimtalkTestRecipient}=tsRequire(fileURLToPath(new URL("../firebase/kangsain-functions/functions/src/alimtalk/testRecipients.ts",import.meta.url)),import.meta.url);
    if(exclusion||isAlimtalkTestRecipient({memberId:target[0],memberName:target[2],memberPhone:memberResult.member.phone}))throw new Error("recovery_staff_or_configured_recipient_excluded");
    if(mode==="--link"){
      const profile=buildMembershipContractMemberProfilePatch(memberResult.member,"5330");
      const aliasRows=await db.collection("memberProfiles").where("phoneLast4","==",profile.phoneLast4).get();
      const aliases=membershipContractFallbackAliasIds(aliasRows.docs.map(d=>({id:d.id,data:d.data()})),profile);
      const profileRef=db.doc(`memberProfiles/${target[0]}`),existing=await profileRef.get();
      if(existing.exists && (existing.data().phone!==profile.phone||existing.data().name!==profile.name))throw new Error("recovery_profile_conflict");
      await db.runTransaction(async tx=>{
        const current=await tx.get(sourceSnap.ref);
        const latestProfile=await tx.get(profileRef);
      const currentAliases=aliases.length?await tx.getAll(...aliases.map(id=>db.doc(`memberProfiles/${id}`))):[];
        if(!current.updateTime.isEqual(sourceSnap.updateTime)||latestProfile.exists!==existing.exists||
          existing.exists&&!latestProfile.updateTime.isEqual(existing.updateTime)||currentAliases.some(d=>
          !d.updateTime.isEqual(aliasRows.docs.find(a=>a.id===d.id).updateTime)))throw new Error("recovery_identity_changed");
        tx.set(profileRef,{...profile,...(aliases.length?{mergedMemberIds:admin.firestore.FieldValue.arrayUnion(...aliases)}:{}),updatedAt:stamp()},{merge:true});
        for(const alias of currentAliases)tx.update(alias.ref,{canonicalMemberId:target[0],studiomateMemberId:target[0],status:"merged",updatedAt:stamp()});
        tx.update(sourceSnap.ref,{signatureReceipt:signature.receipt,nativeReadback:refreshed.nativeReadback,
          identityRecovery:{reference:RECOVERY_APPROVAL,checkedAt},updatedAt:stamp()});
      });
      console.log(JSON.stringify({memberId:target[0],name:target[2],status:"identity_linked",aliases:aliases.length,providerPostCount:0}));return;
    }
    const profileSnapshots=(await db.collection("memberProfiles").where("phoneLast4","==",memberResult.member.phone.slice(-4)).get()).docs
      .filter(doc=>String(doc.data().phone||"").replace(/\D/g,"")===memberResult.member.phone&&doc.data().studioId==="5330");
    const local=await loadMembershipWelcomeHistory(db,{studioId:"5330",memberId:target[0],phone:memberResult.member.phone});
    const coverage=config.providerHistoryCoverage;
    const seen=new Set();
    const get=async url=>{
      const result=await request(url);
      if(new URL(url).pathname==="/messages/v4/list")for(const row of Object.values(result.messageList||{}))seen.add(row.kakaoOptions?.templateId||row.templateId||"missing");
      return result;
    };
    const provider=await loadMembershipProviderHistory(get,{phone:memberResult.member.phone,startAt:coverage?.startAt,now:new Date().toISOString(),
      coverageVerified:coverage?.verified===true&&coverage.allWelcomeVersions===true&&coverage.noRetentionGap===true&&Boolean(coverage.auditId),
      nonWelcomeTemplateAllowlist:coverage?.nonWelcomeTemplateAllowlist});
    console.log(JSON.stringify({memberId:target[0],name:target[2],mode,localComplete:local.complete,localReason:local.reason,
      localWelcomeRows:local.records.length,providerComplete:provider.complete,providerReason:provider.reason,providerWelcomeRows:provider.records.length,
      observedTemplateIds:[...seen]}));
    assertRecoveryHistories({local,provider,candidateId,candidate:candidateSnap.data(),send:sendSnap.data(),source});
    const templateIssue=membershipWelcomeTemplateIssue(await loadMembershipWelcomeTemplate(get));
    if(templateIssue)throw new Error(templateIssue);
    if(mode==="--dry-run"){console.log(JSON.stringify({memberId:target[0],status:"verified_no_send",providerPostCount:0}));return;}
    const evidence={checkedAt,signedAt:signature.receipt.signedAt,nativeReadback:refreshed.nativeReadback,signature:signature.receipt,
      localMemberIds:local.memberIds,localRecords:local.records,providerRecords:provider.records,templateId:template.templateId};
    const claimed=await claimOperatorRecovery({db,sourceSnap,configSnap,candidateSnap,sendSnap,local,candidateId,evidence,templateCode:template.templateId,profileSnapshots,stamp,now:Date.now});
    transportEvidenceAt=checkedAt;
    postAllowed=true;
    try{
      const response=await request("https://api.solapi.com/messages/v4/send-many/detail","POST",{
        messages:[{to:source.binding.memberPhone,type:"ATA",kakaoOptions:{pfId:template.channelId,templateId:template.templateId,disableSms:true,variables:{"#{이름}":source.memberName}}}],
        strict:true,allowDuplicates:false,showMessageList:true});
      const rows=Object.values(response.messageList||{});
      if(Object.keys(response.failedMessageList||{}).length||rows.length!==1||!rows[0].messageId||
        rows[0].to&&rows[0].to!==source.binding.memberPhone)throw new Error("recovery_acceptance_unknown");
      const messageId=rows[0].messageId,groupId=rows[0].groupId||response.groupInfo?.groupId||"";
      const batch=db.batch();
      batch.update(candidateSnap.ref,{status:"sent",solapiMessageId:messageId,sentAt:stamp(),lastError:null,updatedAt:stamp()});
      batch.update(sendSnap.ref,{status:"done",solapiMessageId:messageId,solapiGroupId:groupId,variables:{"#{이름}":source.memberName},lastError:null,updatedAt:stamp()});
      for(const ref of claimed.claimRefs)batch.update(ref,{status:"accepted",messageId,updatedAt:stamp()});
      batch.update(sourceSnap.ref,{welcomeCandidateId:candidateId,welcomeStatus:"accepted",welcomeReason:"operator_approved_recovery_accepted",updatedAt:stamp()});
      await batch.commit();
      console.log(JSON.stringify({memberId:target[0],name:target[2],status:"accepted",messageId,providerPostCount:postCount}));
      await receipt();
    }catch{
      const batch=db.batch();
      batch.update(sourceSnap.ref,{welcomeStatus:"review",welcomeReason:"operator_recovery_reconciliation_required",updatedAt:stamp()});
      for(const ref of claimed.claimRefs)batch.update(ref,{status:"unknown_do_not_retry",updatedAt:stamp()});
      await batch.commit().catch(()=>{});
      throw new Error("recovery_claim_retained_get_only_reconciliation_required");
    }
  }finally{
    try{await context?.close();}finally{await release?.();secrets.clear();await app.delete();}
  }
}
main().catch(error=>{console.error(JSON.stringify({status:"blocked_no_blind_retry",reason:/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:"recovery_failed_no_private_details_logged"}));process.exitCode=1;});
