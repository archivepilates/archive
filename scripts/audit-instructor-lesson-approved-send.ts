import { db } from "../firebase/kangsain-functions/functions/src/config/firebase";
import { refs } from "../firebase/kangsain-functions/functions/src/firestore/refs";
import {
  instructorLessonApprovedCandidatesIssue,
  instructorLessonCancellationRegistrationId,
  instructorLessonCandidateSourceIssue,
  instructorLessonReservationSnapshotIssue,
  type InstructorLessonApprovalDoc,
} from "../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonSampleApproval";
import { cancellationBlocksRegistration } from "../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonCancellationPolicy";

async function main() {
  const sourceDate = process.argv[2];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate || "")) throw new Error("Usage: tsx scripts/audit-instructor-lesson-approved-send.ts YYYY-MM-DD");
  const approvals = await db.collection("instructorLessonAlimtalkApprovals")
    .where("sourceDate", "==", sourceDate).limit(20).get();
  const snapshot = (await db.doc("opsState/studiomateReservationExcelEmergency").get()).data();
  const batches = [];
  for (const doc of approvals.docs) {
    const approval = doc.data() as InstructorLessonApprovalDoc;
    if (approval.studioId !== "5330") continue;
    const candidates = [];
    const rows = [];
    for (const id of new Set(approval.candidateIds || [])) {
      if (!id || id.includes("/")) throw new Error("Invalid approved candidate ID");
      const candidate = (await refs.alimtalkCandidate(id).get()).data();
      if (!candidate) continue;
      candidates.push(candidate);
      const bookingId = String(candidate.payload?.bookingId || "");
      const lectureId = String(candidate.payload?.lectureId || "");
      const booking = bookingId ? (await refs.booking(bookingId).get()).data() : undefined;
      const lecture = lectureId ? (await refs.lecture(lectureId).get()).data() : undefined;
      const profile = (await refs.memberProfile(candidate.memberId).get()).data();
      const registration = (await db.doc(`instructorLessonRegistrations/${instructorLessonCancellationRegistrationId(candidate)}`).get()).data();
      const send = (await refs.alimtalkSend(id).get()).data();
      rows.push({
        candidateId: id, status: candidate.status,
        sourceIssue: instructorLessonCandidateSourceIssue(candidate, booking, lecture),
        profileIdentityMatches: profile?.memberId === candidate.memberId && profile?.studioId === candidate.studioId
          && String(profile?.phone || "").replace(/\D/g, "") === String(candidate.memberPhone || "").replace(/\D/g, ""),
        cancellationBlocked: cancellationBlocksRegistration(registration),
        sendStatus: send?.status || null, providerMessageId: send?.solapiMessageId || null,
      });
    }
    batches.push({
      approvalId: doc.id, status: approval.status, lessonDate: approval.lessonDate,
      approvedCount: approval.candidateIds?.length || 0,
      candidateContractIssue: instructorLessonApprovedCandidatesIssue(approval, candidates),
      snapshotIssue: instructorLessonReservationSnapshotIssue(snapshot, approval.lessonDate), rows,
    });
  }
  console.log(JSON.stringify({ readOnly: true, sourceDate, checkedAt: new Date().toISOString(), batches }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
