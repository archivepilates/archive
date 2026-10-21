#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets, readCompleteStudioMateContractHistory, readStudioMateTemplateTerms, readStudioMateContract, normalizePayments } from "./lib/studiomate-native-contract-source.mjs";
import { selectNativeMembershipContractCandidate } from "./lib/studiomate-membership-contract-native-selection.mjs";
import { buildStudioMateJoinContractPayload, executeStudioMateMembershipContract } from "./lib/studiomate-native-contract-writer.mjs";
import { firestoreJournal, persistStudioMateMembershipContractSource } from "./lib/studiomate-membership-contract-processor.mjs";
import { verifyStudioMateOfficialSeal } from "./lib/studiomate-membership-contract-seal.mjs";

// Explicit operator-only recovery. This command is not a scheduler entry point.
const args = process.argv.slice(2);
assert(args.every((a) => ["--test", "--apply"].includes(a)), "Unknown recovery option");
const testOnly = args.includes("--test"), apply = args.includes("--apply");
if (apply && !testOnly) {
  const hourKst = new Date(Date.now() + 9 * 3600000).getUTCHours();
  assert(hourKst >= 9, "Operator instructed genuine recovery sends only after 09:00 KST");
}
const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
const XLSX = require("xlsx");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const testKey = `membership_contract_${sha256(JSON.stringify(["studiomate-renewal-operator-test-v1", "1982133", "10277817", "20261022"]))}`;
const exportFile = path.join(os.homedir(), "ArchiveIN/emergency/archive/member/2026-10-22/회원목록_20261022_0134-ed4236829cd8.xlsx");
const bytes = await readFile(exportFile);
const sourceSha256 = sha256(bytes);
assert.equal(sourceSha256, "ed4236829cd869f1da0e3627a31ec846ab4c22ffc767ab8a95ee2cdced56e64a");
const book = XLSX.read(bytes, { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false });
const audit = JSON.parse(await readFile(new URL("../artifacts/2026-10-22-october-renewal-audit.json", import.meta.url), "utf8"));
assert(audit.readOnly && audit.sourceSha256 === sourceSha256 && audit.members.length === audit.octoberMembers && audit.members.every((m) => m.verified), "Complete source audit required");
assert(Date.now() - Date.parse(audit.finishedAt) < 2 * 3600000 && Date.parse(audit.finishedAt) <= Date.now(), "Audit expired");
const output = { mode: testOnly ? "operator_test" : "october_renewal", apply, sourceSha256, startedAt: new Date().toISOString(), outcomes: [] };
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
const outputPath = new URL(`../artifacts/2026-10-22-renewal-${testOnly ? "test" : "recovery"}-${apply ? "apply" : "preflight"}.json`, import.meta.url);
admin.initializeApp({ projectId: "archive-pilates" });
const db = admin.firestore();
let context, release;
try {
  const config = (await db.doc("systemSettings/membershipContractAutomation").get()).data();
  assert(config?.enabled && config.mode === "live" && config.studioId === "5330" && config.contractWriterEnabled && config.sourcePromoted && config.nativeE2eVerified, "Writer disabled");
  if (!testOnly && apply) {
    const testJob = (await db.doc(`studiomateMembershipContractJobs/${testKey}`).get()).data();
    assert(testJob?.stage === "signature_requested" && testJob?.contractId && testJob.recoveryApproval?.reference === "user_october_renewal_test_20261022", "Successful single test required first");
  }
  release = await acquireStudioMateBrowserLock({ owner: "october-renewal-approved-recovery", waitMs: 60000 });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(path.join(os.homedir(), "ArchiveIN/automation/browser-profile"), { headless: true });
  const page = context.pages()[0] || await context.newPage();
  const api = await captureStudioMateNativeApiClient(page, { ensureLoggedIn: (p) => ensureStudioMateLoggedIn(p, { headless: true }) });
  const loaded = await readStudioMateTemplateTerms(api, "1341");
  await verifyStudioMateOfficialSeal();
  let targets;
  if (testOnly) {
    const profile = (await db.doc("memberProfiles/1982133").get()).data();
    assert(profile?.name === "김기효" && /^010\d{8}$/.test(profile.phone) && profile.phone.endsWith("8585"), "Test profile mismatch");
    targets = [{ memberId: "1982133", ticketId: "10277817", phone: profile.phone, name: profile.name, rows: [] }];
  } else {
    targets = audit.members.flatMap((m) => m.decisions.filter((d) => d.status === "eligible").map((d) => {
      const matching = rows.filter((r) => sha256(String(r["전화번호"]).replace(/\D/g, "")) === m.phoneFingerprint);
      assert(matching.length > 0);
      return { memberId: m.memberId, name: m.name, ticketId: d.ticketId, phone: String(matching[0]["전화번호"]).replace(/\D/g, ""), rows: matching };
    }));
    assert(targets.length > 0 && targets.length <= 20 && new Set(targets.map((t) => `${t.memberId}:${t.ticketId}`)).size === targets.length, "Unexpected recovery target count");
  }
  for (const target of targets) {
    const result = { memberId: target.memberId, name: target.name, userTicketId: target.ticketId, checkedAt: new Date().toISOString() };
    try {
      const mr = await readExactStudioMateMember(api, target.phone);
      assert(mr.status === "verified" && mr.member.memberId === target.memberId && mr.member.name === target.name && !mr.member.inactive, "Native member mismatch");
      const member = mr.member;
      const ticketRead = await readStudioMateUserTickets(api, member.memberId);
      const history = await readCompleteStudioMateContractHistory(api, { phone: member.phone, startDate: config.contractHistoryStartDate || "2023-01-01" });
      assert(ticketRead.status === "verified" && history.status === "verified", "Native history incomplete");
      let ticket = ticketRead.tickets.find((t) => t.userTicketId === target.ticketId);
      assert(ticket && member.gender && member.birthday, "Missing native ticket or required member fields");
      if (testOnly && ticket.payment.reason === "invalid_payment_total") {
        const raw = await api.get("/v2/staff/userTickets?is_all=1&member_id=1982133");
        const nativeRows = Array.isArray(raw) ? raw : raw.data;
        assert(Array.isArray(nativeRows), "Native test ticket response invalid");
        const matched = nativeRows.filter((r) => String(r.id) === "10277817" && String(r.member?.id) === "1982133" && String(r.studio_id) === "5330");
        assert.equal(matched.length, 1, "Exact test zero-payment source missing");
        const payment = normalizePayments(matched[0].payments, { allowZero: true });
        assert(payment.verified && payment.complete && payment.totalAmount === 0, "Test zero-payment ledger not verified");
        ticket = { ...ticket, payment };
      }
      const now = new Date().toISOString();
      let selection, approval, operatorTestApproval;
      if (testOnly) {
        approval = { reference: "user_october_renewal_test_20261022", studioId: "5330", memberId: "1982133", userTicketId: "10277817", productId: "191164", action: "renewal_purchase_confirmation", jobKey: testKey };
        operatorTestApproval = approval;
        selection = { schemaVersion: 1, source: "studiomate_native_operator_test", verified: true, now, ...approval, memberPhone: member.phone, signExpirationDays: 7 };
        assert(!history.records.some((c) => c.title === "(테스트) 아카이브 재등록"), "Test contract already exists; do not resend");
      } else {
        approval = { reference: "user_october_renewal_recovery_20261022", memberId: member.memberId, userTicketId: ticket.userTicketId, sourceSha256, sourceComplete: true };
        const selected = selectNativeMembershipContractCandidate({ group: target, member, ticketRead, contractHistory: history, sourceDownloadedAt: now, config, recoveryApproval: approval });
        assert(selected.status === "eligible" && selected.selection.action === "renewal_purchase_confirmation", `Pre-send review: ${selected.reason}`);
        selection = selected.selection;
        // Older manual contracts can lack a native issuance binding. Exact purchase
        // fields are not sufficient proof of another independent consent request.
        assert(!history.records.some((c) => !c.ticket?.userTicketId && c.categoryId === 1 && c.ticket?.productId === ticket.productId && c.ticket?.availabilityStartAt === ticket.availabilityStartAt && c.ticket?.expireAt === ticket.expireAt), "Unbound same-purchase contract requires review");
      }
      const jobs = await db.collection("studiomateMembershipContractJobs").where("memberId", "==", member.memberId).limit(100).get();
      assert(jobs.size < 100 && !jobs.docs.some((d) => d.id === selection.jobKey || (!testOnly && d.data().userTicketId === ticket.userTicketId)), "Existing job: reconcile without replay");
      const input = { selection, member, ticket, staff: { id: String(config.contractStaffId), name: config.contractStaffName }, template: loaded.template, terms: loaded.terms, ...(operatorTestApproval ? { operatorTestApproval } : {}) };
      buildStudioMateJoinContractPayload(input);
      Object.assign(result, { status: "preflight", jobKey: selection.jobKey, action: selection.action });
      if (apply) {
        const outcome = await executeStudioMateMembershipContract({ ...input, api, journal: firestoreJournal(db, { ...approval, approvedAt: now, sourceSha256 }) });
        Object.assign(result, outcome);
        assert(["waiting", "signed"].includes(outcome.status), `Native write held: ${outcome.reason}`);
        const detail = await readStudioMateContract(api, outcome.contractId);
        assert(detail?.verified && detail.contractId === outcome.contractId && detail.memberId === member.memberId && detail.centerSignaturePresent && ["sent", "signed"].includes(detail.status), "Post-send native verification failed");
        result.providerStatus = detail.providerStatus;
        result.memberSignaturePresent = detail.memberSignaturePresent;
        result.verifiedAt = new Date().toISOString();
        if (!testOnly) await persistStudioMateMembershipContractSource({ db, contractId: outcome.contractId, member, ticket, selection, template: loaded.template });
        await db.doc(`workLanes/october-renewal-recovery/reports/${selection.jobKey}`).set({ ...result, sourceSha256, operatorTest: testOnly, updatedAt: new Date() });
      }
    } catch (error) { result.status = "review"; result.reason = String(error.message).replace(/010[\d-]{8,}/g, "[redacted]"); }
    output.outcomes.push(result);
    await writeFile(outputPath, JSON.stringify(output, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result));
    if (result.status === "review") { process.exitCode = 1; break; }
  }
} finally {
  try { await context?.close(); } finally { await release?.(); await admin.app().delete(); }
  output.finishedAt = new Date().toISOString();
  await writeFile(outputPath, JSON.stringify(output, null, 2), { mode: 0o600 });
}
