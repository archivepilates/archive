#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { normalizeHoldingObservation, reconcileHoldingObservation, holdingSourceId } from "./lib/studiomate-holding-source.mjs";

const args = process.argv.slice(2);
function value(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ""; }
const file = value("--observation"), reviewFile = value("--review"), output = value("--output");
if (!file || !output) throw new Error("--observation and --output required; --review optional for evidence preview");
const raw = JSON.parse(await readFile(file, "utf8"));
const observation = normalizeHoldingObservation(raw);
const review = reviewFile ? JSON.parse(await readFile(reviewFile, "utf8")) : null;
let result = { ok: true, mode: "evidence-preview", observation, sendAllowed: false, reason: "identity_review_required" };
if (review) {
  const previous = value("--previous") ? JSON.parse(await readFile(value("--previous"), "utf8")) : null;
  result = { ok: true, mode: "shadow", ...reconcileHoldingObservation(raw, review, previous) };
}
if (args.includes("--stage") || args.includes("--promote")) {
  const require = createRequire(import.meta.url);
  const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
  if (!admin.apps.length) admin.initializeApp({ projectId: "archive-pilates" });
  const db = admin.firestore();
  if (args.includes("--promote")) {
    if (!review || args.includes("--stage")) throw new Error("Explicit verified review required for promotion");
    const id = holdingSourceId({ ...observation, ticketId: review.ticketId });
    await db.runTransaction(async tx => {
      const settings = (await tx.get(db.doc("settings/holdingNotice"))).data();
      if (settings?.canonicalSourcePromoted !== true || settings?.sourceReadbackVerified !== true ||
        !settings?.promotionAuditId || settings?.studioId !== "5330") throw new Error("Separate audited source promotion required");
      const ref = db.collection("memberTicketHolds").doc(id);
      const current = await tx.get(ref);
      // Never use a caller-supplied previous file as production baseline authority.
      const plan = reconcileHoldingObservation(raw, review, current.data() || null);
      if (Date.now() - Date.parse(plan.source.observedAt) > 15 * 60000) throw new Error("Fresh StudioMate observation required");
      tx.set(ref, plan.source);
      result = { ok: true, mode: "canonical-source-only", ...plan };
    });
  } else {
    const id = observation.observationFingerprint;
    await db.doc(`workLanes/holding-allowance-notice/observations/${id}`).set({ ...raw, observationFingerprint: id });
    if (review) await db.doc(`workLanes/holding-allowance-notice/identityReviews/${id}`).set(review);
    result.mode = "staged-no-send";
  }
}
await writeFile(output, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ok: result.ok, mode: result.mode, output, reason: result.reason,
  candidateCount: result.candidateKeys?.length || 0, sendAllowed: false }));
