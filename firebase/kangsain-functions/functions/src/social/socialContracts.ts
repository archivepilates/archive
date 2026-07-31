import { createHash } from "node:crypto";

export const INSTAGRAM_ACCOUNT_HANDLE = "archivepilates_official";
export const SOCIAL_CONTENT_TYPES = ["image", "carousel", "reel"] as const;
export const SOCIAL_CONTENT_PILLARS = [
  "brand_method",
  "local_operations",
  "promotion",
  "people_community",
] as const;

export type SocialContentType = (typeof SOCIAL_CONTENT_TYPES)[number];
export type SocialContentPillar = (typeof SOCIAL_CONTENT_PILLARS)[number];
export type SocialMediaType = "image" | "video";

export interface SocialMediaInput {
  type: SocialMediaType;
  url: string;
  altText: string;
  position: number;
}

export interface NormalizedSocialDraftInput {
  contentId: string;
  contentType: SocialContentType;
  pillar: SocialContentPillar;
  caption: string;
  media: SocialMediaInput[];
  publishAt: Date;
  location: string;
  cta: string;
  intent: "draft" | "review";
}

export interface InstagramPublishContent {
  contentType: SocialContentType;
  caption: string;
  media: SocialMediaInput[];
}

export function composeInstagramCaption(caption: string, cta: string): string {
  const body = String(caption || "").trim();
  const action = String(cta || "").trim();
  if (!action || body.includes(action)) return body.slice(0, 2_200);
  const separator = "\n\n";
  const safeAction = action.slice(0, 2_200);
  const bodyLimit = Math.max(0, 2_200 - separator.length - safeAction.length);
  return `${body.slice(0, bodyLimit).trimEnd()}${separator}${safeAction}`.slice(0, 2_200);
}

export function normalizeSocialDraftInput(value: unknown): NormalizedSocialDraftInput {
  const input = objectValue(value);
  const contentId = stringValue(input.contentId, 100);
  const contentType = enumValue(input.contentType, SOCIAL_CONTENT_TYPES, "콘텐츠 유형");
  const pillar = enumValue(input.pillar, SOCIAL_CONTENT_PILLARS, "콘텐츠 목적");
  const caption = requiredString(input.caption, "캡션", 2_200);
  const publishAt = requiredDate(input.publishAt, "발행 일시");
  const location = stringValue(input.location, 100);
  const cta = stringValue(input.cta, 160);
  const intent = input.intent === "review" ? "review" : "draft";
  const media = normalizeMedia(input.media);

  if (contentType === "image" && (media.length !== 1 || media[0]?.type !== "image")) {
    throw new Error("이미지 게시물은 이미지 URL 1개가 필요합니다.");
  }
  if (contentType === "reel" && (media.length !== 1 || media[0]?.type !== "video")) {
    throw new Error("릴스 게시물은 영상 URL 1개가 필요합니다.");
  }
  if (contentType === "carousel" && (media.length < 2 || media.length > 10)) {
    throw new Error("캐러셀은 이미지 또는 영상 2~10개가 필요합니다.");
  }

  return {
    contentId,
    contentType,
    pillar,
    caption,
    media,
    publishAt,
    location,
    cta,
    intent,
  };
}

export function socialContentHash(input: Pick<
  NormalizedSocialDraftInput,
  "contentType" | "pillar" | "caption" | "media" | "publishAt" | "location" | "cta"
>): string {
  return sha256(
    JSON.stringify({
      contentType: input.contentType,
      pillar: input.pillar,
      caption: input.caption,
      media: input.media.map((asset) => ({
        type: asset.type,
        url: asset.url,
        altText: asset.altText,
        position: asset.position,
      })),
      publishAt: input.publishAt.toISOString(),
      location: input.location,
      cta: input.cta,
    }),
  );
}

export function socialPublishIdempotencyKey(params: {
  accountHandle?: string;
  contentId: string;
  contentHash: string;
  publishAt: Date;
}): string {
  const publishMinute = params.publishAt.toISOString().slice(0, 16);
  return sha256(
    ["instagram", params.accountHandle || INSTAGRAM_ACCOUNT_HANDLE, params.contentId, publishMinute, params.contentHash].join("|"),
  );
}

function normalizeMedia(value: unknown): SocialMediaInput[] {
  if (!Array.isArray(value)) throw new Error("미디어 URL을 입력하세요.");
  const media = value.map((item, index) => {
    const asset = objectValue(item);
    const type: SocialMediaType | null =
      asset.type === "video" ? "video" : asset.type === "image" ? "image" : null;
    if (!type) throw new Error(`${index + 1}번째 미디어 유형을 확인하세요.`);
    const url = requiredHttpsUrl(asset.url, `${index + 1}번째 미디어 URL`);
    return {
      type,
      url,
      altText: stringValue(asset.altText, 1_000),
      position: index,
    };
  });
  if (!media.length) throw new Error("미디어 URL을 입력하세요.");
  return media;
}

function requiredHttpsUrl(value: unknown, label: string): string {
  const text = requiredString(value, label, 2_000);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label}은 HTTPS 주소여야 합니다.`);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`${label}은 외부에서 접근 가능한 주소여야 합니다.`);
  }
  return url.toString();
}

function requiredDate(value: unknown, label: string): Date {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) throw new Error(`${label}를 확인하세요.`);
  return date;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  const text = stringValue(value, maxLength);
  if (!text) throw new Error(`${label}을 입력하세요.`);
  return text;
}

function stringValue(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  const candidate = String(value || "");
  if (!allowed.includes(candidate)) throw new Error(`${label}을 확인하세요.`);
  return candidate as T[number];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
