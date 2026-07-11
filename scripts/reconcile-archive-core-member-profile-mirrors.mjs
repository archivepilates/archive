#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = parseArgs(process.argv.slice(2));
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = String(args["studio-id"] || process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330");
const MEMBER_ID = String(args["member-id"] || "").trim();
const MEMBER_NAME = String(args["member-name"] || "").trim();
const APPLY = Boolean(args.apply);
const MAX_WRITES = Number(args["max-writes"] || "10000");
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
  const [profilesSnap, cardsSnap, purchasesSnap] = await Promise.all([
    db.collection("memberProfiles").where("studioId", "==", STUDIO_ID).get(),
    db.collection("member360Cards").where("studioId", "==", STUDIO_ID).get(),
    db.collectionGroup("purchases").get(),
  ]);
  const profiles = profilesSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((profile) => !MEMBER_ID || memberId(profile) === MEMBER_ID)
    .filter((profile) => !MEMBER_NAME || String(profile.name || profile.memberName || "").includes(MEMBER_NAME));
  const cardsById = new Map(cardsSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  const purchasesByMember = new Map();
  for (const doc of purchasesSnap.docs) {
    const data = doc.data();
    const id = String(data.memberId || doc.ref.parent.parent?.id || "").trim();
    if (!id) continue;
    const list = purchasesByMember.get(id) || [];
    list.push({ id: doc.id, ...data });
    purchasesByMember.set(id, list);
  }

  const writes = [];
  const stats = {
    profiles: profiles.length,
    missingCards: 0,
    staleTicketMirrors: 0,
    profilePaymentPurchasesAdded: 0,
    membersTouched: 0,
  };
  const samples = [];

  for (const profile of profiles) {
    const id = memberId(profile);
    if (!id) continue;
    const card = cardsById.get(id) || {};
    const activeTickets = currentProfileTickets(profile);
    const cardTickets = Array.isArray(card.currentTicketsSummary) ? card.currentTicketsSummary : [];
    const staleTickets = ticketFingerprint(activeTickets) !== ticketFingerprint(cardTickets);
    const profilePurchases = profileActiveTicketPurchases(profile);
    const existingPurchaseDocs = purchasesByMember.get(id) || [];
    const existingRecentPurchases = Array.isArray(card.recentPurchases) ? card.recentPurchases : [];
    const existingPurchaseKeys = new Set(
      [...existingPurchaseDocs, ...existingRecentPurchases].map((purchase) => canonicalPurchaseKey(id, normalizeExistingPurchase(purchase))),
    );
    const latestExistingPurchaseMs = Math.max(
      0,
      ...[...existingPurchaseDocs, ...existingRecentPurchases].map((purchase) =>
        timestampMs(normalizeExistingPurchase(purchase).paymentDate || purchase.purchasedAt || purchase.createdAt),
      ),
    );
    const missingPurchases = profilePurchases.filter((purchase) => {
      if (existingPurchaseKeys.has(canonicalPurchaseKey(id, purchase))) return false;
      const paymentMs = timestampMs(purchase.paymentDate);
      if (!latestExistingPurchaseMs) return true;
      return paymentMs > latestExistingPurchaseMs + 24 * 60 * 60 * 1000;
    });
    const recentPurchases = sortPurchases([...missingPurchases.map(purchaseSummary), ...existingRecentPurchases]).slice(0, 10);
    const totalRevenue =
      (card.id ? numberValue(card.totalRevenue) : sum(existingPurchaseDocs.map((purchase) => normalizeExistingPurchase(purchase).amountTotal))) +
      sum(missingPurchases.map((purchase) => purchase.amountTotal));
    const purchaseCount = (card.id ? numberValue(card.purchaseCount) : existingPurchaseDocs.length) + missingPurchases.length;
    const now = admin.firestore.Timestamp.now();
    const baseDoc = compactObject({
      memberId: id,
      studioId: profile.studioId || STUDIO_ID,
      name: profile.name || profile.memberName || "",
      normalizedName: profile.normalizedName || normalizeName(profile.name || profile.memberName || ""),
      phone: normalizePhone(profile.phone || ""),
      phoneLast4: profile.phoneLast4 || last4(profile.phone || ""),
      registeredAt: profile.registeredAt || null,
      status: activeTickets.length ? "active" : profile.status || "unknown",
      currentTicketsSummary: activeTickets,
      activeTicketCount: activeTickets.length,
      totalRevenue,
      purchaseCount,
      bookingCount: numberValue(card.bookingCount),
      attendedCount: numberValue(card.attendedCount),
      absentCount: numberValue(card.absentCount),
      recentVisitAt: card.recentVisitAt || profile.recentVisitAt || null,
      recentPurchases: recentPurchases.slice(0, 3),
      recentBookings: card.recentBookings || [],
      recentMemos: card.recentMemos || [],
      signals: card.signals || [],
      sourceProfileUpdatedAt: profile.updatedAt || profile.syncedAt || null,
      rebuiltAt: now,
      updatedAt: now,
      dataSources: {
        ...(card.dataSources || {}),
        profile: "memberProfiles",
        card: card.id ? "member360Cards" : "created_from_memberProfiles",
      },
    });
    const summaryDoc = compactObject({
      ...baseDoc,
      recentPurchases,
      sourcePaths: {
        profile: `memberProfiles/${id}`,
        purchases: "memberProfiles.activeTickets payment metadata plus existing member360 mirror",
      },
    });

    writes.push({ ref: db.collection("members").doc(id), data: baseDoc });
    writes.push({ ref: db.collection("members").doc(id).collection("summary").doc("current"), data: summaryDoc });
    writes.push({ ref: db.collection("member360Cards").doc(id), data: baseDoc });
    for (const [index, ticket] of activeTickets.entries()) {
      const ticketId = docId(ticket.userTicketId || ticket.ticketId || `active_${hash([id, ticket.name || ticket.ticketName || "", index].join("|")).slice(0, 16)}`);
      writes.push({
        ref: db.collection("members").doc(id).collection("tickets").doc(ticketId),
        data: compactObject({ ...ticket, memberId: id, studioId: profile.studioId || STUDIO_ID, source: "memberProfiles.activeTickets", updatedAt: now }),
      });
    }
    for (const purchase of missingPurchases) {
      writes.push({
        ref: db.collection("members").doc(id).collection("purchases").doc(docId(purchase.purchaseId)),
        data: compactObject({ ...purchase, source: "memberProfiles.activeTickets", updatedAt: now }),
      });
    }

    if (!card.id) stats.missingCards += 1;
    if (staleTickets) stats.staleTicketMirrors += 1;
    stats.profilePaymentPurchasesAdded += missingPurchases.length;
    stats.membersTouched += 1;
    if (samples.length < 20 && (!card.id || staleTickets || missingPurchases.length)) {
      samples.push({
        memberId: id,
        memberName: profile.name || profile.memberName || "",
        activeTickets: activeTickets.map((ticket) => ({
          name: ticket.name || ticket.ticketName || "",
          remainingCount: ticket.remainingCount ?? "",
          expiresAt: dateKeyFromAny(ticket.expiresAt || ticket.endDate || ticket.expireAt),
          paymentDate: dateKeyFromAny(ticket.paymentAt || ticket.paymentDate || ticket.purchasedAt),
          paymentAmount: numberValue(ticket.paymentAmount || ticket.amountTotal || ticket.price),
        })),
        missingPurchases: missingPurchases.map(purchaseSummary),
      });
    }
  }

  if (writes.length > MAX_WRITES) {
    throw new Error(`Planned writes ${writes.length} exceeds --max-writes ${MAX_WRITES}.`);
  }
  if (APPLY) await applyWrites(writes);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: APPLY ? "apply" : "dry-run",
        projectId: PROJECT_ID,
        studioId: STUDIO_ID,
        filter: { memberId: MEMBER_ID || undefined, memberName: MEMBER_NAME || undefined },
        stats,
        plannedWrites: writes.length,
        appliedWrites: APPLY ? writes.length : 0,
        samples,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function profileActiveTicketPurchases(profile) {
  const id = memberId(profile);
  return currentProfileTickets(profile)
    .map((ticket, index) => {
      const amountTotal = numberValue(ticket.paymentAmount ?? ticket.amountTotal ?? ticket.price);
      const paymentDate = dateKeyFromAny(ticket.paymentAt || ticket.paymentDate || ticket.purchasedAt);
      if (!amountTotal && !paymentDate) return null;
      const ticketName = String(ticket.name || ticket.ticketName || "현재 수강권").trim();
      const startDate = dateKeyFromAny(ticket.availableFrom || ticket.startDate || ticket.issuedAt);
      const endDate = dateKeyFromAny(ticket.expiresAt || ticket.endDate || ticket.expireAt);
      return {
        purchaseId:
          String(ticket.purchaseId || "").trim() ||
          `profile_active_ticket_${hash([id, ticketName, paymentDate, amountTotal, startDate, endDate, index].join("|")).slice(0, 20)}`,
        memberId: id,
        memberName: profile.name || profile.memberName || "",
        memberPhone: normalizePhone(profile.phone || ""),
        ticketName,
        classType: ticket.classType || ticket.lessonType || "",
        paymentDate,
        paymentMethod: ticket.paymentMethod || "",
        category: ticket.paymentType || "현재 수강권",
        amountTotal,
        startDate,
        endDate,
        sourceMonth: String(paymentDate || startDate).slice(0, 7),
        ticketStatus: ticket.status || ticket.ticketStatus || "",
      };
    })
    .filter(Boolean);
}

function normalizeExistingPurchase(purchase) {
  return {
    ticketName: purchase.ticketName || purchase.productName || purchase.name || "",
    paymentDate: purchase.paymentDate || purchase.purchasedAt || purchase.createdAt || "",
    amountTotal: purchase.amountTotal ?? purchase.price ?? purchase.amount ?? purchase.revenue ?? 0,
    startDate: purchase.startDate || "",
    endDate: purchase.endDate || "",
  };
}

function purchaseSummary(purchase) {
  return compactObject({
    purchaseId: purchase.purchaseId,
    paymentDate: purchase.paymentDate,
    sourceMonth: purchase.sourceMonth,
    classType: purchase.classType,
    ticketName: purchase.ticketName,
    amountTotal: purchase.amountTotal,
    paymentMethod: purchase.paymentMethod,
    category: purchase.category,
    ticketStatus: purchase.ticketStatus,
  });
}

function canonicalPurchaseKey(id, purchase) {
  return [
    id,
    String(purchase.ticketName || "").trim(),
    dateKeyFromAny(purchase.paymentDate),
    numberValue(purchase.amountTotal),
    dateKeyFromAny(purchase.startDate),
    dateKeyFromAny(purchase.endDate),
  ].join("|");
}

async function applyWrites(writes) {
  for (let index = 0; index < writes.length; index += 450) {
    const batch = db.batch();
    writes.slice(index, index + 450).forEach((write) => batch.set(write.ref, write.data, { merge: true }));
    await batch.commit();
  }
}

function sortPurchases(items) {
  return [...items].sort((a, b) => timestampMs(b.paymentDate || b.purchasedAt || b.createdAt) - timestampMs(a.paymentDate || a.purchasedAt || a.createdAt));
}

function ticketFingerprint(tickets = []) {
  return (tickets || [])
    .map((ticket) =>
      [
        ticket.name || ticket.ticketName || "",
        ticket.classType || ticket.lessonType || "",
        numberValue(ticket.remainingCount ?? ticket.remaining ?? 0),
        numberValue(ticket.maxCount ?? ticket.totalCount ?? ticket.usableCount ?? 0),
        timestampMs(ticket.availableFrom || ticket.startDate || ticket.issuedAt),
        timestampMs(ticket.expiresAt || ticket.endDate || ticket.expireAt),
      ].join("|"),
    )
    .sort()
    .join(";");
}

function currentProfileTickets(profile) {
  return (Array.isArray(profile.activeTickets) ? profile.activeTickets : []).filter((ticket) => {
    const expiresMs = timestampMs(ticket.expiresAt || ticket.endDate || ticket.expireAt);
    return !expiresMs || expiresMs + 24 * 60 * 60 * 1000 >= Date.now();
  });
}

function memberId(item) {
  return String(item?.memberId || item?.id || "").trim();
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D+/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return digits;
}

function last4(value) {
  const phone = normalizePhone(value);
  return phone ? phone.slice(-4) : "";
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return Number(String(value ?? "").replace(/[^0-9.-]+/g, "")) || 0;
}

function sum(values) {
  return values.reduce((total, value) => total + numberValue(value), 0);
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "object" && typeof value.seconds === "number") return value.seconds * 1000;
  const date = new Date(String(value).replace(/\./g, "-"));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function dateKeyFromAny(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return dateKey(value.toDate().toISOString());
  if (typeof value === "object" && typeof value.seconds === "number") return dateKey(new Date(value.seconds * 1000).toISOString());
  return dateKey(value);
}

function dateKey(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const matched = text.match(/(20\d{2})[-./년 ]\s*(\d{1,2})[-./월 ]\s*(\d{1,2})/);
  if (matched) return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
  return text.slice(0, 10);
}

function compactObject(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function docId(value) {
  return String(value || "unknown").replaceAll("/", "_");
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
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
