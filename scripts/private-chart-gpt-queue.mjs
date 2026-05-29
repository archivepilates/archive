import admin from "../firebase/kangsain-functions/functions/node_modules/firebase-admin/lib/index.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const PROJECT_ID = "archive-pilates";
const NOTION_API_VERSION = "2022-06-28";
const LEGACY_PRIVATE_REPORT_URL_PATH = "/archivein/api/privateLessonReport";
const PRIVATE_LESSON_REPORT_VIEW_BASE_URL =
  process.env.PRIVATE_LESSON_REPORT_VIEW_BASE_URL || "https://in.archivepilates.com/api/privateLessonReport";
const SHORT_LINK_BASE_URL = "https://in.archivepilates.com/s";

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

  if (command === "repair") {
    const recordId = readArg("--record") || readArg("--recordId") || "";
    if (!recordId) throw new Error("--record 또는 --recordId 값이 필요합니다.");
    await repairPrivateLessonReportLinks(recordId);
    console.log(JSON.stringify({ ok: true, recordId }));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function repairPrivateLessonReportLinks(recordId) {
  const recordRef = db.collection("privateLessonChartRecords").doc(recordId);
  const recordSnap = await recordRef.get();
  if (!recordSnap.exists) throw new Error(`Record not found: ${recordId}`);
  const record = recordSnap.data();
  if (!record?.requestId) throw new Error(`Record has no requestId: ${recordId}`);

  const requestDoc = (await db.collection("privateLessonChartRequests").doc(record.requestId).get()).data();
  if (!requestDoc) throw new Error(`Request not found: ${record.requestId}`);

  const reportCanonicalUrl = makePrivateLessonReportUrl({
    recordId: String(record.recordId || ""),
    accessTokenHash: String(requestDoc.accessTokenHash || ""),
  });
  if (!reportCanonicalUrl) {
    throw new Error(`Cannot build canonical report URL for record: ${recordId}`);
  }

  const reportShortLink = await ensureShortLink({
    type: "private_report",
    targetUrl: reportCanonicalUrl,
    sourceId: `${String(record.recordId || "").replace(/[^\w-]/g, "") || "manual"}_report`,
  });
  const reportUrl = reportShortLink?.shortUrl || "";

  const now = nowTimestamp();
  await recordRef.set(
    {
      publicReportUrl: reportUrl,
      publicReportCanonicalUrl: reportCanonicalUrl,
      gptStatus: record.gptStatus || "draft_created",
      updatedAt: now,
    },
    { merge: true },
  );

  const pageId = record.notionSync?.pageId;
  if (pageId && reportUrl) {
    await Promise.all([updateNotionReportUrl(pageId, reportUrl), ensureSessionReportLinks(pageId, reportUrl)]);
  }
  const instructorPageId = record.notionSync?.instructorPageId;
  if (instructorPageId && reportUrl) {
    await ensureInstructorDraftBlock(instructorPageId, record.gptDraftSummary || "", record.gptDraftNextDirection || "", reportUrl, record.memberName);
    await ensureInstructorApprovalBlock(instructorPageId, record.notionSync?.pageUrl || notionPageUrl(pageId || ""), pageId || "");
  }
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
  const staleBeforeMillis = Date.now() - PROCESSING_STALE_MINUTES * 60 * 1000;
  const snap = await db.collection("privateLessonChartGptTasks").where("status", "==", "processing").limit(50).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const startedAtMillis = data.processingStartedAt?.toMillis?.() || Date.now();
    if (startedAtMillis >= staleBeforeMillis) continue;
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
  const requestDoc = task.requestId
    ? (await db.collection("privateLessonChartRequests").doc(task.requestId).get()).data()
    : null;
  const reportCanonicalUrl = requestDoc
    ? makePrivateLessonReportUrl({
      recordId: String(task.recordId || ""),
      accessTokenHash: String(requestDoc.accessTokenHash || ""),
    })
    : "";
  const reportShortLink = reportCanonicalUrl
    ? await ensureShortLink({
      type: "private_report",
      targetUrl: reportCanonicalUrl,
      sourceId: `${String(task.recordId || "").replace(/[^\w-]/g, "") || "manual"}_report`,
    })
    : null;
  const reportUrl = reportShortLink?.shortUrl || reportCanonicalUrl || "";

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
          publicReportUrl: reportUrl || null,
          publicReportCanonicalUrl: reportCanonicalUrl || null,
          publicSummary: summary,
          publicNextDirection: nextDirection,
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
    const instructorPageId = recordSnap.data()?.notionSync?.instructorPageId;
    const sessionPageUrl = recordSnap.data()?.notionSync?.pageUrl;
    const sessionPageId = recordSnap.data()?.notionSync?.pageId;
    if (pageId) {
      await updateNotionDraft(pageId, summary, nextDirection);
      if (reportUrl) await Promise.all([updateNotionReportUrl(pageId, reportUrl), ensureSessionReportLinks(pageId, reportUrl)]);
    }
    if (instructorPageId && reportUrl) {
      await ensureInstructorDraftBlock(instructorPageId, summary, nextDirection, reportUrl, task.memberName);
      await ensureInstructorApprovalBlock(instructorPageId, sessionPageUrl, sessionPageId);
    }
  }
}

async function ensureInstructorDraftBlock(instructorPageId, summary, nextDirection, reportUrl, memberName = "") {
  if (!instructorPageId || !reportUrl) return;
  const token = notionToken();
  if (!token) return;
  const existing = await notionRequest(token, `blocks/${instructorPageId}/children?page_size=100`, "GET");
  const hasDraft = Array.isArray(existing.results)
    && existing.results.some((block) => {
      const heading = block.type === "heading_3" ? block.heading_3 : null;
      return heading?.rich_text?.some((item) => String(item?.plain_text || "").includes("회원용 초안"));
    });

  if (!hasDraft) {
    const blocks = [
      { type: "divider", divider: {} },
      {
        type: "heading_3",
        heading_3: { rich_text: [{ type: "text", text: { content: "회원용 초안" } }] },
      },
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: summary || "GPT 초안 생성 대기 중입니다." } },
            { type: "text", text: { content: " " } },
            { type: "text", text: { content: `다음 방향: ${nextDirection || "다음 수업 방향을 입력합니다."}` } },
          ],
        },
      },
      { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: `${memberName ? `${memberName}님` : "회원"}에게 보낼 최종 리포트입니다.` } }] } },
      {
        type: "bookmark",
        bookmark: {
          url: reportUrl,
          caption: [{ type: "text", text: { content: "최종 회원 리포트 보기" } }],
        },
      },
    ];
    await notionRequest(token, `blocks/${instructorPageId}/children`, "PATCH", { children: blocks });
  }

  await ensureInstructorReportBookmark(token, instructorPageId, reportUrl);
}

async function ensureInstructorApprovalBlock(instructorPageId, sessionPageUrl, sessionPageId) {
  if (!instructorPageId) return;
  const token = notionToken();
  if (!token) return;
  const existing = await notionRequest(token, `blocks/${instructorPageId}/children?page_size=100`, "GET");
  const hasApprovalHeading = Array.isArray(existing.results)
    && existing.results.some((block) => {
      const heading = block.type === "heading_3" ? block.heading_3 : null;
      return heading?.rich_text?.some((item) => String(item?.plain_text || "").includes("발송 승인"));
    });
  const hasApprovalButton = Array.isArray(existing.results)
    && existing.results.some((block) => {
      if (block.type !== "bookmark") return false;
      const caption = (block.bookmark?.caption || []).map((part) => String(part?.plain_text || part?.text?.content || "")).join(" ");
      return caption.includes("발송 승인") || caption.includes("승인하기") || caption.includes("승인") ;
    });
  if (hasApprovalButton && hasApprovalHeading) return;

  const targetUrl = sessionPageUrl || notionPageUrl(sessionPageId || instructorPageId);
  const blocks = [
    { type: "divider", divider: {} },
    {
      type: "heading_3",
      heading_3: { rich_text: [{ type: "text", text: { content: "발송 승인" } }] },
    },
    {
      type: "bookmark",
      bookmark: {
        url: targetUrl,
        caption: [{ type: "text", text: { content: "발송 승인하기" } }],
      },
    },
    {
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: "세션 DB에서 발송 체크 후 강사용 알림톡 발송 상태를 승인합니다." } }],
      },
    },
  ];
  await notionRequest(token, `blocks/${instructorPageId}/children`, "PATCH", { children: blocks });
}

async function ensureInstructorReportBookmark(token, instructorPageId, reportUrl) {
  const existingBlocks = await notionRequest(token, `blocks/${instructorPageId}/children?page_size=100`, "GET");
  const reportBookmarks = Array.isArray(existingBlocks.results)
    ? existingBlocks.results.filter((block) => {
      if (block.type !== "bookmark") return false;
      const caption = (block.bookmark?.caption || []).map((part) => String(part?.plain_text || part?.text?.content || "")).join(" ");
      const bookmarkUrl = String(block.bookmark?.url || "").trim();
      return caption.includes("최종 회원 리포트 보기") || bookmarkUrl === reportUrl;
    })
    : [];
  if (reportBookmarks.length) {
    const mismatch = reportBookmarks.find((block) => String(block.bookmark?.url || "").trim() !== reportUrl);
    if (mismatch) {
      await notionRequest(token, `blocks/${mismatch.id}`, "PATCH", {
        bookmark: {
          url: reportUrl,
          caption: [{ type: "text", text: { content: "최종 회원 리포트 보기" } }],
        },
      });
    }
    return;
  }

  await notionRequest(token, `blocks/${instructorPageId}/children`, "PATCH", {
    children: [
      {
        type: "bookmark",
        bookmark: {
          url: reportUrl,
          caption: [{ type: "text", text: { content: "최종 회원 리포트 보기" } }],
        },
      },
    ],
  });
}

function notionPageUrl(pageId) {
  if (!pageId) return "";
  return `https://www.notion.so/${String(pageId).replaceAll("-", "")}`;
}

function makePrivateLessonReportUrl(input) {
  if (!input.recordId || !input.accessTokenHash) return "";
  const url = new URL(PRIVATE_LESSON_REPORT_VIEW_BASE_URL);
  url.searchParams.set("recordId", input.recordId);
  url.searchParams.set("token", input.accessTokenHash);
  return url.toString();
}

function shortLinkIdForTarget(type, targetUrl) {
  const prefix = type === "survey_detail"
    ? "sv"
    : type === "group_survey"
      ? "gs"
      : type === "private_chart"
        ? "pc"
        : type === "private_report"
          ? "pr"
          : type === "inbody_report"
            ? "ir"
            : "mt";
  return `${prefix}-${stableHash({ type, targetUrl }).slice(0, 12)}`;
}

function shortUrlForId(linkId) {
  return `${SHORT_LINK_BASE_URL}/${encodeURIComponent(linkId)}/`;
}

function stableHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

async function ensureShortLink(input) {
  const targetUrl = String(input?.targetUrl || "");
  if (!targetUrl) throw new Error("short link targetUrl is required");
  const linkId = shortLinkIdForTarget(input.type, targetUrl);
  await db
    .collection("shortLinks")
    .doc(linkId)
    .set(
      {
        linkId,
        type: input.type,
        targetUrl,
        sourceId: String(input.sourceId || ""),
        active: true,
        updatedAt: nowTimestamp(),
        createdAt: nowTimestamp(),
      },
      { merge: true },
    );
  return { linkId, shortUrl: shortUrlForId(linkId) };
}

function nowTimestamp() {
  return admin.firestore.Timestamp.now();
}

async function updateNotionReportUrl(pageId, reportUrl) {
  const token = notionToken();
  if (!token || !pageId || !reportUrl) return;
  await notionRequest(token, `pages/${pageId}`, "PATCH", {
    properties: {
      "회원 리포트": { url: reportUrl },
      발송상태: { select: { name: "대기" } },
    },
  });
}

function shouldReplaceLegacyReportUrl(value) {
  return Boolean(value && String(value).includes(LEGACY_PRIVATE_REPORT_URL_PATH) && String(value).includes("recordId="));
}

function normalizeReportText(text, replacementUrl) {
  const legacyPattern = /https:\/\/in\.archivepilates\.com\/archivein\/api\/privateLessonReport\?[^\s)]+/g;
  const original = String(text || "");
  const replaced = original.replace(legacyPattern, replacementUrl);
  return replaced;
}

async function ensureSessionReportLinks(pageId, reportUrl) {
  const token = notionToken();
  if (!token || !pageId || !reportUrl) return;
  const children = await notionRequest(token, `blocks/${pageId}/children?page_size=150`, "GET");
  const blocks = Array.isArray(children.results) ? children.results : [];

  const legacyCandidates = blocks.filter((block) => {
    if (block.type === "embed") return shouldReplaceLegacyReportUrl(block?.embed?.url);
    if (block.type === "paragraph") {
      const richText = block?.paragraph?.rich_text || [];
      return richText.some((item) => shouldReplaceLegacyReportUrl(item?.plain_text || item?.text?.content || item?.text?.link?.url));
    }
    return false;
  });

  await Promise.all(
    legacyCandidates.map(async (block) => {
      if (block.type === "embed") {
        await notionRequest(token, `blocks/${block.id}`, "PATCH", {
          embed: { url: reportUrl },
        });
        return;
      }

      if (block.type === "paragraph") {
        const richText = block.paragraph?.rich_text || [];
        const originalText = richText.map((item) => String(item?.plain_text || item?.text?.content || "")).join("");
        const nextText = normalizeReportText(originalText, reportUrl);
        if (nextText !== originalText) {
          await notionRequest(token, `blocks/${block.id}`, "PATCH", {
            paragraph: {
              rich_text: [{ type: "text", text: { content: nextText } }],
            },
          });
        }
      }
    }),
  );
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
