#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { planWelcomeStateReconciliation } from "./lib/membership-welcome-state-reconciliation.mjs";

async function main() {
  const args = process.argv.slice(2);
  let contractId = "", memberId = "", apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--contract-id" && !contractId) contractId = args[++i];
    else if (args[i] === "--member-id" && !memberId) memberId = args[++i];
    else if (args[i] === "--apply" && !apply) apply = true;
    else throw new Error("Invalid exact reconciliation arguments");
  }
  if (!/^[a-f0-9]{64}$/.test(contractId || "") || !/^[1-9]\d*$/.test(memberId || "")) throw new Error("Exact identity required");
  const key = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS || "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json", "utf8"));
  if (key.project_id !== "archive-pilates" || key.client_email !== "archive-codex-operator@archive-pilates.iam.gserviceaccount.com" ||
      process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT].some(value => value && value !== "archive-pilates")) throw new Error("Production operator identity required");
  const require = createRequire(new URL("../firebase/kangsain-functions/functions/package.json", import.meta.url));
  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: "archive-pilates", credential: admin.credential.cert(key) });
  const db = admin.firestore();
  try {
    const sourceRef = db.doc(`studiomateMembershipContracts/${contractId}`);
    const auditRef = db.doc(`workLanes/welcome-predispatch-recovery/reports/source-state-${contractId}`);
    const result = await db.runTransaction(async tx => {
      const source = await tx.get(sourceRef);
      const id = source.data()?.welcomeCandidateId;
      if (!/^membership_welcome_[a-f0-9]{64}$/.test(id || "")) return { applied: false, reason: "missing_permanent_reference" };
      const candidateRef = db.doc(`alimtalkCandidates/${id}`), sendRef = db.doc(`alimtalkSends/${id}`);
      const [candidate, send, audit] = await tx.getAll(candidateRef, sendRef, auditRef);
      const plan = planWelcomeStateReconciliation({ contractId, memberId, contract: source.data(), candidate: candidate.data(), send: send.data() });
      if (!plan.eligible || audit.exists) return { applied: false, reason: audit.exists ? "already_audited" : plan.reason };
      if (apply) {
        const at = admin.firestore.Timestamp.now();
        tx.update(sourceRef, { ...plan.patch, updatedAt: at });
        tx.create(auditRef, { sourceRef: sourceRef.path, candidateRef: candidateRef.path, sendRef: sendRef.path,
          action: "stale_queued_to_failed_review", before: { welcomeStatus: "queued", welcomeReason: source.data().welcomeReason || null },
          after: plan.patch, evidencePreserved: true, sendsAttempted: 0, checkedAt: at });
      }
      return { applied: apply, contractId, candidateId: id, reason: plan.reason, patch: plan.patch, sendsAttempted: 0 };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await db.terminate(); }
}
main().catch(() => { console.error("Welcome state reconciliation failed; no credentials logged"); process.exitCode = 1; });
