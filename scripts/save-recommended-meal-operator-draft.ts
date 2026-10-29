import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "../firebase/kangsain-functions/functions/src/config/firebase";
import {
  cleanRequestId, mealResponseSourceHash, saveRecommendedMealProgramDraftHandler,
} from "../firebase/kangsain-functions/functions/src/mealPlan/recommendedMealProgram";
import type { StaffDoc } from "../firebase/kangsain-functions/functions/src/types/models";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => args.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
  const allowed = ["request-id", "member-id", "response-hash", "revision", "input", "audit-dir"];
  if (args.some(v => v !== "--apply" && !allowed.some(k => v.startsWith(`--${k}=`)))
    || args.length !== new Set(args.map(v => v.split("=")[0])).size) throw Error("Invalid arguments");
  const requestId = cleanRequestId(value("request-id"));
  const memberId = value("member-id");
  if (!memberId || !/^[a-f0-9]{64}$/.test(value("response-hash"))
    || !path.isAbsolute(value("input")) || !path.isAbsolute(value("audit-dir"))) throw Error("Explicit source and private audit required");
  if (process.env.GOOGLE_CLOUD_PROJECT !== "archive-pilates"
    || process.env.GOOGLE_APPLICATION_CREDENTIALS !== "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json") {
    throw Error("Expected operator service account and project");
  }
  const input = JSON.parse(fs.readFileSync(value("input"), "utf8"));
  const apply = args.includes("--apply");
  const collections = ["recommendedMealProgramRequests", "recommendedMealProgramResponses",
    "recommendedMealProgramDrafts", "recommendedMealProgramReports"];
  const before: Record<string, any> = {};
  for (const c of collections) before[c] = (await db.collection(c).doc(requestId).get()).data() || null;
  const request = before[collections[0]], response = before[collections[1]], draft = before[collections[2]], report = before[collections[3]];
  if (request?.memberId !== memberId || response?.memberId !== memberId || request?.status !== "submitted"
    || digest(response) !== value("response-hash") || String(draft?.revision || "") !== value("revision")) throw Error("Source precondition mismatch");
  if ((response.reviewReasons || []).length || report?.publicationStatus !== "draft"
    || report?.approvalStatus !== "draft" || report?.candidateId || report?.approvedSnapshot || report?.publishedSnapshot || report?.sentSnapshot) {
    throw Error("This operator test permits only a submitted, unreviewed, unpublished source");
  }
  const ledger = async () => {
    const result: Record<string, string> = {};
    for (const c of ["alimtalkCandidates", "alimtalkSends"]) {
      for (const id of [`${requestId}-invite`, `${requestId}-report`]) {
        result[`${c}/${id}`] = digest((await db.collection(c).doc(id).get()).data() || null);
      }
    }
    return result;
  };
  const unrelated = async () => {
    const result: Record<string, string> = {};
    for (const c of collections) {
      const snapshot = await db.collection(c).where("memberName", "==", "정유리").limit(20).get();
      result[c] = digest(snapshot.docs.map(d => ({ id: d.id, data: d.data() })));
    }
    return result;
  };
  const ledgersBefore = await ledger(), unrelatedBefore = await unrelated();
  const auditDir = value("audit-dir");
  fs.mkdirSync(auditDir, { recursive: true, mode: 0o700 });
  const auditFile = path.join(auditDir, "operator-draft-apply.json");
  const inputHash = digest(input);
  const evidence: Record<string, unknown> = {
    requestId, memberId, inputHash, responseHash: digest(response), previousRevision: draft?.revision,
    previousDraftHash: digest(draft), ledgersBefore, unrelatedBefore, checkedAt: new Date().toISOString(),
  };
  if (!apply) {
    fs.writeFileSync(path.join(auditDir, "operator-draft-plan.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ok: true, mode: "plan", requestId, responsePreserved: true, draftOnly: true }));
    return;
  }
  const plan = JSON.parse(fs.readFileSync(path.join(auditDir, "operator-draft-plan.json"), "utf8"));
  if (plan.inputHash !== inputHash || plan.responseHash !== evidence.responseHash
    || plan.previousRevision !== evidence.previousRevision || plan.previousDraftHash !== evidence.previousDraftHash
    || plan.memberId !== memberId || plan.requestId !== requestId) throw Error("Plan changed: prepare a new verified plan");
  if (fs.existsSync(auditFile)) throw Error("Prior apply intent: read back, never replay");
  const saveAudit = () => fs.writeFileSync(auditFile, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  evidence.applyIntentAt = new Date().toISOString(); saveAudit();
  // This local operator-only path reuses the exact deployed transaction. It has no publish/send capability.
  const actor = { staffId: "codex-operator", uid: "service:archive-codex-operator",
    name: "ARCHIVE PILATES OPS 관리자 호출", studioId: request.studioId } as StaffDoc;
  const result = await saveRecommendedMealProgramDraftHandler({ data: {
    requestId, expectedRevision: value("revision"), expectedResponseHash: mealResponseSourceHash(response),
    publicContent: input, authoringMode: "codex_operator", reviewAcknowledged: false,
  } } as any, actor);
  evidence.handlerReturned = true; saveAudit();
  const after: Record<string, any> = {};
  for (const c of collections) after[c] = (await db.collection(c).doc(requestId).get()).data() || null;
  const history = draft?.revision
    ? (await db.collection(collections[2]).doc(requestId).collection("revisions").doc(draft.revision).get()).data() : null;
  const preserved = history ? Object.fromEntries(Object.keys(draft).map(k => [k, history[k]])) : null;
  const ledgersAfter = await ledger(), unrelatedAfter = await unrelated();
  const verified = digest(after[collections[1]]) === digest(response)
    && after[collections[2]]?.provider === "operator_assisted" && after[collections[2]]?.model === "codex-chat"
    && digest(after[collections[2]].publicContent) === inputHash
    && after[collections[3]]?.publicationStatus === "draft" && after[collections[3]]?.approvalStatus === "draft"
    && !after[collections[3]]?.candidateId && !after[collections[3]]?.approvedSnapshot
    && !after[collections[3]]?.publishedSnapshot && !after[collections[3]]?.sentSnapshot
    && (!draft || digest(preserved) === digest(draft))
    && digest(ledgersAfter) === digest(ledgersBefore) && digest(unrelatedAfter) === digest(unrelatedBefore);
  Object.assign(evidence, { verified, completedAt: new Date().toISOString(),
    revision: (result.draft as Record<string, unknown>)?.revision, responsePreserved: digest(after[collections[1]]) === digest(response),
    previousDraftArchived: !draft || digest(preserved) === digest(draft), ledgersUnchanged: digest(ledgersAfter) === digest(ledgersBefore),
    unrelatedUnchanged: digest(unrelatedAfter) === digest(unrelatedBefore), publicationStatus: after[collections[3]]?.publicationStatus });
  saveAudit();
  if (!verified) throw Error("Readback mismatch; inspect audit without replay");
  console.log(JSON.stringify({ ok: true, requestId, draftSaved: true, responsePreserved: true,
    previousDraftArchived: true, published: false, sent: false, verified: true }));
}

main().catch(() => { console.error("Operator draft stopped. Read private audit before any retry."); process.exitCode = 1; });
