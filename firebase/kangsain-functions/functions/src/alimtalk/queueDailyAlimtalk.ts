import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { autoSendabilityIssue } from "./eligibility";
import { rebuildAlimtalkCandidatesForRange } from "./rebuildAlimtalkCandidates";

export async function queueDailyAlimtalkCandidates(
  input: {
    studioId?: string;
    today?: string;
  } = {},
): Promise<{ rebuilt: number; queued: number; blocked: number }> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const today = input.today || todayKst();
  const rebuilt = await rebuildAlimtalkCandidatesForRange({
    studioId,
    startDate: today,
    endDate: today,
  });
  const candidates = await listRebuiltCandidates(rebuilt.candidateIds, studioId);

  let queued = 0;
  let blocked = 0;
  for (const candidate of candidates) {
    if (!["candidate", "reviewed", "failed"].includes(candidate.status) || autoSendabilityIssue(candidate, today)) {
      blocked += 1;
      continue;
    }
    const didQueue = await queueCandidate(candidate, today);
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

async function listRebuiltCandidates(candidateIds: string[], studioId: string): Promise<AlimtalkCandidateDoc[]> {
  const uniqueIds = [...new Set(candidateIds)];
  const snaps = await Promise.all(uniqueIds.map((candidateId) => refs.alimtalkCandidate(candidateId).get()));
  return snaps
    .map((snap) => snap.data())
    .filter((candidate): candidate is AlimtalkCandidateDoc => Boolean(candidate && candidate.studioId === studioId));
}

async function queueCandidate(candidate: AlimtalkCandidateDoc, today: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = refs.alimtalkCandidate(candidate.candidateId);
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current) return false;
    if (!["candidate", "reviewed", "failed"].includes(current.status)) return false;
    if (autoSendabilityIssue(current, today)) return false;
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
