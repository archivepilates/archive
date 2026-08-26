import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  countVideoWatchTrackers,
  mergeVideoWatchTracker,
} from "../prepare-imweb-video-watch-tracker.mjs";
import {
  buildBackfillPlan,
  buildMemberDirectory,
  buyerKeyFromMemberCode,
  cleanBuyerName,
  memberRowsFromResponse,
} from "../backfill-video-watch-buyer-names.mjs";

const source = fs.readFileSync(new URL("../imweb-video-watch-tracker.js", import.meta.url), "utf8");
const deployedSource = fs.readFileSync(
  new URL("../../core/assets/imweb-video-watch-tracker-20260826.js", import.meta.url),
  "utf8",
);

test("CORE serves the exact tracker source used by the Imweb loader", () => {
  assert.equal(deployedSource, source);
});

test("tracker is restricted to paid watch pages and an embedded YouTube player", () => {
  assert.match(source, /archive-method-watch-/);
  assert.match(source, /waitForYouTubeIframe/);
  assert.match(source, /youtube\.com\/embed/);
  assert.match(source, /enablejsapi/);
  assert.match(source, /window\.location\.origin/);
  assert.doesNotMatch(source, /private-lesson/);
});

test("tracker hashes the member identity and only adds the cleaned profile name", () => {
  assert.match(source, /window\.MEMBER_HASH/);
  assert.match(source, /subtle\.digest\("SHA-256"/);
  assert.match(source, /maskAccount\(String\(window\.MEMBER_UID/);
  assert.match(source, /readBuyerName/);
  assert.match(source, /normalizeBuyerName/);
  assert.match(source, /if \(!buyerName\) buyerName = readBuyerName\(\)/);
  const payloadStart = source.indexOf("const payload = {");
  const payloadEnd = source.indexOf("};", payloadStart);
  const payloadSource = source.slice(payloadStart, payloadEnd);
  assert.ok(payloadStart >= 0 && payloadEnd > payloadStart);
  assert.doesNotMatch(payloadSource, /MEMBER_HASH|MEMBER_UID|memberIdentity|email|phone/);
  assert.match(payloadSource, /buyerKey/);
  assert.match(payloadSource, /buyerName/);
  assert.match(payloadSource, /accountHint/);
});

test("tracker records playback milestones without touching purchase or access state", () => {
  for (const marker of ["page_view", "play", "pause", "heartbeat", "progress_${milestone}", "complete", "pagehide"]) {
    assert.ok(source.includes(marker), `missing ${marker}`);
  }
  assert.match(source, /MILESTONES = \[25, 50, 75, 90\]/);
  assert.match(source, /SESSION_IDLE_MS = 30 \* 60 \* 1000/);
  assert.match(source, /catch\(function ignoreNetworkFailure/);
  assert.doesNotMatch(source, /MEMBER_GROUP|member groups|update groups|product purchase|order/iu);
});

test("body script merge preserves unrelated scripts and replaces the tracker idempotently", () => {
  const current = [
    '<script data-existing="one">window.existingOne = true;</script>',
    '<script data-archive-pilates-video-watch-tracker="old">window.oldTracker = true;</script>',
    '<script data-existing="two">window.existingTwo = true;</script>',
  ].join("\n");
  const mergedOnce = mergeVideoWatchTracker(current, source);
  const mergedTwice = mergeVideoWatchTracker(mergedOnce, source);
  assert.equal(countVideoWatchTrackers(mergedOnce), 1);
  assert.equal(countVideoWatchTrackers(mergedTwice), 1);
  assert.ok(mergedTwice.includes("window.existingOne = true"));
  assert.ok(mergedTwice.includes("window.existingTwo = true"));
  assert.ok(!mergedTwice.includes("window.oldTracker = true"));
  assert.match(
    mergedTwice,
    /src="https:\/\/core\.archivepilates\.com\/assets\/imweb-video-watch-tracker-20260826\.js\?v=20260826b"/,
  );
  assert.ok(!mergedTwice.includes("archivePilatesVideoWatchTracker"));
  assert.equal(mergedTwice, mergedOnce);
});

test("backfill derives the same stable buyer key for the same Imweb member code", () => {
  const first = buyerKeyFromMemberCode("member-code-example");
  const second = buyerKeyFromMemberCode("member-code-example");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, buyerKeyFromMemberCode("other-member-code"));
});

test("backfill keeps member names while rejecting contact details and generic labels", () => {
  assert.equal(cleanBuyerName("홍길동 님"), "홍길동");
  assert.equal(cleanBuyerName("sample@example.com"), "");
  assert.equal(cleanBuyerName("01012345678"), "");
  assert.equal(cleanBuyerName("관리자"), "");
});

test("backfill reads both paged and --all Imweb member response shapes", () => {
  const rows = [{ memberCode: "one", name: "홍길동" }];
  assert.deepEqual(memberRowsFromResponse(rows), rows);
  assert.deepEqual(memberRowsFromResponse({ data: { list: rows } }), rows);
  assert.deepEqual(memberRowsFromResponse({ data: {} }), []);
});

test("backfill plans only exact unnamed session matches and excludes collisions", () => {
  const exactKey = buyerKeyFromMemberCode("exact-member");
  const collisionKey = buyerKeyFromMemberCode("collision-member");
  const { directory, collisions } = buildMemberDirectory([
    { memberCode: "exact-member", name: "홍길동" },
    { memberCode: "collision-member", name: "김하늘" },
    { memberCode: "collision-member", name: "이바다" },
  ]);
  assert.equal(collisions, 1);
  assert.equal(directory.has(collisionKey), false);

  const result = buildBackfillPlan(
    [
      { id: "exact", data: { buyerKey: exactKey } },
      { id: "already", data: { buyerKey: exactKey, buyerName: "기존회원" } },
      { id: "collision", data: { buyerKey: collisionKey } },
      { id: "invalid", data: { buyerKey: "short" } },
    ],
    directory,
  );
  assert.deepEqual(result.plan, [{ id: "exact", buyerName: "홍길동" }]);
  assert.equal(result.alreadyNamed, 1);
  assert.equal(result.unmatched, 1);
  assert.equal(result.invalidBuyerKeys, 1);
});
