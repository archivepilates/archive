import type { MemberMemoDoc, MemoVisibility } from "../types/models";
import { refs } from "./refs";

export async function getMemberMemoHistory(input: {
  studioId: string;
  memberId: string;
  uid: string;
  isManager: boolean;
  limit: number;
}): Promise<MemberMemoDoc[]> {
  const snap = await refs.memberMemos()
    .where("studioId", "==", input.studioId)
    .where("memberId", "==", input.memberId)
    .orderBy("createdAt", "desc")
    .limit(input.limit)
    .get();
  return snap.docs
    .map((doc) => doc.data())
    .filter((memo) => canReadMemo(memo.visibility, memo.createdByUid, input.uid, input.isManager));
}

function canReadMemo(visibility: MemoVisibility, createdByUid: string, uid: string, isManager: boolean): boolean {
  if (isManager) return true;
  if (visibility === "staff_and_manager") return true;
  if (visibility === "creator_only") return createdByUid === uid;
  return false;
}

