import type { AlimtalkCandidateDoc } from "../types/models";

const RENEWAL_TYPES = new Set([
  "ticket_expiring",
  "remaining_low",
  "private_count_low",
  "private_ticket_expiring",
]);

const RENEWAL_PRIORITY: Record<string, number> = {
  private_count_low: 400,
  remaining_low: 300,
  private_ticket_expiring: 200,
  ticket_expiring: 100,
};

export interface DailyCandidateSelection {
  selected: AlimtalkCandidateDoc[];
  suppressed: Array<{ candidate: AlimtalkCandidateDoc; reason: string }>;
}

export function selectDailyAlimtalkCandidates(candidates: AlimtalkCandidateDoc[]): DailyCandidateSelection {
  const suppressed = new Map<string, { candidate: AlimtalkCandidateDoc; reason: string }>();
  const memberGroups = new Map<string, AlimtalkCandidateDoc[]>();

  for (const candidate of candidates) {
    const key = candidate.memberId || candidate.memberPhone || candidate.candidateId;
    const group = memberGroups.get(key) || [];
    group.push(candidate);
    memberGroups.set(key, group);
  }

  for (const group of memberGroups.values()) {
    const renewalCandidates = group.filter((candidate) => RENEWAL_TYPES.has(candidate.type));
    if (!renewalCandidates.length) continue;

    for (const candidate of group.filter((item) => item.type === "long_absence")) {
      suppressed.set(candidate.candidateId, {
        candidate,
        reason: "같은 회원의 재등록 안내가 있어 장기 미출석 안내를 당일 발송하지 않음",
      });
    }

    const byTicket = new Map<string, AlimtalkCandidateDoc[]>();
    for (const candidate of renewalCandidates) {
      const key = renewalTicketIdentity(candidate);
      const ticketGroup = byTicket.get(key) || [];
      ticketGroup.push(candidate);
      byTicket.set(key, ticketGroup);
    }

    for (const ticketGroup of byTicket.values()) {
      if (ticketGroup.length < 2) continue;
      const ordered = ticketGroup.slice().sort((a, b) => {
        const priority = (RENEWAL_PRIORITY[b.type] || 0) - (RENEWAL_PRIORITY[a.type] || 0);
        return priority || a.candidateId.localeCompare(b.candidateId);
      });
      for (const candidate of ordered.slice(1)) {
        suppressed.set(candidate.candidateId, {
          candidate,
          reason: "같은 수강권의 잔여횟수·만료 안내 중 우선순위가 높은 1건만 당일 발송",
        });
      }
    }
  }

  return {
    selected: candidates.filter((candidate) => !suppressed.has(candidate.candidateId)),
    suppressed: [...suppressed.values()],
  };
}

function renewalTicketIdentity(candidate: AlimtalkCandidateDoc): string {
  const payload = candidate.payload || {};
  const renewalCaseId = String(payload.renewalCaseId || "").trim();
  if (renewalCaseId) return `${candidate.memberId}|case:${renewalCaseId}`;
  const ticketId = String(payload.userTicketId || payload.ticketId || "").trim();
  if (ticketId) return `${candidate.memberId}|ticket:${ticketId}`;
  return [
    candidate.memberId,
    String(payload.ticketName || payload.ticket || "").trim().toLowerCase(),
  ].join("|");
}
