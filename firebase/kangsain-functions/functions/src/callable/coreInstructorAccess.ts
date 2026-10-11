import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { getStaffByEmail, getStaffByUid } from "../firestore/staffRepository";
import { isManagerRole, requireStaff } from "../security/authGuards";
import { assertCoreInstructorAccess, assertCoreSessionFresh, ownsCoreBooking, safeCoreChartUrl, validCorePassword, type CoreInstructorStaff } from "../security/coreInstructorAccess";
import { AppError } from "../utils/errors";
import { addDays, todayKst } from "../utils/date";

async function sessionStaff(request: CallableRequest): Promise<CoreInstructorStaff> {
  if (!request.auth) throw new AppError("AUTH_REQUIRED", "로그인이 필요합니다");
  const email = String(request.auth.token.email || "").toLowerCase();
  const staff = await getStaffByUid(request.auth.uid) || (email ? await getStaffByEmail(email) : null);
  if (!staff?.active) throw new AppError("PERMISSION_DENIED", "사용 가능한 업무 계정이 없습니다");
  if (staff.role === "instructor") assertCoreInstructorAccess(staff, request.auth, true);
  else if (!isManagerRole(staff.role)) throw new AppError("PERMISSION_DENIED", "업무 계정 권한이 필요합니다");
  else assertCoreSessionFresh(staff, request.auth);
  return staff;
}

export async function getCoreAccessSessionHandler(request: CallableRequest): Promise<unknown> {
  const staff = await sessionStaff(request);
  return { role: isManagerRole(staff.role) ? "manager" : staff.role, staffId: staff.staffId, staffName: staff.name,
    mustChangePassword: staff.role === "instructor" && staff.coreMustChangePassword !== false };
}

export async function completeCoreFirstLoginHandler(request: CallableRequest): Promise<unknown> {
  const staff = await sessionStaff(request);
  const password = request.data?.password;
  if (staff.role !== "instructor" || staff.coreMustChangePassword !== true || !validCorePassword(password))
    throw new AppError("INVALID_ARGUMENT", "새 비밀번호는 8~64자리로 입력하세요");
  if (Date.now() / 1000 - Number(request.auth?.token.auth_time || 0) > 600)
    throw new AppError("PERMISSION_DENIED", "다시 로그인한 후 비밀번호를 변경하세요");
  const ref = db.doc(`staffs/${staff.staffId}`);
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as CoreInstructorStaff;
    assertCoreInstructorAccess(current, request.auth, true);
    if (current.coreMustChangePassword !== true || Number(current.corePasswordChangeLockUntil || 0) > Date.now())
      throw new AppError("PERMISSION_DENIED", "비밀번호 변경을 처리 중이거나 이미 완료했습니다");
    tx.update(ref, { corePasswordChangeLockUntil: Date.now() + 120_000 });
  });
  try {
    await getAuth().updateUser(request.auth!.uid, { password });
    await getAuth().revokeRefreshTokens(request.auth!.uid);
    // Even a previously issued ID token must not acquire access when the gate opens.
    await ref.update({ coreMustChangePassword: false, coreAuthAfter: Math.floor(Date.now() / 1000) + 1,
      corePasswordChangedAt: Timestamp.now(), corePasswordChangeLockUntil: 0, updatedAt: Timestamp.now() });
    return { ok: true, requireFreshLogin: true };
  } catch (error) {
    await ref.update({ corePasswordChangeLockUntil: 0 });
    throw error;
  }
}

export async function getCoreInstructorWorkspaceHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireStaff(request);
  if (staff.role !== "instructor") throw new AppError("PERMISSION_DENIED", "강사 계정 전용 화면입니다");
  const date = todayKst();
  const from = addDays(date, -45), to = addDays(date, 14);
  const [bookings, requests] = await Promise.all([
    db.collection("bookings").where("studioId", "==", staff.studioId).where("staffId", "==", staff.staffId)
      .where("lectureDate", "==", date).limit(200).get(),
    db.collection("privateLessonChartRequests").where("studioId", "==", staff.studioId).where("staffId", "==", staff.staffId)
      .where("lessonDate", ">=", from).where("lessonDate", "<=", to).orderBy("lessonDate", "desc").limit(200).get(),
  ]);
  if (bookings.size === 200 || requests.size === 200) throw new AppError("PERMISSION_DENIED", "조회 범위가 많아 운영자 확인이 필요합니다");
  const sourceIds = [...new Set(requests.docs.map(d => String(d.data().bookingId || "")))].filter(id => /^[A-Za-z0-9_-]{1,150}$/.test(id));
  const sources = sourceIds.length ? await db.getAll(...sourceIds.map(id => db.doc(`bookings/${id}`))) : [];
  const ownedBookings = new Map([...bookings.docs, ...sources].filter(d => d.exists && ownsCoreBooking(staff, d.data()!)).map(d => [d.id, d.data()!]));
  const matchingRequests = requests.docs.filter(d => {
    const r = d.data(), b = ownedBookings.get(String(r.bookingId));
    return b && ownsCoreBooking(staff, b, r) && safeCoreChartUrl(r.postUrl, d.id);
  });
  const canonicalRequests = new Map<string, typeof matchingRequests[number]>();
  const sourceRank = (id: string) => /^\d+$/.test(id) ? 3 : id.startsWith("usage_booking_") ? 2 : 1;
  for (const document of matchingRequests) {
    const r = document.data(), b = ownedBookings.get(String(r.bookingId))!;
    const key = String(b.canonicalBookingKey || `${staff.staffId}:${b.memberId}:${b.lectureDate}:${b.lectureStartAt?.seconds}`);
    const previous = canonicalRequests.get(key);
    if (!previous || sourceRank(r.bookingId) > sourceRank(previous.data().bookingId)) canonicalRequests.set(key, document);
  }
  const validRequests = [...canonicalRequests.values()];
  const recordRefs = validRequests.map(d => db.doc(`privateLessonChartRecords/${d.id}`));
  const records = recordRefs.length ? await db.getAll(...recordRefs) : [];
  const recordById = new Map(records.filter(d => d.exists).map(d => [d.id, d.data()!]));
  const time = (value: any): string => value?.toDate ? value.toDate().toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }) : "";
  const lessons = [...ownedBookings].filter(([, b]) => b.lectureDate === date)
    .map(([id, b]) => ({ id, date: b.lectureDate, startTime: time(b.lectureStartAt), title: b.lessonType === "private" ? "프라이빗" : "수업", memberName: b.memberName || "회원" }));
  const privateTasks = validRequests.map(d => {
    const r = d.data(), record = recordById.get(d.id);
    const ownRecord = record?.staffId === staff.staffId && record?.studioId === staff.studioId ? record : null;
    const sent = Boolean(ownRecord?.publicReportApproval?.status === "sent" || ownRecord?.publicReportApproval?.sentAt || ownRecord?.publicReportSentAt || ownRecord?.sentRevision);
    const ready = ["draft_created", "approved", "published"].includes(String(ownRecord?.gptStatus || ""));
    const status = sent ? "delivered" : ready ? "report_review" : ownRecord?.postSubmittedAt || r.postStatus === "submitted" ? "submitted" : ownRecord?.report?.status || r.postStatus || "pending";
    return { id: d.id, memberName: r.memberName || "회원", date: r.lessonDate, startTime: time(r.lessonStartAt),
      status, recordUrl: safeCoreChartUrl(r.postUrl, d.id), surveyUrl: "", reportUrl: "" };
  });
  return { date, staffName: staff.name, lessons, privateTasks };
}
