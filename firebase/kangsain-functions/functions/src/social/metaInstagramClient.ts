import { defineSecret } from "firebase-functions/params";
import {
  INSTAGRAM_ACCOUNT_HANDLE,
  type InstagramPublishContent,
  type SocialMediaInput,
} from "./socialContracts";

export const instagramAccessToken = defineSecret("INSTAGRAM_ACCESS_TOKEN");
export const instagramUserId = defineSecret("INSTAGRAM_USER_ID");

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface InstagramConnectionStatus {
  configured: boolean;
  accountHandle: string;
  graphApiVersion: string;
  username?: string;
  accountType?: string;
  followersCount?: number;
  mediaCount?: number;
  message: string;
}

export interface InstagramContainerResult {
  creationId: string;
  childCreationIds: string[];
}

export interface InstagramPublishedMedia {
  id: string;
  permalink?: string;
}

export async function getInstagramConnectionStatus(options: { verify?: boolean } = {}): Promise<InstagramConnectionStatus> {
  const credentials = credentialsOrNull();
  if (!credentials) {
    return {
      configured: false,
      accountHandle: INSTAGRAM_ACCOUNT_HANDLE,
      graphApiVersion: GRAPH_API_VERSION,
      message: "Meta 연결이 필요합니다.",
    };
  }
  if (!options.verify) {
    return {
      configured: true,
      accountHandle: INSTAGRAM_ACCOUNT_HANDLE,
      graphApiVersion: GRAPH_API_VERSION,
      message: "Meta 연결 정보가 준비되어 있습니다.",
    };
  }
  const profile = await graphGet<{
    id: string;
    username?: string;
    account_type?: string;
    followers_count?: number;
    media_count?: number;
  }>(credentials.userId, {
    fields: "id,username,account_type,followers_count,media_count",
  });
  return {
    configured: true,
    accountHandle: profile.username || INSTAGRAM_ACCOUNT_HANDLE,
    graphApiVersion: GRAPH_API_VERSION,
    username: profile.username,
    accountType: profile.account_type,
    followersCount: numberOrUndefined(profile.followers_count),
    mediaCount: numberOrUndefined(profile.media_count),
    message: "Instagram 전문 계정 연결을 확인했습니다.",
  };
}

export function isExpectedInstagramAccount(connection: InstagramConnectionStatus): boolean {
  return (
    connection.configured &&
    String(connection.username || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase() === INSTAGRAM_ACCOUNT_HANDLE
  );
}

export async function createInstagramContainer(content: InstagramPublishContent): Promise<InstagramContainerResult> {
  const credentials = requireCredentials();
  if (content.contentType === "image") {
    const asset = content.media[0];
    const result = await createMediaContainer(credentials.userId, {
      image_url: asset.url,
      caption: content.caption,
      ...(asset.altText ? { alt_text: asset.altText } : {}),
    });
    return { creationId: result.id, childCreationIds: [] };
  }

  if (content.contentType === "reel") {
    const asset = content.media[0];
    const result = await createMediaContainer(credentials.userId, {
      media_type: "REELS",
      video_url: asset.url,
      caption: content.caption,
      share_to_feed: "true",
    });
    await waitForContainerReady(result.id);
    return { creationId: result.id, childCreationIds: [] };
  }

  const childCreationIds: string[] = [];
  for (const asset of content.media) {
    const child = await createCarouselChild(credentials.userId, asset);
    childCreationIds.push(child.id);
    await waitForContainerReady(child.id);
  }
  const parent = await createMediaContainer(credentials.userId, {
    media_type: "CAROUSEL",
    children: childCreationIds.join(","),
    caption: content.caption,
  });
  await waitForContainerReady(parent.id);
  return { creationId: parent.id, childCreationIds };
}

export async function publishInstagramContainer(creationId: string): Promise<InstagramPublishedMedia> {
  const credentials = requireCredentials();
  const result = await graphPost<{ id: string }>(`${credentials.userId}/media_publish`, {
    creation_id: creationId,
  });
  const detail = await graphGet<{ id: string; permalink?: string }>(result.id, {
    fields: "id,permalink",
  });
  return { id: detail.id, permalink: detail.permalink };
}

export async function getInstagramMediaMetrics(mediaId: string): Promise<Record<string, unknown>> {
  const basic = await graphGet<Record<string, unknown>>(mediaId, {
    fields: "id,media_type,permalink,timestamp,like_count,comments_count",
  });
  try {
    const insights = await graphGet<{ data?: Array<{ name: string; values?: Array<{ value: unknown }> }> }>(
      `${mediaId}/insights`,
      { metric: "reach,saved,shares,total_interactions,views" },
    );
    return {
      ...basic,
      insights: Object.fromEntries(
        (insights.data || []).map((item) => [item.name, item.values?.[0]?.value ?? null]),
      ),
    };
  } catch (error) {
    return {
      ...basic,
      insightsWarning: safeMetaError(error),
    };
  }
}

async function createCarouselChild(userId: string, asset: SocialMediaInput): Promise<{ id: string }> {
  return createMediaContainer(userId, {
    ...(asset.type === "video"
      ? { media_type: "VIDEO", video_url: asset.url }
      : { image_url: asset.url, ...(asset.altText ? { alt_text: asset.altText } : {}) }),
    is_carousel_item: "true",
  });
}

async function createMediaContainer(userId: string, body: Record<string, string>): Promise<{ id: string }> {
  return graphPost<{ id: string }>(`${userId}/media`, body);
}

async function waitForContainerReady(containerId: string): Promise<void> {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const status = await graphGet<{ status_code?: string; status?: string }>(containerId, {
      fields: "status_code,status",
    });
    const code = String(status.status_code || "").toUpperCase();
    if (code === "FINISHED" || code === "PUBLISHED") return;
    if (["ERROR", "EXPIRED"].includes(code)) {
      throw new Error(`Instagram 미디어 준비 실패: ${status.status || code}`);
    }
    await delay(5_000);
  }
  throw new Error("Instagram 미디어 준비 시간이 초과되었습니다.");
}

async function graphGet<T>(path: string, query: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_API_BASE}/${path.replace(/^\/+/, "")}`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  return graphRequest<T>(url, { method: "GET" });
}

async function graphPost<T>(path: string, body: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_API_BASE}/${path.replace(/^\/+/, "")}`);
  return graphRequest<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

async function graphRequest<T>(url: URL, init: RequestInit): Promise<T> {
  const credentials = requireCredentials();
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${credentials.accessToken}`,
    },
    signal: AbortSignal.timeout(90_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_subcode?: number; type?: string };
  } & T;
  if (!response.ok || payload.error) {
    const error = payload.error;
    throw new Error(
      [
        `Meta API ${response.status}`,
        error?.code ? `code ${error.code}` : "",
        error?.error_subcode ? `subcode ${error.error_subcode}` : "",
        error?.message || "요청 실패",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }
  return payload as T;
}

function credentialsOrNull(): { accessToken: string; userId: string } | null {
  const accessToken = String(instagramAccessToken.value() || "").trim();
  const userId = String(instagramUserId.value() || "").trim();
  return isConfiguredInstagramSecret(accessToken) && isConfiguredInstagramSecret(userId)
    ? { accessToken, userId }
    : null;
}

export function isConfiguredInstagramSecret(value: unknown): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["not-configured", "not_configured", "disabled"].includes(normalized);
}

function requireCredentials(): { accessToken: string; userId: string } {
  const credentials = credentialsOrNull();
  if (!credentials) throw new Error("Meta 연결이 필요합니다.");
  return credentials;
}

function safeMetaError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 400);
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
