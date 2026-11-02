import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CONTRACT_LANE,
  contractObservationGroups,
  observeMembershipContractHints,
} from "../lib/studiomate-membership-contract-observer.mjs";
import { contractHintRowCounts } from "../lib/studiomate-contract-coverage-reconciliation.mjs";
import { selectNativeMembershipContractCandidate } from "../lib/studiomate-membership-contract-native-selection.mjs";
import { membershipContractJobKey } from "../lib/studiomate-membership-contract-policy.mjs";

const NAME = "\uC774\uB984";
const PHONE = "\uC804\uD654\uBC88\uD638";
const TICKET = "\uC218\uAC15\uAD8C\uBA85";
const GRADE = "\uB4F1\uAE09";
const REGISTERED = "\uB4F1\uB85D\uC77C";
const BASELINE_AT = "2026-11-17T00:00:00.000Z";
const TICKETLESS_AT = "2026-11-18T00:00:00.000Z";
const ISSUED_AT = "2026-11-20T00:30:00.000Z";
const ISSUED_EXPORT_AT = "2026-11-20T01:00:00.000Z";
const REPEAT_AT = "2026-11-20T01:05:00.000Z";
const STATE = `workLanes/${CONTRACT_LANE}/state/excelBaseline`;
const HINT_ROOT = `workLanes/${CONTRACT_LANE}/purchaseHints/`;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const row = (phone, ticketName = "") => ({
  [NAME]: "Synthetic Member",
  [PHONE]: phone,
  [TICKET]: ticketName,
  [GRADE]: "",
  [REGISTERED]: "2026-11-17",
});
const ticketless = () => row("01000000001");
const issuedRow = () => row("01000000001", "Synthetic Regular");
const existingRow = () => row("01000000002", "Synthetic Existing");
const counts = (rows) => contractHintRowCounts(contractObservationGroups(rows)[0]?.hints || []);

function fakeDb() {
  const records = new Map();
  const ref = (key) => ({
    key,
    id: key.split("/").at(-1),
    collection: (name) => ({ doc: (id) => ref(`${key}/${name}/${id}`) }),
    get: async () => ({
      exists: records.has(key),
      data: () => structuredClone(records.get(key)),
    }),
  });
  return {
    records,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    runTransaction: async (fn) => {
      const pending = [];
      const result = await fn({
        get: (target) => target.get(),
        set: (target, data) => pending.push([target.key, structuredClone(data)]),
      });
      for (const [key, data] of pending) records.set(key, data);
      return result;
    },
  };
}

async function observe(db, rows, downloadedAt) {
  return observeMembershipContractHints({
    db,
    rows,
    source: {
      sourceImportId: `synthetic-import-${downloadedAt}`,
      downloadedAt,
      complete: true,
      applied: true,
    },
    now: new Date(Date.parse(downloadedAt) + 60_000).toISOString(),
  });
}

function nativeInput(rows = [issuedRow()]) {
  return {
    group: { phone: "01000000001", rows },
    member: {
      memberId: "100",
      phone: "01000000001",
      registeredAt: BASELINE_AT,
    },
    ticketRead: {
      status: "verified",
      tickets: [{
        memberId: "100",
        userTicketId: "200",
        productId: "300",
        title: "Synthetic Regular",
        issuedAt: ISSUED_AT,
        status: "active",
        refunded: false,
        cancelled: false,
        payment: {
          verified: true,
          complete: true,
          status: "paid",
          totalAmount: 100000,
          paidAmount: 100000,
          outstandingAmount: 0,
          refundedAmount: 0,
          transactions: [{
            paymentId: "synthetic-payment",
            method: "card",
            status: "paid",
            amount: 100000,
            paidAt: ISSUED_AT,
          }],
        },
      }],
    },
    contractHistory: { status: "verified", records: [] },
    previousDownloadedAt: TICKETLESS_AT,
    sourceDownloadedAt: ISSUED_EXPORT_AT,
    config: {
      studioId: "5330",
      regularProductIds: ["300"],
      termsVersion: "synthetic-v1",
      cutoverAt: "2026-11-01T00:00:00.000Z",
      maxSourceAgeMs: 3600000,
      maxIssuanceAgeMs: 3600000,
    },
  };
}

function assertDiscovery(result, candidates) {
  assert.equal(result.ok, true);
  assert.equal(result.mode, "shadow");
  assert.equal(result.candidates, candidates);
  assert.equal(result.sends, 0);
  assert.deepEqual(result.coverageLossIds, []);
}

// Model an already reviewed baseline; never run a production reconciliation writer.
function reviewedCoverage(db, originalRows, currentRows) {
  const baseline = db.records.get(STATE);
  const [original] = contractObservationGroups(originalRows);
  const [current] = contractObservationGroups(currentRows);
  baseline.coverageReconciliations = {
    [original.id]: {
      schemaVersion: 1,
      reviewId: digest(["synthetic-review", original.id]),
      reviewedAt: BASELINE_AT,
      originalObservedAt: BASELINE_AT,
      historicalRows: counts(originalRows),
      minimumRows: counts(currentRows),
      lastRows: counts(currentRows),
    },
  };
  if (current) {
    baseline.fingerprints[original.id] = current.fingerprint;
    baseline.rowCounts[original.id] = current.hints.length;
  } else {
    delete baseline.fingerprints[original.id];
    delete baseline.rowCounts[original.id];
    delete baseline.observedAtByMember[original.id];
  }
  return original.id;
}

test("established baseline: ticketless repeats, issuance days later and repeats give 0/1/0 hints", async () => {
  const db = fakeDb();
  const initial = await observe(db, [existingRow(), ticketless()], BASELINE_AT);
  assertDiscovery(initial, 0);
  assert.equal(initial.baseline, true);
  assert.deepEqual(contractObservationGroups([ticketless()]), []);
  const repeatedTicketless = await observe(db, [existingRow(), ticketless()], TICKETLESS_AT);
  assertDiscovery(repeatedTicketless, 0);
  const issued = await observe(db, [existingRow(), issuedRow()], ISSUED_EXPORT_AT);
  assertDiscovery(issued, 1);
  assert.equal(issued.candidateHints[0].previousDownloadedAt, TICKETLESS_AT);
  const hintPath = `${HINT_ROOT}${issued.candidateHints[0].hintId}`;
  const hint = structuredClone(db.records.get(hintPath));
  assert.equal(hint.allowedAction, "read_only_review");
  assert.equal(hint.status, "native_verification_required");
  assert.ok(hint.prohibitedActions.includes("contract_send"));
  const repeated = await observe(db, [existingRow(), issuedRow()], REPEAT_AT);
  assertDiscovery(repeated, 0);
  assert.deepEqual(db.records.get(hintPath), hint);
  assert.equal([...db.records.keys()].filter((key) => key.startsWith(HINT_ROOT)).length, 1);
  assert.equal(db.records.get(STATE).initializedAt, new Date(Date.parse(BASELINE_AT) + 60_000).toISOString());
});

test("native selection needs an issuance, not registration age, and retains the canonical job key", () => {
  const empty = nativeInput([ticketless()]);
  empty.ticketRead.tickets = [];
  const noTicket = selectNativeMembershipContractCandidate(empty);
  assert.equal(noTicket.status, "ignored");
  assert.equal(noTicket.reason, "no_fresh_native_issuance");
  assert.equal(noTicket.selection, null);
  const input = nativeInput();
  input.member.registeredAt = "2026-10-01T00:00:00.000Z";
  const selected = selectNativeMembershipContractCandidate(input);
  assert.equal(selected.status, "eligible");
  assert.equal(selected.selection.action, "first_purchase_contract");
  assert.deepEqual(selected.selection.history.previousIssuanceIds, []);
  assert.equal(selected.selection.jobKey, membershipContractJobKey("100", "200"));
  const repeat = selectNativeMembershipContractCandidate({ ...input, previousDownloadedAt: ISSUED_EXPORT_AT, sourceDownloadedAt: REPEAT_AT });
  assert.equal(repeat.reason, "no_fresh_native_issuance");
  assert.equal(repeat.selection, null);
});

test("outdoor, trial and one-off issuances remain excluded even with allowlisted product IDs", () => {
  for (const title of ["OUTDOOR class", "\uCCB4\uD5D8\uAD8C", "\uADF8\uB8F9 1\uD68C\uAD8C"]) {
    const input = nativeInput();
    input.ticketRead.tickets[0].title = title;
    const result = selectNativeMembershipContractCandidate(input);
    assert.equal(result.status, "ignored", title);
    assert.equal(result.selection, null, title);
  }
});

test("instructor, staff, trial and consultation grades remain excluded after later issuance", () => {
  for (const grade of ["\uAC15\uC0AC\uD68C\uC6D0", "\uC9C1\uC6D0", "\uCCB4\uD5D8\uD68C\uC6D0", "\uC0C1\uB2F4\uD68C\uC6D0"]) {
    const input = nativeInput([{ ...issuedRow(), [GRADE]: grade }]);
    const result = selectNativeMembershipContractCandidate(input);
    assert.equal(result.status, "excluded", grade);
    assert.equal(result.selection, null, grade);
  }
});

test("refunded and cancelled later issuances cannot become contract selections", () => {
  for (const field of ["refunded", "cancelled"]) {
    const input = nativeInput();
    input.ticketRead.tickets[0][field] = true;
    const result = selectNativeMembershipContractCandidate(input);
    assert.equal(result.status, "review", field);
    assert.equal(result.reason, "refunded_or_cancelled", field);
    assert.equal(result.selection, null, field);
  }
});

test("ticketless and later issuance observations retain unrelated coverage review metadata and bounds", async () => {
  const db = fakeDb();
  const kept = existingRow();
  const historical = { ...kept, [TICKET]: "Synthetic Historical" };
  await observe(db, [kept, historical, historical, ticketless()], BASELINE_AT);
  const id = reviewedCoverage(db, [kept, historical, historical], [kept]);
  const before = structuredClone(db.records.get(STATE));
  for (const [at, member, expected] of [
    [TICKETLESS_AT, ticketless(), 0],
    [ISSUED_EXPORT_AT, issuedRow(), 1],
    [REPEAT_AT, issuedRow(), 0],
  ]) {
    assertDiscovery(await observe(db, [kept, member], at), expected);
    const state = db.records.get(STATE);
    assert.deepEqual(state.coverageReconciliations, before.coverageReconciliations);
    assert.equal(state.observedAtByMember[id], before.observedAtByMember[id]);
    assert.equal(state.fingerprints[id], before.fingerprints[id]);
    assert.equal(state.rowCounts[id], before.rowCounts[id]);
  }
  const historicalCount = Object.values(before.coverageReconciliations[id].historicalRows).sort();
  assert.deepEqual(historicalCount, [1, 2]);
});

test("reviewed ticketless member later issues once without losing original coverage evidence", async () => {
  const db = fakeDb();
  const historical = { ...ticketless(), [TICKET]: "Synthetic Historical" };
  await observe(db, [existingRow(), historical], BASELINE_AT);
  const id = reviewedCoverage(db, [historical], []);
  const before = structuredClone(db.records.get(STATE).coverageReconciliations[id]);
  assertDiscovery(await observe(db, [existingRow(), ticketless()], TICKETLESS_AT), 0);
  assert.deepEqual(db.records.get(STATE).coverageReconciliations[id], before);
  const issued = await observe(db, [existingRow(), issuedRow()], ISSUED_EXPORT_AT);
  assertDiscovery(issued, 1);
  assert.equal(issued.candidateHints[0].previousDownloadedAt, BASELINE_AT);
  assert.deepEqual(db.records.get(STATE).coverageReconciliations[id], {
    ...before,
    lastRows: counts([issuedRow()]),
  });
  const afterIssuance = structuredClone(db.records.get(STATE).coverageReconciliations[id]);
  assertDiscovery(await observe(db, [existingRow(), issuedRow()], REPEAT_AT), 0);
  assert.deepEqual(db.records.get(STATE).coverageReconciliations[id], afterIssuance);
});

test("historical bootstrap intentionally remains no-send, including ticketless-only first exports", async () => {
  const db = fakeDb();
  const empty = await observe(db, [ticketless()], BASELINE_AT);
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, "empty_purchase_groups");
  assert.equal(empty.candidates, 0);
  assert.equal(empty.sends, 0);
  assert.equal(db.records.size, 0);
  const bootstrap = await observe(db, [issuedRow()], ISSUED_EXPORT_AT);
  assertDiscovery(bootstrap, 0);
  assert.equal(bootstrap.baseline, true);
  assert.equal(db.records.size, 1);
  assertDiscovery(await observe(db, [issuedRow()], REPEAT_AT), 0);
  assert.equal(db.records.size, 1);
});
