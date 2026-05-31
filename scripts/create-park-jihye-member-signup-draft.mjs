import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json";
const STUDIO_ID = process.env.ARCHIVEIN_STUDIO_ID || "5330";
const MEMBER_NAME = process.env.ARCHIVEIN_SAMPLE_MEMBER_NAME || "박지혜";

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id || "archive-pilates",
  });
}

const db = admin.firestore();
const token = randomBytes(24).toString("base64url");
const tokenHash = sha256(token);
const profileSnap = await db
  .collection("memberProfiles")
  .where("studioId", "==", STUDIO_ID)
  .where("name", "==", MEMBER_NAME)
  .limit(1)
  .get();

const profile = profileSnap.docs[0]?.data() || {};
const memberId = String(profile.memberId || `sample-${sha256(MEMBER_NAME).slice(0, 10)}`);
const contractId = `msc-${memberId}-${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9-]/g, "-");
const ticket = Array.isArray(profile.activeTickets) ? profile.activeTickets[0] || {} : {};
const now = admin.firestore.Timestamp.now();
const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 1000 * 60 * 60 * 24 * 14);

const doc = {
  contractId,
  studioId: STUDIO_ID,
  memberId,
  memberName: String(profile.name || MEMBER_NAME),
  memberPhone: digitsOnly(profile.phone || ""),
  memberPhoneLast4: digitsOnly(profile.phone || "").slice(-4),
  status: "draft",
  accessTokenHash: tokenHash,
  source: profile.memberId ? "studiomate_profile" : "manual_sample",
  member: {
    name: String(profile.name || MEMBER_NAME),
    phone: digitsOnly(profile.phone || ""),
    gender: String(profile.gender || ""),
    birthDate: String(profile.birthDate || ""),
    email: String(profile.email || ""),
    address: "",
    visitRoute: "",
    exercisePurpose: "",
    recommender: "",
  },
  purchase: {
    ticketName: String(ticket.name || (profile.activeTicketNames || [])[0] || ""),
    startDate: dateText(ticket.availableFrom),
    endDate: dateText(ticket.expiresAt),
    paymentMethod: "",
    paidAmount: "",
    unpaidAmount: "0원",
  },
  termsVersion: "archive-member-signup-2026-05",
  openedAt: null,
  submittedAt: null,
  expiresAt,
  createdAt: now,
  updatedAt: now,
};

await db.collection("memberSignupContracts").doc(contractId).set(doc, { merge: true });

console.log(JSON.stringify({
  ok: true,
  contractId,
  memberName: doc.memberName,
  source: doc.source,
  url: `https://in.archivepilates.com/memberSignup/?id=${encodeURIComponent(contractId)}&token=${encodeURIComponent(token)}`,
}, null, 2));

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function dateText(value) {
  if (!value) return "";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);
}
