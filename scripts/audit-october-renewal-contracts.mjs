#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets, readCompleteStudioMateContractHistory } from "./lib/studiomate-native-contract-source.mjs";
import { membershipContractMemberGradeDecision, selectNativeMembershipContractCandidate } from "./lib/studiomate-membership-contract-native-selection.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
const { chromium } = require("playwright");
const file = process.argv[2];
assert(file?.endsWith(".xlsx"), "Canonical member export required");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const bytes = await readFile(file);
const workbook = XLSX.read(bytes, { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false });
const groups = new Map();
for (const row of rows) {
  const phone = String(row["전화번호"]).replace(/\D/g, "");
  if (!/^010\d{8}$/.test(phone)) continue;
  if (!groups.has(phone)) groups.set(phone, { phone, rows: [], october: false });
  const g = groups.get(phone);
  g.rows.push(row);
  if (/^2026-10-/.test(row["수강권발급일"])) g.october = true;
}
const targets = [...groups.values()].filter((g) => g.october);
assert(targets.length > 0 && targets.length < 100, "Unexpected October population");
const report = { readOnly: true, externalWrites: 0, sourceSha256: sha256(bytes), startedAt: new Date().toISOString(), exportRows: rows.length, octoberMembers: targets.length, members: [] };
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
admin.initializeApp({ projectId: "archive-pilates" });
const db = admin.firestore();
let context, release;
try {
  const config = (await db.doc("systemSettings/membershipContractAutomation").get()).data();
  const jobs = await db.collection("studiomateMembershipContractJobs").limit(1000).get();
  assert(jobs.size < 1000);
  release = await acquireStudioMateBrowserLock({ owner: "october-renewal-readonly-audit", waitMs: 60000 });
  context = await chromium.launchPersistentContext(path.join(os.homedir(), "ArchiveIN/automation/browser-profile"), { headless: true });
  const page = context.pages()[0] || await context.newPage();
  const captured = await captureStudioMateNativeApiClient(page, { ensureLoggedIn: (p) => ensureStudioMateLoggedIn(p, { headless: true }) });
  const api = Object.freeze({ get: captured.get });
  for (const group of targets) {
    const record = { name: group.rows[0]["이름"], phoneFingerprint: sha256(group.phone), verified: false };
    try {
      const mr = await readExactStudioMateMember(api, group.phone);
      assert(mr.status === "verified" && mr.member.phone === group.phone, "Native identity incomplete");
      const member = mr.member;
      const tr = await readStudioMateUserTickets(api, member.memberId);
      assert(tr.status === "verified", "Native tickets incomplete");
      const history = await readCompleteStudioMateContractHistory(api, { phone: group.phone, startDate: config.contractHistoryStartDate || "2023-01-01" });
      assert(history.status === "verified", "Native contract history incomplete");
      const regular = tr.tickets.filter((t) => config.regularProductIds.map(String).includes(t.productId));
      Object.assign(record, {
        verified: true, memberId: member.memberId, inactive: member.inactive, grade: membershipContractMemberGradeDecision(group, member),
        identityFieldsComplete: !!member.gender && !!member.birthday,
        tickets: tr.tickets.filter((t) => t.issuedAt >= "2026-09-30T15:00:00.000Z" && t.issuedAt < "2026-10-31T15:00:00.000Z").map((t) => ({
          id: t.userTicketId, productId: t.productId, title: t.title, issuedAt: t.issuedAt, status: t.status, refunded: t.refunded, cancelled: t.cancelled,
          regular: regular.includes(t), priorRegularCount: regular.filter((p) => p.issuedAt < t.issuedAt && !p.refunded && !p.cancelled).length,
          from: t.availabilityStartAt, until: t.expireAt, amount: t.payment.totalAmount,
        })),
        contracts: history.records.map((c) => ({ id: c.contractId, title: c.title, status: c.status, userTicketId: c.ticket?.userTicketId || "", productId: c.ticket?.productId, from: c.ticket?.availabilityStartAt, until: c.ticket?.expireAt, amount: c.ticket?.amount, signedAt: c.signedAt })),
        jobs: jobs.docs.filter((d) => d.data().memberId === member.memberId).map((d) => ({ id: d.id, stage: d.data().stage, ticketId: d.data().userTicketId, contractId: d.data().contractId || "" })),
        checkedAt: new Date().toISOString(),
      });
      record.decisions = [];
      for (const ticket of tr.tickets.filter((t) => t.issuedAt >= "2026-09-30T15:00:00.000Z" && t.issuedAt < "2026-10-31T15:00:00.000Z")) {
        const approval = { reference: "user_october_renewal_recovery_20261022", memberId: member.memberId, userTicketId: ticket.userTicketId, sourceSha256: report.sourceSha256, sourceComplete: true };
        const selected = selectNativeMembershipContractCandidate({ group, member, ticketRead: tr, contractHistory: history, sourceDownloadedAt: new Date().toISOString(), config, recoveryApproval: approval });
        let reason = selected.reason, status = selected.status;
        if (status === "eligible" && (!record.identityFieldsComplete || member.inactive)) { status = "review"; reason = "member_identity_is_incomplete_or_inactive"; }
        if (status === "eligible" && record.jobs.some((j) => j.ticketId === ticket.userTicketId)) { status = "review"; reason = "existing_job_requires_reconciliation"; }
        record.decisions.push({ ticketId: ticket.userTicketId, status, reason, jobKey: selected.selection?.jobKey || null });
      }
    } catch (error) { record.error = String(error.message).replace(/010[\d-]{8,}/g, "[redacted]"); }
    report.members.push(record);
    console.log(JSON.stringify({ name: record.name, verified: record.verified, grade: record.grade?.status, octoberTickets: record.tickets?.length, error: record.error }));
  }
} finally {
  try { await context?.close(); } finally { await release?.(); await admin.app().delete(); }
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL("../artifacts/2026-10-22-october-renewal-audit.json", import.meta.url), JSON.stringify(report, null, 2), { mode: 0o600 });
}
