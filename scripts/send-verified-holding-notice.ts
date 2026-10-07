import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { db } from "../firebase/kangsain-functions/functions/src/config/firebase";
import { nowTimestamp } from "../firebase/kangsain-functions/functions/src/utils/date";
import { automaticMemberExclusionReason } from "../firebase/kangsain-functions/functions/src/alimtalk/recipientExclusion";
import { normalizeRecipientPhone } from "../firebase/kangsain-functions/functions/src/alimtalk/testRecipients";
import { HOLDING_NOTICE_TEMPLATE_ID, holdingTemplateIssue } from "./lib/holding-allowance-notice.mjs";
import { dispatchVerifiedOperatorHolding, reconcileVerifiedOperatorHolding, verifiedOperatorHoldingPlan } from "./lib/holding-notice-operator-dispatch.mjs";
import { calculateLiveHolding } from "./lib/holding-notice-live-readback.mjs";

async function main() {
  const credential = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS || "", "utf8"));
  if (credential.project_id !== "archive-pilates" || credential.client_email !== "archive-codex-operator@archive-pilates.iam.gserviceaccount.com" ||
      process.env.GCLOUD_PROJECT !== "archive-pilates") throw new Error("Expected archive-pilates operator service account");
  const args = process.argv.slice(2), value = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const options = new Set(["--member-id", "--ticket-name", "--approval", "--reconcile", "--apply", "--confirm-single-member-send"]);
  for (let i = 0; i < args.length; i++) {
    if (!options.has(args[i])) throw new Error("Unknown argument");
    if (["--member-id", "--ticket-name", "--approval", "--reconcile"].includes(args[i])) {
      if (!args[++i] || args[i].startsWith("--")) throw new Error("Missing argument value");
    }
  }
  const secret = (name: string) => execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`,
    "--project=archive-pilates", "--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const key = secret("SOLAPI_API_KEY"), secretKey = secret("SOLAPI_API_SECRET");
  const request = async (url: string, method = "GET", body?: unknown) => {
    const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
    const signature = createHmac("sha256", secretKey).update(date + salt).digest("hex");
    const response = await fetch(`https://api.solapi.com${url}`, { method,
      headers: { Authorization: `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`SOLAPI HTTP ${response.status}; reconcile before retry`);
    return response.json();
  };
  if (args.includes("--reconcile")) {
    if (args.includes("--apply") || args.includes("--confirm-single-member-send") || args.includes("--member-id") || args.includes("--ticket-name") || args.includes("--approval"))
      throw new Error("Reconciliation cannot send");
    const id = value("--reconcile");
    if (!/^holding_operator_notice_[a-f0-9]{64}$/.test(id)) throw new Error("Invalid operator receipt key");
    console.log(JSON.stringify(await reconcileVerifiedOperatorHolding({ db, stamp: nowTimestamp, id, request })));
    return;
  }
  const memberId = value("--member-id"), ticketName = value("--ticket-name");
  if (!/^[1-9]\d*$/.test(memberId || "") || !ticketName?.trim()) throw new Error("Native member ID and exact ticket name required");
  const readLatest = async ({ memberId, ticketName }: { memberId: string; ticketName: string }) => {
    const output = execFileSync(process.execPath, ["scripts/collect-studiomate-holding-source.mjs", "--member-id", memberId,
      "--ticket-name", ticketName, "--stdout"], { encoding: "utf8", timeout: 120000, maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"] });
    const response = JSON.parse(output.trim());
    if (response.ok !== true || response.mode !== "read-only-memory" || response.raw?.memberId !== memberId || response.raw?.ticketName !== ticketName)
      throw new Error("Live readback identity mismatch");
    return response.raw;
  };
  const raw = await readLatest({ memberId: memberId!, ticketName });
  const profile = (await db.doc(`memberProfiles/${raw.memberId}`).get()).data();
  if (!profile || profile.memberId !== memberId || profile.studioId !== "5330" || profile.name !== raw.memberName)
    throw new Error("Canonical current member mismatch");
  const live = calculateLiveHolding(raw);
  const approval = args.includes("--approval") ? JSON.parse(await readFile(value("--approval")!, "utf8")) : null;
  const plan = approval ? verifiedOperatorHoldingPlan(raw, profile, approval) : null;
  const template = await request(`/kakao/v2/templates/${HOLDING_NOTICE_TEMPLATE_ID}`);
  const issue = holdingTemplateIssue(template);
  if (issue) throw new Error(issue);
  if (!args.includes("--apply")) {
    console.log(JSON.stringify({ ok: true, mode: "live-preview-no-send", calculationMode: live.calculationMode,
      id: plan?.id || null, memberName: raw.memberName, phoneLast4: profile.phone.slice(-4),
      summary: live.summary, holds: live.holds.map(({ start, end }) => ({ start, end })),
      currentHold: live.currentHold, observationFingerprint: live.observation.observationFingerprint,
      ...(plan ? { variables: plan.variables, message: plan.message } : {}), sendAllowed: false }));
    return;
  }
  if (!args.includes("--confirm-single-member-send") || !plan) throw new Error("Explicit single-member approval required");
  const result = await dispatchVerifiedOperatorHolding({ db, stamp: nowTimestamp, plan, template, request, readLatest,
    recipientIssue: async (tx: FirebaseFirestore.Transaction, member: any) => {
      const staff = await tx.get(db.collection("staffs").where("studioId", "==", plan.studioId).where("active", "==", true));
      return automaticMemberExclusionReason(member, new Set(staff.docs.map(doc => normalizeRecipientPhone(doc.data().phone || ""))));
    },
  });
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
