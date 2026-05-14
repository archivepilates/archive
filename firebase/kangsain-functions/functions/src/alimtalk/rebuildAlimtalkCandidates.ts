import { logger } from "firebase-functions";
import type { AdminActionDoc, AlimtalkCandidateDoc, AlimtalkCandidateType, MemberProfileDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";

const TEMPLATE_CODES: Record<Exclude<AlimtalkCandidateType, "manual_review">, string> = {
  new_member: "KA01TP260514081318309wQGfeIJxIAJ",
  ticket_expiring: "KA01TP260513132546274Sp5VtNf2pv7",
  remaining_low: "KA01TP260513132546352nPdudb2yHnG",
  long_absence: "KA01TP260513132546446zCdmdJXDOW4",
};

export async function rebuildAlimtalkCandidatesForRange(input: {
  studioId: string;
  startDate: string;
  endDate: string;
}): Promise<{ candidates: number }> {
  const [actionsSnap, profilesSnap] = await Promise.all([
    refs.adminActions().where("studioId", "==", input.studioId).get(),
    refs.memberProfiles().where("studioId", "==", input.studioId).get(),
  ]);

  const profileByMemberId = new Map(profilesSnap.docs.map((snap) => [snap.id, snap.data()]));
  const writes: Array<Promise<unknown>> = [];
  actionsSnap.docs
    .map((snap) => snap.data())
    .filter((doc) => doc.date >= input.startDate && doc.date <= input.endDate)
    .forEach((doc) => {
      (doc.actions || []).forEach((action) => {
        const candidate = candidateFromAction(doc, action, action.memberId ? profileByMemberId.get(action.memberId) : undefined);
        if (candidate) writes.push(upsertCandidate(candidate));
      });
    });

  profilesSnap.docs
    .map((snap) => snap.data())
    .filter((profile) => profile.isNewMember && registeredDate(profile) >= input.startDate && registeredDate(profile) <= input.endDate)
    .forEach((profile) => {
      const sourceDate = registeredDate(profile);
      if (!sourceDate || !profile.phone) return;
      writes.push(
        upsertCandidate({
          candidateId: `new_member_${profile.memberId}_${sourceDate}`,
          studioId: profile.studioId,
          memberId: profile.memberId,
          memberName: profile.name,
          memberPhone: profile.phone,
          type: "new_member",
          status: "candidate",
          templateCode: TEMPLATE_CODES.new_member,
          title: "신규회원",
          reason: `최초등록 ${sourceDate}`,
          sourceDate,
          payload: {
            memberName: profile.name,
            registeredDate: sourceDate,
          },
          lastError: null,
          createdAt: nowTimestamp(),
          updatedAt: nowTimestamp(),
        }),
      );
    });

  await Promise.all(writes);
  logger.info("rebuildAlimtalkCandidatesForRange completed", { studioId: input.studioId, candidates: writes.length });
  return { candidates: writes.length };
}

function candidateFromAction(
  doc: AdminActionDoc,
  action: AdminActionDoc["actions"][number],
  profile?: MemberProfileDoc,
): AlimtalkCandidateDoc | null {
  if (!action.memberId || !action.memberName || !profile?.phone) return null;
  if (!["ticket_expiring", "long_absence"].includes(action.type)) return null;
  const type = alimtalkTypeFromAction(action, profile);
  const candidateId = `action_${stableHash({ date: doc.date, key: action.actionKey }).slice(0, 24)}`;
  return {
    candidateId,
    studioId: doc.studioId,
    memberId: action.memberId,
    memberName: action.memberName,
    memberPhone: profile.phone,
    type,
    status: "candidate",
    templateCode: TEMPLATE_CODES[type as Exclude<AlimtalkCandidateType, "manual_review">],
    title: action.label,
    reason: action.body,
    sourceActionKey: action.actionKey,
    sourceDate: doc.date,
    payload: {
      memberName: action.memberName,
      reason: action.body,
      date: doc.date,
    },
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

function alimtalkTypeFromAction(action: AdminActionDoc["actions"][number], profile?: MemberProfileDoc): AlimtalkCandidateType {
  if (action.type !== "ticket_expiring") return action.type as AlimtalkCandidateType;
  const remaining = actionRemainingCount(action, profile);
  if (Number.isFinite(remaining) && Number(remaining) >= 0 && Number(remaining) < 5) return "remaining_low";
  return "ticket_expiring";
}

function actionRemainingCount(action: AdminActionDoc["actions"][number], profile?: MemberProfileDoc): number | null {
  const matchedTicket = profile?.activeTickets?.find((ticket) => {
    const name = ticket.name || "";
    return Boolean(name && (action.body.includes(name) || action.title.includes(name) || action.label.includes(name)));
  }) || profile?.activeTickets?.find((ticket) => ticket.expiryLevel === "soon") || profile?.activeTickets?.[0];
  if (matchedTicket?.remainingCount != null) return Number(matchedTicket.remainingCount);
  const match = action.body.match(/(\d+)\s*회/);
  return match ? Number(match[1]) : null;
}

async function upsertCandidate(candidate: AlimtalkCandidateDoc): Promise<void> {
  const ref = refs.alimtalkCandidate(candidate.candidateId);
  const previous = (await ref.get()).data();
  if (previous && ["queued", "sent", "skipped"].includes(previous.status)) {
    await ref.set({ updatedAt: nowTimestamp() }, { merge: true });
    return;
  }
  await ref.set(
    {
      ...candidate,
      status: previous?.status || candidate.status,
      createdAt: previous?.createdAt || candidate.createdAt,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

function registeredDate(profile: MemberProfileDoc): string {
  const date = profile.registeredAt?.toDate();
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}
