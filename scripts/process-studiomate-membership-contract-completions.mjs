#!/usr/bin/env node
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { readNativeContractPage } from "./lib/studiomate-native-contract-reader.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import {
  buildNativeContractCompletionReadback,
  captureStudioMateNativeApiClient,
  readExactStudioMateMember,
  readStudioMateContract,
  readStudioMateUserTickets,
} from "./lib/studiomate-native-contract-source.mjs";
import {
  normalizeNativeContractObservation,
  normalizeNativeContractDom,
  normalizeNativeContractSignatureReceipt,
} from "./lib/studiomate-native-contract-evidence.mjs";
import {
  needsMembershipContractObservation,
  membershipContractNextObservation,
  selectMembershipContractObservationTargets,
  membershipContractObservationHistory,
  resolveMembershipContractSignature,
  membershipContractObservationTail,
  membershipContractCompletionSafetyPatch,
  membershipContractWelcomeObservationPatch,
} from "./lib/studiomate-membership-contract-completion-state.mjs";
import {
  buildMembershipContractMemberProfilePatch,
  membershipContractFallbackAliasIds,
} from "./lib/studiomate-membership-contract-member-profile.mjs";
import { processContractSignatureReminder,planContractSignatureReminder,assertContractReminderLive,contractReminderDiagnosticText } from "./lib/contract-signature-reminder.mjs";
import { sendContractReminderSms } from "./lib/contract-signature-reminder-browser.mjs";

const args = process.argv.slice(2);
let requestedContractId = "";
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (["--apply", "--dry-run", "--send-signature-reminders"].includes(arg)) continue;
  if (arg === "--contract-id" && !requestedContractId) {
    requestedContractId = String(args[index + 1] || "");
    index += 1;
    continue;
  }
  throw new Error("Use --apply or --dry-run with an optional --contract-id");
}
if (
  (args.includes("--apply") && args.includes("--dry-run")) ||
  (requestedContractId && !/^[a-f0-9]{64}$/.test(requestedContractId))
)
  throw new Error("Use --apply or --dry-run with a valid --contract-id");
const apply = args.includes("--apply");
const sendSignatureReminders = args.includes("--send-signature-reminders");
if (sendSignatureReminders && (!apply || requestedContractId))
  throw new Error("Signature reminders require the scheduled apply path without an exact contract target");
const result = {
  mode: apply ? "apply" : "dry-run",
  checked: 0,
  completed: 0,
  review: 0,
  sent: 0,
  studioMateWrites: 0,
  signaturesRecorded: 0,
  signatureReminderAccepted: 0,
  signatureReminderReview: 0,
  records: [],
};
// Same download runner as contact sync; no duplicate downloader, LaunchAgent or heartbeat.
if (process.env.STUDIOMATE_MEMBERSHIP_CONTRACT_COMPLETION !== "enabled") {
  console.log(JSON.stringify({ ...result, status: "disabled" }));
  process.exit(0);
}
const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  "archive-pilates";
if (projectId !== "archive-pilates")
  throw new Error("Unexpected Firebase project");
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
const settingsRef = db.doc("systemSettings/membershipContractAutomation");
const config = (await settingsRef.get()).data();
if (
  config?.observeEnabled !== true ||
  config?.sourcePromoted !== true ||
  config?.studioId !== "5330"
) {
  console.log(JSON.stringify({ ...result, status: "source_not_promoted" }));
  process.exit(0);
}
const recoveryCursorRef = db.doc("opsState/membershipContractCompletionRecoveryCursor");
let recoveryPage = null;
let nextRecoveryCursor = null;
let nextDueCursor = null;
const targets = requestedContractId
  ? await exactContractTarget(requestedContractId)
  : await scheduledTargets();

async function scheduledTargets() {
  const savedCursor = (await recoveryCursorRef.get()).data() || {};
  let dueQuery = db
      .collection("studiomateMembershipContracts")
      .where("nextObservationAt", "<=", admin.firestore.Timestamp.now())
      .orderBy("nextObservationAt")
      .orderBy(admin.firestore.FieldPath.documentId()).limit(20);
  if (savedCursor.dueAt?.toMillis && /^[a-f0-9]{64}$/.test(savedCursor.dueId || ""))
    dueQuery = dueQuery.startAfter(savedCursor.dueAt, savedCursor.dueId);
  const due = await dueQuery.get();
  nextDueCursor = due.size === 20 ? { dueId: due.docs.at(-1).id, dueAt: due.docs.at(-1).data().nextObservationAt } : { dueId: null, dueAt: null };
  const cursor = savedCursor.lastId;
  let query = db.collection("studiomateMembershipContracts")
    .where("status", "in", ["waiting", "review"])
    .orderBy(admin.firestore.FieldPath.documentId()).limit(20);
  if (/^[a-f0-9]{64}$/.test(cursor || "")) query = query.startAfter(cursor);
  recoveryPage = await query.get();
  nextRecoveryCursor = recoveryPage.size === 20 ? recoveryPage.docs.at(-1).id : null;
  const docs = selectMembershipContractObservationTargets(due.docs, recoveryPage.docs, config.studioId);
  return { empty: !docs.length, docs };
}
if (targets.empty) {
  if (apply && recoveryPage) await recoveryCursorRef.set({ ...nextDueCursor, lastId: nextRecoveryCursor, updatedAt: admin.firestore.Timestamp.now() });
  console.log(JSON.stringify({ ...result, status: "idle" }));
  process.exit(0);
}
let context;
let release;
try {
  release = await acquireStudioMateBrowserLock({
    owner: "membership-contract-completion",
    waitMs: 10_000,
  });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(
    path.join(os.homedir(), "ArchiveIN/automation/browser-profile"),
    { headless: true },
  );
  const page = await context.newPage();
  const api = await captureStudioMateNativeApiClient(page, {
    ensureLoggedIn: (target) =>
      ensureStudioMateLoggedIn(target, { headless: true }),
  });
  for (const doc of targets.docs) {
    const source = doc.data();
    if (
      !needsMembershipContractObservation(source, doc.id, config.studioId, { refresh: Boolean(requestedContractId) })
    )
      continue;
    result.checked++;
    let outcome;
    let refreshedReadback = null;
    let refreshedMember = null;
    let profilePatch = null;
    let fallbackAliasIds = [];
    let reminderReadback = null;
    try {
      const [observed, providerContract, memberResult] = await Promise.all([
        readNativeContractPage(page, doc.id),
        readStudioMateContract(api, doc.id),
        readExactStudioMateMember(api, source.binding.memberPhone),
      ]);
      const ticketRead =
        memberResult.status === "verified"
          ? await readStudioMateUserTickets(api, memberResult.member.memberId)
          : { status: "review", tickets: [] };
      const refreshed = buildNativeContractCompletionReadback({
        memberResult,
        ticketRead,
        contract: providerContract,
        binding: source.binding,
        checkedAt: new Date().toISOString(),
      });
      if (refreshed.status !== "verified")
        throw new Error(refreshed.reason);
      refreshedReadback = refreshed.nativeReadback;
      refreshedMember = memberResult.member;
      reminderReadback = {dom:observed,contract:providerContract,memberResult,ticketRead,checkedAt:new Date().toISOString()};
      const contract = {
        ...observed,
        schemaVersion: 1,
        source: "studiomate_contract_dom",
        verified: true,
        complete: true,
        loading: false,
        matchCount: 1,
      };
      const binding = {
        ...source.binding,
        previousObservations: membershipContractObservationHistory(source),
        currentMemberTicket: refreshed.nativeReadback,
      };
      const dom = normalizeNativeContractDom(contract, binding);
      const signature = normalizeNativeContractSignatureReceipt(contract, binding, providerContract, new Date().toISOString());
      // Native eligibility comes only from an independently verified current member/ticket/payment read.
      // The contract's copied purchase fields cannot prove a ticket was not later refunded.
      outcome = normalizeNativeContractObservation(
        contract,
        binding,
        new Date().toISOString(),
      );
      if (dom.observation && !outcome.observation)
        outcome.observation = dom.observation;
      outcome = resolveMembershipContractSignature(outcome, signature, dom.observation?.status);
      if (outcome.completion) {
        profilePatch = buildMembershipContractMemberProfilePatch(
          refreshedMember,
          source.studioId,
        );
        const aliases = await db
          .collection("memberProfiles")
          .where("phoneLast4", "==", profilePatch.phoneLast4)
          .get();
        fallbackAliasIds = membershipContractFallbackAliasIds(
          aliases.docs.map((item) => ({ id: item.id, data: item.data() })),
          profilePatch,
        );
      }
    } catch (error) {
      outcome = {
        status: "review",
        reason: error?.message === "invalid_observation_history" ? "invalid_observation_history" : "native_contract_read_failed",
        observation: null,
        completion: null,
      };
      outcome.diagnostic = String(error?.message || "unknown_native_read_failure").slice(0, 160);
    }
    const tail = membershipContractObservationTail(source, outcome.observation);
    if (tail.overflow) outcome = { ...outcome, status: "review", reason: "invalid_observation_history", completion: null, signatureReceipt: null };
    if (outcome.status === "complete") result.completed++;
    if (outcome.status === "review") result.review++;
    if (outcome.signatureReceipt) result.signaturesRecorded++;
    result.records.push({ contractId: doc.id, status: outcome.status, reason: outcome.reason,
      signedAt: outcome.signatureReceipt?.signedAt || null, diagnostic: outcome.diagnostic || null });
    if (!apply && outcome.status === "waiting") {
      const plan=planContractSignatureReminder(source,doc.id);
      if (plan.status === "ready") {
        try { assertContractReminderLive(source,plan,reminderReadback); result.records.at(-1).signatureReminderPreflight="verified_no_send"; }
        catch { result.records.at(-1).signatureReminderPreflight="source_unverified_no_send"; }
      } else result.records.at(-1).signatureReminderPreflight=plan.reason;
    }
    if (!apply) continue;
    await db.runTransaction(async (tx) => {
      const latest = await tx.get(doc.ref);
      const currentConfig = await tx.get(settingsRef);
      if (
        !latest.updateTime?.isEqual(doc.updateTime) ||
        currentConfig.data()?.observeEnabled !== true ||
        currentConfig.data()?.sourcePromoted !== true
      )
        throw new Error("Native source/config changed while reading");
      const observations = [...(source.binding.previousObservations || [])];
      if (outcome.observation && observations.length < 100)
        observations.push(outcome.observation);
      const next = membershipContractNextObservation(outcome, source, Date.now());
      tx.update(doc.ref, {
        observationStatus: outcome.status,
        observationReason: outcome.reason,
        ...(refreshedReadback ? { nativeReadback: refreshedReadback } : {}),
        "binding.previousObservations": observations,
        lastObservation: outcome.observation || source.lastObservation || null,
        observationTail: tail.rows,
        observationReviewAttempts: next?.reviewAttempts || 0,
        observationHold: outcome.status === "review" && !next,
        observationDiagnostic: outcome.diagnostic || null,
        ...(outcome.signatureReceipt ? { signatureReceipt: outcome.signatureReceipt, status: "signed" } : {}),
        ...(outcome.completion
          ? {
              completion: outcome.completion,
              status: "signed",
            }
          : {}),
        ...membershipContractWelcomeObservationPatch(outcome, source),
        ...membershipContractCompletionSafetyPatch(outcome, source, admin.firestore.FieldValue.delete()),
        nextObservationAt: next ? admin.firestore.Timestamp.fromMillis(next.at) : admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.Timestamp.now(),
      });
      if (outcome.completion) {
        tx.set(
          db.collection("memberProfiles").doc(profilePatch.memberId),
          {
            ...profilePatch,
            ...(fallbackAliasIds.length
              ? {
                  mergedMemberIds:
                    admin.firestore.FieldValue.arrayUnion(...fallbackAliasIds),
                }
              : {}),
            syncedAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
          },
          { merge: true },
        );
        for (const aliasId of fallbackAliasIds) {
          tx.set(
            db.collection("memberProfiles").doc(aliasId),
            {
              canonicalMemberId: profilePatch.memberId,
              status: "merged",
              updatedAt: admin.firestore.Timestamp.now(),
            },
            { merge: true },
          );
        }
      }
      if (outcome.completion || outcome.signatureReceipt) {
        tx.set(
          db
            .collection("studiomateMembershipContractJobs")
            .doc(source.binding.selectionJobKey),
          {
            stage: "complete",
            contractId: doc.id,
            signedAt:
              outcome.completion?.signedAt ||
              outcome.completion?.firstObservedSignedAt ||
              outcome.signatureReceipt.signedAt,
            updatedAt: admin.firestore.Timestamp.now(),
          },
          { merge: true },
        );
      }
    });
    if (sendSignatureReminders && outcome.status === "waiting") {
      const reminder = await processContractSignatureReminder({
        db,source:(await doc.ref.get()).data(),id:doc.id,apply,scheduled:true,
        readLive:async()=>{
          const verificationPage = await context.newPage();
          try {
            const dom = await readNativeContractPage(verificationPage,doc.id);
            const contract = await readStudioMateContract(api,doc.id);
            const memberResult = await readExactStudioMateMember(api,source.binding.memberPhone);
            const ticketRead = memberResult.status === "verified"
              ? await readStudioMateUserTickets(api,memberResult.member.memberId) : {status:"review",tickets:[]};
            return {dom,contract,memberResult,ticketRead,checkedAt:new Date().toISOString()};
          } finally { await verificationPage.close(); }
        },
        sendSms:(plan,beforeFinalSend)=>sendContractReminderSms(page,plan,beforeFinalSend),
      });
      result.records.at(-1).signatureReminder = reminder;
      if (reminder.status === "accepted") { result.signatureReminderAccepted++; result.studioMateWrites++; }
      if (reminder.status === "review") {
        result.signatureReminderReview++;
        const report = spawnSync(process.execPath,[fileURLToPath(new URL("../firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs",import.meta.url))],{
          encoding:"utf8",timeout:45000,maxBuffer:1024*1024,env:{...process.env,
            AUTOMATION_REPORT_FROM:"home@archivepilates.com",AUTOMATION_REPORT_TO:"home@archivepilates.com",
            AUTOMATION_REPORT_EVENT_ID:createHash("sha256").update(`contract_signature_reminder_review:${reminder.stage}:${doc.id}`).digest("hex"),
            AUTOMATION_REPORT_SUBJECT:"[전자계약][확인필요] 서명 요청 문자 결과 확인",
            AUTOMATION_REPORT_LABEL:"자동화 확인필요",
            AUTOMATION_REPORT_BODY:["주체: ARCHIVE CORE / 전자계약 24시간 서명 요청",
              "결론: 서명 요청 문자를 안전하게 완료 확인하지 못했습니다.",`원인: ${reminder.reason}`,
              ...(contractReminderDiagnosticText(reminder.diagnostic)
                ? [`상세원인: ${contractReminderDiagnosticText(reminder.diagnostic)} 최종 발송 전 보류했습니다.`] : []),
              `원천: studiomateMembershipContracts/${doc.id}`,
              reminder.stage === "postclaim"
                ? "현재: 발송 시도 기록은 보존되며 자동 재발송하지 않습니다. 문자 접수와 전달은 별도입니다."
                : "현재: 원본 검증 또는 문자 작성 화면 확인 단계에서 보류했습니다. 최종 발송 시도는 없으며 다음 정기 실행에서 다시 확인합니다.",
              `상세: https://arcpilates.studiomate.kr/users/contract/detail?id=${doc.id}`,
              reminder.stage === "postclaim"
                ? "다음: StudioMate 문자 발송 내역과 서명 상태를 확인한 뒤 운영자가 판단하세요."
                : "다음: 원본 계약·수강권 변경 여부를 확인하세요. 원본 검증 전 문자를 보내지 않습니다."].join("\n")}});
        if (report.status !== 0) result.records.at(-1).signatureReminderEmailUnconfirmed=true;
      }
    }
  }
} finally {
  try {
    await context?.close();
  } finally {
    await release?.();
  }
}
if (apply && recoveryPage) await recoveryCursorRef.set({ ...nextDueCursor, lastId: nextRecoveryCursor, updatedAt: admin.firestore.Timestamp.now() });
console.log(
  JSON.stringify({ ...result, ok:result.signatureReminderReview===0, status: result.review || result.signatureReminderReview ? "review" : "checked" }),
);

async function exactContractTarget(contractId) {
  const doc = await db
    .collection("studiomateMembershipContracts")
    .doc(contractId)
    .get();
  return { empty: !doc.exists, docs: doc.exists ? [doc] : [] };
}
