import admin from "../firebase/kangsain-functions/functions/node_modules/firebase-admin/lib/index.js";
import { spawnSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const NOTION_API_VERSION = "2022-06-28";

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const command = process.argv[2] || "count";
const limit = Math.max(1, Math.min(10, Number(readArg("--limit") || 5)));
const PROCESSING_STALE_MINUTES = 30;

async function main() {
  if (command === "count") {
    await resetStaleProcessingTasks();
    const snap = await db.collection("privateLessonChartGptTasks").where("status", "==", "pending").limit(20).get();
    console.log(String(snap.size));
    return;
  }
  if (command === "claim") {
    await resetStaleProcessingTasks();
    const tasks = await claimPendingTasks(limit);
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }
  if (command === "complete") {
    const input = await readStdinJson();
    await completeTask(input);
    console.log(JSON.stringify({ ok: true, taskId: input.taskId }));
    return;
  }
  if (command === "fail") {
    const input = await readStdinJson();
    await failTask(input);
    console.log(JSON.stringify({ ok: true, taskId: input.taskId }));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

async function claimPendingTasks(max) {
  const snap = await db.collection("privateLessonChartGptTasks").where("status", "==", "pending").limit(max).get();
  const claimed = [];
  for (const doc of snap.docs) {
    const task = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const data = fresh.data();
      if (!data || data.status !== "pending") return null;
      tx.set(
        doc.ref,
        {
          status: "processing",
          attempts: Number(data.attempts || 0) + 1,
          processingStartedAt: admin.firestore.Timestamp.now(),
          lockedBy: "macmini-codex-agent",
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );
      return { taskId: doc.id, ...data };
    });
    if (!task) continue;
    const recordSnap = task.recordId ? await db.collection("privateLessonChartRecords").doc(task.recordId).get() : null;
    const record = recordSnap?.exists ? recordSnap.data() : null;
    claimed.push({
      taskId: task.taskId,
      sourceCollection: task.sourceCollection || "privateLessonChartRecords",
      sourceDocId: task.sourceDocId || task.recordId,
      sourceHash: task.sourceHash || "",
      recordId: task.recordId,
      requestId: task.requestId,
      memberName: task.memberName,
      staffName: task.staffName,
      sessionNumber: task.sessionNumber,
      lessonDate: task.lessonDate,
      promptBrief: task.promptBrief,
      notionPageId: record?.notionSync?.pageId || "",
    });
  }
  return claimed;
}

async function resetStaleProcessingTasks() {
  const staleBefore = admin.firestore.Timestamp.fromMillis(Date.now() - PROCESSING_STALE_MINUTES * 60 * 1000);
  const snap = await db
    .collection("privateLessonChartGptTasks")
    .where("status", "==", "processing")
    .where("processingStartedAt", "<", staleBefore)
    .limit(20)
    .get();
  for (const doc of snap.docs) {
    await doc.ref.set(
      {
        status: "pending",
        error: `processing stale over ${PROCESSING_STALE_MINUTES} minutes; requeued by macmini agent`,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
  }
}

async function completeTask(input) {
  const taskId = requireString(input.taskId, "taskId");
  const summary = cleanPublicText(requireString(input.summary, "summary"), 500);
  const nextDirection = cleanPublicText(requireString(input.nextDirection, "nextDirection"), 300);
  const taskRef = db.collection("privateLessonChartGptTasks").doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) throw new Error(`Task not found: ${taskId}`);
  const task = taskSnap.data();
  const now = admin.firestore.Timestamp.now();

  await db.runTransaction(async (tx) => {
    tx.set(
      taskRef,
      {
        status: "draft_created",
        result: { summary, nextDirection },
        error: null,
        completedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    if (task.recordId) {
      tx.set(
        db.collection("privateLessonChartRecords").doc(task.recordId),
        {
          gptStatus: "draft_created",
          gptDraftSummary: summary,
          gptDraftNextDirection: nextDirection,
          updatedAt: now,
        },
        { merge: true },
      );
    }
  });

  if (task.recordId) {
    const recordSnap = await db.collection("privateLessonChartRecords").doc(task.recordId).get();
    const pageId = recordSnap.data()?.notionSync?.pageId;
    if (pageId) await updateNotionDraft(pageId, summary, nextDirection);
  }
}

async function failTask(input) {
  const taskId = requireString(input.taskId, "taskId");
  const error = String(input.error || "unknown error").slice(0, 1000);
  await db.collection("privateLessonChartGptTasks").doc(taskId).set(
    {
      status: "failed",
      error,
      updatedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true },
  );
}

async function updateNotionDraft(pageId, summary, nextDirection) {
  const token = notionToken();
  await notionRequest(token, `pages/${pageId}`, "PATCH", {
    properties: {
      "GPT Status": { select: { name: "draft_created" } },
      "GPT Draft Summary": richText(summary),
      "GPT Draft Next Direction": richText(nextDirection),
    },
  });
  await replaceWaitingDraftBlock(token, pageId, `${summary}\n\n다음 방향: ${nextDirection}`);
}

async function replaceWaitingDraftBlock(token, pageId, text) {
  const list = await notionRequest(token, `blocks/${pageId}/children?page_size=100`, "GET");
  const block = (list.results || []).find((item) => {
    const richText = item?.paragraph?.rich_text || [];
    return richText.some((part) => String(part?.plain_text || "").includes("GPT 초안 생성 대기"));
  });
  if (!block?.id) return;
  await notionRequest(token, `blocks/${block.id}`, "PATCH", {
    paragraph: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] },
  });
}

async function notionRequest(token, path, method, body) {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Notion ${method} ${path} failed ${response.status}: ${parsed.message || text}`);
  return parsed;
}

function notionToken() {
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN;
  const result = spawnSync("gcloud", ["secrets", "versions", "access", "latest", "--secret=NOTION_TOKEN", "--project", PROJECT_ID], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`NOTION_TOKEN secret read failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function richText(value) {
  return { rich_text: value ? [{ text: { content: value.slice(0, 2000) } }] : [] };
}

function cleanPublicText(value, maxLength) {
  return String(value || "")
    .replace(/\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "")
    .replace(/병력|진단명|의학적|통증 상세/g, "컨디션")
    .trim()
    .slice(0, maxLength);
}

function requireString(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) throw new Error("JSON stdin is required");
  return JSON.parse(raw);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
