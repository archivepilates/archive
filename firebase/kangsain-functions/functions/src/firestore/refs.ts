import { db } from "../config/firebase";
import type {
  AttendanceSummaryDoc,
  AdminActionDoc,
  BookingDoc,
  ContactSyncJobDoc,
  AlimtalkCandidateDoc,
  AlimtalkSendDoc,
  ConsultationDoc,
  FcmTokenDoc,
  InstructorViewDoc,
  MemberContactIndexDoc,
  LectureDoc,
  MemberMemoDoc,
  MemberProfileDoc,
  MemberTagDoc,
  NoticeDoc,
  OtherScheduleDoc,
  PrivateSurveyResponseDoc,
  PrivateLessonChartRecordDoc,
  PrivateLessonChartRequestDoc,
  PrivateLessonChartGptTaskDoc,
  StaffDoc,
  TokenCacheDoc,
  WriteQueueJobDoc,
} from "../types/models";
import type {
  DashboardInstructorMetricDoc,
  DashboardMonthlyMetricDoc,
  DashboardSnapshotDoc,
  DashboardTicketMetricDoc,
} from "../types/dashboard";

export const refs = {
  staffs: () => db.collection("staffs").withConverter(converter<StaffDoc>()),
  staff: (staffId: string) => refs.staffs().doc(staffId),
  lectures: () => db.collection("lectures").withConverter(converter<LectureDoc>()),
  lecture: (lectureId: string) => refs.lectures().doc(lectureId),
  bookings: () => db.collection("bookings").withConverter(converter<BookingDoc>()),
  booking: (bookingId: string) => refs.bookings().doc(bookingId),
  consultations: () => db.collection("consultations").withConverter(converter<ConsultationDoc>()),
  consultation: (consultationId: string) => refs.consultations().doc(consultationId),
  otherSchedules: () => db.collection("otherSchedules").withConverter(converter<OtherScheduleDoc>()),
  otherSchedule: (scheduleId: string) => refs.otherSchedules().doc(scheduleId),
  instructorViews: () => db.collection("instructorViews").withConverter(converter<InstructorViewDoc>()),
  instructorView: (staffId: string, date: string) => refs.instructorViews().doc(`${staffId}_${date}`),
  attendanceSummaries: () => db.collection("attendanceSummaries").withConverter(converter<AttendanceSummaryDoc>()),
  attendanceSummary: (memberId: string, yyyymmdd: string) => refs.attendanceSummaries().doc(`${memberId}_${yyyymmdd}`),
  adminActions: () => db.collection("adminActions").withConverter(converter<AdminActionDoc>()),
  adminAction: (studioId: string, date: string) => refs.adminActions().doc(`${studioId}_${date}`),
  memberTags: () => db.collection("memberTags").withConverter(converter<MemberTagDoc>()),
  memberTag: (memberId: string) => refs.memberTags().doc(memberId),
  memberProfiles: () => db.collection("memberProfiles").withConverter(converter<MemberProfileDoc>()),
  memberProfile: (memberId: string) => refs.memberProfiles().doc(memberId),
  memberContactIndex: () => db.collection("memberContactIndex").withConverter(converter<MemberContactIndexDoc>()),
  memberContactIndexDoc: (memberId: string) => refs.memberContactIndex().doc(memberId),
  contactSyncJobs: () => db.collection("contactSyncJobs").withConverter(converter<ContactSyncJobDoc>()),
  contactSyncJob: (jobId: string) => refs.contactSyncJobs().doc(jobId),
  alimtalkCandidates: () => db.collection("alimtalkCandidates").withConverter(converter<AlimtalkCandidateDoc>()),
  alimtalkCandidate: (candidateId: string) => refs.alimtalkCandidates().doc(candidateId),
  alimtalkSends: () => db.collection("alimtalkSends").withConverter(converter<AlimtalkSendDoc>()),
  alimtalkSend: (sendId: string) => refs.alimtalkSends().doc(sendId),
  privateSurveyResponses: () =>
    db.collection("privateSurveyResponses").withConverter(converter<PrivateSurveyResponseDoc>()),
  privateSurveyResponse: (responseId: string) => refs.privateSurveyResponses().doc(responseId),
  privateLessonChartRequests: () =>
    db.collection("privateLessonChartRequests").withConverter(converter<PrivateLessonChartRequestDoc>()),
  privateLessonChartRequest: (requestId: string) => refs.privateLessonChartRequests().doc(requestId),
  privateLessonChartRecords: () =>
    db.collection("privateLessonChartRecords").withConverter(converter<PrivateLessonChartRecordDoc>()),
  privateLessonChartRecord: (recordId: string) => refs.privateLessonChartRecords().doc(recordId),
  privateLessonChartGptTasks: () =>
    db.collection("privateLessonChartGptTasks").withConverter(converter<PrivateLessonChartGptTaskDoc>()),
  privateLessonChartGptTask: (taskId: string) => refs.privateLessonChartGptTasks().doc(taskId),
  memberMemos: () => db.collection("memberMemos").withConverter(converter<MemberMemoDoc>()),
  memberMemo: (memoId: string) => refs.memberMemos().doc(memoId),
  notices: () => db.collection("notices").withConverter(converter<NoticeDoc>()),
  notice: (noticeId: string) => refs.notices().doc(noticeId),
  writeQueue: () => db.collection("writeQueue").withConverter(converter<WriteQueueJobDoc>()),
  writeJob: (jobId: string) => refs.writeQueue().doc(jobId),
  tokenCache: () => db.collection("tokenCache").withConverter(converter<TokenCacheDoc>()),
  tokenCacheDoc: (tokenKey: string) => refs.tokenCache().doc(tokenKey),
  fcmTokens: () => db.collection("fcmTokens").withConverter(converter<FcmTokenDoc>()),
  fcmToken: (tokenId: string) => refs.fcmTokens().doc(tokenId),
  dashboardSnapshots: () => db.collection("dashboardSnapshots").withConverter(converter<DashboardSnapshotDoc>()),
  dashboardSnapshot: (snapshotId: string) => refs.dashboardSnapshots().doc(snapshotId),
  dashboardMonthlyMetrics: () =>
    db.collection("dashboardMonthlyMetrics").withConverter(converter<DashboardMonthlyMetricDoc>()),
  dashboardMonthlyMetric: (month: string) => refs.dashboardMonthlyMetrics().doc(month),
  dashboardInstructorMetrics: () =>
    db.collection("dashboardInstructorMetrics").withConverter(converter<DashboardInstructorMetricDoc>()),
  dashboardInstructorMetric: (month: string, instructorName: string) =>
    refs.dashboardInstructorMetrics().doc(`${month}_${instructorName}`),
  dashboardTicketMetrics: () => db.collection("dashboardTicketMetrics").withConverter(converter<DashboardTicketMetricDoc>()),
  dashboardTicketMetric: (month: string, rank: number) => refs.dashboardTicketMetrics().doc(`${month}_${rank}`),
  syncState: (syncName: string) => db.collection("syncStates").doc(syncName),
};

function converter<T>() {
  return {
    toFirestore(data: T): FirebaseFirestore.DocumentData {
      return data as FirebaseFirestore.DocumentData;
    },
    fromFirestore(snapshot: FirebaseFirestore.QueryDocumentSnapshot): T {
      return snapshot.data() as T;
    },
  };
}
