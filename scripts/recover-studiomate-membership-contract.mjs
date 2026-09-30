#!/usr/bin/env node
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets,
  readCompleteStudioMateContractHistory, readStudioMateTemplates, readStudioMateTemplateTerms,
} from "./lib/studiomate-native-contract-source.mjs";
import { selectNativeMembershipContractCandidate } from "./lib/studiomate-membership-contract-native-selection.mjs";
import { buildStudioMateJoinContractPayload, executeStudioMateMembershipContract, MEMBERSHIP_CONTRACT_TEMPLATES } from "./lib/studiomate-native-contract-writer.mjs";
import { firestoreJournal, persistStudioMateMembershipContractSource } from "./lib/studiomate-membership-contract-processor.mjs";
import { verifyStudioMateOfficialSeal } from "./lib/studiomate-membership-contract-seal.mjs";

// Explicit operator recovery only; never invoked by a scheduler or the Excel runner.
const args = process.argv.slice(2);
const allowed = new Set(["--member-id", "--phone", "--user-ticket-id", "--approval-reference", "--discovery-start-at"]);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--apply") { options.apply = true; continue; }
  if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid recovery arguments");
  options[args[i].slice(2)] = args[++i];
}
if (!/^[1-9]\d+$/.test(options["member-id"] || "") || !/^010\d{8}$/.test(options.phone || ""))
  throw new Error("Exact native member ID and phone required");
if (options.apply && (!/^[1-9]\d+$/.test(options["user-ticket-id"] || "") || !options["approval-reference"]))
  throw new Error("Apply requires exact issuance ID and operator approval reference");
const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "archive-pilates" });
const db = admin.firestore();
let context;
let release;
try {
  const config = (await db.doc("systemSettings/membershipContractAutomation").get()).data();
  if (config?.enabled !== true || config.mode !== "live" || config.studioId !== "5330" || !config.contractWriterEnabled ||
    !config.sourcePromoted || !config.nativeE2eVerified) throw new Error("Contract writer not enabled/promoted");
  const baseline = (await db.doc("workLanes/studiomate-membership-contract-automation/state/excelBaseline").get()).data();
  const discoveryStartAt = options["discovery-start-at"] || baseline?.downloadedAt;
  if (!Number.isFinite(Date.parse(discoveryStartAt)) || Date.parse(discoveryStartAt) < Date.parse(config.cutoverAt))
    throw new Error("Verified discovery start required after cutover");
  release = await acquireStudioMateBrowserLock({ owner: "membership-contract-approved-recovery", waitMs: 60000 });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(path.join(os.homedir(), "ArchiveIN/automation/browser-profile"), { headless: true });
  const page = context.pages()[0] || await context.newPage();
  const api = await captureStudioMateNativeApiClient(page, { ensureLoggedIn: (p) => ensureStudioMateLoggedIn(p, { headless: true }) });
  const memberRead = await readExactStudioMateMember(api, options.phone);
  const member = memberRead.member;
  if (memberRead.status !== "verified" || member?.memberId !== options["member-id"] || member.inactive)
    throw new Error("Native member identity mismatch");
  const ticketRead = await readStudioMateUserTickets(api, member.memberId);
  const history = await readCompleteStudioMateContractHistory(api, { phone: member.phone, startDate: config.contractHistoryStartDate || "2023-01-01" });
  if (ticketRead.status !== "verified" || history.status !== "verified") throw new Error("Native history incomplete");
  const current = new Date().toISOString();
  const recent = ticketRead.tickets.filter((t) => config.regularProductIds.map(String).includes(t.productId) &&
    Date.parse(t.issuedAt) > Date.parse(discoveryStartAt) &&
    Date.parse(current) - Date.parse(t.issuedAt) <= 7 * 86400000 && !t.refunded && !t.cancelled);
  console.log(JSON.stringify({ mode: options.apply ? "apply" : "dry-run", memberId: member.memberId,
    memberName: member.name, capturedAt: current, baseline: discoveryStartAt,
    tickets: recent.map((t) => ({ userTicketId: t.userTicketId, productId: t.productId, title: t.title,
      issuedAt: t.issuedAt, from: t.availabilityStartAt, until: t.expireAt, totalAmount: t.payment.totalAmount, status: t.status })),
    contracts: history.records.map((c) => ({ contractId: c.contractId, title: c.title, status: c.status })) }));
  if (options["user-ticket-id"]) {
    const matches = recent.filter((t) => t.userTicketId === options["user-ticket-id"]);
    if (matches.length !== 1) throw new Error("Approved issuance missing or not eligible for bounded recovery");
    const ticket = matches[0];
    // Preserve real current time; only this explicit member/issuance gets a bounded age exception.
    const selected = selectNativeMembershipContractCandidate({
      group: { phone: member.phone, rows: [{ 수강권명: ticket.title, 회원구분: member.memberGrade }] },
      member, ticketRead, contractHistory: history,
      previousDownloadedAt: discoveryStartAt, sourceDownloadedAt: current,
      config: { ...config, maxIssuanceAgeMs: 7 * 86400000 },
    });
    if (selected.status !== "eligible" || selected.selection.userTicketId !== ticket.userTicketId)
      throw new Error(`Recovery requires review: ${selected.reason}`);
    const existingJob = await db.collection("studiomateMembershipContractJobs").doc(selected.selection.jobKey).get();
    if (existingJob.exists) throw new Error("Existing job requires explicit outcome reconciliation; recovery will not resend");
    const templateRule = MEMBERSHIP_CONTRACT_TEMPLATES[selected.selection.action];
    const templates = await readStudioMateTemplates(api);
    if (!templates.some((t) => t.id === templateRule.id && t.title === templateRule.title)) throw new Error("Approved template missing");
    const loaded = await readStudioMateTemplateTerms(api, templateRule.id);
    await verifyStudioMateOfficialSeal();
    buildStudioMateJoinContractPayload({ selection: selected.selection, member, ticket,
      staff: { id: String(config.contractStaffId), name: config.contractStaffName }, template: loaded.template, terms: loaded.terms });
    console.log(JSON.stringify({ preflight: "eligible", memberId: member.memberId, userTicketId: ticket.userTicketId,
      action: selected.selection.action, jobKey: selected.selection.jobKey, officialSeal: "verified", existingJob: false }));
    if (options.apply) {
    const recoveryApproval = {
      reference: options["approval-reference"].slice(0, 500), memberId: member.memberId,
      userTicketId: ticket.userTicketId,
      originalMaxIssuanceAgeMs: Number.isSafeInteger(config.maxIssuanceAgeMs) ? config.maxIssuanceAgeMs : null,
      approvedRecoveryMaxAgeMs: 7 * 86400000, capturedAt: current, discoveryStartAt,
      reason: "operator_approved_coverage_loss_recovery",
    };
    const outcome = await executeStudioMateMembershipContract({ api, journal: firestoreJournal(db, recoveryApproval), selection: selected.selection,
      member, ticket, staff: { id: String(config.contractStaffId), name: config.contractStaffName },
      template: loaded.template, terms: loaded.terms });
    if (["waiting", "signed"].includes(outcome.status)) {
      await persistStudioMateMembershipContractSource({ db, contractId: outcome.contractId, member, ticket,
        selection: selected.selection, template: loaded.template });
    }
    console.log(JSON.stringify({ memberId: member.memberId, userTicketId: ticket.userTicketId, jobKey: selected.selection.jobKey, ...outcome }));
    if (!["waiting", "signed"].includes(outcome.status)) process.exitCode = 1;
    }
  }
} finally {
  try { await context?.close(); } finally { await release?.(); await admin.app().delete(); }
}
