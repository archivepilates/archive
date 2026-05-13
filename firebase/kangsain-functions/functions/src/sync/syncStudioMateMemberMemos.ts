import { logger } from "firebase-functions";
import type { Timestamp } from "firebase-admin/firestore";
import type { BookingDoc, MemberMemoDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { saveRawMirrorBatch } from "../firestore/rawMirrorRepository";
import { StudioMateClient } from "../studiomate/studiomateClient";
import { nowTimestamp, parseStudioMateDateTime, todayKst } from "../utils/date";

export async function syncStudioMateMemberMemos(input: {
  studioId: string;
  bookings: BookingDoc[];
}): Promise<{ members: number; memos: number }> {
  const members = uniqueMembers(input.bookings);
  const client = new StudioMateClient(input.studioId);
  let memoCount = 0;

  for (let index = 0; index < members.length; index += 5) {
    const chunk = members.slice(index, index + 5);
    const results = await Promise.allSettled(
      chunk.map(async (member) => {
        const rawMemos = await client.getMemberMemos(member.memberId);
        await saveRawMirrorBatch({
          studioId: input.studioId,
          dataset: "staffMemberMemos",
          sourcePath: "/v2/staff/memo",
          records: rawMemos.map((raw) => ({ member, raw })),
          mirrorDate: todayKst(),
          idFor: (record) => {
            const wrapped = record as { member?: { memberId?: string }; raw?: Record<string, unknown> };
            return `${wrapped.member?.memberId || "member"}_${String(wrapped.raw?.id || wrapped.raw?.created_at || "")}`;
          },
        });
        await Promise.all(
          rawMemos
            .filter((raw) => !raw.deleted_at)
            .map((raw) => saveStudioMateMemo(input.studioId, member, raw)),
        );
        return rawMemos.length;
      }),
    );
    memoCount += results.reduce((sum, result) => sum + (result.status === "fulfilled" ? result.value : 0), 0);
    results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .forEach((result) => logger.warn("syncStudioMateMemberMemos member failed", { message: String(result.reason) }));
    if (index + 5 < members.length) await sleep(250);
  }

  logger.info("syncStudioMateMemberMemos completed", { studioId: input.studioId, members: members.length, memoCount });
  return { members: members.length, memos: memoCount };
}

function uniqueMembers(bookings: BookingDoc[]): Array<{ memberId: string; memberName: string }> {
  return [
    ...new Map(
      bookings
        .filter((booking) => booking.memberId)
        .map((booking) => [booking.memberId, { memberId: booking.memberId, memberName: booking.memberName }]),
    ).values(),
  ];
}

async function saveStudioMateMemo(
  studioId: string,
  member: { memberId: string; memberName: string },
  raw: Record<string, any>,
): Promise<void> {
  const memoId = `studiomate_${String(raw.id || `${member.memberId}_${raw.created_at || ""}`)}`;
  const createdAt = parseStudioMateDateTime(stringValue(raw.created_at)) || nowTimestamp();
  const updatedAt = parseStudioMateDateTime(stringValue(raw.updated_at)) || createdAt;
  const staff = raw.staff || {};
  const doc: MemberMemoDoc = {
    memoId,
    studioId,
    memberId: member.memberId,
    memberName: member.memberName,
    lectureId: "",
    bookingId: "",
    lectureDate: "",
    staffId: stringValue(staff.id),
    staffName: stringValue(staff.name ?? staff.profile?.name),
    memoType: "member_note",
    visibility: "staff_and_manager",
    content: stringValue(raw.memo),
    syncStatus: "synced",
    createdByUid: "studiomate",
    createdAt,
    updatedAt: updatedAt as Timestamp,
  };
  if (!doc.content) return;
  await refs.memberMemo(memoId).set(doc, { merge: true });
}

function stringValue(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
