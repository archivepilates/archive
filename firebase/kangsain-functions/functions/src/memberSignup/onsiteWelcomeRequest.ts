import { createHash, randomBytes } from "node:crypto";
import type { OnsiteWelcomeRequestDoc } from "../types/models";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import { nowTimestamp } from "../utils/date";

export async function onsiteWelcomeRequestHandler(request: any, response: any): Promise<void> {
  try {
    if (request.method === "POST") {
      const body = request.body || {};
      const phone = digitsOnly(body.phone);
      if (!/^01\d{8,9}$/.test(phone)) throw new Error("휴대폰 번호를 정확히 입력해주세요.");
      const accessToken = randomBytes(24).toString("base64url");
      const requestId = `owr-${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
      const now = nowTimestamp();
      const doc: OnsiteWelcomeRequestDoc = {
        requestId,
        studioId: String(body.studioId || DEFAULT_STUDIO_ID),
        status: "pending",
        accessTokenHash: sha256(accessToken),
        phone,
        phoneLast4: phone.slice(-4),
        memberNameHint: cleanText(body.memberName, 60),
        source: "onsite_welcome_page",
        progressPercent: 5,
        progressLabel: "현장 웰컴 요청 접수",
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      await refs.onsiteWelcomeRequest(requestId).set(doc, { merge: true });
      response.json({ ok: true, requestId, accessToken });
      return;
    }

    if (request.method === "GET") {
      const requestId = cleanText(request.query?.id, 120);
      const accessToken = cleanText(request.query?.token, 160);
      if (!/^owr-[a-z0-9-]{8,120}$/i.test(requestId) || !accessToken) {
        throw new Error("요청 링크가 올바르지 않습니다.");
      }
      const snap = await refs.onsiteWelcomeRequest(requestId).get();
      const doc = snap.data();
      if (!doc || doc.accessTokenHash !== sha256(accessToken)) {
        throw new Error("요청 상태를 확인할 권한이 없습니다.");
      }
      response.json({ ok: true, request: publicRequest(doc) });
      return;
    }

    response.set("Allow", "GET, POST").status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    response.status(400).json({ ok: false, error: message });
  }
}

function publicRequest(doc: OnsiteWelcomeRequestDoc) {
  return {
    requestId: doc.requestId,
    status: doc.status,
    phoneLast4: doc.phoneLast4,
    memberNameHint: doc.memberNameHint || "",
    progressPercent: doc.progressPercent,
    progressLabel: doc.progressLabel,
    lookup: doc.lookup
      ? {
          memberName: doc.lookup.memberName || "",
          ticketName: doc.lookup.ticketName || "",
          startDate: doc.lookup.startDate || "",
          endDate: doc.lookup.endDate || "",
        }
      : null,
    signupUrl: doc.signupUrl || "",
    alimtalkCandidateId: doc.alimtalkCandidateId || "",
    lastError: doc.lastError || "",
  };
}

function digitsOnly(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function cleanText(value: unknown, max: number): string {
  return String(value || "").trim().slice(0, max);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
