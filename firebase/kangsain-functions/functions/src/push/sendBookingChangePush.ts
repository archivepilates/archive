import { getMessaging } from "firebase-admin/messaging";
import { getFcmTokensByStaff, deleteFcmToken } from "../firestore/fcmTokenRepository";
import type { NoticeDoc } from "../types/models";
import { logApiCall } from "../utils/logger";

export async function sendBookingChangePush(input: {
  notice: NoticeDoc;
  lectureTimeText?: string;
  memberName?: string;
}): Promise<{ sent: number; failed: number }> {
  const tokens = await getFcmTokensByStaff(input.notice.studioId, input.notice.staffId);
  if (!tokens.length) return { sent: 0, failed: 0 };

  const response = await getMessaging().sendEachForMulticast({
    tokens: tokens.map((item) => item.token),
    notification: {
      title: "수업 변경 알림",
      body: `${input.lectureTimeText || ""} ${input.memberName || ""} ${input.notice.label}`.trim(),
    },
    data: {
      type: "booking_change",
      lectureId: input.notice.refLectureId,
      noticeId: input.notice.noticeId,
    },
  });

  await Promise.all(
    response.responses.map((result, index) => {
      const code = result.error?.code || "";
      if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")) {
        return deleteFcmToken(tokens[index].tokenId);
      }
      return Promise.resolve();
    }),
  );
  await logApiCall({
    studioId: input.notice.studioId,
    service: "manager",
    endpoint: "FCM sendBookingChangePush",
    requestId: input.notice.noticeId,
    status: response.failureCount ? "failed" : "success",
    durationMs: 0,
    errorMessage: response.failureCount ? `${response.failureCount} FCM failures` : undefined,
  });
  return { sent: response.successCount, failed: response.failureCount };
}
