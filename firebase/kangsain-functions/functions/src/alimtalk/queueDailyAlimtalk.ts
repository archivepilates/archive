import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { addDays, nowTimestamp, todayKst } from "../utils/date";
import {
  APPROVED_ALIMTALK_TEMPLATE_CODES,
  NEW_MEMBER_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_WINDOW_DAYS,
} from "./templates";
import { rebuildAlimtalkCandidatesForRange } from "./rebuildAlimtalkCandidates";

export async function queueDailyAlimtalkCandidates(input: {
  studioId?: string;
  today?: string;
} = {}): Promise<{ rebuilt: number; queued: number; blocked: number }> {
  const studioId = input.studioId || "5330";
  const today = input.today || todayKst();
  const rebuilt = await rebuildAlimtalkCandidatesForRange({
    studioId,
    startDate: today,
    endDate: today,
  });
  const snap = await refs
    .alimtalkCandidates()
    .where("studioId", "==", studioId)
    .where("status", "in", ["candidate", "reviewed", "failed"])
    .limit(300)
    .get();

  let queued = 0;
  let blocked = 0;
  for (const doc of snap.docs) {
    const candidate = doc.data();
    if (!isAutoQueueable(candidate, today)) {
      blocked += 1;
      continue;
    }
    const didQueue = await queueCandidate(candidate);
    if (didQueue) queued += 1;
  }

  logger.info("queueDailyAlimtalkCandidates completed", {
    studioId,
    today,
    rebuilt: rebuilt.candidates,
    queued,
    blocked,
  });
  return { rebuilt: rebuilt.candidates, queued, blocked };
}

function isAutoQueueable(candidate: AlimtalkCandidateDoc, today: string): boolean {
  if (!candidate.memberPhone) return false;
  if (!APPROVED_ALIMTALK_TEMPLATE_CODES.has(candidate.templateCode)) return false;
  if (candidate.sourceDate && candidate.sourceDate > today) return false;
  if (candidate.type !== "new_member" && candidate.sourceDate !== today) return false;
  if (candidate.type === "new_member" && candidate.sourceDate < NEW_MEMBER_ALIMTALK_START_DATE) return false;
  if (candidate.type === "new_member" && candidate.sourceDate < addDays(today, -(NEW_MEMBER_ALIMTALK_WINDOW_DAYS - 1))) return false;
  return true;
}

async function queueCandidate(candidate: AlimtalkCandidateDoc): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = refs.alimtalkCandidate(candidate.candidateId);
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current) return false;
    if (!["candidate", "reviewed", "failed"].includes(current.status)) return false;
    if (!isAutoQueueable(current, todayKst())) return false;
    tx.set(
      ref,
      {
        status: "queued",
        queuedBy: "auto",
        reviewedByUid: "system:auto-daily-1130",
        reviewedAt: nowTimestamp(),
        lastError: null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return true;
  });
}
