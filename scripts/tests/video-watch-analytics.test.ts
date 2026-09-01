import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoWatchDashboard,
  eventWithoutBuyerName,
  normalizeVideoWatchEvent,
  type VideoWatchSessionRow,
} from "../../firebase/kangsain-functions/functions/src/videoAnalytics/videoWatchAnalytics";

const now = new Date("2026-08-26T08:30:00.000Z");

test("normalizes a legacy paid video watch event with a cleaned buyer name", () => {
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
  assert.equal(event.contentType, "paid");
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
    contentType: "paid",
    videoCode: "AR1",
    eventType: "play",
    pagePath: "/archive-method-watch-ar1",
  };
  assert.throws(() => normalizeVideoWatchEvent({ ...base, accountHint: "home@archivepilates.com" }, now), /마스킹/);
  assert.throws(() => normalizeVideoWatchEvent({ ...base, buyerName: "home@archivepilates.com" }, now), /이메일/);
  assert.throws(() => normalizeVideoWatchEvent({ ...base, pagePath: "/archive-method-watch-ab1" }, now), /일치/);
  assert.throws(() => normalizeVideoWatchEvent({ ...base, contentType: "student_share" }, now), /유형/);
  assert.throws(
    () => normalizeVideoWatchEvent({ ...base, pagePath: "/private-lesson-support-movement-unknown" }, now),
    /일치/,
  );
  assert.throws(() => normalizeVideoWatchEvent({ ...base, buyerKey: "short" }, now), /식별값/);
});

test("normalizes only explicitly registered student-share pages", () => {
  const event = normalizeVideoWatchEvent(
    {
      eventId: "event_student_123456789012345",
      sessionId: "session_student_1234567890",
      buyerKey: "b".repeat(64),
      buyerName: "수강회원",
      contentType: "student_share",
      videoCode: "D260830",
      videoTitle: "8/30 지지와 움직임 D팀 · 수강생 공유 (B팀 영상 대체)",
      eventType: "play",
      pagePath: "/private-lesson-support-movement-d-260830/",
    },
    now,
  );

  assert.equal(event.contentType, "student_share");
  assert.equal(event.videoCode, "D260830");
  assert.equal(event.pagePath, "/private-lesson-support-movement-d-260830");
  assert.throws(
    () => normalizeVideoWatchEvent({ ...event, videoCode: "B260829" }, now),
    /일치/,
  );
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
    recentMembers: Array<Record<string, unknown>>;
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
  assert.equal(dashboard.recentMembers.length, 1);
  assert.equal(dashboard.recentMembers[0].buyerName, "홍길동");
  assert.equal(dashboard.recentMembers[0].watchedVideos, 1);
  assert.deepEqual(
    (dashboard.recentMembers[0].history as Array<Record<string, unknown>>).map((row) => ({
      code: row.videoCode,
      sessions: row.sessions,
      completions: row.completions,
    })),
    [{ code: "AR1", sessions: 2, completions: 1 }],
  );
});

test("returns only the ten most recently active members in recent order", () => {
  const sessions = Array.from({ length: 12 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return session({
      id: `session-${index + 1}`,
      buyerKey: (index + 1).toString(16).padStart(64, "0"),
      buyerName: `회원${index + 1}`,
      lastSeenAt: new Date(`2026-08-${day}T09:00:00.000Z`),
      watchDates: [`2026-08-${day}`],
    });
  });

  const dashboard = buildVideoWatchDashboard(sessions, 30) as {
    recentMembers: Array<Record<string, unknown>>;
  };

  assert.equal(dashboard.recentMembers.length, 10);
  assert.equal(dashboard.recentMembers[0].buyerName, "회원12");
  assert.equal(dashboard.recentMembers[9].buyerName, "회원3");
  assert.equal(dashboard.recentMembers.some((row) => row.buyerName === "회원2"), false);
});

test("keeps paid and student-share dashboard segments separate", () => {
  const dashboard = buildVideoWatchDashboard(
    [
      session({
        id: "paid-session",
        buyerKey: "a".repeat(64),
        buyerName: "판매회원",
        contentType: "paid",
        videoCode: "ACA2",
      }),
      session({
        id: "share-session",
        buyerKey: "b".repeat(64),
        buyerName: "공유회원",
        contentType: "student_share",
        videoCode: "A260829",
        sourcePage: "/private-lesson-support-movement-a-260829",
      }),
    ],
    30,
  ) as {
    totals: Record<string, number>;
    segments: {
      paid: {
        totals: Record<string, number>;
        videos: Array<Record<string, unknown>>;
        recentMembers: Array<Record<string, unknown>>;
      };
      studentShare: {
        totals: Record<string, number>;
        videos: Array<Record<string, unknown>>;
        recentMembers: Array<Record<string, unknown>>;
      };
    };
  };

  assert.equal(dashboard.totals.watchSessions, 2);
  assert.equal(dashboard.segments.paid.totals.watchSessions, 1);
  assert.equal(dashboard.segments.studentShare.totals.watchSessions, 1);
  assert.equal(dashboard.segments.paid.videos[0].videoCode, "ACA2");
  assert.equal(dashboard.segments.studentShare.videos[0].videoCode, "A260829");
  assert.equal(dashboard.segments.paid.recentMembers[0].buyerName, "판매회원");
  assert.equal(dashboard.segments.studentShare.recentMembers[0].buyerName, "공유회원");
});

function session(overrides: Partial<VideoWatchSessionRow>): VideoWatchSessionRow {
  return {
    id: "session",
    buyerKey: "a".repeat(64),
    buyerName: "",
    accountHint: "",
    contentType: "paid",
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
