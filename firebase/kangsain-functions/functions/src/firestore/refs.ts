import { db } from "../config/firebase";
import type {
  AttendanceSummaryDoc,
  BookingDoc,
  DailyGroupStatsDoc,
  InstructorViewDoc,
  LectureDoc,
  NoticeDoc,
  StaffDoc,
  WriteQueueJobDoc,
} from "../types/models";

export const refs = {
  staffs: () => db.collection("staffs").withConverter(converter<StaffDoc>()),
  staff: (staffId: string) => refs.staffs().doc(staffId),
  lectures: () => db.collection("lectures").withConverter(converter<LectureDoc>()),
  lecture: (lectureId: string) => refs.lectures().doc(lectureId),
  bookings: () => db.collection("bookings").withConverter(converter<BookingDoc>()),
  booking: (bookingId: string) => refs.bookings().doc(bookingId),
  instructorViews: () => db.collection("instructorViews").withConverter(converter<InstructorViewDoc>()),
  instructorView: (staffId: string, date: string) => refs.instructorViews().doc(`${staffId}_${date}`),
  attendanceSummaries: () => db.collection("attendanceSummaries").withConverter(converter<AttendanceSummaryDoc>()),
  attendanceSummary: (memberId: string, yyyymmdd: string) => refs.attendanceSummaries().doc(`${memberId}_${yyyymmdd}`),
  dailyGroupStats: () => db.collection("dailyGroupStats").withConverter(converter<DailyGroupStatsDoc>()),
  dailyGroupStat: (studioId: string, date: string) => refs.dailyGroupStats().doc(`${studioId}_${date}`),
  notices: () => db.collection("notices").withConverter(converter<NoticeDoc>()),
  notice: (noticeId: string) => refs.notices().doc(noticeId),
  writeQueue: () => db.collection("writeQueue").withConverter(converter<WriteQueueJobDoc>()),
  writeJob: (jobId: string) => refs.writeQueue().doc(jobId),
  syncState: (syncName: string) => db.collection("syncStates").doc(syncName),
  memberMemos: () => db.collection("memberMemos"),
  instructorHandoffs: () => db.collection("instructorHandoffs"),
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

