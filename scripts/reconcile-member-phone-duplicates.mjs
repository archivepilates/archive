#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const REPORT_DIR = path.join(os.homedir(), "ArchiveIN/automation/reports/member-profile-dedupe");

const args = parseArgs(process.argv.slice(2));
const config = {
  apply: Boolean(args.apply),
  phone: normalizePhone(args.phone || ""),
  maxWrites: numberValue(args["max-writes"] || process.env.ARCHIVEIN_MEMBER_DEDUPE_MAX_WRITES || "20000"),
};

const MEMBER_ID_COLLECTIONS = [
  "bookings",
  "privateSessionLedger",
  "privateLessonChartRequests",
  "privateLessonChartRecords",
  "privateSurveyResponses",
  "memberMemos",
  "alimtalkCandidates",
  "alimtalkSends",
  "contactSyncJobs",
  "studiomateMemoWriteJobs",
  "parkingVehicles",
  "attendanceSummaries",
  "dashboardMemberSales",
  "dashboardMonthlyMembers",
  "memberSignupContracts",
];

const NESTED_MEMBER_ID_COLLECTIONS = [
  { collection: "onsiteWelcomeRequests", fieldPath: "lookup.memberId" },
];

const MEMBER_DOC_COLLECTIONS = ["memberContactIndex", "memberTags", "members", "member360Cards"];

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const profiles = await loadProfiles();
  const duplicateGroups = duplicatePhoneGroups(profiles);
  const plans = [];
  for (const group of duplicateGroups) {
    plans.push(await buildMergePlan(group));
  }
  const plannedWrites = plans.reduce((sum, plan) => sum + plan.plannedWrites, 0);
  if (plannedWrites > config.maxWrites) {
    throw new Error(`Planned writes ${plannedWrites} exceed --max-writes=${config.maxWrites}.`);
  }
  if (config.apply) await applyPlans(plans);
  const report = {
    ok: true,
    mode: config.apply ? "apply" : "dry-run",
    source: "member_phone_duplicate_reconcile",
    studioId: STUDIO_ID,
    generatedAt: new Date().toISOString(),
    totalProfiles: profiles.length,
    duplicatePhoneGroups: duplicateGroups.length,
    affectedDuplicateProfiles: duplicateGroups.reduce((sum, group) => sum + group.members.length, 0),
    plannedWrites,
    plans: plans.map(reportPlan),
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(
    REPORT_DIR,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-member-phone-dedupe-${config.apply ? "apply" : "dry-run"}.json`,
  );
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

async function loadProfiles() {
  let query = db.collection("memberProfiles").where("studioId", "==", STUDIO_ID);
  if (config.phone) query = query.where("phone", "==", config.phone);
  const snap = await query.get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function duplicatePhoneGroups(profiles) {
  const byPhone = new Map();
  for (const profile of profiles) {
    const phone = normalizePhone(profile.data.phone || profile.data.memberPhone || "");
    if (!phone) continue;
    const list = byPhone.get(phone) || [];
    list.push({ ...profile, phone, score: memberProfilePriority(profile) });
    byPhone.set(phone, list);
  }
  return [...byPhone.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([phone, members]) => ({
      phone,
      members: [...members].sort(compareProfilePriority),
    }))
    .sort((a, b) => b.members.length - a.members.length || a.phone.localeCompare(b.phone));
}

async function buildMergePlan(group) {
  const keeper = group.members[0];
  const losers = group.members.slice(1);
  const refUpdates = [];
  const memberDocUpdates = [];
  for (const loser of losers) {
    for (const collection of MEMBER_ID_COLLECTIONS) {
      const snap = await db.collection(collection).where("memberId", "==", loser.id).get();
      if (!snap.empty) {
        refUpdates.push({
          collection,
          fieldPath: "memberId",
          fromMemberId: loser.id,
          toMemberId: keeper.id,
          docIds: snap.docs.map((doc) => doc.id),
        });
      }
    }
    for (const item of NESTED_MEMBER_ID_COLLECTIONS) {
      const snap = await db.collection(item.collection).where(item.fieldPath, "==", loser.id).get();
      if (!snap.empty) {
        refUpdates.push({
          collection: item.collection,
          fieldPath: item.fieldPath,
          fromMemberId: loser.id,
          toMemberId: keeper.id,
          docIds: snap.docs.map((doc) => doc.id),
        });
      }
    }
    for (const collection of MEMBER_DOC_COLLECTIONS) {
      const snap = await db.collection(collection).doc(loser.id).get();
      if (snap.exists) {
        memberDocUpdates.push({
          collection,
          fromMemberId: loser.id,
          toMemberId: keeper.id,
          data: snap.data() || {},
        });
      }
    }
  }
  const keeperPatch = buildKeeperPatch(keeper, losers, memberDocUpdates);
  const loserPatches = losers.map((loser) => buildLoserPatch(loser, keeper));
  const plannedWrites =
    (keeperPatch ? 1 : 0) +
    loserPatches.length +
    refUpdates.reduce((sum, item) => sum + item.docIds.length, 0) +
    memberDocUpdates.length * 2;
  return {
    phone: group.phone,
    keeper,
    losers,
    keeperPatch,
    loserPatches,
    refUpdates,
    memberDocUpdates,
    plannedWrites,
  };
}

function buildKeeperPatch(keeper, losers, memberDocUpdates) {
  const now = admin.firestore.Timestamp.now();
  const aliasNames = new Set([
    ...(Array.isArray(keeper.data.aliasNames) ? keeper.data.aliasNames : []),
    keeper.data.name,
    ...losers.flatMap((loser) => [loser.data.name, ...(Array.isArray(loser.data.aliasNames) ? loser.data.aliasNames : [])]),
  ].filter(Boolean));
  const mergedMemberIds = new Set([
    ...(Array.isArray(keeper.data.mergedMemberIds) ? keeper.data.mergedMemberIds : []),
    ...losers.map((loser) => loser.id),
  ]);
  const activeTickets = mergeActiveTickets([
    ...(Array.isArray(keeper.data.activeTickets) ? keeper.data.activeTickets : []),
    ...losers.flatMap((loser) => (Array.isArray(loser.data.activeTickets) ? loser.data.activeTickets : [])),
  ]);
  const mergedTags = memberDocUpdates
    .filter((item) => item.collection === "memberTags")
    .flatMap((item) => (Array.isArray(item.data.tags) ? item.data.tags : []));
  return removeUndefined({
    aliasNames: [...aliasNames].slice(0, 50),
    mergedMemberIds: [...mergedMemberIds].slice(0, 100),
    activeTickets,
    activeTicketCount: activeTickets.length,
    activeTicketNames: activeTickets.map((ticket) => ticket.name).filter(Boolean),
    memberMerge: {
      role: "keeper",
      strategy: "phone_canonical",
      phone: keeper.phone || normalizePhone(keeper.data.phone || ""),
      mergedMemberIds: [...mergedMemberIds].slice(0, 100),
      updatedAt: now,
    },
    mergedTags: mergedTags.length ? [...new Set([...(Array.isArray(keeper.data.mergedTags) ? keeper.data.mergedTags : []), ...mergedTags])] : undefined,
    updatedAt: now,
  });
}

function buildLoserPatch(loser, keeper) {
  const now = admin.firestore.Timestamp.now();
  return {
    memberId: loser.id,
    patch: {
      canonicalMemberId: keeper.id,
      mergedInto: keeper.id,
      externalActionEligible: false,
      status: "merged",
      memberMerge: {
        role: "merged",
        strategy: "phone_canonical",
        phone: loser.phone || normalizePhone(loser.data.phone || ""),
        canonicalMemberId: keeper.id,
        mergedAt: now,
      },
      updatedAt: now,
    },
  };
}

async function applyPlans(plans) {
  let batch = db.batch();
  let writes = 0;
  const commit = async () => {
    if (!writes) return;
    await batch.commit();
    batch = db.batch();
    writes = 0;
  };
  const set = async (ref, data, options = { merge: true }) => {
    batch.set(ref, data, options);
    writes += 1;
    if (writes >= 450) await commit();
  };
  for (const plan of plans) {
    if (plan.keeperPatch) await set(db.collection("memberProfiles").doc(plan.keeper.id), plan.keeperPatch);
    for (const item of plan.loserPatches) {
      await set(db.collection("memberProfiles").doc(item.memberId), item.patch);
    }
    for (const item of plan.refUpdates) {
      for (const docId of item.docIds) {
        await set(db.collection(item.collection).doc(docId), {
          ...nestedFieldPatch(item.fieldPath, item.toMemberId),
          canonicalMemberId: item.toMemberId,
          previousMemberIds: admin.firestore.FieldValue.arrayUnion(item.fromMemberId),
          memberMerge: {
            strategy: "phone_canonical",
            fromMemberId: item.fromMemberId,
            toMemberId: item.toMemberId,
            updatedAt: admin.firestore.Timestamp.now(),
          },
          updatedAt: admin.firestore.Timestamp.now(),
        });
      }
    }
    for (const item of plan.memberDocUpdates) {
      await set(db.collection(item.collection).doc(item.toMemberId), mergeMemberDocData(item));
      await set(db.collection(item.collection).doc(item.fromMemberId), {
        canonicalMemberId: item.toMemberId,
        mergedInto: item.toMemberId,
        mergeStatus: "merged",
        updatedAt: admin.firestore.Timestamp.now(),
      });
    }
  }
  await commit();
}

function mergeMemberDocData(item) {
  const now = admin.firestore.Timestamp.now();
  if (item.collection === "memberTags") {
    const tags = Array.isArray(item.data.tags) ? item.data.tags.filter(Boolean) : [];
    return removeUndefined({
      tags: tags.length ? admin.firestore.FieldValue.arrayUnion(...tags) : undefined,
      mergedFromMemberIds: admin.firestore.FieldValue.arrayUnion(item.fromMemberId),
      updatedAt: now,
    });
  }
  if (item.collection === "memberContactIndex") {
    return removeUndefined({
      mergedFromMemberIds: admin.firestore.FieldValue.arrayUnion(item.fromMemberId),
      contactMemo: item.data.contactMemo || undefined,
      homeContactResourceName: item.data.homeContactResourceName || undefined,
      updatedAt: now,
    });
  }
  return {
    mergedFromMemberIds: admin.firestore.FieldValue.arrayUnion(item.fromMemberId),
    updatedAt: now,
  };
}

function reportPlan(plan) {
  return {
    phoneMasked: maskPhone(plan.phone),
    phoneLast4: plan.phone.slice(-4),
    keeper: reportProfile(plan.keeper),
    losers: plan.losers.map(reportProfile),
    referenceUpdates: plan.refUpdates.map((item) => ({
      collection: item.collection,
      fieldPath: item.fieldPath,
      fromMemberId: item.fromMemberId,
      toMemberId: item.toMemberId,
      count: item.docIds.length,
      sampleDocIds: item.docIds.slice(0, 10),
    })),
    memberDocUpdates: plan.memberDocUpdates.map((item) => ({
      collection: item.collection,
      fromMemberId: item.fromMemberId,
      toMemberId: item.toMemberId,
    })),
    plannedWrites: plan.plannedWrites,
  };
}

function reportProfile(profile) {
  return {
    id: profile.id,
    name: profile.data.name || profile.data.memberName || "",
    status: profile.data.status || "",
    profileKind: profile.data.profileKind || "",
    activeTickets: Array.isArray(profile.data.activeTickets) ? profile.data.activeTickets.length : 0,
    externalActionEligible: profile.data.externalActionEligible ?? null,
    score: profile.score,
  };
}

function compareProfilePriority(a, b) {
  return a.score - b.score || String(a.id).localeCompare(String(b.id));
}

function memberProfilePriority(item) {
  const data = item.data || {};
  const id = String(item.id || data.memberId || "");
  let score = 0;
  if (data.mergedInto || data.canonicalMemberId) score += 5000;
  if (String(data.profileKind || "") === "reservation_only" || String(data.status || "") === "reservation_only") score += 1000;
  if (id.startsWith("reservation_phone_")) score += 1000;
  if (id.startsWith("excel_") || id.startsWith("consultation_excel_")) score += 200;
  if (!data.memberId && !data.studiomateMemberId) score += 50;
  if (Array.isArray(data.activeTickets) && data.activeTickets.length) score -= 50;
  if (data.registeredAt?.toMillis?.()) score -= 5;
  if (String(data.status || "").includes("퇴") || String(data.status || "").toLowerCase().includes("inactive")) score += 30;
  return score;
}

function mergeActiveTickets(tickets) {
  const byKey = new Map();
  for (const ticket of tickets) {
    if (!ticket || typeof ticket !== "object") continue;
    const key = [
      ticket.userTicketId || "",
      ticket.ticketId || "",
      ticket.name || "",
      ticket.expiresAt?.toMillis?.() || ticket.expiresAt?._seconds || "",
      ticket.remainingCount ?? "",
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, ticket);
  }
  return [...byKey.values()].slice(0, 50);
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key.includes("=")) {
      const [name, ...rest] = key.split("=");
      out[name] = rest.join("=");
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      out[key] = argv[index + 1];
      index += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizePhone(value) {
  let text = cleanText(value);
  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");
  if (/^\d+(?:\.\d+)?e\+?\d+$/i.test(text)) {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) text = String(Math.trunc(parsed));
  }
  let digits = text.replace(/\D+/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return digits;
}

function maskPhone(phone) {
  return phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : "";
}

function cleanText(value) {
  return String(value ?? "").normalize("NFC").trim();
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function nestedFieldPatch(fieldPath, value) {
  const parts = String(fieldPath || "").split(".").filter(Boolean);
  if (parts.length <= 1) return { [fieldPath]: value };
  const root = {};
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor[parts[index]] = {};
    cursor = cursor[parts[index]];
  }
  cursor[parts.at(-1)] = value;
  return root;
}
