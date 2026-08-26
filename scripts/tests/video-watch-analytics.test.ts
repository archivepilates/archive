import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoWatchDashboard,
  eventWithoutBuyerName,
  normalizeVideoWatchEvent,
  type VideoWatchSessionRow,
} from "../../firebase/kangsain-functions/functions/src/videoAnalytics/videoWatchAnalytics";

const now = new Date("2026-08-26T08:30:00.000Z");

test("normalizes a paid video watch event with a cleaned buyer name", () => {
  const event = normalizeVideoWatchEvent(
    {
      eventId: "event_123456789012345678901234",
      sessionId: "session_1234567890123456",
      buyerKey: "a".repeat(64),
      buyerName: "홍길동 님",
      accountHint: "h***@archivepilates.com",
      videoCode: "AR2-1",
      videoTitle: "ARCHIVE METHOD 리포머",
      eventType: "progress_50",
      pagePath: "/archive-method-watch-ar2-1",
      positionSeconds: 1200,
      durationSeconds: 2400,
      activeDeltaSeconds: 60,
      clientOccurredAt: "2026-08-26T08:29:50.000Z",
      trackerVersion: "2026-08-26.2",
    },
    now,
  );

  assert.equal(event.videoCode, "AR2-1");
  assert.equal(event.progressPercent, 50);
  assert.equal(event.watchDate, "2026-08-26");
  assert.equal(event.buyerName, "홍길동");
  assert.equal(event.accountHint, "h***@archivepilates.com");
  assert.equal("email" in event, false);
  assert.equal("phone" in event, false);
  const rawEvent = eventWithoutBuyerName(event);
  assert.equal("buyerName" in rawEvent, false);
  assert.equal(rawEvent.buyerKey, event.buyerKey);
});

test("rejects raw email, mismatched page, and invalid buyer identity", () => {
  const base = {
    eventId: "event_123456789012345678901234",
    sessionId: "session_1234567890123456",
    buyerKey: "a".repeat(64),
    accountHint: "h***@archivepilates.com",
    videoCode: "AR1",
    eventType: "play",
    pagePath: "/archive-method-watch-ar1",
  };
  assert.throws(() => normalizeVideoWatchEvent({ ...base, accountHint: "home@archivepilates.com" }, now), /마스킹/);
  assert.throws(() => normalizeVideoWatchEvent({ ...base, buyerName: "home@archivepilates.com" }, now), /이메일/);
  assert.throws(() => normalizeVideoWatchEvent({ ...base, pagePath: "/archive-method-watch-ab1" }, now), /일치/);
  assert.throws(() => normalizeVideoWatchEvent({ ...base, buyerKey: "short" }, now), /식별값/);
});

test("builds video and buyer frequency summaries from started sessions only", () => {
  const sessions: VideoWatchSessionRow[] = [
    session({
      id: "session-a",
      buyerKey: "a".repeat(64),
      buyerName: "홍길동",
      accountHint: "h***@archivepilates.com",
      videoCode: "AR1",
      videoTitle: "리포머 AR1",
      firstSeenAt: new Date("2026-08-24T01:00:00.000Z"),
      lastSeenAt: new Date("2026-08-24T01:30:00.000Z"),
      playCount: 2,
      activeWatchSeconds: 1200,
      maxProgressPercent: 75,
      watchDates: ["2026-08-24"],
    }),
    session({
      id: "session-b",
      buyerKey: "a".repeat(64),
      buyerName: "",
      accountHint: "h***@archivepilates.com",
      videoCode: "AR1",
      videoTitle: "리포머 AR1",
      firstSeenAt: new Date("2026-08-25T01:00:00.000Z"),
      lastSeenAt: new Date("2026-08-25T01:40:00.000Z"),
      playCount: 1,
      activeWatchSeconds: 1800,
      maxProgressPercent: 100,
      completed: true,
      watchDates: ["2026-08-25"],
    }),
    session({
      id: "session-c",
      buyerKey: "b".repeat(64),
      accountHint: "k***@example.com",
      videoCode: "AB1",
      videoTitle: "바렐 AB1",
      firstSeenAt: new Date("2026-08-25T02:00:00.000Z"),
      lastSeenAt: new Date("2026-08-25T02:01:00.000Z"),
      started: false,
      playCount: 0,
      activeWatchSeconds: 0,
      maxProgressPercent: 0,
      watchDates: ["2026-08-25"],
    }),
  ];

  const dashboard = buildVideoWatchDashboard(sessions, 30) as {
    totals: Record<string, number>;
    videos: Array<Record<string, unknown>>;
    buyers: Array<Record<string, unknown>>;
  };
  assert.equal(dashboard.totals.activeBuyers, 1);
  assert.equal(dashboard.totals.watchSessions, 2);
  assert.equal(dashboard.totals.playStarts, 3);
  assert.equal(dashboard.totals.completions, 1);
  assert.equal(dashboard.totals.totalWatchSeconds, 3000);
  assert.equal(dashboard.videos.length, 1);
  assert.equal(dashboard.videos[0].sessions, 2);
  assert.equal(dashboard.buyers[0].activeDays, 2);
  assert.equal(dashboard.buyers[0].label, "홍길동");
  assert.equal(dashboard.buyers[0].buyerName, "홍길동");
});

function session(overrides: Partial<VideoWatchSessionRow>): VideoWatchSessionRow {
  return {
    id: "session",
    buyerKey: "a".repeat(64),
    buyerName: "",
    accountHint: "",
    videoCode: "AR1",
    videoTitle: "AR1",
    sourcePage: "/archive-method-watch-ar1",
    firstSeenAt: now,
    lastSeenAt: now,
    started: true,
    completed: false,
    playCount: 1,
    activeWatchSeconds: 0,
    maxProgressPercent: 0,
    watchDates: ["2026-08-26"],
    ...overrides,
  };
}
