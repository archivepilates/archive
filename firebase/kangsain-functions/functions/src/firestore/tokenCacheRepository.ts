import { Timestamp } from "firebase-admin/firestore";
import type { TokenCacheDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { refs } from "./refs";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getTokenCache(tokenKey: string): Promise<TokenCacheDoc | null> {
  const snap = await refs.tokenCacheDoc(tokenKey).get();
  const data = snap.data();
  if (!data) return null;
  if (data.expiresAt.toMillis() <= Date.now() + REFRESH_MARGIN_MS) return null;
  await refs.tokenCacheDoc(tokenKey).set({ lastUsedAt: nowTimestamp() }, { merge: true });
  return data;
}

export async function saveTokenCache(input: {
  tokenKey: string;
  service: TokenCacheDoc["service"];
  studioId: string;
  staffId?: string;
  token: string;
  expiresAtMs: number;
}): Promise<void> {
  const now = nowTimestamp();
  await refs.tokenCacheDoc(input.tokenKey).set({
    tokenKey: input.tokenKey,
    service: input.service,
    studioId: input.studioId,
    staffId: input.staffId,
    token: input.token,
    issuedAt: now,
    expiresAt: Timestamp.fromMillis(input.expiresAtMs),
    lastUsedAt: now,
  }, { merge: true });
}

