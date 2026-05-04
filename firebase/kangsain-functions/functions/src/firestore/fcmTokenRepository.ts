import { stableHash } from "../utils/hash";
import { nowTimestamp } from "../utils/date";
import type { FcmTokenDoc } from "../types/models";
import { refs } from "./refs";

export function fcmTokenId(token: string): string {
  return stableHash(token).slice(0, 40);
}

export async function saveFcmToken(input: Omit<FcmTokenDoc, "tokenId" | "createdAt" | "lastSeenAt">): Promise<string> {
  const tokenId = fcmTokenId(input.token);
  const ref = refs.fcmToken(tokenId);
  const snap = await ref.get();
  const now = nowTimestamp();
  await ref.set({
    ...input,
    tokenId,
    createdAt: snap.data()?.createdAt || now,
    lastSeenAt: now,
  }, { merge: true });
  return tokenId;
}

export async function getFcmTokensByStaff(studioId: string, staffId: string): Promise<FcmTokenDoc[]> {
  const snap = await refs.fcmTokens()
    .where("studioId", "==", studioId)
    .where("staffId", "==", staffId)
    .orderBy("lastSeenAt", "desc")
    .limit(20)
    .get();
  return snap.docs.map((doc) => doc.data());
}

export async function deleteFcmToken(tokenId: string): Promise<void> {
  await refs.fcmToken(tokenId).delete();
}

