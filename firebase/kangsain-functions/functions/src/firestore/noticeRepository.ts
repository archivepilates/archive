import type { NoticeDoc } from "../types/models";
import { refs } from "./refs";

export async function saveNoticeIfNew(notice: NoticeDoc): Promise<boolean> {
  const ref = refs.notice(notice.noticeId);
  const snap = await ref.get();
  if (snap.exists) return false;
  await ref.set(notice);
  return true;
}

export async function getLastNoticeCreatedAt(studioId: string): Promise<string> {
  const state = await refs.syncState(`managerNoticePoller_${studioId}`).get();
  return String(state.data()?.lastNoticeCreatedAt || "");
}

