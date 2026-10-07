import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { sourceReader } from "./lib/alimtalk-catalog-source.mjs";
import { HOLDING_NOTICE_TEMPLATE as spec, HOLDING_NOTICE_TEMPLATE_ID, holdingTemplateIssue } from "./lib/holding-allowance-notice.mjs";
import { dispatchHoldingNoticeSample, holdingNoticeSamplePlan, reconcileHoldingNoticeSample, completeProviderRows, HOLDING_V2_TEST_DATE } from "./lib/holding-notice-test-dispatch.mjs";

const args = process.argv.slice(2);
const allowed = new Set(["--read-only", "--connect", "--test", "--reconcile", "--apply", "--confirm-live-alimtalk-test"]);
if (args.some((arg) => !allowed.has(arg)) || new Set(args).size !== args.length ||
    args.filter((arg) => ["--read-only", "--connect", "--test", "--reconcile"].includes(arg)).length !== 1)
  throw new Error("Use --read-only, --connect --apply, or --test --apply --confirm-live-alimtalk-test");
const apply = args.includes("--apply"), test = args.includes("--test");
if (args.includes("--read-only") && apply) throw new Error("Read-only does not allow writes");
if (apply && test && !args.includes("--confirm-live-alimtalk-test")) throw new Error("Live test needs explicit confirmation");
const secret = (name) => execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`,
  "--project=archive-pilates", "--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const apiKey = secret("SOLAPI_API_KEY"), apiSecret = secret("SOLAPI_API_SECRET");
async function request(path, method = "GET", body) {
  const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  const response = await fetch(`https://api.solapi.com${path}`, { method,
    headers: { Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`SOLAPI HTTP ${response.status}; reconcile before retry`);
  return response.json();
}
const template = await request(`/kakao/v2/templates/${HOLDING_NOTICE_TEMPLATE_ID}`);
const issue = holdingTemplateIssue(template);
if (issue) throw new Error(issue);
const reader = sourceReader();
const recipients = reader.constant("firebase/kangsain-functions/functions/src/alimtalk/testRecipients.ts", "TEST_RECIPIENTS");
if (recipients.length !== 1) throw new Error("Test registry changed; inspect before dispatch");
const recipient = recipients[0];
const date = HOLDING_V2_TEST_DATE;
const plan = holdingNoticeSamplePlan(recipient, date, template);
const result = { ok: true, checkedAt: new Date().toISOString(), templateId: template.templateId,
  name: template.name, status: template.status, automaticMemberDispatchEnabled: false,
  blocker: "검증된 최초 계약기간·전체 홀딩 이력·고유 홀딩 식별자 원천 연결 전",
  sample: { id: plan.id, name: recipient.name, phoneLast4: recipient.phone.slice(-4), summary: plan.summary, message: plan.message } };
{
  const require = createRequire(import.meta.url);
  const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
  const key = JSON.parse(await readFile("/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json", "utf8"));
  if (key.project_id !== "archive-pilates" || key.client_email !== "archive-codex-operator@archive-pilates.iam.gserviceaccount.com") throw new Error("Wrong production account");
  const app = admin.initializeApp({ credential: admin.credential.cert(key), projectId: "archive-pilates" });
  try {
    const db = app.firestore(), stamp = () => admin.firestore.Timestamp.now();
    const claim = (await db.doc(`alimtalkSends/${plan.id}`).get()).data();
    result.priorTest = { exists: Boolean(claim), status: claim?.status || null, messageId: claim?.solapiMessageId || null };
    for (const collection of ["alimtalkCandidates", "alimtalkSends"]) {
      const rows = await db.collection(collection).where("templateCode", "==", template.templateId).limit(100).get();
      if (rows.size === 100) throw new Error("Incomplete v2 ledger evidence; do not send");
      if (rows.docs.some((doc) => doc.id !== plan.id && doc.data().memberPhone === recipient.phone))
        throw new Error("Existing v2 recipient claim under another key; reconcile before sending");
    }
    const params = new URLSearchParams({ startDate: `${date}T00:00:00+09:00`, endDate: new Date().toISOString(),
      dateType: "CREATED", type: "ATA", to: recipient.phone, limit: "500" });
    const history = await request(`/messages/v4/list?${params}`);
    const prior = completeProviderRows(history).filter((row) => row.to === recipient.phone && row.kakaoOptions?.templateId === template.templateId);
    result.providerPriorCount = prior.length;
    result.providerReceipts = prior.map((row) => ({ messageId: row.messageId, groupId: row.groupId,
      status: row.status, statusCode: row.statusCode }));
    if (prior.length && !claim) throw new Error("Provider already has v2 receipt without matching ledger; reconcile, do not resend");
    const [candidate, settings] = await Promise.all([
      db.doc(`alimtalkCandidates/${plan.id}`).get(), db.doc("settings/holdingNotice").get(),
    ]);
    result.savedState = { candidateStatus: candidate.data()?.status || null,
      providerOutcome: claim?.providerOutcome || null, providerStatusCode: claim?.providerStatusCode || null,
      templateId: settings.data()?.templateId || null, autoSendEnabled: settings.data()?.autoSendEnabled ?? null,
      canonicalSourcePromoted: settings.data()?.canonicalSourcePromoted ?? null };
    if (!apply) { console.log(JSON.stringify(result, null, 2)); process.exitCode = 0; }
    else {
    const batch = db.batch();
    batch.set(db.doc(`alimtalkTemplateStates/${template.templateId}`), {
      templateCode: template.templateId, name: template.name, label: template.name,
      status: template.status, source: "solapi", lastError: null, channelId: template.channelId,
      content: template.content, buttons: template.buttons, buttonUrls: [...new Set(template.buttons.flatMap((button) => [button.linkMo, button.linkPc]).filter(Boolean))], messageType: template.messageType,
      emphasizeType: template.emphasizeType, imageId: template.imageId, syncedAt: stamp(), updatedAt: stamp(),
    }, { merge: true });
    batch.set(db.doc("settings/holdingNotice"), {
      templateId: template.templateId, templateLabel: template.name, channelId: spec.channelId,
      imageId: spec.imageId, templateStatus: "APPROVED", mode: "operator_sample_only",
      buttons: template.buttons, testKey: plan.id,
      autoSendEnabled: false, canonicalSourcePromoted: false, blocker: result.blocker,
      updatedAt: stamp(), updatedBy: "codex:operator-approved-template-connection",
    }, { merge: true });
    await batch.commit();
    result.connected = true;
    if (test) result.send = await dispatchHoldingNoticeSample({ db, stamp, recipient, date, template, request, confirmed: true });
    if (args.includes("--reconcile")) result.reconciliation = await reconcileHoldingNoticeSample({ db, stamp, recipient, date, template, request });
    if (test) {
      const ledger = (await db.doc(`alimtalkSends/${plan.id}`).get()).data();
      const messageId = result.send?.messageId || ledger?.solapiMessageId;
      if (!messageId) {
        result.evidence = { ledgerStatus: ledger?.status || null, deliveryComplete: false, reason: "발송 결과 확인 전 · 재발송 금지" };
      } else {
      const query = new URLSearchParams({ messageIds: JSON.stringify([messageId]) });
      const provider = await request(`/messages/v4/list?${query}`);
      const rows = completeProviderRows(provider);
      const row = rows.length === 1 && rows[0].messageId === messageId ? rows[0] : null;
      const rowTemplate = row?.kakaoOptions?.templateId || row?.templateId || null;
      result.evidence = { ledgerStatus: ledger?.status || null, messageId,
        providerStatus: row?.status || null, providerStatusCode: row?.statusCode || null,
        templateId: rowTemplate, phoneLast4: String(row?.to || "").slice(-4),
        deliveryComplete: rowTemplate === template.templateId && row?.to === recipient.phone &&
          String(row?.statusCode) === "4000" && row?.status === "COMPLETE" };
      }
    }
    }
  } finally { await app.delete(); }
}
if (apply) console.log(JSON.stringify(result, null, 2));
