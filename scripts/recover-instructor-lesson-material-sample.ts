import type { DocumentReference, DocumentSnapshot, Query, QuerySnapshot, Transaction } from "../firebase/kangsain-functions/functions/node_modules/firebase-admin/firestore";
import { db } from "../firebase/kangsain-functions/functions/src/config/firebase";
import type { AlimtalkCandidateDoc, BookingDoc, LectureDoc, MemberProfileDoc } from "../firebase/kangsain-functions/functions/src/types/models";
import { instructorLessonMaterialCandidatesForDate } from "../firebase/kangsain-functions/functions/src/alimtalk/rebuildAlimtalkCandidates";
import { instructorLessonManagementNumberFor } from "../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonManagement";
import { isInstructorLessonBooking } from "../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonBookingPolicy";
import { alimtalkDedupeKey, normalizePhone } from "../firebase/kangsain-functions/functions/src/alimtalk/dedupe";
import { instructorLessonApprovalId, instructorLessonApprovalCutoffIssue, instructorLessonCandidateSourceIssue,
  instructorLessonCancellationRegistrationId, instructorLessonReservationSnapshotIssue, prepareInstructorLessonSampleApprovals,
} from "../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonSampleApproval";
import { cancellationBlocksRegistration } from "../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonCancellationPolicy";
import { targetEligibilityIssue } from "../firebase/kangsain-functions/functions/src/alimtalk/targetValidationChecks";
import { alimtalkTemplateReadiness } from "../firebase/kangsain-functions/functions/src/alimtalk/templateStatus";
import { INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE } from "../firebase/kangsain-functions/functions/src/alimtalk/templates";
import { primaryAlimtalkTestRecipient, isAlimtalkTestRecipient } from "../firebase/kangsain-functions/functions/src/alimtalk/testRecipients";
import { auditInstructorLessonProvider } from "./audit-instructor-lesson-provider";
import { attachInstructorLessonParkingPayload, upsertInstructorLessonParkingPreRegistration } from "../firebase/kangsain-functions/functions/src/parking/instructorLessonParkingPreRegistration";
import { canonicalizeBookings } from "../firebase/kangsain-functions/functions/src/utils/canonicalBooking";
import { stableHash } from "../firebase/kangsain-functions/functions/src/utils/hash";
import { ensureShortLink } from "../firebase/kangsain-functions/functions/src/utils/shortLinks";
import { nowTimestamp } from "../firebase/kangsain-functions/functions/src/utils/date";
import { assertMemberDispatchAllowed } from "../firebase/kangsain-functions/functions/src/memberSignup/memberDispatchWindow";

export const SCOPE = Object.freeze({ studioId: "5330", sourceDate: "2026-10-23", lessonDate: "2026-10-24",
  managementNumber: "external-feedback-261024" });
export const OLD_APPROVAL_IDS = ["instructor_lesson_0e5dc84471e202263d5b983b", "instructor_lesson_6dae119d5fa5344bddeba625"] as const;
const RECOVERY_KEY = "instructor-material-recovery:5330:2026-10-24:external-feedback";
const APPROVALS = "instructorLessonAlimtalkApprovals";
const SNAPSHOT = "opsState/studiomateReservationExcelEmergency";
const BAD_MANAGEMENT = new Set(["a-261024", "b-261024"]);
type Row = { id: string; data: Record<string, any> };
export interface RecoveryInput {
  bookings: BookingDoc[]; lectures: LectureDoc[]; profiles: MemberProfileDoc[];
  snapshot: Record<string, any> | undefined; candidates: Row[]; approvals: Row[]; sends: Row[];
  cancellations: Row[]; version: string;
}
export interface RecoveryPlan {
  candidates: AlimtalkCandidateDoc[]; oldCandidateIds: string[]; uniqueRecipients: number; fingerprint: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function buildRecoveryPlan(input: RecoveryInput, now = Date.now()): RecoveryPlan {
  const snapshotIssue = instructorLessonReservationSnapshotIssue(input.snapshot, SCOPE.lessonDate, now);
  assert(!snapshotIssue, snapshotIssue);
  const lectureIndex = new Map(input.lectures.map((lecture) => [lecture.lectureId, lecture]));
  const profiles = new Map(input.profiles.map((profile) => [profile.memberId, profile]));
  const bookingIndex = new Map<string, BookingDoc[]>();
  // Canonicalize before filtering reserved rows, so a fallback cannot revive a cancelled real booking.
  for (const booking of canonicalizeBookings(input.bookings)) {
    if (booking.appStatus !== "reserved" || !isInstructorLessonBooking(booking)) continue;
    assert(booking.studioId === SCOPE.studioId && booking.lectureDate === SCOPE.lessonDate, "Booking outside recovery scope");
    const lecture = lectureIndex.get(booking.lectureId);
    assert(lecture && instructorLessonManagementNumberFor({ title: lecture.title, lessonDate: lecture.date }) === SCOPE.managementNumber,
      "Management mapping fix is not present; do not override a/b locally");
    const profile = profiles.get(booking.memberId);
    assert(profile && profile.studioId === SCOPE.studioId && profile.name && normalizePhone(profile.phone || "")
      && normalizePhone(profile.phone || "") === normalizePhone(booking.memberPhone), "Current profile identity mismatch");
    if (isAlimtalkTestRecipient({ memberId: profile.memberId, memberName: profile.name, memberPhone: profile.phone })) continue;
    assert(!booking.supersededByBookingId && !booking.sessionOrder?.supersededByBookingId, "Superseded source booking");
    const rows = bookingIndex.get(booking.memberId) || [];
    rows.push(booking); bookingIndex.set(booking.memberId, rows);
  }
  const candidates = [...bookingIndex.keys()].sort().flatMap((id) =>
    instructorLessonMaterialCandidatesForDate(profiles.get(id)!, SCOPE.sourceDate, bookingIndex, lectureIndex));
  assert(candidates.length > 0 && candidates.length <= 100, "Recovery cohort empty or exceeds bounded maximum 100");
  const phones = new Set(candidates.map((candidate) => normalizePhone(candidate.memberPhone)));
  assert(phones.size === candidates.length, "Duplicate recipient phone across source member IDs");
  const bookings = new Map(input.bookings.map((booking) => [booking.bookingId, booking]));
  for (const candidate of candidates) {
    const issue = instructorLessonCandidateSourceIssue(candidate, bookings.get(candidate.payload.bookingId), lectureIndex.get(candidate.payload.lectureId));
    assert(!issue, issue);
    const cancellation = input.cancellations.find((row) => row.id === instructorLessonCancellationRegistrationId(candidate));
    assert(!cancellationBlocksRegistration(cancellation?.data), "Cancellation/refund request blocks recovery");
  }
  // A failed label is insufficient: every legacy/new sample and target ledger must be absent.
  assert(input.sends.length === 0, "Existing send ledger (including failed/unknown): reconcile provider, never replay");
  for (const id of OLD_APPROVAL_IDS) {
    const approval = input.approvals.find((row) => row.id === id)?.data;
    assert(approval && approval.studioId === SCOPE.studioId && approval.sourceDate === SCOPE.sourceDate
      && approval.lessonDate === SCOPE.lessonDate && BAD_MANAGEMENT.has(approval.managementNumber)
      && approval.status === "sample_failed" && !approval.sampleSolapiMessageId && !approval.sampleSentAt
      && !approval.approvedAt && !approval.liveSendStartedAt
      && (!approval.supersededByApprovalId || approval.supersededByApprovalId === instructorLessonApprovalId(
        SCOPE.studioId, SCOPE.sourceDate, SCOPE.managementNumber)), "Legacy approval is not a proven pre-send mapping failure");
  }
  assert(input.approvals.every((row) => (OLD_APPROVAL_IDS as readonly string[]).includes(row.id)),
    "New/other approval already exists: reconcile without resetting approval history");
  const oldCandidateIds: string[] = [];
  const expected = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  for (const row of input.candidates) {
    const data = row.data;
    assert(data.candidateId === row.id && data.studioId === SCOPE.studioId && data.sourceDate === SCOPE.sourceDate
      && data.type === "instructor_lesson_material" && data.payload?.lessonDate === SCOPE.lessonDate, "Candidate identity/scope mismatch");
    assert(["candidate", "reviewed", "skipped"].includes(data.status) && !(data.attempts > 0) && !data.sentAt
      && !data.payload?.deliveryMode, "Candidate has prior attempt, claim, or ambiguous outcome");
    if (BAD_MANAGEMENT.has(data.payload.managementNumber)) {
      assert(candidates.some((candidate) => candidate.memberId === data.memberId
        && normalizePhone(candidate.memberPhone) === normalizePhone(data.memberPhone)), "Legacy candidate recipient outside fresh cohort");
      assert(input.approvals.some((approval) => (approval.data.candidateIds || []).includes(row.id)), "Unbound legacy candidate");
      oldCandidateIds.push(row.id);
    } else {
      const candidate = expected.get(row.id);
      assert(candidate && data.status === "candidate" && data.sourceActionKey === RECOVERY_KEY
        && data.memberId === candidate.memberId && normalizePhone(data.memberPhone) === normalizePhone(candidate.memberPhone)
        && data.payload.managementNumber === SCOPE.managementNumber && data.payload.bookingId === candidate.payload.bookingId
        && data.payload.lectureId === candidate.payload.lectureId, "Existing corrected candidate is not this unattempted recovery");
    }
  }
  for (const approval of input.approvals) {
    for (const id of approval.data.candidateIds || []) assert(oldCandidateIds.includes(id), "Legacy approval target missing or changed");
  }
  assert([...phones].every((phone) => input.candidates.some((row) => normalizePhone(row.data.memberPhone) === phone)),
    "Provider audit sourceDate candidate coverage missing a fresh recipient; expand read-only audit first");
  return { candidates, oldCandidateIds: oldCandidateIds.sort(), uniqueRecipients: phones.size,
    fingerprint: stableHash({ scope: SCOPE, version: input.version, ids: candidates.map((candidate) => candidate.candidateId),
      phones: [...phones].sort(), parking: candidates.map((candidate) => candidate.payload.parkingBookingIds) }) };
}

async function readInputs(tx?: Transaction): Promise<RecoveryInput> {
  const versions = new Map<string, string>();
  async function document(ref: DocumentReference): Promise<DocumentSnapshot> {
    const snap = tx ? await tx.get(ref) : await ref.get();
    versions.set(ref.path, snap.updateTime?.toDate().toISOString() + ":" + stableHash(snap.data() || null));
    return snap;
  }
  async function query(ref: Query): Promise<QuerySnapshot> {
    const snap = tx ? await tx.get(ref) : await ref.get();
    for (const doc of snap.docs) versions.set(doc.ref.path, stableHash(doc.data()));
    return snap;
  }
  const bookingRows = await query(db.collection("bookings").where("studioId", "==", SCOPE.studioId).where("lectureDate", "==", SCOPE.lessonDate));
  const lectureRows = await query(db.collection("lectures").where("studioId", "==", SCOPE.studioId).where("date", "==", SCOPE.lessonDate));
  const snapshot = (await document(db.doc(SNAPSHOT))).data();
  const bookings = bookingRows.docs.map((doc) => { assert(doc.id === doc.data().bookingId, "Booking document ID mismatch"); return doc.data() as BookingDoc; });
  const lectures = lectureRows.docs.map((doc) => { assert(doc.id === doc.data().lectureId, "Lecture document ID mismatch"); return doc.data() as LectureDoc; });
  const profiles: MemberProfileDoc[] = [];
  for (const memberId of new Set(bookings.filter(isInstructorLessonBooking).map((booking) => booking.memberId))) {
    assert(memberId && !memberId.includes("/"), "Invalid member ID");
    const profile = (await document(db.doc(`memberProfiles/${memberId}`))).data();
    assert(profile && profile.memberId === memberId, "Missing canonical member profile"); profiles.push(profile as MemberProfileDoc);
  }
  const candidateRows = await query(db.collection("alimtalkCandidates").where("sourceDate", "==", SCOPE.sourceDate));
  const candidates = new Map(candidateRows.docs.filter((doc) => doc.data().studioId === SCOPE.studioId
    && doc.data().type === "instructor_lesson_material").map((doc) => [doc.id, { id: doc.id, data: doc.data() }]));
  const approvalRows = await query(db.collection(APPROVALS).where("sourceDate", "==", SCOPE.sourceDate));
  const approvals = new Map(approvalRows.docs.filter((doc) => doc.data().studioId === SCOPE.studioId)
    .map((doc) => [doc.id, { id: doc.id, data: doc.data() }]));
  const correctedApprovalId = instructorLessonApprovalId(SCOPE.studioId, SCOPE.sourceDate, SCOPE.managementNumber);
  for (const id of [...OLD_APPROVAL_IDS, correctedApprovalId]) {
    const snap = await document(db.doc(`${APPROVALS}/${id}`));
    if (snap.exists) approvals.set(id, { id, data: snap.data()! });
  }
  // Include referenced and newly derived IDs even when sourceDate is absent/corrupt on stored rows.
  const sendIds = new Set<string>([...candidates.keys(), correctedApprovalId + "_sample", ...OLD_APPROVAL_IDS.map((id) => id + "_sample")]);
  for (const approval of approvals.values()) {
    for (const id of [...(approval.data.candidateIds || []), approval.data.sampleCandidateId].filter(Boolean)) sendIds.add(id);
  }
  const index = new Map<string, BookingDoc[]>();
  for (const booking of canonicalizeBookings(bookings)) index.set(booking.memberId, [...(index.get(booking.memberId) || []), booking]);
  const lectureIndex = new Map(lectures.map((lecture) => [lecture.lectureId, lecture]));
  for (const profile of profiles) for (const candidate of instructorLessonMaterialCandidatesForDate(profile, SCOPE.sourceDate, index, lectureIndex)) sendIds.add(candidate.candidateId);
  const sends: Row[] = [];
  for (const id of sendIds) {
    assert(typeof id === "string" && id && !id.includes("/"), "Invalid candidate/sample ID");
    const candidate = await document(db.doc(`alimtalkCandidates/${id}`));
    if (candidate.exists) candidates.set(id, { id, data: candidate.data()! });
    const send = await document(db.doc(`alimtalkSends/${id}`));
    if (send.exists) sends.push({ id, data: send.data()! });
  }
  const cancellations: Row[] = [];
  for (const profile of profiles) {
    const id = instructorLessonCancellationRegistrationId({ studioId: SCOPE.studioId, memberPhone: profile.phone || "",
      payload: { lessonDate: SCOPE.lessonDate } } as AlimtalkCandidateDoc);
    const snap = await document(db.doc(`instructorLessonRegistrations/${id}`));
    if (snap.exists) cancellations.push({ id, data: snap.data()! });
  }
  return { bookings, lectures, profiles, snapshot, candidates: [...candidates.values()], approvals: [...approvals.values()], sends,
    cancellations, version: stableHash([...versions].sort(([a], [b]) => a.localeCompare(b))) };
}

export function parseRecoveryArgs(args: string[]) {
  const options = { apply: false, expectedRecipients: 0, expectedPlan: "" };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") continue;
    else {
      const keys: Record<string, "expectedRecipients" | "expectedPlan"> = {
        "--expected-recipients": "expectedRecipients", "--expected-plan": "expectedPlan" };
      const key = keys[arg];
      assert(key && args[index + 1] && !args[index + 1].startsWith("--"), `Unknown/missing option: ${arg}`);
      const value = args[++index];
      if (key === "expectedRecipients") options.expectedRecipients = Number(value);
      else options[key] = value;
    }
  }
  return options;
}

export function assertApplyGate(options: ReturnType<typeof parseRecoveryArgs>, plan: RecoveryPlan, now = Date.now()) {
  assert(options.expectedRecipients === plan.uniqueRecipients, "Re-read recipient count must equal --expected-recipients");
  assert(options.expectedPlan === plan.fingerprint, "Reviewed plan must match current fingerprint");
  const cutoff = instructorLessonApprovalCutoffIssue(SCOPE.sourceDate, new Date(now));
  assert(!cutoff, cutoff); assertMemberDispatchAllowed(now);
}

export function assertProviderPrecheck(result: Awaited<ReturnType<typeof auditInstructorLessonProvider>>, plan: RecoveryPlan, now = Date.now()) {
  const age = now - Date.parse(result.checkedAt);
  assert(result.readOnly === true && result.sourceDate === SCOPE.sourceDate && result.templateApproved === true,
    "Provider audit scope/template not approved");
  assert(result.recipientCount === plan.uniqueRecipients, "Provider audit recipient coverage differs from fresh cohort");
  assert(result.memberHistoryCount === 0 && result.sampleHistoryCount === 0, "Provider member/sample history exists; no replay");
  assert(Number.isFinite(age) && age >= 0 && age <= 60_000, "Provider precheck stale or invalid");
}

async function persistRecoveryCandidates(expected: RecoveryPlan, secret: string) {
  return db.runTransaction(async (tx) => {
    const current = buildRecoveryPlan(await readInputs(tx));
    assert(current.fingerprint === expected.fingerprint, "Source/identity/approval/send state changed since review");
    const now = nowTimestamp();
    const prepared = current.candidates.map((candidate) => attachInstructorLessonParkingPayload(candidate, secret));
    for (const candidate of prepared) {
      assert(candidate.payload.parkingRequestId && candidate.payload.parkingLinkId && candidate.payload.parkingAccessToken, "Parking payload preparation failed");
    }
    for (const candidate of prepared) tx.set(db.doc(`alimtalkCandidates/${candidate.candidateId}`), {
      ...candidate, dedupeKey: alimtalkDedupeKey(candidate), sourceActionKey: RECOVERY_KEY,
    });
    for (const id of current.oldCandidateIds) tx.update(db.doc(`alimtalkCandidates/${id}`), {
      status: "skipped", reasonCode: "superseded_management_mapping", lastError: "Superseded by external-feedback-261024 recovery; original approval retained",
      updatedAt: now,
    });
    const correctedApprovalId = instructorLessonApprovalId(SCOPE.studioId, SCOPE.sourceDate, SCOPE.managementNumber);
    for (const id of OLD_APPROVAL_IDS) tx.update(db.doc(`${APPROVALS}/${id}`), {
      supersededByApprovalId: correctedApprovalId, supersededAt: now,
    });
    return prepared;
  });
}

export async function runRecovery(args: string[]) {
  const options = parseRecoveryArgs(args);
  assert(process.env.GCLOUD_PROJECT === "archive-pilates", "Explicit GCLOUD_PROJECT=archive-pilates required");
  assert(!process.env.FIRESTORE_EMULATOR_HOST, "Production recovery must not use an emulator");
  const plan = buildRecoveryPlan(await readInputs());
  const report = { mode: options.apply ? "apply" : "dry-run", scope: SCOPE, uniqueRecipients: plan.uniqueRecipients,
    candidateIds: plan.candidates.map((candidate) => candidate.candidateId), supersedeCandidateIds: plan.oldCandidateIds,
    fingerprint: plan.fingerprint, providerPrecheckRequired: "--apply calls the GET-only auditInstructorLessonProvider immediately before persistence and again before shared sample preparation. Approved template, complete coverage, zero member/sample history and fresh results are mandatory. Main must verify the deployed mapping separately; no local override proves deployment.",
    verification: "After sample, reconcile approval.sampleCandidateId, candidate sent status, alimtalkSends done + nonempty provider message/group ID with SOLAPI recipient/template/time/result. API acceptance is not handset delivery. Never reapply an ambiguous sample." };
  console.log(JSON.stringify(report, null, 2));
  if (!options.apply) return report;
  assertApplyGate(options, plan);
  for (const name of ["PRIVATE_SURVEY_WEBHOOK_SECRET", "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_PFID", "GOOGLE_DWD_SERVICE_ACCOUNT_JSON"]) {
    assert(process.env[name]?.trim(), `Externally injected ${name} required; never load credential files in this script`);
  }
  const recipient = primaryAlimtalkTestRecipient();
  assert(recipient.name === "\uAE40\uAE30\uD6A8", "Configured sample recipient must be Kim GiHyo");
  const providerPrecheck = await auditInstructorLessonProvider(SCOPE.sourceDate);
  assertProviderPrecheck(providerPrecheck, plan);
  // Read-only eligibility intentionally rejects an expired template cache.
  const readiness = await alimtalkTemplateReadiness(INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE);
  assert(readiness.approved && !readiness.retryable, "Current V3 template cache refresh not approved");
  for (const candidate of plan.candidates) {
    const prepared = attachInstructorLessonParkingPayload(candidate, process.env.PRIVATE_SURVEY_WEBHOOK_SECRET);
    const issue = await targetEligibilityIssue(prepared, SCOPE.sourceDate, { readOnly: true });
    assert(!issue, issue);
  }
  assertApplyGate(options, plan);
  assertProviderPrecheck(providerPrecheck, plan);
  assertApplyGate(options, plan);
  const candidates = await persistRecoveryCandidates(plan, process.env.PRIVATE_SURVEY_WEBHOOK_SECRET!);
  for (const candidate of candidates) {
    await upsertInstructorLessonParkingPreRegistration(candidate);
    await ensureShortLink({ type: "method_material", targetUrl: `https://in.archivepilates.com/method/${SCOPE.managementNumber}`, sourceId: candidate.candidateId });
  }
  // Re-read after persistence/link writes; no prepared in-memory cohort is a send authority.
  const fresh = buildRecoveryPlan(await readInputs());
  assert(stableHash(fresh.candidates.map((candidate) => candidate.candidateId)) === stableHash(plan.candidates.map((candidate) => candidate.candidateId)), "Cohort changed after persistence");
  assert(options.expectedRecipients === fresh.uniqueRecipients, "Recipient count changed after persistence");
  assertProviderPrecheck(await auditInstructorLessonProvider(SCOPE.sourceDate), fresh);
  assert(buildRecoveryPlan(await readInputs()).fingerprint === fresh.fingerprint, "Source/ledger changed during final provider audit");
  assert(!instructorLessonApprovalCutoffIssue(SCOPE.sourceDate), "Approval cutoff crossed during recovery");
  assertMemberDispatchAllowed();
  const result = await prepareInstructorLessonSampleApprovals({ studioId: SCOPE.studioId, sourceDate: SCOPE.sourceDate, candidates });
  console.log(JSON.stringify({ sample: result, memberBatchInvoked: false }));
  assert(result.batches === 1 && result.sampleSent === 1, "Sample not confirmed; reconcile exact approval/ledger/provider, do not retry");
  return report;
}

if (require.main === module) runRecovery(process.argv.slice(2)).catch(() => {
  console.error("Recovery stopped. No automatic retry. Review guards and exact ledger/provider state in the main chat; error details suppressed to avoid sensitive output.");
  process.exitCode = 1;
});
