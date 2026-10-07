import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { HOLDING_NOTICE_TEMPLATE_ID, holdingTemplateIssue } from "./lib/holding-allowance-notice.mjs";
import { completeProviderRows } from "./lib/holding-notice-test-dispatch.mjs";
import { holdingFingerprint } from "./lib/studiomate-holding-source.mjs";
import { HOLDING_ROSTER_STATE } from "./lib/studiomate-holding-roster.mjs";
import { HOLDING_AUTO_MODE, HOLDING_AUTO_EVENTS, HOLDING_AUTO_POLICY, HOLDING_AUTO_CUTOVER, holdingAutomaticConfigIssue } from "./lib/holding-notice-automatic.mjs";

const args = process.argv.slice(2), apply = args.includes("--apply");
if (args.length !== 1 || !["--check", "--apply"].includes(args[0])) throw new Error("Use --check or --apply");
const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
const key = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS || "", "utf8"));
if (key.project_id !== "archive-pilates" || key.client_email !== "archive-codex-operator@archive-pilates.iam.gserviceaccount.com")
  throw new Error("Expected archive-pilates operator account");
const app = admin.initializeApp({ credential: admin.credential.cert(key), projectId: "archive-pilates" });
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
try {
  const db = app.firestore(), ref = db.doc("settings/holdingNotice"), baselineRef = db.doc(HOLDING_ROSTER_STATE);
  const prior = (await ref.get()).data(), baseline = (await baselineRef.get()).data();
  const age = Date.now() - Date.parse(baseline?.downloadedAt);
  if (baseline?.schemaVersion !== 2 || baseline.mode !== "discovery_only" || !Number.isFinite(age) || age < 0 || age > 90 * 60_000 ||
      Date.parse(baseline.initializedAt) >= Date.parse(HOLDING_AUTO_CUTOVER)) throw new Error("fresh_pre_cutover_baseline_required");
  if (prior?.templateId !== HOLDING_NOTICE_TEMPLATE_ID || prior.calculationMode !== "live_studiomate_readback")
    throw new Error("expected_live_readback_template_configuration");
  const journal = JSON.parse(await readFile("/Users/archivepilates/ArchiveIN/automation/reports/holding-timing-test/holding_native_timing_test_20261007.json", "utf8"));
  if (journal.stage !== "cleaned" || journal.cleanup?.nativeListAbsent !== true || journal.cleanup.originalTicketsUnchanged !== true ||
      journal.cleanup.zeroPayment !== true || journal.cleanup.reservationsCreated !== 0) throw new Error("native_e2e_cleanup_proof_required");
  const id = "holding_operator_notice_5c34bd83f9d4a65259a43232232eb900adabd014564a266304aa7666328e8ed5";
  const messageId = "M4V20261007215731UTI5KEUUZELNLRO", groupId = "G4V202610072157319DAEUKUIBVGUJVU";
  const docs = await Promise.all([`holdingNoticeClaims/holding_native_timing_test_20261007`, `holdingNoticeClaims/${id}`,
    `alimtalkCandidates/${id}`, `alimtalkSends/${id}`].map(path => db.doc(path).get()));
  if (docs.some(doc => !doc.exists || doc.data()?.solapiMessageId !== messageId || doc.data()?.solapiGroupId !== groupId) ||
      docs[0].data()?.status !== "delivered" || docs[1].data()?.status !== "delivered" || docs[2].data()?.status !== "sent" ||
      docs[3].data()?.status !== "done" || docs[3].data()?.attempts !== 1 || docs[3].data()?.providerStatusCode !== "4000")
    throw new Error("native_e2e_ledger_proof_required");
  const secret = name => execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`,
    "--project=archive-pilates", "--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 }).trim();
  const apiKey = secret("SOLAPI_API_KEY"), apiSecret = secret("SOLAPI_API_SECRET");
  const get = async path => {
    const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
    const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
    const response = await fetch(`https://api.solapi.com${path}`, { headers: {
      Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`holding_provider_preflight_${response.status}`);
    return response.json();
  };
  const templateIssue = holdingTemplateIssue(await get(`/kakao/v2/templates/${HOLDING_NOTICE_TEMPLATE_ID}`));
  if (templateIssue) throw new Error(templateIssue);
  const rows = completeProviderRows(await get(`/messages/v4/list?${new URLSearchParams({ to: "01086488585", type: "ATA", dateType: "CREATED",
    startDate: "2026-10-07T12:57:00.000Z", endDate: new Date().toISOString(), limit: "500" })}`));
  const receipt = rows.find(row => row.messageId === messageId);
  if (!receipt || receipt.groupId !== groupId || receipt.to !== "01086488585" || receipt.kakaoOptions?.templateId !== HOLDING_NOTICE_TEMPLATE_ID ||
      receipt.status !== "COMPLETE" || String(receipt.statusCode) !== "4000" || receipt.text !== docs[3].data()?.message)
    throw new Error("native_e2e_provider_proof_required");
  const head = git("rev-parse", "HEAD");
  const patch = { mode: HOLDING_AUTO_MODE, autoSendEnabled: true, canonicalSourcePromoted: true,
    calculationMode: "live_studiomate_readback", cutoverAt: HOLDING_AUTO_CUTOVER,
    automaticPolicyId: HOLDING_AUTO_POLICY, automaticSourceCollection: HOLDING_AUTO_EVENTS,
    activationCommit: head, baselineInitializedAt: baseline.initializedAt, nativeE2eVerified: true,
    sourceScanEnabled: true, rosterDiscoveryEnabled: true, blocker: "",
    updatedBy: "codex:human-approved-new-holding-cutover", automaticActivatedAt: new Date().toISOString() };
  const desired = { ...prior, ...patch };
  const configIssue = holdingAutomaticConfigIssue(desired, new Date(HOLDING_AUTO_CUTOVER));
  if (configIssue) throw new Error(configIssue);
  if (apply) {
    git("fetch", "origin");
    if (git("branch", "--show-current") !== "main" || git("status", "--porcelain") || git("rev-parse", "origin/main") !== head)
      throw new Error("clean_main_equal_origin_required");
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data(), latest = (await tx.get(baselineRef)).data();
      if (holdingFingerprint(current) !== holdingFingerprint(prior) || latest?.initializedAt !== baseline.initializedAt ||
          latest?.downloadedAt !== baseline.downloadedAt) throw new Error("activation_preflight_changed_retry_read_only");
      tx.update(ref, { ...patch, updatedAt: admin.firestore.Timestamp.now() });
    });
  }
  const saved = (await ref.get()).data();
  console.log(JSON.stringify({ ok: true, applied: apply, mode: apply ? saved.mode : "activation-preflight-no-write",
    cutoverAt: HOLDING_AUTO_CUTOVER, templateContract: "APPROVED/BA/IMAGE/exact-body-and-button", nativeE2e: "COMPLETE/4000/cleaned",
    baselineInitializedAt: baseline.initializedAt, historicalHeldMembers: Object.keys(baseline.held).length,
    ...(apply ? { autoSendEnabled: saved.autoSendEnabled, canonicalSourcePromoted: saved.canonicalSourcePromoted,
      currentGate: holdingAutomaticConfigIssue(saved) || "enabled" } : {}) }));
} finally { await app.delete(); }
