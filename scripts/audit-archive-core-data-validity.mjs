#!/usr/bin/env node
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = parseArgs(process.argv.slice(2));
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = String(args["studio-id"] || process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330");
const MEMBER_NAME = String(args["member-name"] || "").trim();
const SAMPLE_LIMIT = Number(args["sample-limit"] || "30");
const DEFAULT_CREDENTIALS = path.join(os.homedir(), "ArchiveIN/secrets/google/archive-codex-operator.json");

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_CREDENTIALS;
}
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const [profilesSnap, cardsSnap] = await Promise.all([
    db.collection("memberProfiles").where("studioId", "==", STUDIO_ID).get(),
    db.collection("member360Cards").where("studioId", "==", STUDIO_ID).get(),
  ]);
  const profiles = profilesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const cards = cardsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const cardsById = new Map(cards.map((card) => [memberId(card), card]).filter(([id]) => id));
  const issues = [];

  for (const profile of profiles) {
    if (MEMBER_NAME && !String(profile.name || profile.memberName || "").includes(MEMBER_NAME)) continue;
    const id = memberId(profile);
    const card = cardsById.get(id);
    if (!card) {
      issues.push(issue("missing_member360_card", profile, null, "memberProfiles는 있지만 CORE 회원 미러가 없습니다."));
      continue;
    }
    const activeTickets = currentProfileTickets(profile);
    const profileTickets = ticketFingerprint(activeTickets);
    const cardTickets = ticketFingerprint(card.currentTicketsSummary || []);
    const profileUpdatedAt = millis(profile.updatedAt || profile.syncedAt);
    const cardUpdatedAt = millis(card.rebuiltAt || card.updatedAt || card.sourceProfileUpdatedAt);
    if (profileUpdatedAt && cardUpdatedAt && profileUpdatedAt > cardUpdatedAt + 5 * 60 * 1000 && profileTickets !== cardTickets) {
      issues.push(issue("stale_member360_ticket_summary", profile, card, "최신 수강권 원천과 CORE 수강권 미러가 다릅니다."));
    }
    for (const activeTicket of activeTickets) {
      if (hasPaymentMetadata(activeTicket)) continue;
      const cardTicket = findMatchingTicket(card.currentTicketsSummary || [], activeTicket);
      if (cardTicket && hasPaymentMetadata(cardTicket)) {
        issues.push(
          issue(
            "profile_active_ticket_payment_metadata_missing",
            profile,
            card,
            "최신 회원 프로필의 현재 수강권에서 결제일/결제금액 메타데이터가 사라졌습니다.",
          ),
        );
        break;
      }
    }
    const latestTicketStart = Math.max(0, ...activeTickets.map((ticket) => millis(ticket.availableFrom || ticket.startDate || ticket.issuedAt)));
    const latestPurchase = Math.max(
      0,
      ...(card.recentPurchases || []).map((purchase) => millis(purchase.paymentDate || purchase.purchasedAt || purchase.createdAt)),
      ...activeTickets.map((ticket) => millis(ticket.paymentAt || ticket.paymentDate || ticket.purchasedAt)),
    );
    const hasTicketPaymentEvidence = activeTickets.some(
      (ticket) => millis(ticket.paymentAt || ticket.paymentDate || ticket.purchasedAt) || Number(ticket.paymentAmount || ticket.amountTotal || ticket.price || 0),
    );
    if (latestTicketStart && !hasTicketPaymentEvidence && (!latestPurchase || latestTicketStart > latestPurchase + 30 * 24 * 60 * 60 * 1000)) {
      issues.push(issue("missing_recent_purchase_amount", profile, card, "활성 수강권 시작일 이후 구매 이력이 없어 구매금액 미러가 최신이 아닐 수 있습니다."));
    }
  }

  const byType = issues.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
  const output = {
    ok: issues.length === 0,
    mode: "read-only",
    projectId: PROJECT_ID,
    studioId: STUDIO_ID,
    filter: MEMBER_NAME ? { memberName: MEMBER_NAME } : {},
    source: {
      memberProfiles: profiles.length,
      member360Cards: cards.length,
    },
    issues: {
      total: issues.length,
      byType,
      samples: issues.slice(0, SAMPLE_LIMIT),
    },
    notes: [
      "재등록·현재 수강권 판단은 memberProfiles.activeTickets를 우선해야 합니다.",
      "member360Cards와 members 하위 구매 이력은 분석용 미러이며 최신 결제금액 원천이 끊기면 stale 상태가 됩니다.",
      "구매금액 누락은 임의 추정하지 말고 StudioMate 회원목록/결제 원천을 재수집해 purchase mirror를 재생성해야 합니다.",
    ],
    generatedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(output, null, 2));
}

function issue(type, profile, card, detail) {
  return {
    type,
    memberId: memberId(profile),
    memberName: profile.name || profile.memberName || "",
    phoneLast4: String(profile.phoneLast4 || profile.phone || "").slice(-4),
    detail,
    profileUpdatedAt: iso(profile.updatedAt || profile.syncedAt),
    cardUpdatedAt: iso(card?.rebuiltAt || card?.updatedAt || card?.sourceProfileUpdatedAt),
    profileTickets: currentProfileTickets(profile).map(ticketSummary),
    cardTickets: (card?.currentTicketsSummary || []).map(ticketSummary),
    recentPurchases: (card?.recentPurchases || []).slice(0, 3).map((purchase) => ({
      paymentDate: purchase.paymentDate || purchase.purchasedAt || "",
      ticketName: purchase.ticketName || purchase.name || "",
      amountTotal: Number(purchase.amountTotal || purchase.amount || purchase.price || 0),
    })),
  };
}

function ticketSummary(ticket) {
  return {
    name: ticket.name || ticket.ticketName || "",
    classType: ticket.classType || ticket.lessonType || "",
    remainingCount: Number(ticket.remainingCount ?? ticket.remaining ?? 0),
    maxCount: Number(ticket.maxCount ?? ticket.totalCount ?? ticket.usableCount ?? 0),
    availableFrom: iso(ticket.availableFrom || ticket.startDate || ticket.issuedAt),
    expiresAt: iso(ticket.expiresAt || ticket.endDate || ticket.expireAt),
    paymentAt: iso(ticket.paymentAt || ticket.paymentDate || ticket.purchasedAt),
    paymentAmount: Number(ticket.paymentAmount || ticket.amountTotal || ticket.price || 0),
    status: ticket.status || ticket.ticketStatus || "",
  };
}

function ticketFingerprint(tickets) {
  return (tickets || [])
    .map((ticket) =>
      [
        ticket.name || ticket.ticketName || "",
        ticket.classType || ticket.lessonType || "",
        Number(ticket.remainingCount ?? ticket.remaining ?? 0),
        Number(ticket.maxCount ?? ticket.totalCount ?? ticket.usableCount ?? 0),
        millis(ticket.availableFrom || ticket.startDate || ticket.issuedAt),
        millis(ticket.expiresAt || ticket.endDate || ticket.expireAt),
      ].join("|"),
    )
    .sort()
    .join(";");
}

function findMatchingTicket(tickets, target) {
  const strictKey = paymentMetadataKey(target, true);
  const looseKey = paymentMetadataKey(target, false);
  return (tickets || []).find((ticket) => paymentMetadataKey(ticket, true) === strictKey) || (tickets || []).find((ticket) => paymentMetadataKey(ticket, false) === looseKey);
}

function paymentMetadataKey(ticket, strict) {
  return [
    String(ticket.name || ticket.ticketName || "").replace(/\s+/g, "").toLowerCase(),
    ticket.classType || ticket.lessonType || "",
    strict ? millis(ticket.availableFrom || ticket.startDate || ticket.issuedAt) : "",
    millis(ticket.expiresAt || ticket.endDate || ticket.expireAt),
    strict ? Number(ticket.maxCount ?? ticket.totalCount ?? ticket.usableCount ?? 0) : "",
  ].join("|");
}

function hasPaymentMetadata(ticket) {
  return Boolean(
    Number(ticket.paymentAmount || ticket.amountTotal || ticket.price || 0) ||
      ticket.paymentAt ||
      ticket.paymentDate ||
      ticket.purchasedAt ||
      ticket.paymentMethod ||
      ticket.paymentType ||
      ticket.category,
  );
}

function currentProfileTickets(profile) {
  return (profile.activeTickets || []).filter((ticket) => {
    const expiresMs = millis(ticket.expiresAt || ticket.endDate || ticket.expireAt);
    return !expiresMs || expiresMs + 24 * 60 * 60 * 1000 >= Date.now();
  });
}

function memberId(item) {
  return String(item?.memberId || item?.id || "").trim();
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "object" && typeof value.seconds === "number") return value.seconds * 1000;
  const date = new Date(String(value).replace(/\./g, "-"));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function iso(value) {
  const ms = millis(value);
  return ms ? new Date(ms).toISOString() : "";
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=");
    parsed[key] = inlineValue ?? argv[index + 1] ?? true;
    if (inlineValue === undefined && argv[index + 1] && !argv[index + 1].startsWith("--")) index += 1;
  }
  return parsed;
}
