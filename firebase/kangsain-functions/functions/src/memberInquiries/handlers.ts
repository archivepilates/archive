import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { requireStaff } from "../security/authGuards";
import { InquiryError } from "./policy";
import { createInquiryService } from "./service";

const service = createInquiryService({ db });
const origins = new Set(["https://help.archivepilates.com", "https://archive-pilates-help.web.app", "https://archive-pilates-help.firebaseapp.com"]);
export function createPublicInquiryHandler(controller = service) {
  return async (request: any, response: any): Promise<void> => {
    response.set("Cache-Control", "no-store, max-age=0");
    response.set("Referrer-Policy", "no-referrer");
    response.set("X-Content-Type-Options", "nosniff");
    response.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.set("Vary", "Origin");
    const origin = request.get?.("origin");
    const emulatorOrigin = process.env.FUNCTIONS_EMULATOR === "true" && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
    if (!origin || (!origins.has(origin) && !emulatorOrigin)) { response.status(403).json({ ok: false, message: "지원하지 않는 요청입니다." }); return; }
    response.set("Access-Control-Allow-Origin", origin);
    if (request.method === "OPTIONS") {
      response.set("Access-Control-Allow-Methods", "POST"); response.set("Access-Control-Allow-Headers", "Content-Type");
      response.status(204).send(""); return;
    }
    if (request.method !== "POST") { response.status(405).json({ ok: false, message: "지원하지 않는 요청입니다." }); return; }
    try {
      if (!/^application\/json(?:;|$)/i.test(request.get?.("content-type") || "") ||
        !request.rawBody || request.rawBody.length > 8192) throw new InquiryError(400, "접수 내용을 확인해 주세요.");
      const result = request.body?.action === "lookup" ? await controller.lookup(request.body, String(request.ip || "unknown")) :
        await controller.submit(request.body, String(request.ip || "unknown"));
      response.status(200).json(result);
    } catch (error) {
      response.status(error instanceof InquiryError ? error.status : 503).json({ ok: false,
        notAccepted: error instanceof InquiryError && [400, 403, 413, 429, 503].includes(error.status),
        message: error instanceof InquiryError ? error.message : "접수 결과를 확인하지 못했습니다. 같은 내용으로 접수 확인을 다시 눌러주세요." });
    }
  };
}
export const memberInquiryApiHandler = createPublicInquiryHandler();
export async function memberInquiryStaffHandler(request: CallableRequest) {
  try {
    // Always reuse native employment/session checks; client-provided roles are ignored.
    const actor = await requireStaff(request);
    return await service.staff(actor, request.data);
  } catch (error) {
    if (!(error instanceof InquiryError)) throw error;
    const code = ({ 400: "invalid-argument", 403: "permission-denied", 404: "not-found", 409: "failed-precondition", 429: "resource-exhausted", 503: "unavailable" } as const)[error.status as 400] || "internal";
    throw new HttpsError(code, error.message);
  }
}
