import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { buildInstructorLessonScheduleSummaries } from "./instructorLessonSchedule";

const ID = /^ilr_[a-f0-9]{24}$/;
const ORIGINS = new Set(["https://in.archivepilates.com", "https://archive-pilates.web.app"]);
type Row = Record<string, any>;
type Dependencies = { db: any; secret: () => string; now?: () => number };

export class WaitlistPublicError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function millis(value: any): number {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return typeof value === "string" ? Date.parse(value) : NaN;
}

function tokenBasis(row: Row): string {
  const phone = String(row.memberPhone || "").replace(/\D/g, "").replace(/^82/, "0");
  const date = String(row.lessonDate || "");
  const stamp = millis(row.waitlistedAt || row.waitlistHistory?.registeredAt);
  const canonicalId = "ilr_" + createHash("sha256").update(`5330|${phone}|${date}`).digest("hex").slice(0, 24);
  if (row.studioId !== "5330" || row.source?.type !== "archive_core_operator" || !ID.test(row.registrationId || "") || row.registrationId !== canonicalId ||
    !/^010\d{8}$/.test(phone) || !/^20\d{2}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date ||
    !Number.isFinite(stamp) || stamp <= 0) throw new WaitlistPublicError(403, "수강대기 링크를 확인해 주세요.");
  return JSON.stringify(["instructor_waitlist_v1", row.studioId, row.registrationId, phone, date, stamp]);
}

export function instructorWaitlistToken(row: Row, secret: string): string {
  if (typeof secret !== "string" || secret.length < 16) throw new WaitlistPublicError(503, "잠시 후 다시 확인해 주세요.");
  return createHmac("sha256", secret).update(tokenBasis(row)).digest("hex");
}

export function instructorWaitlistLinks(row: Row, secret: string) {
  const token = instructorWaitlistToken(row, secret);
  const url = `https://in.archivepilates.com/instructor-waitlist/?id=${row.registrationId}#token=${token}`;
  return { statusUrl: url, cancelUrl: `${url}&view=cancel` };
}

function authorize(row: Row | undefined, id: string, token: unknown, secret: string): asserts row is Row {
  if (!row || row.registrationId !== id || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new WaitlistPublicError(403, "수강대기 링크를 확인해 주세요.");
  const expected = instructorWaitlistToken(row, secret);
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(token, "hex")))
    throw new WaitlistPublicError(403, "수강대기 링크를 확인해 주세요.");
}

function unpaidWaiter(row: Row): boolean {
  return row.status === "waitlisted" && row.waitlistOnly === true && row.courseKind === "waitlist" && row.mode === "waitlist" &&
    row.paymentMethod === "none" && row.operatorChecks?.paymentConfirmed === false && row.operatorChecks?.seatConfirmed === false &&
    !row.cancellation && !row.externalEffectStarted && !row.waitlistHistory?.convertedAt && !row.teamFulfillmentStarted &&
    !row.ticketName && !Object.values(row.evidence || {}).some(value => Array.isArray(value) ? value.length > 0 : Boolean(value)) &&
    ["member", "ticket", "bookings", "eformsign", "memo", "confirmation"].every(key => row.steps?.[key]?.status === "not_required");
}

function publicState(row: Row, now: number) {
  if (["cancelled", "canceled"].includes(row.status))
    return { ok: true, lessonDate: row.lessonDate, status: "cancelled", position: null, canCancel: false };
  if (!unpaidWaiter(row)) {
    if (!row.cancellation && ["queued", "processing", "waiting_signature", "memo_pending", "booking_pending", "confirmation_pending", "completed"].includes(row.status) &&
      row.waitlistHistory?.convertedAt && row.waitlistOnly === false && ["standard", "team"].includes(row.courseKind) &&
      row.operatorChecks?.paymentConfirmed === true && row.operatorChecks?.seatConfirmed === true)
      return { ok: true, lessonDate: row.lessonDate, status: "confirmed", position: null, canCancel: false };
    throw new WaitlistPublicError(409, "대기 상태를 확인하지 못했습니다. 센터로 문의해 주세요.");
  }
  if (now >= Date.parse(`${row.lessonDate}T23:59:59.999+09:00`))
    return { ok: true, lessonDate: row.lessonDate, status: "closed", position: null, canCancel: false };
  return null;
}

export function createInstructorWaitlistApi({ db, secret, now = Date.now }: Dependencies) {
  const rates = new Map<string, { at: number; count: number }>();
  return async (request: any, response: any): Promise<void> => {
    response.set("Cache-Control", "private, no-store, max-age=0");
    response.set("Referrer-Policy", "no-referrer");
    response.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.set("X-Content-Type-Options", "nosniff");
    response.set("Vary", "Origin");
    const origin = request.get?.("origin");
    if (origin && !ORIGINS.has(origin)) { response.status(403).json({ ok: false, message: "지원하지 않는 요청입니다." }); return; }
    if (origin) response.set("Access-Control-Allow-Origin", origin);
    if (request.method === "OPTIONS") {
      response.set("Access-Control-Allow-Methods", "POST"); response.set("Access-Control-Allow-Headers", "Content-Type");
      response.status(204).send(""); return;
    }
    if (request.method !== "POST") { response.status(405).json({ ok: false, message: "지원하지 않는 요청입니다." }); return; }
    try {
      if (!/^application\/json(?:;|$)/i.test(request.get?.("content-type") || "") ||
        (request.rawBody?.length || 0) > 4096) throw new WaitlistPublicError(400, "요청 내용을 확인해 주세요.");
      const body = request.body || {}, id = body.registrationId;
      if (!ID.test(id || "") || !["status", "cancel"].includes(body.action) ||
        typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token) ||
        (body.action === "cancel" && body.confirm !== true)) throw new WaitlistPublicError(400, "요청 내용을 확인해 주세요.");
      const current = now();
      for (const [key, rate] of rates) if (current - rate.at >= 60000) rates.delete(key);
      const client = createHash("sha256").update(String(request.ip || "unknown")).digest("hex");
      const rate = rates.get(client) || { at: current, count: 0 };
      if (++rate.count > 30 || rates.size >= 5000) throw new WaitlistPublicError(429, "잠시 후 다시 확인해 주세요.");
      rates.set(client, rate);
      const ref = db.collection("instructorLessonRegistrations").doc(id);
      const result = await db.runTransaction(async (tx: any) => {
        const snapshot = await tx.get(ref), row = snapshot.data();
        authorize(row, id, body.token, secret());
        const state = publicState(row, now());
        if (state) {
          if (body.action === "cancel" && state.status !== "cancelled")
            throw new WaitlistPublicError(409, "이미 처리되었거나 대기기간이 종료된 접수입니다. 센터로 문의해 주세요.");
          return state;
        }
        if (body.action === "cancel") {
          const job = await tx.get(db.collection("studiomateInstructorLessonJobs").doc(id));
          if (job.exists) throw new WaitlistPublicError(409, "처리 이력이 있어 직접 취소할 수 없습니다. 센터로 문의해 주세요.");
          const cancelNow = now();
          if (publicState(row, cancelNow)) throw new WaitlistPublicError(409, "대기기간이 종료되었습니다. 센터로 문의해 주세요.");
          const cancelledAt = new Date(cancelNow).toISOString();
          tx.update(ref, { status: "cancelled", waitlistCancelledAt: cancelledAt,
            waitlistCancellation: { schemaVersion: 1, source: "member_waitlist_link", cancelledAt },
            nextAction: "없음", updatedAt: cancelledAt });
          return { ok: true, lessonDate: row.lessonDate, status: "cancelled", position: null, canCancel: false };
        }
        const day = await tx.get(db.collection("instructorLessonRegistrations").where("studioId", "==", row.studioId)
          .where("lessonDate", "==", row.lessonDate).limit(501));
        if (day.size >= 501) throw new WaitlistPublicError(503, "대기순번을 확인하지 못했습니다. 센터로 문의해 주세요.");
        const schedule = buildInstructorLessonScheduleSummaries({ startDate: row.lessonDate, endDate: row.lessonDate,
          registrations: day.docs.map((doc: any) => ({ ...doc.data(), registrationId: doc.id })) });
        const entry = schedule[0]?.waitlist.find(waiter => waiter.registrationId === id);
        if (!entry) throw new WaitlistPublicError(409, "대기 상태를 확인하지 못했습니다. 센터로 문의해 주세요.");
        return { ok: true, lessonDate: row.lessonDate, status: "waitlisted", position: entry.position, canCancel: true };
      });
      response.status(200).json(result);
    } catch (error) {
      const known = error instanceof WaitlistPublicError;
      response.status(known ? error.status : 503).json({ ok: false,
        message: known ? error.message : "잠시 후 다시 확인해 주세요. 취소 결과가 불명확하면 새로 조회해 주세요." });
    }
  };
}
