import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { nowTimestamp } from "./date";
import { stableHash } from "./hash";

const SHORT_LINK_BASE_URL = "https://in.archivepilates.com/s";
const ALLOWED_TARGET_ORIGINS = new Set(["https://in.archivepilates.com", "https://www.notion.so"]);

export type ShortLinkType =
  | "survey_detail"
  | "group_survey"
  | "method_material"
  | "private_chart"
  | "private_report"
  | "inbody_report";

export function shortLinkIdForTarget(type: ShortLinkType, targetUrl: string): string {
  const prefix =
    type === "survey_detail"
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

export function shortUrlForId(linkId: string): string {
  return `${SHORT_LINK_BASE_URL}/${encodeURIComponent(linkId)}/`;
}

export async function ensureShortLink(input: {
  type: ShortLinkType;
  targetUrl: string;
  sourceId?: string;
}): Promise<{ linkId: string; shortUrl: string }> {
  assertAllowedTargetUrl(input.targetUrl);
  const linkId = shortLinkIdForTarget(input.type, input.targetUrl);
  const ref = db.collection("shortLinks").doc(linkId);
  const sourceId = input.sourceId || "";
  await db.runTransaction(async (tx) => {
    const now = nowTimestamp();
    const snap = await tx.get(ref);
    const previous = snap.data() || {};
    const sourceIds = Array.isArray(previous.sourceIds)
      ? previous.sourceIds.filter((value): value is string => typeof value === "string" && Boolean(value))
      : [];
    if (sourceId && !sourceIds.includes(sourceId)) sourceIds.push(sourceId);
    tx.set(
      ref,
      {
        linkId,
        type: input.type,
        targetUrl: input.targetUrl,
        sourceId: previous.sourceId || sourceId,
        latestSourceId: sourceId || previous.latestSourceId || previous.sourceId || "",
        sourceIds,
        active: true,
        updatedAt: now,
        createdAt: previous.createdAt || now,
      },
      { merge: true },
    );
  });
  return { linkId, shortUrl: shortUrlForId(linkId) };
}

export async function redirectShortLinkHandler(request: any, response: any): Promise<void> {
  const linkId = shortLinkIdFromRequest(request);
  if (!linkId) {
    response.status(404).send("링크를 찾을 수 없습니다.");
    return;
  }

  const snap = await db.collection("shortLinks").doc(linkId).get();
  const data = snap.data();
  if (!data?.active || !data.targetUrl) {
    response.status(404).send("링크를 찾을 수 없습니다.");
    return;
  }

  try {
    assertAllowedTargetUrl(String(data.targetUrl));
  } catch (err) {
    logger.error("short link blocked invalid target", { linkId, targetUrl: data.targetUrl });
    response.status(410).send("사용할 수 없는 링크입니다.");
    return;
  }

  await snap.ref.set({ lastAccessedAt: nowTimestamp() }, { merge: true }).catch((err) => {
    logger.warn("short link access timestamp update failed", {
      linkId,
      message: err instanceof Error ? err.message : String(err),
    });
  });
  response.redirect(302, String(data.targetUrl));
}

function shortLinkIdFromRequest(request: any): string {
  const rawUrl = String(request.originalUrl || request.url || "");
  const path = rawUrl.split("?")[0] || "";
  const match = path.match(/\/s\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function assertAllowedTargetUrl(targetUrl: string): void {
  const url = new URL(targetUrl);
  if (!ALLOWED_TARGET_ORIGINS.has(url.origin)) throw new Error("short link target origin is not allowed");
}
