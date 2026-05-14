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
        const phone = digitsOnly(
          firstValue(data, [
            "mobile",
            "phone",
            "cellphone",
            "contact",
            "tel",
            "phone_number",
            "mobile_phone",
            "mobilePhone",
          ]),
        );
        const doc: MemberProfileDoc = {
          memberId: member.memberId,
          studioId: input.studioId,
          name: stringValue(data.name ?? member.memberName),
          normalizedName: normalizeName(data.name ?? member.memberName),
          phone,
          phoneLast4: phone ? phone.slice(-4) : "",
          email: stringValue(firstValue(data, ["email", "mail"])),
          birthDate: stringValue(firstValue(data, ["birth", "birthday", "birth_date", "birthDate"])),
          gender: stringValue(firstValue(data, ["gender", "sex"])),
          registeredAt: parseStudioMateDateTime(data.registered_at),
          sourceUpdatedAt: parseStudioMateDateTime(data.updated_at ?? data.modified_at),
          syncedAt: nowTimestamp(),
          updatedAt: nowTimestamp(),
        };
        await refs.memberProfile(member.memberId).set(doc, { merge: true });
        if (phone) {
          await refs.memberContactIndexDoc(member.memberId).set(
            {
              memberId: member.memberId,
              studioId: input.studioId,
              name: doc.name,
              phone,
              phoneLast4: phone.slice(-4),
              registeredAt: doc.registeredAt,
              activeTicketCount: doc.activeTicketCount ?? 0,
              source: "studiomate_api",
              contactTargets: {
                archivepilates_gmail: "pending",
                home_archivepilates: "pending",
              },
              syncedAt: nowTimestamp(),
              updatedAt: nowTimestamp(),
            },
            { merge: true },
          );
        }
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

function normalizeName(value: unknown): string {
  return stringValue(value).replace(/\s+/g, "");
}

function digitsOnly(value: unknown): string {
  return stringValue(value).replace(/\D/g, "");
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value != null && stringValue(value)) return value;
  }
  const contactInfos = source.contact_infos;
  if (Array.isArray(contactInfos)) {
    const representative = contactInfos.find((item) => item?.is_representative)?.contact;
    if (representative) return representative;
    return contactInfos.find((item) => item?.contact)?.contact;
  }
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
