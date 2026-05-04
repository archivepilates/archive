import { logger } from "firebase-functions";
import { DEFAULT_MANAGER_STAFF_ID, DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import { saveNoticeIfNew, getLastNoticeCreatedAt } from "../firestore/noticeRepository";
import { ManagerClient } from "../studiomate/managerClient";
import { normalizeManagerNotice } from "../studiomate/normalizers";
import { nowTimestamp } from "../utils/date";
import { enqueueLectureRefreshJob } from "../queue/enqueueWriteJob";

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
  for (const notice of notices) {
    if (await saveNoticeIfNew(notice)) {
      saved++;
      if (notice.refLectureId) {
        await enqueueLectureRefreshJob({
          studioId,
          lectureId: notice.refLectureId,
          fallbackDate: notice.sourceCreatedAt.slice(0, 10),
          createdByUid: "system",
        });
        refreshJobs++;
      }
    }
  }

  const newest = notices.at(-1)?.sourceCreatedAt || lastNoticeCreatedAt || "";
  await refs.syncState(`managerNoticePoller_${studioId}`).set({
    syncName: `managerNoticePoller_${studioId}`,
    studioId,
    status: "success",
    lastRunAt: nowTimestamp(),
    lastSuccessAt: nowTimestamp(),
    lastNoticeCreatedAt: newest,
    errorCount: 0,
    lastError: null,
  }, { merge: true });

  logger.info("pollManagerNotices completed", { studioId, staffId, seen: rawNotices.length, saved, refreshJobs });
  return { seen: rawNotices.length, saved, refreshJobs };
}

