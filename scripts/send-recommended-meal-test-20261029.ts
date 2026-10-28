import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import type { CallableRequest } from "firebase-functions/v2/https";
import type { StaffDoc, AlimtalkCandidateDoc } from "../firebase/kangsain-functions/functions/src/types/models";

async function main() {
  const apply = process.argv.includes("--apply");
  const checked = process.argv.find(v => v.startsWith("--native-checked-at="))?.slice(20);
  const account = "archive-codex-operator@archive-pilates.iam.gserviceaccount.com";
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json";
  process.env.GCLOUD_PROJECT = "archive-pilates";
  for (const secret of ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_PFID"]) {
    process.env[secret] = execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${secret}`,
      "--project=archive-pilates", `--account=${account}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  const { db } = await import("../firebase/kangsain-functions/functions/src/config/firebase");
  const require = createRequire(new URL("../firebase/kangsain-functions/functions/package.json", import.meta.url));
  const { Timestamp } = require("firebase-admin/firestore");
  const { primaryAlimtalkTestRecipient } = await import("../firebase/kangsain-functions/functions/src/alimtalk/testRecipients");
  const policy = await import("../firebase/kangsain-functions/functions/src/alimtalk/recommendedMealTestWindow");
  const { ALIMTALK_TEMPLATES } = await import("../firebase/kangsain-functions/functions/src/alimtalk/templates");
  const { recommendedMealTemplateContractIssue } = await import("../firebase/kangsain-functions/functions/src/alimtalk/eligibility");
  const target = primaryAlimtalkTestRecipient(), code = ALIMTALK_TEMPLATES.recommended_meal_survey.code;
  const profiles = await db.collection("memberProfiles").where("phone", "==", target.phone).limit(20).get();
  const matches = profiles.docs.filter(d => String(d.get("memberId") || d.id) === target.memberId && d.get("name") === target.name);
  if (profiles.size === 20 || matches.length !== 1) throw Error("Test identity ambiguous or absent");
  const staffRows = await db.collection("staffs").where("name", "==", target.name).limit(20).get();
  const operators = staffRows.docs.filter(d => d.get("active") && ["owner", "manager"].includes(d.get("role")));
  if (operators.length !== 1) throw Error("Canonical approved operator identity ambiguous or absent");
  const staff = { ...operators[0].data(), staffId: operators[0].id,
    uid: `service:${account}`, name: "Codex 운영자 승인 테스트" } as StaffDoc;
  const candidateRef = db.doc(`alimtalkCandidates/${policy.MEAL_TEST_CANDIDATE}`);
  const requestRef = db.doc(`recommendedMealProgramRequests/${policy.MEAL_TEST_REQUEST}`);
  const sendRef = db.doc(`alimtalkSends/${policy.MEAL_TEST_CANDIDATE}`);
  const existing = await db.getAll(requestRef, candidateRef, sendRef, db.doc(policy.MEAL_TEST_APPROVAL));
  if (existing.some(d => d.exists)) throw Error("Test has existing request, claim or approval; read outcome, never replay");
  const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", process.env.SOLAPI_API_SECRET!).update(date + salt).digest("hex");
  const response = await fetch(`https://api.solapi.com/kakao/v2/templates/${encodeURIComponent(code)}`, {
    headers: { Authorization: `HMAC-SHA256 apiKey=${process.env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}` },
  });
  if (!response.ok) throw Error(`Template read ${response.status}`);
  const template = await response.json() as Record<string, any>;
  const buttons = (template.buttons || []).map((b: Record<string, unknown>) => ({ name: b.buttonName,
    type: b.buttonType, mobileUrl: b.linkMo, desktopUrl: b.linkPc }));
  const issue = recommendedMealTemplateContractIssue({ type: "recommended_meal_survey", templateCode: code } as AlimtalkCandidateDoc,
    { ...template, buttonUrls: buttons.flatMap((b: any) => [b.mobileUrl, b.desktopUrl]), buttons } as any);
  if (template.status !== "APPROVED" || issue) throw Error("Remote approved template contract mismatch");
  if (!apply) { console.log(JSON.stringify({ ok: true, mode: "read_only_plan", recipient: target.name,
    nativeMemberId: target.memberId, template: code, requestId: policy.MEAL_TEST_REQUEST, priorTestRecords: 0 })); return; }
  const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  git(["fetch", "origin", "main"]);
  if (git(["branch", "--show-current"]) !== "main" || git(["status", "--porcelain"])
    || git(["rev-parse", "HEAD"]) !== git(["rev-parse", "origin/main"])) throw Error("Test requires reviewed clean deployed main");
  for (const surface of ["core", "member", "compatibility"]) {
    const receipt = JSON.parse(fs.readFileSync(`artifacts/recommended-meal-20261029/${surface}-release.json`, "utf8"));
    if (!receipt.verified || receipt.sourceCommit !== git(["rev-parse", "HEAD"])) throw Error("Verified matching Hosting release missing");
  }
  const nativeTime = Date.parse(checked || "");
  if (!Number.isFinite(nativeTime) || Date.now() < nativeTime || Date.now() - nativeTime > 5 * 60000)
    throw Error("Fresh full-phone StudioMate exact-match verification required");
  const approval = { approved: true, status: "approved", campaign: policy.MEAL_TEST_CAMPAIGN,
    memberId: target.memberId, phoneSha256: createHash("sha256").update(target.phone).digest("hex"),
    templateCode: code, candidateId: policy.MEAL_TEST_CANDIDATE, notBefore: new Date().toISOString(),
    expiresAt: "2026-10-29T14:00:00.000Z", nativeVerifiedAt: checked, approvalSource: "user_20261029_meal_test_one_time_window_exception" };
  await db.runTransaction(async tx => {
    const refs = [requestRef, candidateRef, sendRef, db.doc(policy.MEAL_TEST_APPROVAL)];
    const rows = await tx.getAll(...refs);
    if (rows.some(r => r.exists)) throw Error("Concurrent test intent exists");
    if (Date.now() >= Date.parse(approval.expiresAt) || Date.parse(approval.expiresAt) - Date.now() > 86400000) throw Error("Test approval interval invalid");
    tx.create(db.doc(policy.MEAL_TEST_APPROVAL), { ...approval, createdAt: Timestamp.now() });
  });
  const { operatorSendRecommendedMealProgramAlimtalkHandler } = await import("../firebase/kangsain-functions/functions/src/mealPlan/recommendedMealAlimtalk");
  const result = await operatorSendRecommendedMealProgramAlimtalkHandler({ data: { phone: target.phone,
    memberName: target.name, testCampaign: policy.MEAL_TEST_CAMPAIGN, note: "승인된 3분 설문 테스트 1회" } } as CallableRequest, staff);
  console.log(JSON.stringify({ status: result.status, requestId: result.requestId, candidateId: result.candidateId,
    messageId: result.solapiMessageId || null, noReplay: true }));
}

main().catch(() => { console.error("Approved meal test stopped. Read canonical outcome before any retry; no automatic replay."); process.exitCode = 1; });
