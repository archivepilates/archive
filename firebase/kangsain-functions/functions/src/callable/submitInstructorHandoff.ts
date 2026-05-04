import type { CallableRequest } from "firebase-functions/v2/https";
import { refs } from "../firestore/refs";
import { requireStaff } from "../security/authGuards";
import { AppError } from "../utils/errors";
import { nowTimestamp } from "../utils/date";

const ALLOWED = ["member_consultation", "customer_complaint", "facility_issue", "lost_item", "class_note", "other"];
const BLOCKED = ["payment_check", "ticket_check", "renewal_sales", "settlement"];

export async function submitInstructorHandoffHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireStaff(request);
  const category = String(request.data?.category || "");
  if (BLOCKED.includes(category) || !ALLOWED.includes(category)) throw new AppError("INVALID_ARGUMENT", "이번 범위에서 허용되지 않는 전달사항 종류입니다");
  const title = String(request.data?.title || "").trim();
  const content = String(request.data?.content || "").trim();
  if (!title || !content) throw new AppError("INVALID_ARGUMENT", "제목과 내용을 입력해야 합니다");

  const ref = refs.instructorHandoffs().doc();
  await ref.set({
    handoffId: ref.id,
    studioId: staff.studioId,
    staffId: staff.staffId,
    staffName: staff.name,
    memberId: String(request.data?.memberId || ""),
    memberName: String(request.data?.memberName || ""),
    lectureId: String(request.data?.lectureId || ""),
    category,
    title,
    content,
    status: "open",
    createdByUid: request.auth?.uid || "unknown",
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
    resolvedAt: null,
  });
  return { ok: true, handoffId: ref.id };
}

