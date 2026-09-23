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
} from "./lib/studiomate-native-contract-evidence.mjs";
import { buildMembershipContractMemberProfilePatch } from "./lib/studiomate-membership-contract-member-profile.mjs";

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
const targets = requestedContractId
  ? await exactContractTarget(requestedContractId)
  : await db
      .collection("studiomateMembershipContracts")
      .where("nextObservationAt", "<=", admin.firestore.Timestamp.now())
      .orderBy("nextObservationAt")
      .limit(5)
      .get();
if (targets.empty) {
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
      source.schemaVersion !== 1 ||
      source.source !== "studiomate_native_contract" ||
      source.bindingVerified !== true ||
      source.studioId !== config.studioId ||
      source.contractId !== doc.id ||
      source.binding?.contractId !== doc.id ||
      source.welcomeStatus === "accepted"
    )
      continue;
    result.checked++;
    let outcome;
    let refreshedReadback = null;
    let refreshedMember = null;
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
        currentMemberTicket: refreshed.nativeReadback,
      };
      const dom = normalizeNativeContractDom(contract, binding);
      // Native eligibility comes only from an independently verified current member/ticket/payment read.
      // The contract's copied purchase fields cannot prove a ticket was not later refunded.
      outcome = normalizeNativeContractObservation(
        contract,
        binding,
        new Date().toISOString(),
      );
      if (dom.observation && !outcome.observation)
        outcome.observation = dom.observation;
    } catch {
      outcome = {
        status: "review",
        reason: "native_contract_read_failed",
        observation: null,
        completion: null,
      };
    }
    if (outcome.status === "complete") result.completed++;
    if (outcome.status === "review") result.review++;
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
      const terminal =
        outcome.status !== "waiting" || observations.length >= 100;
      tx.update(doc.ref, {
        observationStatus: outcome.status,
        observationReason: outcome.reason,
        ...(refreshedReadback ? { nativeReadback: refreshedReadback } : {}),
        "binding.previousObservations": observations,
        ...(outcome.completion
          ? {
              completion: outcome.completion,
              status: "signed",
              welcomeStatus:
                source.welcomeStatus === "queued" ? "queued" : "ready",
            }
          : {}),
        nextObservationAt: terminal
          ? admin.firestore.FieldValue.delete()
          : admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60_000),
        updatedAt: admin.firestore.Timestamp.now(),
      });
      if (outcome.completion) {
        const profilePatch = buildMembershipContractMemberProfilePatch(
          refreshedMember,
          source.studioId,
        );
        tx.set(
          db.collection("memberProfiles").doc(profilePatch.memberId),
          {
            ...profilePatch,
            syncedAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
          },
          { merge: true },
        );
        tx.set(
          db
            .collection("studiomateMembershipContractJobs")
            .doc(source.binding.selectionJobKey),
          {
            stage: "complete",
            contractId: doc.id,
            signedAt:
              outcome.completion.signedAt ||
              outcome.completion.firstObservedSignedAt,
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
