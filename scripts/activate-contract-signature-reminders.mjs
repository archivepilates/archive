#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { CONTRACT_REMINDER_POLICY,planContractSignatureReminder } from "./lib/contract-signature-reminder.mjs";

const args=process.argv.slice(2);
if(args.length>1 || args.some(arg=>!["--apply","--dry-run"].includes(arg))) throw new Error("Use --dry-run or explicitly approved --apply");
const apply=args.includes("--apply");
const credential=JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS || "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json","utf8"));
if(credential.project_id!=="archive-pilates" || credential.client_email!=="archive-codex-operator@archive-pilates.iam.gserviceaccount.com"
  || process.env.FIRESTORE_EMULATOR_HOST || process.env.GOOGLE_CLOUD_PROJECT&&process.env.GOOGLE_CLOUD_PROJECT!=="archive-pilates") throw new Error("Unexpected project/operator");
const require=createRequire(new URL("../firebase/kangsain-functions/functions/package.json",import.meta.url)),admin=require("firebase-admin");
admin.initializeApp({credential:admin.credential.cert(credential),projectId:"archive-pilates"});
const db=admin.firestore();
try {
  const ref=db.doc("systemSettings/membershipContractAutomation"),snap=await ref.get(),config=snap.data();
  if(config?.studioId!=="5330" || !config.observeEnabled || !config.sourcePromoted || !config.nativeE2eVerified || config.mode!=="live") throw new Error("Canonical contract source not promoted");
  const targets=await db.collection("studiomateMembershipContracts").where("status","in",["waiting","review"]).limit(21).get();
  if(targets.size>20) throw new Error("Initial reminder population requires explicit review");
  const plans=targets.docs.map(d=>{const p=planContractSignatureReminder(d.data(),d.id);return {contractId:d.id,status:p.status,reason:p.reason||null,firstConfirmedAt:p.firstConfirmedAt||null};});
  if(apply) await db.runTransaction(async tx=>{
    const latest=await tx.get(ref);
    if(!latest.updateTime?.isEqual(snap.updateTime)) throw new Error("Settings changed; re-review required");
    if(config.signatureReminderEnabled===true && config.signatureReminderPolicy===CONTRACT_REMINDER_POLICY) return;
    if(config.signatureReminderPolicy && config.signatureReminderPolicy!==CONTRACT_REMINDER_POLICY) throw new Error("Unexpected prior policy");
    tx.update(ref,{signatureReminderEnabled:true,signatureReminderPolicy:CONTRACT_REMINDER_POLICY,
      signatureReminderActivatedAt:admin.firestore.Timestamp.now()});
  });
  console.log(JSON.stringify({mode:apply?"apply":"dry-run",policy:CONTRACT_REMINDER_POLICY,targets:plans,
    settingsOnly:apply,studioMateWrites:0,smsSends:0,alimtalkSends:0}));
}finally{await db.terminate();}
