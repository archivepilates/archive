import type { CallableRequest } from "firebase-functions/v2/https";
import { searchBookingsByMemberName, searchBookingsByMemberPhone } from "../firestore/bookingRepository";
import { getMemberTagsMap } from "../firestore/memberTagRepository";
import { refs } from "../firestore/refs";
import { requireStaff, isManagerRole } from "../security/authGuards";
import { addDays, todayKst } from "../utils/date";
import { AppError } from "../utils/errors";

export async function searchMembersHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireStaff(request);
  const type = String(request.data?.type || "name");
  const query = String(request.data?.query || "").trim();
  if (!["name", "phone"].includes(type) || query.length < 2)
    throw new AppError("INVALID_ARGUMENT", "검색어가 너무 짧거나 종류가 올바르지 않습니다");

  const startDate = addDays(todayKst(), -90);
  const rows =
    type === "phone"
      ? await searchBookingsByMemberPhone(staff.studioId, digitsOnly(query), startDate)
      : await searchBookingsByMemberName(staff.studioId, query, startDate);
  const manager = isManagerRole(staff.role);
  const visibleRows = manager ? rows : rows.filter((row) => row.staffId === staff.staffId);
  const byMember = new Map(visibleRows.map((row) => [row.memberId, row]));
  const memberIds = [...byMember.keys()].slice(0, 20);
  const tagsByMember = await getMemberTagsMap(memberIds);
  const today = todayKst();
  const summaries = await Promise.all(
    memberIds.map((memberId) => refs.attendanceSummary(memberId, today.replaceAll("-", "")).get()),
  );
  const summaryByMember = new Map(summaries.map((snap) => [snap.id.split("_")[0], snap.data() || null]));

  return {
    results: memberIds.map((memberId) => {
      const row = byMember.get(memberId);
      return {
        memberId,
        memberName: row?.memberName || "",
        memberPhoneMasked: maskPhone(row?.memberPhone || ""),
        tags: tagsByMember.get(memberId) || [],
        recent30Days: summaryByMember.get(memberId),
      };
    }),
  };
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function maskPhone(phone: string): string {
  const digits = digitsOnly(phone);
  if (digits.length < 8) return "";
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}
