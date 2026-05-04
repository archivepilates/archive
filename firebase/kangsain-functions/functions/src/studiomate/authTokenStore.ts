import { db } from "../config/firebase";
import type { ManagerToken, StudioMateToken } from "../types/studiomate";

const TOKEN_COLLECTION = "_serverTokens";

export async function getStudioMateTokenFromStore(): Promise<StudioMateToken | null> {
  const snap = await db.collection(TOKEN_COLLECTION).doc("studiomate").get();
  const data = snap.data();
  if (!data || Number(data.expiresAt) <= Date.now() + 60_000) return null;
  return { accessToken: String(data.accessToken), expiresAt: Number(data.expiresAt) };
}

export async function saveStudioMateToken(token: StudioMateToken): Promise<void> {
  await db.collection(TOKEN_COLLECTION).doc("studiomate").set(token, { merge: true });
}

export async function getManagerTokenFromStore(): Promise<ManagerToken | null> {
  const snap = await db.collection(TOKEN_COLLECTION).doc("manager").get();
  const data = snap.data();
  if (!data || Number(data.expiresAt) <= Date.now() + 60_000) return null;
  return { accountToken: String(data.accountToken), expiresAt: Number(data.expiresAt) };
}

export async function saveManagerToken(token: ManagerToken): Promise<void> {
  await db.collection(TOKEN_COLLECTION).doc("manager").set(token, { merge: true });
}

