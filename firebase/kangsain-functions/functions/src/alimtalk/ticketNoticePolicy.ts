import { createHash } from "node:crypto";
import type { AlimtalkCandidateDoc } from "../types/models";
import type { AlimtalkTemplateState } from "./templateStatus";

export const TICKET_NOTICE_POLICY = {
  purpose: "ticket_facts",
  followupPurchaseExcludes: false,
  reviewedAt: "2026-09-30",
  targetRule: "후속 수강권 구매 여부와 관계없이 기존권의 잔여횟수·만료 정보를 안내",
  pendingReason: "수강권 사실 안내 템플릿 검토 대기:",
  types: ["ticket_expiring", "remaining_low", "private_count_low", "private_ticket_expiring"],
} as const;

// Reviewed approved copy includes no renewal solicitation. A changed contract requires review.
export const REVIEWED_TICKET_FACT_CONTRACTS: Readonly<Record<string, string>> = {
  "KA01TP260514153314927WH270IppWQS": "7bc46e639c64db89499b9d85752ed1e2609514fdecb6163bc63cdb99b6c361f0",
  "KA01TP260514152235608d9icGOBotnV": "1131eccfa127bc73db6fe97227159661b5399bf8231ca829101b85be6b67d6e2",
  "KA01TP260514145047393VpTbcCZKkCV": "344deea3f6172e6a2fa00d4ef5b486bbc145213882c6e52a5d5d1341aca37ae0",
  "KA01TP260514145047261araXgWLVFRs": "5650d4586081d6845d2c672451b03f6f160aa9fb1068b20ad6adcedf609b29c7"
};

export function isTicketFactNotice(type: string): boolean {
  return (TICKET_NOTICE_POLICY.types as readonly string[]).includes(type);
}

export function ticketFactContractFingerprint(state: Pick<AlimtalkTemplateState, "content" | "buttons">): string {
  return createHash("sha256").update(JSON.stringify({
    content: state.content || "",
    buttons: (state.buttons || []).map((button) => ({
      name: button.name || "", type: button.type || "",
      mobileUrl: button.mobileUrl || "", desktopUrl: button.desktopUrl || "",
    })),
  })).digest("hex");
}

export function ticketFactTemplateIssue(
  candidate: Pick<AlimtalkCandidateDoc, "type" | "templateCode">,
  state?: AlimtalkTemplateState | null,
): string {
  if (!isTicketFactNotice(candidate.type)) return "";
  const expected = REVIEWED_TICKET_FACT_CONTRACTS[candidate.templateCode];
  if (!expected) return TICKET_NOTICE_POLICY.pendingReason + " 검증되지 않은 템플릿";
  if (!state || state.source !== "solapi" || state.status !== "APPROVED")
    return TICKET_NOTICE_POLICY.pendingReason + " 승인 원문 확인 필요";
  if (ticketFactContractFingerprint(state) !== expected)
    return TICKET_NOTICE_POLICY.pendingReason + " 본문 또는 버튼 변경";
  return "";
}
