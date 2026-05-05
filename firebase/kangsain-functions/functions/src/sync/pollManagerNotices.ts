import { logger } from "firebase-functions";
import type { Timestamp } from "firebase-admin/firestore";
import { DEFAULT_MANAGER_STAFF_ID, DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import { getLecture } from "../firestore/lectureRepository";
import { saveNoticeIfNew, getLastNoticeCreatedAt } from "../firestore/noticeRepository";
import { ManagerClient } from "../studiomate/managerClient";
import { normalizeManagerNotice } from "../studiomate/normalizers";
import { nowTimestamp } from "../utils/date";
import { sendBookingChangePush } from "../push/sendBookingChangePush";
import { refreshLectureById } from "./refreshLectureById";

export async function pollManagerNotices(input?: {
  studioId?: string;
  staffId?: string;
}): Promise<{ seen: number; saved: number; refreshJobs: number }> {
  const studioId = input?.studioId || DEFAULT_STUDIO_ID;
  const staffId = input?.staffId || DEFAULT_MANAGER_STAFF_ID;
  const client = new ManagerClient(studioId, staffId);
  const lastNoticeCreatedAt = await getLastNoticeCreatedAt(studioId);
  const rawNotices = await client.getCommonNotices();
  const notices = rawNotices
    .map((raw) => normalizeManagerNotice(raw, studioId, staffId))
    .filter((notice) => !lastNoticeCreatedAt || notice.sourceCreatedAt > lastNoticeCreatedAt)
    .sort((a, b) => a.sourceCreatedAt.localeCompare(b.sourceCreatedAt));

  let saved = 0;
  let refreshJobs = 0;
  let pushes = 0;
  for (const notice of notices) {
    if (await saveNoticeIfNew(notice)) {
      saved++;
      if (notice.refLectureId) {
        await refreshLectureById({
          studioId,
          lectureId: notice.refLectureId,
          fallbackDate: notice.sourceCreatedAt.slice(0, 10),
        });
        refreshJobs++;
      }
      const lecture = notice.refLectureId ? await getLecture(notice.refLectureId) : null;
      if (lecture && isTodayOrTomorrow(lecture.date)) {
        const result = await sendBookingChangePush({
          notice: { ...notice, staffId: lecture.staffId },
          lectureTimeText: timeText(lecture.startAt),
        });
        pushes += result.sent;
      }
      await refs.notice(notice.noticeId).set({ processed: true, processedAt: nowTimestamp() }, { merge: true });
    }
  }

  const newest = notices.at(-1)?.sourceCreatedAt || lastNoticeCreatedAt || "";
  await refs.syncState(`managerNoticePoller_${studioId}`).set(
    {
      syncName: `managerNoticePoller_${studioId}`,
      studioId,
      status: "success",
      lastRunAt: nowTimestamp(),
      lastSuccessAt: nowTimestamp(),
      lastNoticeCreatedAt: newest,
      errorCount: 0,
      lastError: null,
    },
    { merge: true },
  );

  logger.info("pollManagerNotices completed", {
    studioId,
    staffId,
    seen: rawNotices.length,
    saved,
    refreshJobs,
    pushes,
  });
  return { seen: rawNotices.length, saved, refreshJobs };
}

function isTodayOrTomorrow(date: string): boolean {
  const now = new Date();
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 33 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return date === today || date === tomorrow;
}

function timeText(value: Timestamp | null): string {
  const date = value?.toDate();
  if (!date) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
