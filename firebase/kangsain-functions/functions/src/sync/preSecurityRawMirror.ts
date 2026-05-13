import { DEFAULT_STUDIO_ID } from "../config/constants";
import { addDays, todayKst } from "../utils/date";
import { syncLecturesRange } from "./syncLecturesRange";
import { syncManagerStaffs } from "./syncManagerStaffs";
import { pollManagerNotices } from "./pollManagerNotices";

const RUN_DATE = "2026-05-12";

export async function preSecurityRawMirror(): Promise<unknown> {
  const today = todayKst();
  if (today !== RUN_DATE) return { skipped: true, reason: `pre-security mirror is only for ${RUN_DATE}` };

  await syncManagerStaffs({ studioId: DEFAULT_STUDIO_ID });
  await pollManagerNotices({ studioId: DEFAULT_STUDIO_ID });
  return syncLecturesRange({
    studioId: DEFAULT_STUDIO_ID,
    startDate: addDays(today, -30),
    endDate: addDays(today, 14),
  });
}
