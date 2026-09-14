#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RETIREMENT_REASON = "onsite_welcome_replaced_by_studiomate_20260914";

export function shouldRetireOnsiteRequest(data) {
  return !data.retiredAt && !data.alimtalkSendId && !data.alimtalkCandidateId
    && ["pending", "lookup_ready", "ready", "error"].includes(data.status);
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (process.argv.slice(2).some((arg) => arg !== "--apply")) throw new Error("Only --apply is supported; default is read-only");
  if (apply) {
    const res = await fetch("https://in.archivepilates.com/api/onsiteWelcomeRequest", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000),
    });
    if (res.status !== 410 || (await res.json()).code !== "onsite_welcome_retired") throw new Error("Retired API must be live before closing requests");
    if (existsSync(path.join(os.homedir(), "Library/LaunchAgents/com.archive.onsite-welcome-requests.plist"))) {
      throw new Error("Remove the retired LaunchAgent from the active directory first");
    }
  }
  const require = createRequire(import.meta.url);
  const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
  if (!admin.apps.length) admin.initializeApp({ projectId: "archive-pilates" });
  const db = admin.firestore();
  const requests = await db.collection("onsiteWelcomeRequests").limit(501).get();
  const candidates = await db.collection("alimtalkCandidates").where("type", "==", "onsite_welcome").limit(501).get();
  if (requests.size > 500 || candidates.size > 500) throw new Error("Coverage limit exceeded; no writes");
  if (requests.docs.some((doc) => doc.data().status === "running")
      || candidates.docs.some((doc) => ["queued", "processing", "approved"].includes(doc.data().status))) {
    throw new Error("Active request/send found; investigate provider state before retiring");
  }
  const targets = requests.docs.filter((doc) => shouldRetireOnsiteRequest(doc.data()));
  const summary = {
    ok: true, mode: apply ? "apply" : "dry-run", retiredRequests: targets.map((doc) => ({ id: doc.id, previousStatus: doc.data().status })),
    requestsTotal: requests.size, sendsPreserved: candidates.size, memberContractsChanged: 0,
  };
  if (apply && targets.length) {
    const reportDir = path.join(os.homedir(), "ArchiveIN/automation/reports/onsite-welcome-retirement");
    mkdirSync(reportDir, { recursive: true });
    const timestamp = new Date().toISOString();
    const reportPath = path.join(reportDir, `${timestamp.replace(/[:.]/g, "-")}.json`);
    writeFileSync(reportPath, JSON.stringify({ ...summary, mode: "planned", timestamp }, null, 2), { mode: 0o600 });
    await db.runTransaction(async (tx) => {
      const fresh = await tx.getAll(...targets.map((doc) => doc.ref));
      for (let i = 0; i < fresh.length; i += 1) {
        if (!fresh[i].exists || !shouldRetireOnsiteRequest(fresh[i].data()) || fresh[i].data().status !== targets[i].data().status) {
          throw new Error("Request state changed; no retirement writes");
        }
      }
      for (const doc of fresh) {
        tx.set(doc.ref, {
          status: "cancelled", retiredFromStatus: doc.data().status, retiredAt: admin.firestore.FieldValue.serverTimestamp(),
          retirementReason: RETIREMENT_REASON, resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
          resolutionStatus: "resolved", resolution: "신규 가입서 경로 종료. 기존 계약·발송 기록 보존.",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });
    const verified = await db.getAll(...targets.map((doc) => doc.ref));
    if (!verified.every((doc) => doc.data()?.status === "cancelled" && doc.data()?.retirementReason === RETIREMENT_REASON)) {
      throw new Error("Retirement readback mismatch; inspect saved report before retry");
    }
    writeFileSync(reportPath, JSON.stringify({ ...summary, timestamp, verified: true }, null, 2), { mode: 0o600 });
    summary.reportPath = reportPath;
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
