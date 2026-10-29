import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, lstat, realpath, open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { completionOnlySignupProfileV2 } from "./lib/instructor-signup-profile-v2.mjs";
import { assertSignupEnrichmentSubset, buildSignupEnrichmentPlan } from "./lib/instructor-signup-enrichment-queue.mjs";
import { validateSourceInventory, selectLatestCompleted } from "./read-instructor-signup-enrichment-sources.mjs";
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE,
  normalizeInstructorLessonName as name, normalizeInstructorLessonPhone as phone } from "./lib/instructor-lesson-registration-contract.mjs";

export const SUBSET_PARENT = "/Users/archivepilates/ArchiveIN/operations/instructor-signup-enrichment-20261030/sources-1793289967373-16a8e894-caed-4330-960b-dbbac5dc1ba1.json";
const DIRECTORY = path.dirname(SUBSET_PARENT);
const sha = raw => createHash("sha256").update(raw).digest("hex");
const nativeId = value => typeof value === "string" && /^[1-9]\d*$/.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const instant = value => {
  assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), "Actual evidence timestamp required");
  return Date.parse(value);
};
const ids = rows => rows.map(row => row.documentId).sort();
const equalIds = (left, right) => isDeepStrictEqual(ids(left), ids(right));

function unique(rows, field = "documentId") {
  assert(Array.isArray(rows) && new Set(rows.map(row => row[field])).size === rows.length, "Duplicate source identity");
  return new Map(rows.map(row => [row[field], row]));
}

function memberShape(member) {
  return { memberId: member.memberId, name: member.memberName, phone: member.memberPhone,
    memberGrade: member.memberGrade, inactive: member.inactive };
}

function validateMemberJoin(doc, member) {
  const job = member.job, completion = doc.completionProof;
  assert(member.documentId === doc.documentId && nativeId(member.memberId)
    && member.memberName === name(member.memberName) && member.memberPhone === phone(member.memberPhone)
    && /^010\d{8}$/.test(member.memberPhone) && member.memberGrade === "강사회원" && member.inactive === false,
  "Exact active native instructor required");
  assert(job?.studioId === "5330" && job.studiomateMemberId === member.memberId
    && job.memberName === member.memberName && job.memberPhone === member.memberPhone
    && job.documentId === doc.documentId && job.documentName === doc.title && job.baselineOnly === true
    && job.status === "done" && job.source === "completed_signup_profile_baseline_v2"
    && job.sendAllowed === false && job.registrationId === "", "Canonical native source job mismatch");
  assert(completion?.documentId === doc.documentId && completion.selectedDocumentId === doc.documentId
    && completion.templateId === TEMPLATE && completion.status === "completed" && completion.recipients?.length === 1
    && name(completion.recipients[0].name) === member.memberName
    && phone(completion.recipients[0].phone) === member.memberPhone, "Actual completed recipient mismatch");
  assert(instant(completion.providerCompletedAt) <= instant(completion.observedAt)
    && instant(completion.observedAt) <= instant(member.checkedAt), "Actual source chronology mismatch");
}

export function buildSubsetRow(doc, member, original) {
  validateMemberJoin(doc, member);
  let row;
  if (original) {
    assert(original.profile?.version === 2 && original.profile.mode == null
      && original.documentId === doc.documentId && original.documentName === doc.title
      && isDeepStrictEqual(original.member, memberShape(member)) && original.nativeCheckedAt === member.checkedAt
      && original.eligibleForBaseline === false && original.statusResponseHash && digest(original.statusResponseHash),
    "Verified signed-field row must remain unchanged");
    assert(original.completionProof.providerCompletedAt === doc.completionProof.providerCompletedAt
      && isDeepStrictEqual(original.completionProof.recipients, doc.completionProof.recipients), "Verified completion proof changed");
    row = structuredClone(original);
  } else {
    row = { status: "verified", documentId: doc.documentId, documentName: doc.title,
      baselineOnly: true, sendAllowed: false, member: memberShape(member),
      profile: completionOnlySignupProfileV2(member.job), completionProof: structuredClone(doc.completionProof),
      nativeCheckedAt: member.checkedAt, checkedAt: member.checkedAt,
      profileMemoJobId: `instructor_member_completion_${doc.documentId}`,
      eligibleForBaseline: false, fieldReview: { birthDate: "review", address: "review", reason: "signed_fields_unverified" },
      statusResponseHash: doc.statusResponseHash };
  }
  // Validate against actual observation time, never manufacture a fresh source clock.
  buildSignupEnrichmentPlan(row, { now: new Date(row.checkedAt) });
  return row;
}

export function prepareVerifiedSubset(parent, inventory, { parentAuditPath, parentAuditSha256, inventorySha256 }) {
  assert(parentAuditPath === SUBSET_PARENT && digest(parentAuditSha256)
    && digest(inventorySha256) && parent.inventory?.sha256 === inventorySha256, "Exact parent and inventory hashes required");
  const scope = validateSourceInventory(inventory);
  assert(scope.scopeComplete && scope.documents.length === 103 && parent.inventory.count === 103, "Full original inventory required");
  assert(parent.source === "instructor_signup_enrichment_native_sources_v2" && parent.studioId === "5330"
    && parent.templateId === TEMPLATE && parent.ok === false && parent.coverage?.complete === false
    && parent.coverage.inventoryComplete === true && parent.coverage.scopeComplete === true
    && parent.operationalWrites === 0 && parent.sendAllowed === false, "Unmodified incomplete parent required");
  const coverage = parent.coverage;
  assert(isDeepStrictEqual(coverage.documentStatus, { attempted: 103, verified: 91, expected: 103 })
    && isDeepStrictEqual(coverage.nativeMembers, { attempted: 88, verified: 80, expected: 88 })
    && isDeepStrictEqual(coverage.profiles, { attempted: 80, verified: 18, expected: 80 }), "Exact audited partition required");
  assert(parent.cleanup?.length === 3 && parent.cleanup.every(row => row.contextClosed && row.lockReleased), "Parent cleanup incomplete");
  assert(parent.errors.every(row => (row.phase === "document_status" && row.code === "DOCUMENT_STATUS_READ_INCOMPLETE")
    || (row.phase === "completed_profiles" && row.code === "COMPLETED_PROFILE_READ_INCOMPLETE")), "Global, security or native source failure is not eligible");
  const statusHolds = parent.errors.filter(row => row.phase === "document_status");
  const fieldHolds = parent.errors.filter(row => row.phase === "completed_profiles");
  const nativeHolds = parent.exclusions.filter(row => row.reason === "native_identity_grade_or_active_mismatch");
  const older = parent.exclusions.filter(row => row.reason === "older_completed_document");
  assert(statusHolds.length === 12 && fieldHolds.length === 62 && nativeHolds.length === 8 && older.length === 3
    && parent.exclusions.length === 11, "Unaccounted source hold");
  const documents = unique(parent.documents), members = unique(parent.members), originals = unique(parent.rows);
  unique(statusHolds); unique(fieldHolds); unique(nativeHolds); unique(older); unique(parent.members, "memberId"); unique(parent.members, "memberPhone");
  assert(documents.size === 91 && members.size === 80 && originals.size === 18
    && equalIds([...parent.documents, ...statusHolds], scope.documents)
    && statusHolds.every(row => !documents.has(row.documentId)), "Status scope is not an exact inventory partition");
  const inventoryById = new Map(scope.documents.map(doc => [doc.documentId, doc]));
  const start = instant(parent.startedAt), end = instant(parent.finishedAt);
  assert(start <= end, "Invalid parent observation window");
  for (const doc of documents.values()) {
    const source = inventoryById.get(doc.documentId), proof = doc.completionProof;
    assert(source && doc.title === source.title && doc.templateId === TEMPLATE
      && doc.listProofHash === source.listProofHash && doc.sourceSkip === source.sourceSkip
      && digest(doc.statusResponseHash), "Document inventory binding mismatch");
    assert(proof?.documentId === doc.documentId && proof.selectedDocumentId === doc.documentId
      && proof.templateId === TEMPLATE && proof.status === "completed" && proof.recipients?.length === 1
      && typeof proof.recipients[0].name === "string" && name(proof.recipients[0].name)
      && /^010\d{8}$/.test(phone(proof.recipients[0].phone))
      && instant(proof.providerCompletedAt) >= 946684800000 && instant(proof.providerCompletedAt) <= instant(proof.observedAt)
      && instant(proof.observedAt) >= start && instant(proof.observedAt) <= end, "Real completed status proof required");
  }
  const selection = selectLatestCompleted(parent.documents);
  assert(selection.selected.length === 88 && equalIds(selection.excluded, older)
    && selection.excluded.every(row => row.reason === "older_completed_document")
    && equalIds([...parent.members, ...nativeHolds], selection.selected)
    && nativeHolds.every(row => !members.has(row.documentId))
    && equalIds([...parent.rows, ...fieldHolds], parent.members)
    && fieldHolds.every(row => !originals.has(row.documentId)), "Latest-within-observed partition mismatch");
  const rows = parent.members.map(member => {
    assert(instant(member.checkedAt) >= start && instant(member.checkedAt) <= end, "Native observation outside parent window");
    const row = buildSubsetRow(documents.get(member.documentId), member, originals.get(member.documentId));
    assert(instant(row.completionProof.observedAt) >= start && instant(row.checkedAt) <= end, "Row observation outside parent window");
    return row;
  });
  const subset = { version: 2, source: "instructor_signup_verified_subset_v2", studioId: "5330", templateId: TEMPLATE,
    ok: true, parentAuditComplete: false, parentAuditPath, parentAuditSha256,
    parentSourceWindow: { startedAt: parent.startedAt, finishedAt: parent.finishedAt },
    inventory: { path: parent.inventory.path, sha256: inventorySha256, attempted: 103 },
    coverage: { complete: true, scope: "verified_completed_native_members", expected: 80, verified: 80,
      verifiedFieldProfiles: 18, completionOnlyProfiles: 62, parentInventoryAttempted: 103, parentStatusVerified: 91 },
    latestGlobalVerified: false, selectionScope: "latest_only_among_91_verified_completed_statuses_not_global",
    sendAllowed: false, operationalWrites: 0, approvalRequired: true,
    remainingFieldsReview: 62, parentErrors: structuredClone(parent.errors),
    holds: { status: structuredClone(statusHolds), native: structuredClone(nativeHolds), fields: structuredClone(fieldHolds) },
    excludedOlderDocuments: structuredClone(older), rows };
  assertSignupEnrichmentSubset(subset, parent);
  return subset;
}

async function privateInput(file) {
  assert(path.dirname(file) === DIRECTORY && await realpath(file) === file, "Private exact input required");
  const stat = await lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, "Private input mode required");
  const raw = await readFile(file, "utf8");
  return { value: JSON.parse(raw), hash: sha(raw) };
}

export async function runSubsetPreparation(args = process.argv.slice(2)) {
  let file, output;
  try {
    assert(args.length === 0 || (args.length === 1 && args[0] === `--parent=${SUBSET_PARENT}`), "Only exact parent is allowed");
    const parent = await privateInput(SUBSET_PARENT), inventory = await privateInput(parent.value.inventory.path);
    const subset = prepareVerifiedSubset(parent.value, inventory.value, { parentAuditPath: SUBSET_PARENT,
      parentAuditSha256: parent.hash, inventorySha256: inventory.hash });
    assertSignupEnrichmentSubset(subset, parent.value);
    const directory = await lstat(DIRECTORY);
    assert(directory.isDirectory() && (directory.mode & 0o077) === 0 && await realpath(DIRECTORY) === DIRECTORY);
    output = `${DIRECTORY}/verified-subset-${Date.now()}-${randomUUID()}.json`;
    file = await open(output, "wx", 0o600);
    await file.writeFile(JSON.stringify(subset, null, 2)); await file.sync(); await file.close(); file = null;
    assert(((await lstat(output)).mode & 0o077) === 0);
    console.log(JSON.stringify({ status: "private_subset_prepared", rows: 80, verifiedFieldProfiles: 18, completionOnlyProfiles: 62,
      statusHolds: 12, nativeHolds: 8, excludedOlderDocuments: 3, parentAuditComplete: false, latestGlobalVerified: false,
      operationalWrites: 0, parentAuditSha256: parent.hash, output }));
    return subset;
  } catch {
    console.log(JSON.stringify({ status: "subset_preparation_failed", code: "PARENT_OR_SUBSET_VALIDATION_FAILED", operationalWrites: 0 }));
    process.exitCode = 1;
  } finally { try { await file?.close(); } catch { process.exitCode = 1; } }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runSubsetPreparation();
