import type { CallableRequest } from "firebase-functions/v2/https";
import { saveFcmToken } from "../firestore/fcmTokenRepository";
import { requireStaff } from "../security/authGuards";
import { AppError } from "../utils/errors";

export async function registerFcmTokenHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireStaff(request);
  const token = String(request.data?.token || "").trim();
  const platform = normalizePlatform(request.data?.platform);
  const deviceLabel = String(request.data?.deviceLabel || "").slice(0, 80);
  if (!token) throw new AppError("INVALID_ARGUMENT", "FCM token이 필요합니다");

  const tokenId = await saveFcmToken({
    studioId: staff.studioId,
    staffId: staff.staffId,
    uid: request.auth?.uid || "",
    token,
    platform,
    deviceLabel,
  });
  return { ok: true, tokenId };
}

function normalizePlatform(value: unknown): "web" | "ios" | "android" | "unknown" {
  const text = String(value || "web");
  if (["web", "ios", "android"].includes(text)) return text as "web" | "ios" | "android";
  return "unknown";
}

