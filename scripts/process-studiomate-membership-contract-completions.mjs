#!/usr/bin/env node
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { readNativeContractPage } from "./lib/studiomate-native-contract-reader.mjs";
import {
  normalizeNativeContractObservation,
  normalizeNativeContractDom,
} from "./lib/studiomate-native-contract-evidence.mjs";

const args = process.argv.slice(2);
if (
  args.some((arg) => !["--apply", "--dry-run"].includes(arg)) ||
  (args.includes("--apply") && args.includes("--dry-run"))
)
  throw new Error("Use --apply or --dry-run");
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
const targets = await db
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
  for (const doc of targets.docs) {
    const source = doc.data();
    if (
      source.schemaVersion !== 1 ||
      source.source !== "studiomate_native_contract" ||
      source.bindingVerified !== true ||
      source.studioId !== config.studioId ||
      source.contractId !== doc.id ||
      source.binding?.contractId !== doc.id ||
      ["accepted", "queued"].includes(source.welcomeStatus)
    )
      continue;
    result.checked++;
    let outcome;
    try {
      const observed = await readNativeContractPage(page, doc.id);
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
        currentMemberTicket: source.nativeReadback,
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
        "binding.previousObservations": observations,
        ...(outcome.completion
          ? {
              completion: outcome.completion,
              status: "signed",
              welcomeStatus: "ready",
            }
          : {}),
        nextObservationAt: terminal
          ? admin.firestore.FieldValue.delete()
          : admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60_000),
        updatedAt: admin.firestore.Timestamp.now(),
      });
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
