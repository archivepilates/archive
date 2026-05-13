import { logger } from "firebase-functions";
import type { BookingDoc, MemberProfileDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { saveRawMirrorBatch } from "../firestore/rawMirrorRepository";
import { StudioMateClient } from "../studiomate/studiomateClient";
import { nowTimestamp, parseStudioMateDateTime, todayKst } from "../utils/date";

export async function syncStudioMateMemberProfiles(input: {
  studioId: string;
  bookings: BookingDoc[];
}): Promise<{ members: number }> {
  const members = uniqueMembers(input.bookings);
  const client = new StudioMateClient(input.studioId);

  for (let index = 0; index < members.length; index += 5) {
    const chunk = members.slice(index, index + 5);
    const results = await Promise.allSettled(
      chunk.map(async (member) => {
        const raw = await client.getMemberById(member.memberId);
        await saveRawMirrorBatch({
          studioId: input.studioId,
          dataset: "staffMemberProfiles",
          sourcePath: "/v2/staff/members/{memberId}",
          records: [{ member, raw }],
          mirrorDate: todayKst(),
          idFor: () => member.memberId,
        });
        const data = raw.data || raw;
        const doc: MemberProfileDoc = {
          memberId: member.memberId,
          studioId: input.studioId,
          name: stringValue(data.name ?? member.memberName),
          registeredAt: parseStudioMateDateTime(data.registered_at),
          syncedAt: nowTimestamp(),
          updatedAt: nowTimestamp(),
        };
        await refs.memberProfile(member.memberId).set(doc, { merge: true });
      }),
    );
    results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .forEach((result) => logger.warn("syncStudioMateMemberProfiles member failed", { message: String(result.reason) }));
    if (index + 5 < members.length) await sleep(250);
  }

  logger.info("syncStudioMateMemberProfiles completed", { studioId: input.studioId, members: members.length });
  return { members: members.length };
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

function stringValue(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
