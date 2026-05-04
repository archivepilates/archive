import type { NoticeDoc } from "../types/models";
import { refs } from "./refs";

export async function saveNoticeIfNew(notice: NoticeDoc): Promise<boolean> {
  const ref = refs.notice(notice.noticeId);
  try {
    await ref.create(notice);
    return true;
  } catch (err: any) {
    if (Number(err?.code) === 6 || String(err?.message || "").includes("ALREADY_EXISTS")) return false;
    throw err;
  }
}

export async function getLastNoticeCreatedAt(studioId: string): Promise<string> {
  const state = await refs.syncState(`managerNoticePoller_${studioId}`).get();
  return String(state.data()?.lastNoticeCreatedAt || "");
}
