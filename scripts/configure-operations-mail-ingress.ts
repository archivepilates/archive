import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

async function main() {
const args = process.argv.slice(2);
if (args.some(arg => !["--activate", "--dry-run"].includes(arg)) || args.length > 1) throw new Error("Expected --dry-run or --activate");
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credentialPath || (process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT) !== "archive-pilates")
  throw new Error("Expected archive-pilates operator environment");
const credential = JSON.parse(await readFile(credentialPath, "utf8"));
if (credential.project_id !== "archive-pilates" || credential.client_email !== "archive-codex-operator@archive-pilates.iam.gserviceaccount.com")
  throw new Error("Expected archive-pilates operator account");

// Read the existing secret into memory only; never write it to a file or print it.
process.env.GOOGLE_DWD_SERVICE_ACCOUNT_JSON = execFileSync("gcloud", ["secrets", "versions", "access", "latest",
  "--secret=GOOGLE_DWD_SERVICE_ACCOUNT_JSON", "--project=archive-pilates", `--account=${credential.client_email}`],
{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim();
if (JSON.parse(process.env.GOOGLE_DWD_SERVICE_ACCOUNT_JSON).project_id !== "archive-pilates")
  throw new Error("mail_gmail_project_mismatch");

const { db } = await import("../firebase/kangsain-functions/functions/src/config/firebase");
const { OperationsMailGmailClient, activateOperationsMailIngress } = await import("../firebase/kangsain-functions/functions/src/sync/operationsMailIngress");
const { OPS_MAIL, OPS_MAIL_LABEL_NAMES } = await import("../firebase/kangsain-functions/functions/src/sync/operationsMailPolicy");
try {
  const gmail = new OperationsMailGmailClient();
  if (!args.includes("--activate")) {
    const profile = await gmail.request("profile?fields=emailAddress,historyId");
    const labels = await gmail.request("labels?fields=labels(id,name)");
    if (profile.emailAddress !== OPS_MAIL.mailbox) throw new Error("mail_mailbox_identity_mismatch");
    console.log(JSON.stringify({ ok: true, mode: "read_only_configuration_check", mailbox: OPS_MAIL.mailbox,
      scope: "gmail.metadata", availableOperationLabels: labels.labels.filter((row: {name: string}) => OPS_MAIL_LABEL_NAMES.includes(row.name)).length,
      changedWatch: false, changedDatabase: false }));
  } else {
    const lane = db.doc(OPS_MAIL.lanePath);
    if (!(await lane.get()).exists) await lane.create({ laneId: "operations-mail-ingress", title: "ARCHIVE PILATES 운영 메일 점검",
      purpose: "운영 보고 메타데이터로 진단 대기열을 만들고 Codex가 원본 대조 후 보고합니다.",
      status: "active", promotionState: "not_ready", sourceCollections: ["Gmail home@archivepilates.com", "codexActionQueue"],
      allowedReaders: ["manager", "codex-operator"], forbiddenActions: ["kakao_alimtalk_send", "studio_mate_write", "google_contacts_write",
        "attendance_write", "memo_write", "payment_or_refund_decision", "reservation_decision"],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log(JSON.stringify({ ok: true, mode: "activate_metadata_only", result: await activateOperationsMailIngress(db, gmail) }));
  }
} finally {
  delete process.env.GOOGLE_DWD_SERVICE_ACCOUNT_JSON;
  await db.terminate();
}
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : "";
  console.error(JSON.stringify({ ok: false, errorCode: /^[a-z][a-z0-9_]{1,100}$/.test(message) ? message : "operations_mail_setup_failed" }));
  process.exitCode = 1;
});
