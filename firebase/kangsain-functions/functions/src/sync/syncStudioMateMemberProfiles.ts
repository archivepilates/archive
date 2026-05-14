import { logger } from "firebase-functions";
import type { Timestamp } from "firebase-admin/firestore";
import type { BookingDoc, ContactSyncJobDoc, MemberProfileDoc, TicketExpiryLevel } from "../types/models";
import { refs } from "../firestore/refs";
import { saveRawMirrorBatch } from "../firestore/rawMirrorRepository";
import { StudioMateClient } from "../studiomate/studiomateClient";
import { addDays, nowTimestamp, parseStudioMateDateTime, todayKst } from "../utils/date";
import { stableHash } from "../utils/hash";

export async function syncStudioMateMemberProfiles(input: {
  studioId: string;
  bookings: BookingDoc[];
}): Promise<{ members: number }> {
  const members = uniqueMembers(input.bookings);
  const ticketSummaryByMember = buildTicketSummaryByMember(input.bookings);
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
        const bookingRegisteredAt = firstBookingRegisteredAt(input.bookings, member.memberId);
        const registeredAt = parseStudioMateDateTime(data.registered_at) || bookingRegisteredAt;
        const ticketSummary = ticketSummaryByMember.get(member.memberId) || {
          activeTicketNames: [] as string[],
          activeTicketCount: 0,
          activeTickets: [] as MemberProfileDoc["activeTickets"],
        };
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
          activeTicketNames: ticketSummary.activeTicketNames,
          activeTicketCount: ticketSummary.activeTicketCount,
          activeTickets: ticketSummary.activeTickets,
          isNewMember: isNewMember(registeredAt),
          newMemberBasis: registeredAt ? (data.registered_at ? "registered_at" : "first_seen_booking") : "unknown",
          registeredAt,
          sourceUpdatedAt: parseStudioMateDateTime(data.updated_at ?? data.modified_at),
          syncedAt: nowTimestamp(),
          updatedAt: nowTimestamp(),
        };
        await refs.memberProfile(member.memberId).set(doc, { merge: true });
        if (phone) {
          const contactHash = stableHash({
            name: doc.name,
            phone,
            registeredAt: registeredAt?.toMillis() || null,
            activeTicketNames: ticketSummary.activeTicketNames,
          });
          const previousContact = (await refs.memberContactIndexDoc(member.memberId).get()).data();
          const shouldQueueHomeSync =
            !previousContact ||
            previousContact.contactHash !== contactHash ||
            previousContact.contactTargets?.home_archivepilates !== "synced";
          const jobId = `contact_${member.memberId}_home_${contactHash.slice(0, 16)}`;
          const contactTargets = {
            archivepilates_gmail: previousContact?.contactTargets?.archivepilates_gmail || "skipped",
            home_archivepilates: shouldQueueHomeSync ? "pending" : previousContact?.contactTargets?.home_archivepilates || "synced",
          } as const;
          await refs.memberContactIndexDoc(member.memberId).set(
            {
              memberId: member.memberId,
              studioId: input.studioId,
              name: doc.name,
              phone,
              phoneLast4: phone.slice(-4),
              registeredAt,
              activeTicketCount: ticketSummary.activeTicketCount,
              activeTicketNames: ticketSummary.activeTicketNames,
              contactHash,
              source: "studiomate_api",
              contactTargets,
              homeContactResourceName: previousContact?.homeContactResourceName || "",
              lastContactSyncJobId: shouldQueueHomeSync ? jobId : previousContact?.lastContactSyncJobId || "",
              contactLastError: shouldQueueHomeSync ? null : previousContact?.contactLastError || null,
              contactUpdatedAt: previousContact?.contactUpdatedAt || null,
              syncedAt: nowTimestamp(),
              updatedAt: nowTimestamp(),
            },
            { merge: true },
          );
          if (shouldQueueHomeSync) {
            const job: ContactSyncJobDoc = {
              jobId,
              studioId: input.studioId,
              memberId: member.memberId,
              memberName: doc.name,
              memberPhone: phone,
              target: "home_archivepilates",
              status: "pending",
              attempts: 0,
              maxAttempts: 5,
              nextRunAt: nowTimestamp(),
              lastError: null,
              sourceReason: doc.isNewMember ? "notice_member_signup" : "member_profile_refresh",
              createdAt: nowTimestamp(),
              updatedAt: nowTimestamp(),
            };
            await refs.contactSyncJob(jobId).set(job, { merge: true });
          }
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

function buildTicketSummaryByMember(bookings: BookingDoc[]): Map<
  string,
  {
    activeTicketNames: string[];
    activeTicketCount: number;
    activeTickets: NonNullable<MemberProfileDoc["activeTickets"]>;
  }
> {
  const map = new Map<string, NonNullable<MemberProfileDoc["activeTickets"]>>();
  bookings
    .filter((booking) => booking.memberId && booking.appStatus === "reserved" && isActiveTicket(booking))
    .forEach((booking) => {
      const rows = map.get(booking.memberId) || [];
      const ticket = {
        name: booking.ticketName || "수강권",
        remainingCount: booking.ticketRemainingCount,
        expiresAt: booking.ticketExpiresAt,
        expiryLevel: booking.ticketExpiryLevel,
      };
      const key = ticketIdentity(ticket);
      const existing = rows.findIndex((row) => ticketIdentity(row) === key);
      if (existing >= 0) rows[existing] = betterTicket(rows[existing], ticket);
      else rows.push(ticket);
      map.set(booking.memberId, rows);
    });
  return new Map(
    [...map.entries()].map(([memberId, rows]) => {
      const activeTickets = rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
      return [
        memberId,
        {
          activeTicketNames: activeTickets.map((ticket) => ticket.name),
          activeTicketCount: activeTickets.length,
          activeTickets,
        },
      ];
    }),
  );
}

function isActiveTicket(booking: BookingDoc): boolean {
  if (!booking.ticketName) return false;
  if (booking.ticketExpiryLevel === "expired") return false;
  if (booking.ticketExpiresAt && booking.ticketExpiresAt.toMillis() < Date.now()) return false;
  const remaining = Number(booking.ticketRemainingCount);
  return !Number.isFinite(remaining) || remaining > 0;
}

function ticketIdentity(ticket: { name: string; remainingCount: number | null; expiresAt: Timestamp | null; expiryLevel: TicketExpiryLevel }): string {
  return [ticket.name, ticket.expiresAt?.toMillis() || "", ticket.remainingCount ?? ""].join("_");
}

function betterTicket<T extends { remainingCount: number | null; expiresAt: Timestamp | null; expiryLevel: TicketExpiryLevel }>(
  current: T,
  next: T,
): T {
  if ((next.expiresAt?.toMillis() || Number.MAX_SAFE_INTEGER) < (current.expiresAt?.toMillis() || Number.MAX_SAFE_INTEGER)) {
    return next;
  }
  const currentRemaining = Number(current.remainingCount);
  const nextRemaining = Number(next.remainingCount);
  if (Number.isFinite(nextRemaining) && (!Number.isFinite(currentRemaining) || nextRemaining < currentRemaining)) return next;
  return current;
}

function firstBookingRegisteredAt(bookings: BookingDoc[], memberId: string) {
  return (
    bookings
      .filter((booking) => booking.memberId === memberId && booking.memberRegisteredAt)
      .sort((a, b) => (a.memberRegisteredAt?.toMillis() || 0) - (b.memberRegisteredAt?.toMillis() || 0))[0]
      ?.memberRegisteredAt || null
  );
}

function isNewMember(registeredAt: Timestamp | null): boolean {
  if (!registeredAt) return false;
  return registeredAt.toMillis() >= new Date(`${addDays(todayKst(), -30)}T00:00:00+09:00`).getTime();
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
