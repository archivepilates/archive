import type { ManagerToken, StudioMateToken } from "../types/studiomate";
import { getTokenCache, saveTokenCache } from "../firestore/tokenCacheRepository";

export async function getStudioMateTokenFromStore(studioId: string): Promise<StudioMateToken | null> {
  const data = await getTokenCache(`studiomate_${studioId}`);
  if (!data) return null;
  return { accessToken: data.token, expiresAt: data.expiresAt.toMillis() };
}

export async function saveStudioMateToken(studioId: string, token: StudioMateToken): Promise<void> {
  await saveTokenCache({
    tokenKey: `studiomate_${studioId}`,
    service: "studiomate",
    studioId,
    token: token.accessToken,
    expiresAtMs: token.expiresAt,
  });
}

export async function getManagerTokenFromStore(studioId: string, staffId: string): Promise<ManagerToken | null> {
  const data = await getTokenCache(`manager_${studioId}_${staffId}`);
  if (!data) return null;
  return { accountToken: data.token, expiresAt: data.expiresAt.toMillis() };
}

export async function saveManagerToken(studioId: string, staffId: string, token: ManagerToken): Promise<void> {
  await saveTokenCache({
    tokenKey: `manager_${studioId}_${staffId}`,
    service: "manager",
    studioId,
    staffId,
    token: token.accountToken,
    expiresAtMs: token.expiresAt,
  });
}
