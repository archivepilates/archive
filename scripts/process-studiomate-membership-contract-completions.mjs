#!/usr/bin/env node
import { createRequire } from "node:module";
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
} from "./lib/studiomate-membership-contract-completion-state.mjs";
import {
  buildMembershipContractMemberProfilePatch,
  membershipContractFallbackAliasIds,
} from "./lib/studiomate-membership-contract-member-profile.mjs";

const args = process.argv.slice(2);
let requestedContractId = "";
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (["--apply", "--dry-run"].includes(arg)) continue;
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
const result = {
  mode: apply ? "apply" : "dry-run",
  checked: 0,
  completed: 0,
  review: 0,
  sent: 0,
  studioMateWrites: 0,
  signaturesRecorded: 0,
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
        ...(outcome.signatureReceipt && !outcome.completion ? {
          welcomeStatus: ["accepted", "queued"].includes(source.welcomeStatus) ? source.welcomeStatus : "review",
          welcomeReason: "late_signature_welcome_review_required",
        } : {}),
        ...(outcome.completion
          ? {
              completion: outcome.completion,
              status: "signed",
              welcomeStatus:
                source.welcomeStatus === "queued" ? "queued" : "ready",
            }
          : {}),
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
  JSON.stringify({ ...result, status: result.review ? "review" : "checked" }),
);

async function exactContractTarget(contractId) {
  const doc = await db
    .collection("studiomateMembershipContracts")
    .doc(contractId)
    .get();
  return { empty: !doc.exists, docs: doc.exists ? [doc] : [] };
}
