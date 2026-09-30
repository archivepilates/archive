import { createHash } from "node:crypto";

export const CONTRACT_LANE = "studiomate-membership-contract-automation";
const BASELINE_VERSION = 1;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value) => String(value ?? "").trim();
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isUtcTime = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() ===
    (value.length === 20 ? value.replace("Z", ".000Z") : value);
const review = (reason) => ({
  ok: false,
  mode: "shadow",
  reason,
  candidates: 0,
  sends: 0,
});

function validBaseline(value) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== BASELINE_VERSION ||
    value.mode !== "shadow" ||
    !isUtcTime(value.downloadedAt) ||
    !isUtcTime(value.initializedAt) ||
    !isUtcTime(value.updatedAt) ||
    Date.parse(value.downloadedAt) > Date.parse(value.updatedAt) ||
    Date.parse(value.initializedAt) > Date.parse(value.updatedAt) ||
    typeof value.sourceImportId !== "string" ||
    !value.sourceImportId.trim() ||
    !isRecord(value.fingerprints) ||
    !isRecord(value.rowCounts)
  )
    return false;
  const ids = Object.keys(value.fingerprints);
  if (value.observedAtByMember !== undefined && (!isRecord(value.observedAtByMember) || Object.keys(value.observedAtByMember).length !== ids.length ||
    Object.entries(value.observedAtByMember).some(([id, at]) => !ids.includes(id) || !isUtcTime(at) ||
      Date.parse(at) > Date.parse(value.downloadedAt)))) return false;
  return (
    ids.length > 0 &&
    ids.length === Object.keys(value.rowCounts).length &&
    ids.every(
      (id) =>
        /^[a-f0-9]{64}$/.test(id) &&
        typeof value.fingerprints[id] === "string" &&
        /^[a-f0-9]{64}$/.test(value.fingerprints[id]) &&
        Number.isSafeInteger(value.rowCounts[id]) &&
        value.rowCounts[id] > 0,
    )
  );
}
const phoneOf = (value) => {
  let phone = text(value).replace(/\D/g, "");
  if (phone.startsWith("82")) phone = `0${phone.slice(2)}`;
  return /^01[016789]\d{7,8}$/.test(phone) ? phone : "";
};

// Excel is a discovery hint, never a native issuance identity or a send source.
export function contractObservationGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const phone = phoneOf(row["전화번호"]);
    const name = text(row["수강권명"]);
    if (!phone || !name) continue;
    const id = hash(phone);
    const group = groups.get(id) || { id, names: new Set(), hints: [] };
    group.names.add(text(row["이름"]));
    group.hints.push({
      productName: name,
      issuedAtText: text(row["수강권발급일"]),
      paymentAtText: text(row["결제일시"]),
      paymentAmountText: text(row["결제금액"]),
      paymentMethodText: text(row["결제방법"]),
      paymentTypeText: text(row["결제구분"]),
      availableFromText: text(row["수강권시작일"]),
      classType: text(row["수강권종류"]),
    });
    groups.set(id, group);
  }
  return [...groups.values()].map(({ id, names, hints }) => {
    // Preserve multiplicity; two identical rows must not collapse into one purchase.
    hints.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return {
      id,
      hints,
      fingerprint: hash(hints),
      ambiguousNames: names.size !== 1,
    };
  });
}

export function isFreshContractDiscoverySource(
  { sourceImportId, downloadedAt, applied, complete } = {},
  now = Date.now(),
) {
  const age = now - Date.parse(downloadedAt);
  return (
    applied === true &&
    complete === true &&
    typeof sourceImportId === "string" &&
    Boolean(sourceImportId.trim()) &&
    isUtcTime(downloadedAt) &&
    Number.isFinite(age) &&
    age >= 0 &&
    age <= 30 * 60_000
  );
}

export async function observeMembershipContractHints({
  db,
  rows,
  source,
  now = new Date().toISOString(),
}) {
  if (!isFreshContractDiscoverySource(source, Date.parse(now))) {
    return review("fresh_complete_applied_download_required");
  }
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    !rows.every(
      (row) =>
        row && Object.hasOwn(row, "전화번호") && Object.hasOwn(row, "수강권명"),
    )
  ) {
    return review("empty_or_invalid_export");
  }
  const groups = contractObservationGroups(rows);
  if (!groups.length) return review("empty_purchase_groups");
  const lane = db.collection("workLanes").doc(CONTRACT_LANE);
  const stateRef = lane.collection("state").doc("excelBaseline");
  const existing = await stateRef.get();
  const previous = existing.exists ? existing.data() : null;
  if (existing.exists && !validBaseline(previous))
    return review("invalid_baseline_explicit_recovery_required");
  if (
    previous &&
    Date.parse(previous.downloadedAt) >= Date.parse(source.downloadedAt)
  ) {
    return {
      ok: true,
      mode: "shadow",
      reason: "already_observed_or_older_download",
      candidates: 0,
      sends: 0,
    };
  }
  // Compact baseline stores only hashes, not duplicate member/profile/health records.
  const fingerprints = Object.fromEntries(
    groups.map((group) => [group.id, group.fingerprint]),
  );
  const rowCounts = Object.fromEntries(
    groups.map((group) => [group.id, group.hints.length]),
  );
  // Quarantine small coverage losses without blocking unrelated new members.
  // Keep affected baselines intact so a restored row never looks like a purchase.
  const coverageLossIds = previous ? Object.keys(previous.fingerprints).filter(
    (id) => !fingerprints[id] || rowCounts[id] < previous.rowCounts[id],
  ) : [];
  const priorRows = previous ? Object.values(previous.rowCounts).reduce((a, b) => a + b, 0) : 0;
  const lostRows = coverageLossIds.reduce((sum, id) =>
    sum + previous.rowCounts[id] - (rowCounts[id] || 0), 0);
  if (previous && (coverageLossIds.length / Object.keys(previous.fingerprints).length > 0.05 ||
    lostRows / priorRows > 0.05)) {
    return review("export_coverage_loss_explicit_review_required");
  }
  for (const id of coverageLossIds) {
    fingerprints[id] = previous.fingerprints[id];
    rowCounts[id] = previous.rowCounts[id];
  }
  const observedAtByMember = Object.fromEntries(Object.keys(fingerprints).map((id) => [id,
    coverageLossIds.includes(id) ? previous.observedAtByMember?.[id] || previous.downloadedAt : source.downloadedAt,
  ]));
  if (
    Buffer.byteLength(JSON.stringify({ fingerprints, rowCounts, observedAtByMember })) > 700_000
  ) {
    throw new Error(
      "Contract discovery baseline exceeds safe document size; no writes performed",
    );
  }
  const changes = previous
    ? groups.filter(
        (group) => !coverageLossIds.includes(group.id) &&
          previous.fingerprints?.[group.id] !== group.fingerprint,
      )
    : [];
  // One atomic batch prevents a baseline advance from losing its pending hints.
  if (changes.length > 450)
    throw new Error(
      "Unexpected mass purchase change; native review required before discovery",
    );
  const result = await db.runTransaction(async (tx) => {
    const latest = await tx.get(stateRef);
    if (hash(latest.exists ? latest.data() : null) !== hash(previous)) {
      throw new Error(
        "Concurrent membership contract discovery; retry with fresh source",
      );
    }
    const pending = changes.map((group) => ({
      group,
      ref: lane
        .collection("purchaseHints")
        .doc(hash([group.id, group.fingerprint])),
    }));
    const unseen = [];
    for (const candidate of pending) {
      if (!(await tx.get(candidate.ref)).exists) unseen.push(candidate);
    }
    for (const { group, ref } of unseen) {
      tx.set(ref, {
        phoneFingerprint: group.id,
        fingerprint: group.fingerprint,
        ambiguousNames: group.ambiguousNames,
        hints: group.hints,
        sourceImportId: source.sourceImportId,
        previousDownloadedAt: previous.observedAtByMember?.[group.id] || previous.downloadedAt,
        sourceDownloadedAt: source.downloadedAt,
        discoveredAt: now,
        status: "native_verification_required",
        allowedAction: "read_only_review",
        prohibitedActions: [
          "contract_send",
          "member_create",
          "ticket_issue",
          "payment",
          "reservation",
        ],
        reason:
          "Excel lacks native issuance/product IDs and complete native signature history",
      });
    }
    tx.set(stateRef, {
      schemaVersion: BASELINE_VERSION,
      fingerprints,
      rowCounts,
      observedAtByMember,
      downloadedAt: source.downloadedAt,
      sourceImportId: source.sourceImportId,
      initializedAt: previous?.initializedAt || now,
      updatedAt: now,
      mode: "shadow",
      coverageLossIds,
    });
    return unseen.map(({ group, ref }) => ({
      phoneFingerprint: group.id,
      hintId: ref.id,
      previousDownloadedAt: previous.observedAtByMember?.[group.id] || previous.downloadedAt,
    }));
  });
  return {
    ok: true,
    mode: "shadow",
    baseline: !previous,
    candidates: result.length,
    candidateFingerprints: result.map((item) => item.phoneFingerprint),
    candidateHints: result,
    previousDownloadedAt: previous?.downloadedAt || null,
    sourceDownloadedAt: source.downloadedAt,
    coverageLossIds,
    coverageReviewCount: coverageLossIds.length,
    sends: 0,
  };
}

// Raw phones are reconstructed only in the same import process and must not be
// persisted or logged. The durable discovery records contain fingerprints only.
export function resolveContractCandidateGroups(rows, fingerprints) {
  if (!Array.isArray(rows) || !Array.isArray(fingerprints)) return [];
  const wanted = new Set(fingerprints);
  const groups = new Map();
  for (const row of rows) {
    const phone = phoneOf(row?.["\uC804\uD654\uBC88\uD638"]);
    if (!phone) continue;
    const id = hash(phone);
    if (!wanted.has(id)) continue;
    const group = groups.get(id) || { phone, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  }
  return [...groups.entries()].map(([phoneFingerprint, value]) => ({
    phoneFingerprint,
    phone: value.phone,
    rows: value.rows,
  }));
}

// Observer failure is visible to health monitoring without failing a valid source import.
export function membershipContractDiscoveryWarning(importSummary) {
  if (
    !isRecord(importSummary) ||
    !Object.hasOwn(importSummary, "membershipContractDiscovery")
  )
    return null;
  const result = importSummary.membershipContractDiscovery;
  const processing = importSummary.membershipContractProcessing;
  const processingIssue = processing && (processing.status === "review" || processing.review > 0);
  const coverageIssue = result?.coverageReviewCount > 0;
  const pendingIssue = result?.invalidPendingCount > 0 || result?.pendingScanLimited === true;
  if (isRecord(result) && result.ok === true && !processingIssue && !coverageIssue && !pendingIssue) return null;
  return {
    name: "membershipContractDiscovery",
    command: [],
    exitCode: 0,
    stdout: { ...result, ok: false },
    stdoutOk: false,
    requiredFailed: false,
    stderr:
      (processingIssue ? text(processing.reason) || "membership_contract_processing_review" : "") ||
      (coverageIssue ? `member_coverage_review_${result.coverageReviewCount}` : "") ||
      (pendingIssue ? "pending_contract_hint_scan_review" : "") ||
      text(result?.reason) || "invalid membership contract discovery result",
  };
}
