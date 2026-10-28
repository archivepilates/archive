import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  SIGNATURE_RECOVERY_POLICY,
  approvedSignatureRecoveryEntry,
  signatureMaintenanceRecovery,
  signatureRecoverySelectionPolicy,
} from "./studiomate-membership-contract-maintenance-recovery.mjs";
import { loadPendingContractDiscovery } from "./studiomate-membership-contract-pending.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-28T03:00:00.000Z");
const SETTINGS = "systemSettings/membershipContractAutomation";
const ROOT = "workLanes/studiomate-membership-contract-automation/purchaseHints";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const iso = value => new Date(value).toISOString();

function fixture() {
  const phones = Array.from({ length: 5 }, (_, index) => `0109000000${index}`);
  const entries = phones.map((phone, index) => {
    const phoneFingerprint = hash(phone);
    const fingerprint = hash(["synthetic-purchase", index]);
    return {
      hintId: hash([phoneFingerprint, fingerprint]),
      phoneFingerprint,
      fingerprint,
      memberId: String(90001 + index),
      productName: ["사전등록 50회권", "20회(5개월)", "10주(주2회)"][index % 3],
      previousDownloadedAt: "2026-10-22T03:00:00.000Z",
      sourceDownloadedAt: iso(NOW - (5 - index) * HOUR),
    };
  });
  const config = {
    contractWriterEnabled: true,
    mode: "live",
    studioId: "5330",
    sourcePromoted: true,
    nativeE2eVerified: true,
    regularProductIds: ["80001", "80002", "80003"],
    maxIssuanceAgeMs: 2 * HOUR,
    signatureMaintenanceHold: {
      id: "synthetic-maintenance-hold",
      status: "resumed",
      requestedAt: "2026-10-22T03:00:00.000Z",
      autoResume: false,
      initialContractIds: Array.from({ length: 7 }, (_, index) => hash(["existing-contract", index])),
    },
    signatureMaintenanceRecovery: {
      policy: SIGNATURE_RECOVERY_POLICY,
      status: "approved",
      holdId: "synthetic-maintenance-hold",
      reference: "user_signature_resume_20261028",
      noticeUrl: "https://arcpilates.studiomate.kr/boards/studio-notice/224?page=1",
      approvedAt: iso(NOW - HOUR),
      expiresAt: iso(NOW + 23 * HOUR),
      entries,
    },
  };
  const entry = entries[0];
  return {
    config,
    hint: { ...entry, status: "native_verification_required" },
    member: { memberId: entry.memberId, phone: phones[0] },
    ticketRead: {
      status: "verified",
      tickets: [{
        userTicketId: "70001",
        productId: "80001",
        title: entry.productName,
        issuedAt: iso(Date.parse(entry.sourceDownloadedAt) - HOUR),
      }],
    },
    now: NOW,
  };
}

function blocked(input) {
  let result;
  assert.doesNotThrow(() => { result = signatureRecoverySelectionPolicy(input); });
  assert.ok(result === null, "Invalid recovery input must not yield a selection policy");
}

test("synthetic five-hint approval is immutable and grants only a local selection policy", () => {
  const input = fixture();
  const before = structuredClone(input);
  const approval = signatureMaintenanceRecovery(input.config, NOW);
  assert.equal(approval.entries.length, 5);
  assert.equal(approval.holdFrom, input.config.signatureMaintenanceHold.requestedAt);
  assert.equal(approval.approvalHash, hash(input.config.signatureMaintenanceRecovery));
  assert.equal(approvedSignatureRecoveryEntry(input.config, input.hint, NOW).entry.hintId, input.hint.hintId);
  const selected = signatureRecoverySelectionPolicy(input);
  assert.equal(selected.ticketId, "70001");
  assert.equal(selected.config.maxIssuanceAgeMs, 7 * DAY);
  assert.equal(selected.previousDownloadedAt, input.hint.previousDownloadedAt);
  assert.equal(selected.issuanceWindowEndAt, input.hint.sourceDownloadedAt);
  assert.equal(selected.approval.hintId, input.hint.hintId);
  assert.equal(selected.approval.memberId, input.member.memberId);
  assert.equal(selected.approval.userTicketId, selected.ticketId);
  assert.equal(selected.approval.approvalHash, approval.approvalHash);
  assert.notEqual(selected.config, input.config);
  assert.equal(input.config.maxIssuanceAgeMs, 2 * HOUR);
  assert.deepEqual(input, before);
});

const approvalMutations = [
  ["wrong policy", c => { c.signatureMaintenanceRecovery.policy = "other-policy"; }],
  ["wrong reference", c => { c.signatureMaintenanceRecovery.reference = "other-approval"; }],
  ["wrong notice", c => { c.signatureMaintenanceRecovery.noticeUrl = "https://example.invalid/224"; }],
  ["wrong hold", c => { c.signatureMaintenanceRecovery.holdId = "other-hold"; }],
  ["revoked approval", c => { c.signatureMaintenanceRecovery.status = "revoked"; }],
  ["paused hold", c => { c.signatureMaintenanceHold.status = "paused"; }],
  ["writer disabled", c => { c.contractWriterEnabled = false; }],
  ["wrong studio", c => { c.studioId = "9999"; }],
  ["shadow mode", c => { c.mode = "shadow"; }],
  ["unpromoted source", c => { c.sourcePromoted = false; }],
  ["unverified native flow", c => { c.nativeE2eVerified = false; }],
  ["future approval", c => { c.signatureMaintenanceRecovery.approvedAt = iso(NOW + 1); }],
  ["expired approval", c => { c.signatureMaintenanceRecovery.expiresAt = iso(NOW); }],
  ["over 24 hours", c => { c.signatureMaintenanceRecovery.expiresAt = iso(NOW + 23 * HOUR + 1); }],
  ["empty approval interval", c => { c.signatureMaintenanceRecovery.expiresAt = c.signatureMaintenanceRecovery.approvedAt; }],
  ["hold after approval", c => { c.signatureMaintenanceHold.requestedAt = iso(NOW); }],
  ["no entries", c => { c.signatureMaintenanceRecovery.entries = []; }],
  ["null entry", c => { c.signatureMaintenanceRecovery.entries[0] = null; }],
  ["more than five entries", c => { c.signatureMaintenanceRecovery.entries.push({ ...c.signatureMaintenanceRecovery.entries[0] }); }],
  ["duplicate hint", c => { c.signatureMaintenanceRecovery.entries[1] = { ...c.signatureMaintenanceRecovery.entries[0] }; }],
  ["duplicate native member", c => { c.signatureMaintenanceRecovery.entries[1].memberId = c.signatureMaintenanceRecovery.entries[0].memberId; }],
  ["duplicate phone fingerprint", c => {
    const [first, second] = c.signatureMaintenanceRecovery.entries;
    second.phoneFingerprint = first.phoneFingerprint;
    second.hintId = hash([second.phoneFingerprint, second.fingerprint]);
  }],
  ["invalid native member", c => { c.signatureMaintenanceRecovery.entries[0].memberId = "excel_90001"; }],
  ["tampered purchase fingerprint", c => { c.signatureMaintenanceRecovery.entries[0].fingerprint = hash("tampered"); }],
  ["unapproved product title", c => { c.signatureMaintenanceRecovery.entries[0].productName = "synthetic outdoor pass"; }],
  ["detection before hold", c => { c.signatureMaintenanceRecovery.entries[0].sourceDownloadedAt = iso(Date.parse(c.signatureMaintenanceHold.requestedAt) - 1); }],
  ["detection after approval", c => { c.signatureMaintenanceRecovery.entries[0].sourceDownloadedAt = iso(NOW); }],
  ["non-increasing hint interval", c => {
    const entry = c.signatureMaintenanceRecovery.entries[0];
    entry.previousDownloadedAt = entry.sourceDownloadedAt;
  }],
];

for (const [name, mutate] of approvalMutations) {
  test(`approval fails closed: ${name}`, () => {
    const input = fixture();
    mutate(input.config);
    assert.equal(signatureMaintenanceRecovery(input.config, NOW), null);
    blocked(input);
  });
}

const malformedDates = [undefined, null, 0, {}, [], "", "not-a-date", "2026-10-26", "2026-10-26T12:00:00", "2026-10-32T03:00:00.000Z"];
for (const field of ["approvedAt", "expiresAt", "requestedAt", "previousDownloadedAt", "sourceDownloadedAt"]) {
  test(`malformed ${field} is denied without throwing`, () => {
    for (const value of malformedDates) {
      const input = fixture();
      const target = field === "requestedAt" ? input.config.signatureMaintenanceHold
        : ["previousDownloadedAt", "sourceDownloadedAt"].includes(field)
          ? input.config.signatureMaintenanceRecovery.entries[0] : input.config.signatureMaintenanceRecovery;
      target[field] = value;
      assert.doesNotThrow(() => assert.equal(signatureMaintenanceRecovery(input.config, NOW), null));
      blocked(input);
    }
  });
}

test("approval time boundaries include approval and exclude expiry, without invalid-clock exceptions", () => {
  const { config } = fixture();
  const approval = config.signatureMaintenanceRecovery;
  assert.ok(signatureMaintenanceRecovery(config, Date.parse(approval.approvedAt)));
  assert.ok(signatureMaintenanceRecovery(config, Date.parse(approval.expiresAt) - 1));
  for (const now of [Date.parse(approval.approvedAt) - 1, Date.parse(approval.expiresAt), NaN, Infinity]) {
    assert.doesNotThrow(() => assert.equal(signatureMaintenanceRecovery(config, now), null));
  }
});

for (const [name, mutate] of [
  ["wrong hint ID", i => { i.hint.hintId = hash("unapproved-hint"); }],
  ["wrong phone fingerprint", i => { i.hint.phoneFingerprint = hash("unapproved-phone"); }],
  ["wrong hint previous boundary", i => { i.hint.previousDownloadedAt = iso(NOW - DAY); }],
  ["wrong member", i => { i.member.memberId = "99999"; }],
  ["wrong native phone", i => { i.member.phone = "01099999999"; }],
  ["unverified tickets", i => { i.ticketRead.status = "review"; }],
  ["wrong native product ID", i => { i.ticketRead.tickets[0].productId = "89999"; }],
  ["wrong native product title", i => { i.ticketRead.tickets[0].title = "synthetic outdoor pass"; }],
  ["no native issuance", i => { i.ticketRead.tickets = []; }],
  ["duplicate native issuance", i => { i.ticketRead.tickets.push({ ...i.ticketRead.tickets[0] }); }],
  ["multiple native issuances", i => { i.ticketRead.tickets.push({ ...i.ticketRead.tickets[0], userTicketId: "70002" }); }],
]) {
  test(`selection rejects ${name}`, () => {
    const input = fixture();
    mutate(input);
    blocked(input);
  });
}

test("malformed issuance dates are denied without throwing", async t => {
  for (const value of malformedDates) await t.test(String(JSON.stringify(value)), () => {
    const input = fixture();
    input.ticketRead.tickets[0].issuedAt = value;
    blocked(input);
  });
});

test("seven-day wall-time limit is inclusive, cannot be extended by quiet hours or detection time", () => {
  for (const [age, allowed] of [[7 * DAY - 1, true], [7 * DAY, true], [7 * DAY + 1, false]]) {
    const input = fixture();
    input.config.signatureMaintenanceHold.requestedAt = iso(NOW - 9 * DAY);
    const entry = input.config.signatureMaintenanceRecovery.entries[0];
    entry.previousDownloadedAt = iso(NOW - 8 * DAY);
    input.hint.previousDownloadedAt = entry.previousDownloadedAt;
    input.ticketRead.tickets[0].issuedAt = iso(NOW - age);
    const before = structuredClone(input.config);
    if (allowed) assert.ok(signatureRecoverySelectionPolicy(input));
    else blocked(input);
    assert.deepEqual(input.config, before);
  }
});

test("issuance must be within hold, after previous capture, and no later than detection or current clock", () => {
  for (const [boundary, offset, allowed] of [
    ["hold", -1, false], ["hold", 0, true],
    ["previous", 0, false], ["previous", 1, true],
    ["detection", 0, true], ["detection", 1, false],
    ["clock", 1, false], ["approval", 1, false],
  ]) {
    const input = fixture();
    const entry = input.config.signatureMaintenanceRecovery.entries[0];
    entry.previousDownloadedAt = iso(NOW - 5 * DAY);
    input.config.signatureMaintenanceHold.requestedAt = iso(NOW - 6 * DAY);
    if (boundary === "hold") entry.previousDownloadedAt = iso(NOW - 7 * DAY);
    input.hint.previousDownloadedAt = entry.previousDownloadedAt;
    const time = {
      hold: input.config.signatureMaintenanceHold.requestedAt,
      previous: entry.previousDownloadedAt,
      detection: entry.sourceDownloadedAt,
      clock: iso(NOW),
      approval: input.config.signatureMaintenanceRecovery.approvedAt,
    }[boundary];
    input.ticketRead.tickets[0].issuedAt = iso(Date.parse(time) + offset);
    if (allowed) assert.ok(signatureRecoverySelectionPolicy(input), `${boundary}:${offset}`);
    else blocked(input);
  }
});

// No Firebase SDK or browser: every read is an in-memory document lookup and
// any collection scan, transaction, or write is an immediate test failure.
function fakeDb(config) {
  const records = new Map([[SETTINGS, structuredClone(config)]]);
  for (let index = 0; index < 201; index++) {
    records.set(`${ROOT}/${hash(["unapproved-backlog", index])}`, {
      status: "native_verification_required", fingerprint: hash(["outdoor", index]),
    });
  }
  for (const entry of config.signatureMaintenanceRecovery.entries) {
    records.set(`${ROOT}/${entry.hintId}`, { ...structuredClone(entry), status: "native_verification_required" });
  }
  const reads = [];
  const failures = new Set();
  const forbidden = () => assert.fail("No fallback scan, canonical write, or transaction is permitted");
  const db = {
    doc: path => ({
      get: async () => {
        reads.push(path);
        if (failures.has(path)) throw new Error("synthetic_read_failure");
        return { exists: records.has(path), data: () => structuredClone(records.get(path)) };
      },
      set: forbidden, update: forbidden, delete: forbidden, create: forbidden,
    }),
    collection: forbidden, batch: forbidden, runTransaction: forbidden,
  };
  return { db, records, reads, failures };
}

function load(harness, overrides = {}) {
  return loadPendingContractDiscovery({
    db: harness.db,
    discovery: { ok: true, candidates: 1, candidateFingerprints: [hash("unapproved")], candidateHints: [{ hintId: hash("unapproved") }] },
    source: { sourceImportId: "synthetic-current-export", downloadedAt: iso(NOW - 60_000), applied: true, complete: true },
    now: NOW,
    ...overrides,
  });
}

test("pending reads settings and only five exact approved hints across 201 unrelated pending hints", async () => {
  const { config } = fixture();
  const harness = fakeDb(config);
  const before = structuredClone([...harness.records]);
  const result = await load(harness);
  assert.equal(result.candidates, 5);
  assert.deepEqual(result.candidateHints.map(row => row.hintId), config.signatureMaintenanceRecovery.entries.map(row => row.hintId));
  assert.deepEqual(harness.reads, [SETTINGS, ...config.signatureMaintenanceRecovery.entries.map(row => `${ROOT}/${row.hintId}`)]);
  assert.deepEqual([...harness.records], before);
});

for (const field of ["phoneFingerprint", "fingerprint", "previousDownloadedAt", "sourceDownloadedAt"]) {
  test(`tampered approved hint ${field} discards all selected work without fallback or writes`, async () => {
    const { config } = fixture();
    const harness = fakeDb(config);
    const path = `${ROOT}/${config.signatureMaintenanceRecovery.entries[2].hintId}`;
    harness.records.get(path)[field] = field.includes("At") ? iso(NOW - DAY) : hash("tampered");
    const before = structuredClone([...harness.records]);
    const result = await load(harness);
    assert.equal(result.candidates, 0);
    assert.deepEqual(result.candidateHints, []);
    assert.deepEqual(result.candidateFingerprints, []);
    assert.deepEqual([...harness.records], before);
  });
}

test("missing approved hint and coverage hold fail closed without fallback", async t => {
  for (const missing of [true, false]) await t.test(missing ? "missing" : "coverage-held", async () => {
    const { config } = fixture();
    const harness = fakeDb(config);
    const entry = config.signatureMaintenanceRecovery.entries[2];
    if (missing) harness.records.delete(`${ROOT}/${entry.hintId}`);
    const before = structuredClone([...harness.records]);
    const result = await load(harness, missing ? {} : { discovery: { ok: true, coverageLossIds: [entry.phoneFingerprint] } });
    assert.equal(result.candidates, 0);
    assert.deepEqual(result.candidateHints, []);
    assert.deepEqual([...harness.records], before);
  });
});

test("failed settings or exact-hint reads abort without a fallback or canonical writes", async t => {
  for (const target of ["settings", "hint"]) await t.test(target, async () => {
    const { config } = fixture();
    const harness = fakeDb(config);
    harness.failures.add(target === "settings" ? SETTINGS : `${ROOT}/${config.signatureMaintenanceRecovery.entries[2].hintId}`);
    const before = structuredClone([...harness.records]);
    await assert.rejects(load(harness), /synthetic_read_failure/);
    assert.deepEqual([...harness.records], before);
  });
});

for (const [name, mutate] of approvalMutations.filter(([name]) => ["expired approval", "revoked approval", "over 24 hours", "wrong reference"].includes(name))) {
  test(`pending cannot fall back when recovery approval is ${name}`, async () => {
    const { config } = fixture();
    mutate(config);
    const harness = fakeDb(config);
    const before = structuredClone([...harness.records]);
    const result = await load(harness);
    assert.equal(result.candidates, 0);
    assert.deepEqual(result.candidateHints, []);
    assert.deepEqual(harness.reads, [SETTINGS]);
    assert.deepEqual([...harness.records], before);
  });
}

test("processed approved hints are not reset or replaced, and a repeat selects zero", async () => {
  const { config } = fixture();
  const harness = fakeDb(config);
  const initial = await load(harness);
  for (const { hintId } of initial.candidateHints) harness.records.get(`${ROOT}/${hintId}`).status = "processed";
  const before = structuredClone([...harness.records]);
  harness.reads.length = 0;
  const repeated = await load(harness);
  assert.equal(repeated.candidates, 0);
  assert.deepEqual(repeated.candidateHints, []);
  assert.deepEqual(repeated.candidateFingerprints, []);
  assert.equal(harness.reads.length, 6);
  assert.deepEqual([...harness.records], before);
});
