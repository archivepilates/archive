#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { captureStudioMateNativeApiClient, readStudioMateContract, readStudioMateUserTickets } from "./lib/studiomate-native-contract-source.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
const read = async (name) => JSON.parse(await readFile(new URL(`../artifacts/${name}.json`, import.meta.url), "utf8"));
const test = await read("2026-10-22-renewal-test-apply");
const batch = await read("2026-10-22-renewal-recovery-apply");
const audit = await read("2026-10-22-october-renewal-audit");
assert(test.outcomes.length === 1 && batch.outcomes.length === 7 && [...test.outcomes, ...batch.outcomes].every((r) => r.status === "waiting"), "Expected completed requests missing");
admin.initializeApp({ projectId: "archive-pilates" });
const db = admin.firestore();
const result = { readOnly: true, checkedAt: new Date().toISOString(), records: [] };
let context, release;
try {
  release = await acquireStudioMateBrowserLock({ owner: "october-renewal-independent-readback", waitMs: 60000 });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(path.join(os.homedir(), "ArchiveIN/automation/browser-profile"), { headless: true });
  const page = context.pages()[0] || await context.newPage();
  const captured = await captureStudioMateNativeApiClient(page, { ensureLoggedIn: (p) => ensureStudioMateLoggedIn(p, { headless: true }) });
  const api = { get: captured.get };
  for (const [index, source] of [...test.outcomes, ...batch.outcomes].entries()) {
    const contract = await readStudioMateContract(api, source.contractId);
    const job = (await db.doc(`studiomateMembershipContractJobs/${source.jobKey}`).get()).data();
    const canonical = await db.doc(`studiomateMembershipContracts/${source.contractId}`).get();
    assert(contract?.verified && contract.memberId === source.memberId && contract.ticket.userTicketId === source.userTicketId && contract.centerSignaturePresent && ["sent", "signed"].includes(contract.status));
    assert(job?.stage === "signature_requested" && job.contractId === source.contractId && job.userTicketId === source.userTicketId && job.action === "renewal_purchase_confirmation");
    if (index === 0) {
      assert.equal(contract.title, "(테스트) 아카이브 재등록");
      assert(!canonical.exists, "Operator test must not enter welcome/reminder source");
      const raw = await api.get(`/v2/staff/contract/${source.contractId}`);
      assert(JSON.stringify(raw.field_values?.basic?.additional).includes("운영자 테스트 전용"), "Test disclaimer not retained");
    } else {
      assert.equal(contract.title, "아카이브 재등록");
      const stored = canonical.data();
      assert(stored?.binding?.contractAction === "renewal_purchase_confirmation" && stored.binding.selectionJobKey === source.jobKey && stored.selection.operatorRecoveryApproval.reference === "user_october_renewal_recovery_20261022");
      assert(!["ready", "queued", "accepted"].includes(stored.welcomeStatus), "Renewal must not queue welcome");
      const before = audit.members.find((m) => m.memberId === source.memberId).tickets.find((t) => t.id === source.userTicketId);
      const after = await readStudioMateUserTickets(api, source.memberId);
      const ticket = after.tickets.find((t) => t.userTicketId === source.userTicketId);
      assert(after.status === "verified" && ticket.status === before.status && ticket.availabilityStartAt === before.from && ticket.expireAt === before.until && ticket.payment.totalAmount === before.amount && !ticket.cancelled && !ticket.refunded, "Native pass changed unexpectedly");
    }
    const receipt = { memberId: source.memberId, userTicketId: source.userTicketId, contractId: source.contractId, nativeStatus: contract.status, memberSigned: contract.memberSignaturePresent, journalMatched: true, canonicalMatched: index > 0, verifiedAt: new Date().toISOString() };
    result.records.push(receipt);
    console.log(JSON.stringify(receipt));
  }
  assert(new Set(result.records.map((r) => r.contractId)).size === 8);
  result.ok = true;
} finally {
  try { await context?.close(); } finally { await release?.(); await admin.app().delete(); }
  result.finishedAt = new Date().toISOString();
  await writeFile(new URL("../artifacts/2026-10-22-renewal-independent-verification.json", import.meta.url), JSON.stringify(result, null, 2), { mode: 0o600 });
}
