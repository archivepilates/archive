#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets,
  readCompleteStudioMateContractHistory } from "./lib/studiomate-native-contract-source.mjs";

const targets = [
  ["5041630", "심예슬"], ["5052201", "이소정"], ["5044408", "정수빈2"],
  ["excel_10381ac7275d7df1", "주현지"], ["excel_aa90ebab2bd52643", "김성환"],
  ["excel_a5380310f7321052", "정세진"], ["2714972", "윤혜진"], ["excel_1778e331d6684fbd", "서지인"],
];
async function main() {
  const args=process.argv.slice(2);
  if ((args.length && !(args.length===2&&args[0]==="--profile-id"&&targets.some(row=>row[0]===args[1]))) || process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Read-only exact review only");
  const key = JSON.parse(await readFile("/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json", "utf8"));
  if (key.project_id !== "archive-pilates" || key.client_email !== "archive-codex-operator@archive-pilates.iam.gserviceaccount.com") throw new Error("Operator identity mismatch");
  const require = createRequire(new URL("../firebase/kangsain-functions/functions/package.json", import.meta.url));
  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: "archive-pilates", credential: admin.credential.cert(key) });
  const db = admin.firestore();
  let release, context;
  try {
    const config = (await db.doc("systemSettings/membershipContractAutomation").get()).data();
    release = await acquireStudioMateBrowserLock({ owner: "member-registration-eight-readonly", waitMs: 60000 });
    const { chromium } = await import("playwright");
    context = await chromium.launchPersistentContext(path.join(os.homedir(), "ArchiveIN/automation/browser-profile"), { headless: true });
    const page = context.pages()[0] || await context.newPage();
    const client = await captureStudioMateNativeApiClient(page, { ensureLoggedIn: p => ensureStudioMateLoggedIn(p, { headless: true }) });
    const api = Object.freeze({ get: (...args) => client.get(...args) });
    for (const [profileId, name] of targets) {
      if(args.length&&profileId!==args[1])continue;
      const profile = (await db.doc(`memberProfiles/${profileId}`).get()).data();
      if (profile?.name !== name) throw new Error("Profile changed");
      const memberRead = await readExactStudioMateMember(api, profile.phone);
      if (memberRead.status !== "verified" || memberRead.member?.name !== name) {
        console.log(JSON.stringify({ profileId, name, status: "review", reason: "native_identity_not_verified" })); continue;
      }
      const member = memberRead.member;
      const ticketRead = await readStudioMateUserTickets(api, member.memberId);
      const history = await readCompleteStudioMateContractHistory(api, { phone: member.phone, startDate: config.contractHistoryStartDate || "2023-01-01" });
      const products = new Set(config.regularProductIds.map(String));
      console.log(JSON.stringify({ readOnly: true, profileId, memberId: member.memberId, name, phoneLast4: member.phone.slice(-4),
        registeredAt: member.registeredAt, memberGrade: member.memberGrade, inactive: member.inactive,
        birthdayPresent: /^\d{4}-\d{2}-\d{2}$/.test(member.birthday||""), genderPresent: Boolean(member.gender),
        ticketRead: ticketRead.status, contractHistory: history.status, historyAllTime: history.allTime, checkedAt: new Date().toISOString(),
        tickets: ticketRead.tickets.map(t => ({ userTicketId: t.userTicketId, productId: t.productId, title: t.title,
          regular: products.has(t.productId), issuedAt: t.issuedAt, status: t.status, refunded: t.refunded, cancelled: t.cancelled })),
        contracts: history.records.map(c => ({ contractId: c.contractId, memberId: c.memberId, userTicketId: c.userTicketId,
          productId: c.productId, title: c.title, status: c.status, signedAt: c.signedAt,
          memberSignaturePresent: c.memberSignaturePresent, centerSignaturePresent: c.centerSignaturePresent })) }));
    }
  } finally {
    try { await context?.close(); } finally { await release?.(); await db.terminate(); }
  }
}
main().catch(() => { console.error("Read-only registration review failed; no credentials logged"); process.exitCode = 1; });
