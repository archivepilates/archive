import { DEFAULT_STUDIO_ID } from "../config/constants";
import { addDays, todayKst } from "../utils/date";
import { syncLecturesRange } from "./syncLecturesRange";
import { syncManagerStaffs } from "./syncManagerStaffs";

export async function syncLecturesDaily(): Promise<unknown> {
  const today = todayKst();
  await syncManagerStaffs({ studioId: DEFAULT_STUDIO_ID });
  return syncLecturesRange({
    studioId: DEFAULT_STUDIO_ID,
    startDate: addDays(today, -30),
    endDate: addDays(today, 14),
  });
}
