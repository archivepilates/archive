import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  composeInstagramCaption,
  normalizeSocialDraftInput,
  socialContentHash,
  socialPublishIdempotencyKey,
} from "../../firebase/kangsain-functions/functions/src/social/socialContracts";
import {
  isConfiguredInstagramSecret,
  isExpectedInstagramAccount,
} from "../../firebase/kangsain-functions/functions/src/social/metaInstagramClient";

const publishAt = "2026-08-03T10:00:00.000+09:00";

test("normalizes a review-ready Instagram image draft", () => {
  const result = normalizeSocialDraftInput({
    contentType: "image",
    pillar: "local_operations",
    caption: "명지점의 오늘 수업 소식입니다.",
    media: [{ type: "image", url: "https://cdn.example.com/class.webp", altText: "그룹 수업 현장" }],
    publishAt,
    location: "부산 명지",
    cta: "프로필 링크에서 상담",
    intent: "review",
  });
  assert.equal(result.contentType, "image");
  assert.equal(result.media.length, 1);
  assert.equal(result.intent, "review");
  assert.equal(result.publishAt.toISOString(), "2026-08-03T01:00:00.000Z");
});

test("rejects local or non-HTTPS media URLs", () => {
  assert.throws(
    () =>
      normalizeSocialDraftInput({
        contentType: "reel",
        pillar: "brand_method",
        caption: "호흡과 움직임을 연결합니다.",
        media: [{ type: "video", url: "http://127.0.0.1/video.mp4" }],
        publishAt,
      }),
    /HTTPS 주소/,
  );
});

test("enforces content-type media contracts", () => {
  assert.throws(
    () =>
      normalizeSocialDraftInput({
        contentType: "carousel",
        pillar: "promotion",
        caption: "프로그램 안내",
        media: [{ type: "image", url: "https://cdn.example.com/one.webp" }],
        publishAt,
      }),
    /2~10개/,
  );
});

test("content hash and publish key are stable and revision-sensitive", () => {
  const input = normalizeSocialDraftInput({
    contentId: "content_test_001",
    contentType: "image",
    pillar: "people_community",
    caption: "ARCHIVE PILATES 사람들의 이야기",
    media: [{ type: "image", url: "https://cdn.example.com/people.webp" }],
    publishAt,
  });
  const hash = socialContentHash(input);
  const key = socialPublishIdempotencyKey({
    contentId: input.contentId,
    contentHash: hash,
    publishAt: input.publishAt,
  });
  assert.equal(hash, socialContentHash(input));
  assert.equal(
    key,
    socialPublishIdempotencyKey({
      contentId: input.contentId,
      contentHash: hash,
      publishAt: input.publishAt,
    }),
  );
  assert.notEqual(
    key,
    socialPublishIdempotencyKey({
      contentId: input.contentId,
      contentHash: `${hash}-changed`,
      publishAt: input.publishAt,
    }),
  );
});

test("appends the operator CTA once without exceeding the Instagram caption limit", () => {
  assert.equal(
    composeInstagramCaption("명지점의 오늘 수업 소식입니다.", "프로필 링크에서 상담"),
    "명지점의 오늘 수업 소식입니다.\n\n프로필 링크에서 상담",
  );
  assert.equal(
    composeInstagramCaption("명지점 소식\n\n프로필 링크에서 상담", "프로필 링크에서 상담"),
    "명지점 소식\n\n프로필 링크에서 상담",
  );
  assert.equal(composeInstagramCaption("가".repeat(2_199), "상담"), `${"가".repeat(2_196)}\n\n상담`);
});

test("keeps social callable reads and mutations inside the manager studio boundary", () => {
  const source = fs.readFileSync(
    new URL(
      "../../firebase/kangsain-functions/functions/src/social/socialContentOperations.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /where\("studioId", "==", studioId\)/);
  assert.match(source, /existing\.studioId !== studioId/);
  assert.match(source, /content\.studioId !== studioId/);
});

test("allows publishing only to the configured ARCHIVE PILATES Instagram account", () => {
  assert.equal(
    isExpectedInstagramAccount({
      configured: true,
      accountHandle: "archivepilates_official",
      username: "archivepilates_official",
      graphApiVersion: "v25.0",
      message: "ok",
    }),
    true,
  );
  assert.equal(
    isExpectedInstagramAccount({
      configured: true,
      accountHandle: "another_account",
      username: "another_account",
      graphApiVersion: "v25.0",
      message: "wrong account",
    }),
    false,
  );
});

test("treats bootstrap secret sentinels as a disconnected Meta account", () => {
  assert.equal(isConfiguredInstagramSecret("not-configured"), false);
  assert.equal(isConfiguredInstagramSecret("NOT_CONFIGURED"), false);
  assert.equal(isConfiguredInstagramSecret("disabled"), false);
  assert.equal(isConfiguredInstagramSecret(""), false);
  assert.equal(isConfiguredInstagramSecret("real-secret-value"), true);
});
