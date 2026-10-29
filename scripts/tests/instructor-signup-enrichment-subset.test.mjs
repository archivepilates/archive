import assert from "node:assert/strict";
import test from "node:test";
import { prepareVerifiedSubset, buildSubsetRow, SUBSET_PARENT } from "../prepare-instructor-signup-enrichment-subset.mjs";
import { assertSignupEnrichmentSubset, buildSignupEnrichmentPlan } from "../lib/instructor-signup-enrichment-queue.mjs";
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE } from "../lib/instructor-lesson-registration-contract.mjs";

const id = n => n.toString(16).padStart(32, "0");
const hash = "a".repeat(64), lastHash = "b".repeat(64);
const times = { start: "2026-10-30T00:00:00.000Z", status: "2026-10-30T00:01:00.000Z",
  native: "2026-10-30T00:02:00.000Z", profile: "2026-10-30T00:03:00.000Z",
  checked: "2026-10-30T00:03:00.100Z", end: "2026-10-30T00:05:00.000Z" };
const person = n => ({ memberId: String(1000 + n), memberName: `Synthetic Instructor ${n}`, memberPhone: `010${String(n).padStart(8, "0")}` });

function fixture() {
  const inventory = { ok: true, source: "eformsign_native_completed_list", account: "archivepilates@gmail.com", templateId: TEMPLATE,
    sourceWindow: { startedAt: times.start, finishedAt: times.end }, cleanup: { contextClosed: true, lockReleased: true },
    coverage: { complete: true, totalAllTemplates: 103, uniqueAllTemplates: 103, matchedOriginalTemplate: 103,
      pageSize: 100, pagesExpected: 2, pagesVerified: 2, firstPageRevalidated: true },
    pages: [0, 100].map(skip => ({ skip, limit: 100, totalRows: 103, rowCount: skip ? 3 : 100,
      queryHash: hash, responseHash: skip ? lastHash : hash, documentIdsHash: hash })),
    documents: Array.from({ length: 103 }, (_, i) => ({ documentId: id(i + 1), title: `Synthetic document ${i + 1}`,
      templateId: TEMPLATE, status: "completed_list_only", listProofHash: i < 100 ? hash : lastHash, sourceSkip: i < 100 ? 0 : 100 })) };
  const documents = inventory.documents.slice(0, 91).map((item, i) => {
    const { status, ...doc } = item, member = person(i < 88 ? i + 1 : i - 87);
    return { ...doc, statusResponseHash: hash, completionProof: { documentId: doc.documentId, selectedDocumentId: doc.documentId,
      templateId: TEMPLATE, status: "completed", recipients: [{ name: member.memberName, phone: member.memberPhone }],
      providerCompletedAt: i < 88 ? "2026-10-01T00:00:00.000Z" : "2026-09-01T00:00:00.000Z", observedAt: times.status } };
  });
  const members = documents.slice(0, 80).map((doc, i) => {
    const member = person(i + 1);
    return { documentId: doc.documentId, ...member, memberGrade: "강사회원", inactive: false, birthday: "", checkedAt: times.native,
      job: { studioId: "5330", studiomateMemberId: member.memberId, memberName: member.memberName, memberPhone: member.memberPhone,
        documentId: doc.documentId, documentName: doc.title, baselineOnly: true, status: "done",
        source: "completed_signup_profile_baseline_v2", sendAllowed: false, registrationId: "" } };
  });
  const rows = members.slice(0, 18).map((member, i) => ({ status: "verified", documentId: member.documentId, documentName: documents[i].title,
    baselineOnly: true, sendAllowed: false, member: { memberId: member.memberId, name: member.memberName, phone: member.memberPhone,
      memberGrade: member.memberGrade, inactive: false },
    profile: { version: 2, documentId: member.documentId, templateId: TEMPLATE, memberName: member.memberName,
      memberPhone: member.memberPhone, birthDateRaw: "1990-01-02", addressRaw: "Synthetic address", career: "", affiliation: "" },
    completionProof: { ...structuredClone(documents[i].completionProof), observedAt: times.profile },
    profileMemoJobId: `instructor_member_completion_${member.documentId}`, nativeCheckedAt: times.native,
    checkedAt: times.checked, eligibleForBaseline: false, statusResponseHash: hash }));
  const parent = { source: "instructor_signup_enrichment_native_sources_v2", studioId: "5330", templateId: TEMPLATE,
    ok: false, sendAllowed: false, operationalWrites: 0, startedAt: times.start, finishedAt: times.end,
    coverage: { complete: false, inventoryComplete: true, scopeComplete: true,
      documentStatus: { attempted: 103, verified: 91, expected: 103 }, nativeMembers: { attempted: 88, verified: 80, expected: 88 },
      profiles: { attempted: 80, verified: 18, expected: 80 } },
    documents, members, rows,
    errors: [...inventory.documents.slice(91).map(doc => ({ documentId: doc.documentId, phase: "document_status", code: "DOCUMENT_STATUS_READ_INCOMPLETE" })),
      ...members.slice(18).map(member => ({ documentId: member.documentId, phase: "completed_profiles", code: "COMPLETED_PROFILE_READ_INCOMPLETE" }))],
    exclusions: [...documents.slice(88).map(doc => ({ documentId: doc.documentId, reason: "older_completed_document" })),
      ...documents.slice(80, 88).map(doc => ({ documentId: doc.documentId, reason: "native_identity_grade_or_active_mismatch" }))],
    cleanup: ["document_status", "native_members", "completed_profiles"].map(phase => ({ phase, contextClosed: true, lockReleased: true })),
    inventory: { path: "/private/inventory.json", sha256: hash, count: 103, limit: 200 } };
  return { parent, inventory, options: { parentAuditPath: SUBSET_PARENT, parentAuditSha256: lastHash, inventorySha256: hash } };
}

test("exact 80-member derivative preserves 18 complete rows and emits 62 metadata-only profiles", () => {
  const f = fixture(), before = structuredClone(f), subset = prepareVerifiedSubset(f.parent, f.inventory, f.options);
  assert.deepEqual(f, before); assert.equal(subset.rows.length, 80); assert.equal(subset.parentAuditComplete, false);
  assert.equal(subset.coverage.scope, "verified_completed_native_members"); assert.equal(subset.latestGlobalVerified, false);
  assert.equal(subset.parentAuditSha256, lastHash); assert.deepEqual(subset.parentErrors, f.parent.errors);
  assert.deepEqual(subset.rows.slice(0, 18), f.parent.rows);
  assert.equal(subset.holds.status.length, 12); assert.equal(subset.holds.native.length, 8); assert.equal(subset.excludedOlderDocuments.length, 3);
  for (const row of subset.rows.slice(18)) {
    assert.equal(row.profile.mode, "completion_only"); assert.equal(row.checkedAt, times.native);
    assert.equal(row.nativeCheckedAt, times.native); assert.equal(row.completionProof.observedAt, times.status);
    assert.equal(row.eligibleForBaseline, false); assert.equal(row.fieldReview.birthDate, "review");
    for (const key of ["birthDateRaw", "addressRaw", "career", "affiliation"]) assert.equal(Object.hasOwn(row.profile, key), false);
    assert.equal(buildSignupEnrichmentPlan(row, { now: new Date(times.end) }).projection.profileUpdate.mode, "completion_only");
  }
  assert.equal(assertSignupEnrichmentSubset(subset, f.parent).length, 80);
});

for (const [label, mutate] of [
  ["global security failure", p => p.errors.push({ phase: "document_status", code: "LOGIN_OR_SECURITY_STOP" })],
  ["incomplete inventory", p => { p.coverage.inventoryComplete = false; }],
  ["missing attempted status", p => { p.coverage.documentStatus.attempted = 102; }],
  ["missing native read", p => { p.coverage.nativeMembers.attempted = 87; }],
  ["cleanup failure", p => { p.cleanup[0].lockReleased = false; }],
  ["member ID mismatch", p => { p.members[20].job.studiomateMemberId = "9999999"; }],
  ["duplicate native phone", p => { p.members[20].memberPhone = p.members[21].memberPhone; }],
  ["inactive native member", p => { p.members[20].inactive = true; }],
  ["unknown native grade", p => { p.members[20].memberGrade = "ordinary"; }],
  ["provider recipient mismatch", p => { p.documents[20].completionProof.recipients[0].phone = "01099999999"; }],
  ["missing selected document proof", p => { delete p.documents[20].completionProof.selectedDocumentId; }],
  ["invented completion timestamp", p => { p.documents[20].completionProof.providerCompletedAt = times.end; }],
  ["native observation before provider proof", p => { p.members[20].checkedAt = times.start; }],
  ["unknown extra hold", p => p.exclusions.push({ documentId: id(99), reason: "unknown" })],
]) test(`builder rejects ${label}`, () => {
  const f = fixture(); mutate(f.parent); assert.throws(() => prepareVerifiedSubset(f.parent, f.inventory, f.options));
});

for (const [label, mutate] of [
  ["forged source", s => { s.source = "workLanes"; }],
  ["fabricated DOB", s => { s.rows[20].profile.birthDateRaw = "1990-01-01"; }],
  ["fabricated blank address", s => { s.rows[20].profile.addressRaw = ""; }],
  ["fabricated career", s => { s.rows[20].profile.career = ""; }],
  ["freshened row timestamp", s => { s.rows[20].checkedAt = times.end; }],
  ["freshened provider observation", s => { s.rows[20].completionProof.observedAt = times.end; }],
  ["changed preserved eligibility", s => { s.rows[0].eligibleForBaseline = true; }],
  ["changed preserved field value", s => { s.rows[0].profile.birthDateRaw = "1991-01-01"; }],
]) test(`main subset assertion rejects ${label}`, () => {
  const f = fixture(), subset = prepareVerifiedSubset(f.parent, f.inventory, f.options);
  mutate(subset); assert.throws(() => assertSignupEnrichmentSubset(subset, f.parent));
});

test("per-row builder rejects wrong document and never mutates verified row evidence", () => {
  const f = fixture(), doc = f.parent.documents[0], member = f.parent.members[0], original = f.parent.rows[0];
  const copy = buildSubsetRow(doc, member, original); assert.deepEqual(copy, original); assert.notEqual(copy, original);
  assert.throws(() => buildSubsetRow({ ...doc, documentId: id(99) }, member));
});
