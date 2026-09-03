import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createPrivateLessonReportSnapshot,
  currentPrivateLessonReportRevision,
  privateLessonReportMutationLockReason,
  privateLessonReportSnapshotForView,
  privateLessonReportSourceChangePatch,
  reportUrlForRevision,
} from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonReportRevision";
import { privateLessonSessionProjection } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonSession";
import { privateLessonRoundVerified } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonSession";
import { renderPrivateLessonReportPage } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart";
import { alimtalkApprovalId } from "../../firebase/kangsain-functions/functions/src/alimtalk/approvalGate";
import { alimtalkDedupeKey } from "../../firebase/kangsain-functions/functions/src/alimtalk/dedupe";
import { privateSurveySourceIssue } from "../../firebase/kangsain-functions/functions/src/alimtalk/privateSurveySendGuard";
import { privateLessonReportScheduleIssue } from "../../firebase/kangsain-functions/functions/src/alimtalk/processAlimtalkQueue";
import {
  isRetryableTemplateStatusIssue,
  privateSurveyTemplateContractIssue,
  recommendedMealTemplateContractIssue,
  reservationOpenTemplateContractIssue,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/eligibility";
import {
  alimtalkTemplateTargetRule,
  solapiButtonUrlLengthIssue,
  surveyDetailButtonUrlLengthIssue,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/templateTargetRules";
import {
  alimtalkImageTemplateContractIssue,
  templateReadinessFromState,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/templateStatus";
import {
  LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
  NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID,
  NATIVE_STAFF_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
  RECOMMENDED_MEAL_ALIMTALK_CHANNEL_ID,
  RECOMMENDED_MEAL_ALIMTALK_IMAGE_ID,
  RECOMMENDED_MEAL_ALIMTALK_TEMPLATE_CODE,
  RESERVATION_OPEN_ALIMTALK_IMAGE_ID,
  RESERVATION_OPEN_ALIMTALK_TEMPLATE_CODE,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/templates";

const nowDate = new Date("2026-07-29T03:00:00.000Z");
const now = {
  toMillis: () => nowDate.getTime(),
  toDate: () => nowDate,
};

test("report revision changes when member-visible content changes", () => {
  const base = reportRecord();
  const revision = currentPrivateLessonReportRevision(base);
  assert.equal(revision.length, 24);
  assert.equal(currentPrivateLessonReportRevision({ ...base }), revision);
  assert.notEqual(
    currentPrivateLessonReportRevision({ ...base, publicNextDirection: "다음에는 호흡 연결을 확인합니다." }),
    revision,
  );
  assert.notEqual(
    currentPrivateLessonReportRevision({
      ...base,
      media: {
        files: [
          {
            mediaId: "media-1",
            driveFileId: "drive-1",
            fileName: "lesson.mov",
            mimeType: "video/quicktime",
            size: 100,
            includeInReport: true,
          },
        ],
      },
    }),
    revision,
  );
  assert.notEqual(
    currentPrivateLessonReportRevision({
      ...base,
      lessonStartAt: {
        toMillis: () => nowDate.getTime() + 60 * 60 * 1000,
        toDate: () => new Date(nowDate.getTime() + 60 * 60 * 1000),
      },
    }),
    revision,
  );
  assert.notEqual(currentPrivateLessonReportRevision({ ...base, sessionNumber: 4 }), revision);
  assert.notEqual(currentPrivateLessonReportRevision({ ...base, staffId: "staff-2", staffName: "변경강사" }), revision);
});

test("approved snapshot and URL remain bound to one revision", () => {
  const record = reportRecord();
  const revision = currentPrivateLessonReportRevision(record);
  const snapshot = createPrivateLessonReportSnapshot(record, revision);
  assert.equal(snapshot.revision, revision);
  assert.equal(snapshot.summary, "오늘의 핵심");
  assert.equal(snapshot.nextDirection, "다음 수업 방향");
  assert.equal(
    reportUrlForRevision("https://in.archivepilates.com/api/privateLessonReport?recordId=plc-1&token=x", revision),
    `https://in.archivepilates.com/api/privateLessonReport?recordId=plc-1&token=x&rev=${revision}`,
  );
});

test("report links prefer immutable sent or approved snapshots", () => {
  const record = reportRecord();
  const approved = createPrivateLessonReportSnapshot(record, "approved-revision");
  const sent = createPrivateLessonReportSnapshot(
    { ...record, publicSummary: "발송된 오늘의 핵심" },
    "sent-revision",
  );
  const versioned = {
    ...record,
    approvedRevision: approved.revision,
    approvedReportSnapshot: approved,
    sentRevision: sent.revision,
    sentReportSnapshot: sent,
  };
  assert.equal(privateLessonReportSnapshotForView(versioned)?.revision, "sent-revision");
  assert.equal(privateLessonReportSnapshotForView(versioned, "approved-revision")?.revision, "approved-revision");
  assert.equal(privateLessonReportSnapshotForView(versioned, "missing-revision"), null);
});

test("legacy sent reports require one frozen snapshot instead of mutable fallback", () => {
  const legacySent = {
    ...reportRecord(),
    gptStatus: "published",
    publicReportApproval: { status: "sent", sentAt: now },
  };
  assert.equal(privateLessonReportSnapshotForView(legacySent), null);
  const frozen = createPrivateLessonReportSnapshot(legacySent, "legacy-frozen");
  assert.equal(
    privateLessonReportSnapshotForView({ ...legacySent, legacySentReportSnapshot: frozen })?.revision,
    "legacy-frozen",
  );
  assert.equal(
    privateLessonReportSnapshotForView(
      { ...legacySent, legacySentReportSnapshot: frozen },
      "unknown-revision",
    ),
    null,
  );
});

test("member report preserves long text and omits empty placeholder sections", () => {
  const nextDirection = [
    "다음 수업에서는 흉곽 움직임과 호흡의 연결을 충분히 반복합니다.",
    "고관절 안정성과 코어 연결을 함께 확인하고 일상에서도 편안하게 적용할 수 있도록 진행합니다.",
  ].join("\n");
  const html = renderPrivateLessonReportPage(
    {
      ...reportRecord(),
      postRecord: {
        focusAreas: ["흉곽"],
        changes: ["호흡 연결 개선"],
        nextDirection: "고관절 안정성과 코어 연결을 이어갑니다.",
        homework: "",
      },
      gptDraftNextDirection: nextDirection,
      publicNextDirection: nextDirection,
    },
    chartRequest(),
  );
  assert.match(html, /white-space:pre-wrap/);
  assert.ok(html.includes(nextDirection));
  assert.doesNotMatch(html, />홈워크</);
  assert.doesNotMatch(html, />좋아진 점</);
  assert.doesNotMatch(html, />집중 영역</);
  assert.doesNotMatch(html, /비어 있음|정리 중/);
});

test("survey answer changes invalidate manual report and approval state", () => {
  const patch = privateLessonReportSourceChangePatch();
  assert.equal(patch.gptStatus, "pending");
  assert.equal(patch.manualReportEdit, null);
  assert.equal(patch.approvedRevision, "");
  assert.equal(patch.approvedReportSnapshot, null);
  assert.equal(patch.publicReportApproval?.status, "pending");
});

test("pre-lesson changes wait for a post record before report generation", () => {
  const patch = privateLessonReportSourceChangePatch("waiting_post");
  assert.equal(patch.gptStatus, "waiting_post");
  assert.equal(patch.publicReportApproval?.status, "pending");
});

test("report is editable before send and locked while processing or after send", () => {
  assert.equal(privateLessonReportMutationLockReason(reportRecord()), "");
  assert.match(
    privateLessonReportMutationLockReason({
      ...reportRecord(),
      publicReportApproval: { status: "processing" },
    }),
    /발송이 시작/,
  );
  assert.match(
    privateLessonReportMutationLockReason({
      ...reportRecord(),
      publicReportApproval: { status: "sent", sentAt: now },
    }),
    /발송 완료/,
  );
});

test("private report send stays bound to the approved booking schedule", () => {
  const request = chartRequest();
  const record = reportRecord();
  const revision = currentPrivateLessonReportRevision(record);
  const approvedRecord = {
    ...record,
    approvedRevision: revision,
    approvedReportSnapshot: createPrivateLessonReportSnapshot(record, revision),
  };
  const booking = {
    bookingId: request.bookingId,
    memberId: request.memberId,
    memberName: request.memberName,
    staffId: request.staffId,
    staffName: request.staffName,
    lectureDate: request.lessonDate,
    lectureStartAt: request.lessonStartAt,
  } as any;

  assert.equal(privateLessonReportScheduleIssue(booking, request, approvedRecord), "");
  assert.match(
    privateLessonReportScheduleIssue(
      { ...booking, lectureStartAt: { toMillis: () => nowDate.getTime() + 60 * 60 * 1000 } },
      request,
      approvedRecord,
    ),
    /재승인/,
  );
  assert.match(
    privateLessonReportScheduleIssue({ ...booking, staffId: "staff-2" }, request, approvedRecord),
    /재승인/,
  );
});

test("permanent private survey dedupe survives phone changes", () => {
  const base = {
    candidateId: "private_survey_member-1_2026-07-29",
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트회원",
    memberPhone: "01011112222",
    type: "private_survey",
    status: "queued",
    templateCode: "private-survey-template",
    title: "프라이빗 사전설문",
    reason: "첫 수업",
    sourceDate: "2026-07-29",
    payload: {},
    attempts: 0,
    maxAttempts: 2,
    createdAt: now,
    updatedAt: now,
  } as any;
  assert.equal(
    alimtalkDedupeKey(base),
    alimtalkDedupeKey({ ...base, memberPhone: "01099998888" }),
  );
  assert.equal(
    alimtalkDedupeKey(base),
    alimtalkDedupeKey({ ...base, templateCode: "private-survey-template-v2" }),
  );
});

test("reservation open dedupe survives template and phone changes within the same week", () => {
  const base = reservationOpenCandidate();
  assert.equal(
    alimtalkDedupeKey(base),
    alimtalkDedupeKey({
      ...base,
      templateCode: "KA01TP260518023011547VpbovK8MrI9",
      memberPhone: "01099998888",
    }),
  );
  assert.notEqual(
    alimtalkDedupeKey(base),
    alimtalkDedupeKey({
      ...base,
      payload: { ...base.payload, reservationWeek: "8월 3주차" },
    }),
  );
});

test("reservation open approval is isolated from the daily Alimtalk approval", () => {
  assert.equal(alimtalkApprovalId("5330", "2026-08-03", "daily"), "5330_2026-08-03");
  assert.equal(
    alimtalkApprovalId("5330", "2026-08-03", "reservation_open"),
    "5330_2026-08-03_reservation_open",
  );
});

test("legacy private survey template is blocked until the native-link v2 template is configured", () => {
  const candidate = privateSurveyCandidate();
  const configuredTemplateCode = "KA01TP_PRIVATE_SURVEY_NATIVE_V2";
  assert.match(
    privateSurveyTemplateContractIssue({
      ...candidate,
      templateCode: LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
    }),
    /v2 템플릿 승인·설정 전/,
  );
  assert.equal(
    privateSurveyTemplateContractIssue(
      {
        ...candidate,
        templateCode: configuredTemplateCode,
      },
      {
        templateCode: configuredTemplateCode,
        label: "프라이빗 사전설문 안내 v2",
        name: "프라이빗 사전설문 안내 v2",
        status: "APPROVED",
        source: "solapi",
        lastError: null,
        channelId: "channel-1",
        content: "#{이름}님, 사전설문을 작성해 주세요.",
        buttonUrls: ["https://in.archivepilates.com/s/#{링크ID}/"],
        messageType: "BA",
        emphasizeType: "IMAGE",
        imageId: NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID,
      },
      configuredTemplateCode,
    ),
    "",
  );
  assert.match(
    privateSurveyTemplateContractIssue(
      { ...candidate, templateCode: configuredTemplateCode },
      {
        templateCode: configuredTemplateCode,
        label: "프라이빗 사전설문 안내 v2",
        name: "프라이빗 사전설문 안내 v2",
        status: "APPROVED",
        source: "solapi",
        lastError: null,
        channelId: "channel-1",
        content: "#{이름}님, 사전설문을 작성해 주세요.",
        buttonUrls: ["https://forms.gle/legacy"],
        messageType: "BA",
        emphasizeType: "IMAGE",
        imageId: NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID,
      },
      configuredTemplateCode,
    ),
    /버튼 URL 불일치/,
  );
});

test("private survey v2 validates only the approved short-link button", () => {
  const rule = alimtalkTemplateTargetRule("private_survey");
  assert.deepEqual(
    rule?.buttonUrlRules?.map(({ template }) => template),
    ["https://in.archivepilates.com/s/#{링크ID}/"],
  );
  assert.equal(
    solapiButtonUrlLengthIssue({
      rules: rule?.buttonUrlRules,
      variables: {
        "#{설문ID}": "psr-e2e-123456789012",
        "#{접근토큰}": "12345678901234567890123456789012",
        "#{링크ID}": "ps-e2e-123456789012",
      },
    }),
    "",
  );
});

test("staff private survey v2 uses a short link even when the legacy detail URL exceeds 100 characters", () => {
  assert.equal(NATIVE_STAFF_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE, "KA01TP260808034937468FF5LLYH823H");
  assert.equal(
    surveyDetailButtonUrlLengthIssue(
      "psr-bd6de316d12a",
      "12345678901234567890123456789012",
      "sv-ae419981b162",
      "short_link",
    ),
    "",
  );
  assert.match(
    surveyDetailButtonUrlLengthIssue(
      "psr-bd6de316d12a",
      "12345678901234567890123456789012",
      "sv-ae419981b162",
      "legacy_direct",
    ),
    /100자 이하/,
  );
});

test("private survey template requires the preserved ARCHIVE image contract", () => {
  const baseState = {
    templateCode: "template-image",
    label: "프라이빗 사전설문 안내 v2",
    name: "프라이빗 사전설문 안내 v2",
    status: "APPROVED",
    source: "solapi",
    lastError: null,
    messageType: "BA",
    emphasizeType: "IMAGE",
    imageId: NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID,
  } as const;
  assert.equal(
    alimtalkImageTemplateContractIssue(
      baseState,
      NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID,
      "프라이빗 사전설문 템플릿",
    ),
    "",
  );
  assert.match(
    alimtalkImageTemplateContractIssue(
      { ...baseState, emphasizeType: "NONE" },
      NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID,
      "프라이빗 사전설문 템플릿",
    ),
    /이미지형/,
  );
  assert.match(
    alimtalkImageTemplateContractIssue(
      { ...baseState, imageId: "different-image" },
      NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID,
      "프라이빗 사전설문 템플릿",
    ),
    /이미지 ID 불일치/,
  );
  assert.match(
    alimtalkImageTemplateContractIssue(
      { ...baseState, messageType: "EX" },
      NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID,
      "프라이빗 사전설문 템플릿",
    ),
    /기본형/,
  );
});

test("reservation open candidates use only the approved v4 template contract", () => {
  const candidate = reservationOpenCandidate();
  assert.match(
    reservationOpenTemplateContractIssue({
      ...candidate,
      templateCode: "KA01TP260518023011547VpbovK8MrI9",
    }),
    /템플릿 설정 불일치/,
  );
  assert.equal(
    reservationOpenTemplateContractIssue(candidate, {
      templateCode: RESERVATION_OPEN_ALIMTALK_TEMPLATE_CODE,
      label: "스튜디오메이트 예약 안내 v4",
      name: "아카이브 스튜디오메이트 예약 안내 v4",
      status: "APPROVED",
      source: "solapi",
      lastError: null,
      channelId: "channel-1",
      content: "#{이름}님, #{예약주차} 예약이 열립니다.",
      buttonUrls: [
        "https://archivepilates.notion.site/notice",
        "https://archivepilates.notion.site/studiomate",
      ],
      messageType: "BA",
      emphasizeType: "IMAGE",
      imageId: RESERVATION_OPEN_ALIMTALK_IMAGE_ID,
    }),
    "",
  );
});

test("reservation open v4 blocks image, variable, and button contract drift", () => {
  const candidate = reservationOpenCandidate();
  const baseState = {
    templateCode: RESERVATION_OPEN_ALIMTALK_TEMPLATE_CODE,
    label: "스튜디오메이트 예약 안내 v4",
    name: "아카이브 스튜디오메이트 예약 안내 v4",
    status: "APPROVED",
    source: "solapi",
    lastError: null,
    channelId: "channel-1",
    content: "#{이름}님, #{예약주차} 예약이 열립니다.",
    buttonUrls: [
      "https://archivepilates.notion.site/notice",
      "https://archivepilates.notion.site/studiomate",
    ],
    messageType: "BA",
    emphasizeType: "IMAGE",
    imageId: RESERVATION_OPEN_ALIMTALK_IMAGE_ID,
  } as const;
  assert.match(
    reservationOpenTemplateContractIssue(candidate, { ...baseState, imageId: "different-image" }),
    /이미지 ID 불일치/,
  );
  assert.match(
    reservationOpenTemplateContractIssue(candidate, {
      ...baseState,
      content: "#{이름}님, 예약이 열립니다.",
    }),
    /예약주차 변수 없음/,
  );
  assert.match(
    reservationOpenTemplateContractIssue(candidate, {
      ...baseState,
      buttonUrls: ["https://archivepilates.notion.site/notice"],
    }),
    /예약방법 버튼 URL 불일치/,
  );
});

test("template status errors fail closed but remain retryable", () => {
  const errorState = {
    templateCode: "template-1",
    label: "테스트",
    name: "테스트",
    status: "UNKNOWN",
    source: "error",
    lastError: "temporary SOLAPI failure",
  } as const;
  assert.deepEqual(templateReadinessFromState(errorState), {
    approved: false,
    retryable: true,
    state: errorState,
  });
  assert.equal(
    isRetryableTemplateStatusIssue("템플릿 상태 확인 일시 실패: template-1"),
    true,
  );
});

test("approved recommended meal v2 template keeps the image and dual-link contract", () => {
  const candidate = recommendedMealCandidate();
  const state = {
    templateCode: RECOMMENDED_MEAL_ALIMTALK_TEMPLATE_CODE,
    label: "아카이브 추천식단 프로그램 v2",
    name: "아카이브 추천식단 프로그램 v2",
    status: "APPROVED",
    source: "solapi",
    lastError: null,
    channelId: RECOMMENDED_MEAL_ALIMTALK_CHANNEL_ID,
    content: "#{이름}님, 식단 프로그램 설문을 보내드립니다.",
    buttonUrls: [
      "https://in.archivepilates.com/s/#{링크ID}/",
      "https://in.archivepilates.com/s/#{리포트링크ID}/",
    ],
    buttons: [
      {
        name: "식단 설문 작성",
        type: "WL",
        mobileUrl: "https://in.archivepilates.com/s/#{링크ID}/",
        desktopUrl: "https://in.archivepilates.com/s/#{링크ID}/",
      },
      {
        name: "추천식단 확인",
        type: "WL",
        mobileUrl: "https://in.archivepilates.com/s/#{리포트링크ID}/",
        desktopUrl: "https://in.archivepilates.com/s/#{리포트링크ID}/",
      },
    ],
    messageType: "BA",
    emphasizeType: "IMAGE",
    imageId: RECOMMENDED_MEAL_ALIMTALK_IMAGE_ID,
  } as const;
  assert.equal(recommendedMealTemplateContractIssue(candidate, state), "");
  assert.match(
    recommendedMealTemplateContractIssue(candidate, { ...state, imageId: "different-image" }),
    /이미지 ID 불일치/,
  );
  assert.match(
    recommendedMealTemplateContractIssue(candidate, { ...state, content: "설문을 보내드립니다." }),
    /회원명 변수 없음/,
  );
  assert.match(
    recommendedMealTemplateContractIssue(candidate, { ...state, buttonUrls: [] }),
    /설문 버튼 URL 불일치/,
  );
  assert.match(
    recommendedMealTemplateContractIssue(candidate, {
      ...state,
      buttonUrls: ["https://in.archivepilates.com/s/#{링크ID}/"],
    }),
    /리포트 버튼 URL 불일치/,
  );
  assert.match(
    recommendedMealTemplateContractIssue(candidate, {
      ...state,
      buttons: [state.buttons[0], { ...state.buttons[1], type: "AL" }],
    }),
    /2버튼 계약 불일치/,
  );
  assert.match(
    recommendedMealTemplateContractIssue(candidate, { ...state, channelId: "wrong-channel" }),
    /채널 ID 불일치/,
  );
});

test("private survey send guard blocks cancelled bookings at send time", () => {
  const candidate = privateSurveyCandidate();
  const request = privateSurveyRequest();
  const activeBooking = privateSurveyBooking();
  assert.equal(privateSurveySourceIssue(candidate, request, activeBooking, nowDate.getTime()), "");
  assert.match(
    privateSurveySourceIssue(
      candidate,
      request,
      { ...activeBooking, appStatus: "cancel" },
      nowDate.getTime(),
    ),
    /예약 상태/,
  );
  assert.match(
    privateSurveySourceIssue(
      candidate,
      request,
      { ...activeBooking, sourceStatus: "missing_from_latest_reservation_import" },
      nowDate.getTime(),
    ),
    /취소·삭제·변경/,
  );
  assert.match(
    privateSurveySourceIssue(
      candidate,
      request,
      {
        ...activeBooking,
        sessionOrder: { counted: false, excludedReason: "rescheduled_duplicate" },
      },
      nowDate.getTime(),
    ),
    /회차 제외 예약/,
  );
  assert.equal(
    privateSurveySourceIssue(
      candidate,
      request,
      {
        ...activeBooking,
        appStatus: "cancel",
        supersededByBookingId: "booking-2",
      },
      nowDate.getTime(),
      {
        ...activeBooking,
        bookingId: "booking-2",
        lectureStartAt: {
          toMillis: () => nowDate.getTime() + 60 * 60 * 1000,
        },
      },
    ),
    "",
  );
});

test("private survey send guard rejects a stale access token", () => {
  const candidate = privateSurveyCandidate();
  const request = privateSurveyRequest();
  const booking = privateSurveyBooking();
  assert.equal(privateSurveySourceIssue(candidate, request, booking, nowDate.getTime()), "");
  assert.match(
    privateSurveySourceIssue(
      { ...candidate, payload: { ...candidate.payload, accessToken: "stale-token" } },
      request,
      booking,
      nowDate.getTime(),
    ),
    /접근 토큰/,
  );
});

test("private survey send guard blocks delivery after the lesson starts", () => {
  const candidate = privateSurveyCandidate();
  const request = privateSurveyRequest();
  const booking = {
    ...privateSurveyBooking(),
    lectureStartAt: {
      toMillis: () => nowDate.getTime() - 1,
    },
  };
  assert.match(privateSurveySourceIssue(candidate, request, booking, nowDate.getTime()), /수업 시작 이후/);
});

test("private lesson session projection starts with post-only recording", () => {
  const request = chartRequest();
  assert.equal(privateLessonSessionProjection(request.requestId, request, undefined).workflowStage, "recording");
  assert.equal(
    privateLessonSessionProjection(request.requestId, { ...request, preStatus: "submitted" }, undefined).workflowStage,
    "recording",
  );
  assert.equal(
    privateLessonSessionProjection(request.requestId, request, {
      ...reportRecord(),
      postSubmittedAt: now,
      gptStatus: "draft_created",
    }).workflowStage,
    "report_review",
  );
  assert.equal(
    privateLessonSessionProjection(request.requestId, request, {
      ...reportRecord(),
      gptStatus: "published",
      publicReportApproval: { status: "sent", sentAt: now },
      sentRevision: "revision-1",
    }).workflowStage,
    "delivered",
  );
});

test("cancelled and unverified rounds are explicit side states", () => {
  const request = chartRequest();
  assert.equal(
    privateLessonSessionProjection(request.requestId, { ...request, status: "cancelled" }, undefined).workflowStage,
    "cancelled",
  );
  assert.equal(
    privateLessonSessionProjection(request.requestId, { ...request, sessionNumber: null }, undefined).workflowStage,
    "needs_review",
  );
  assert.equal(
    privateLessonSessionProjection(
      request.requestId,
      request,
      undefined,
      undefined,
      { roundVerified: false },
    ).workflowStage,
    "needs_review",
  );
  assert.equal(
    privateLessonRoundVerified(
      {
        ...privateSurveyBooking(),
        sessionOrder: { counted: true, privateCumulativeRound: 3 },
      },
      3,
    ),
    true,
  );
  assert.equal(
    privateLessonRoundVerified(
      {
        ...privateSurveyBooking(),
        sessionOrder: { counted: true, privateCumulativeRound: 4 },
      },
      3,
    ),
    false,
  );
});

function chartRequest(): any {
  return {
    requestId: "plc-1",
    studioId: "5330",
    bookingId: "booking-1",
    lectureId: "lecture-1",
    memberId: "member-1",
    memberName: "테스트회원",
    memberPhone: "00000000000",
    memberPhoneLast4: "0000",
    staffId: "staff-1",
    staffName: "테스트강사",
    staffPhone: "00000000001",
    lessonDate: "2026-07-29",
    lessonStartAt: now,
    lessonEndAt: now,
    sessionNumber: 3,
    accessTokenHash: "hash",
    preUrl: "https://example.com/pre",
    postUrl: "https://example.com/post",
    preShortUrl: "https://example.com/s/pre",
    postShortUrl: "https://example.com/s/post",
    status: "pending",
    preStatus: "pending",
    postStatus: "pending",
    alimtalk: { status: "template_pending", templateName: "test", lastError: null },
    createdAt: now,
    updatedAt: now,
  };
}

function reportRecord(): any {
  return {
    recordId: "plc-1",
    requestId: "plc-1",
    studioId: "5330",
    bookingId: "booking-1",
    memberId: "member-1",
    memberName: "테스트회원",
    memberPhone: "00000000000",
    memberPhoneLast4: "0000",
    staffId: "staff-1",
    staffName: "테스트강사",
    lessonDate: "2026-07-29",
    lessonStartAt: now,
    sessionNumber: 3,
    gptStatus: "pending",
    gptDraftSummary: "오늘의 핵심",
    publicSummary: "오늘의 핵심",
    gptDraftNextDirection: "다음 수업 방향",
    publicNextDirection: "다음 수업 방향",
    postRecord: { homework: "호흡 연습" },
    media: { files: [] },
    publicReportApproval: { status: "pending" },
    createdAt: now,
    updatedAt: now,
  };
}

function privateSurveyCandidate(): any {
  return {
    candidateId: "private_survey_member-1_2026-07-29",
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트회원",
    memberPhone: "01011112222",
    type: "private_survey",
    status: "queued",
    templateCode: "private-survey-template",
    title: "프라이빗 사전설문",
    reason: "첫 수업",
    sourceDate: "2026-07-29",
    payload: { surveyId: "psr-test", bookingId: "booking-1", accessToken: "survey-token" },
    attempts: 0,
    maxAttempts: 2,
    createdAt: now,
    updatedAt: now,
  };
}

function reservationOpenCandidate(): any {
  return {
    candidateId: "reservation_open_member-1_2026-08-10",
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트회원",
    memberPhone: "01011112222",
    type: "reservation_open",
    status: "queued",
    templateCode: RESERVATION_OPEN_ALIMTALK_TEMPLATE_CODE,
    title: "예약 안내",
    reason: "예약 오픈",
    sourceDate: "2026-08-03",
    payload: { reservationWeek: "8월 2주차" },
    attempts: 0,
    maxAttempts: 2,
    createdAt: now,
    updatedAt: now,
  };
}

function recommendedMealCandidate(): any {
  return {
    candidateId: "recommended_meal_member-1_2026-07-31",
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트회원",
    memberPhone: "01011112222",
    type: "recommended_meal_survey",
    status: "queued",
    templateCode: RECOMMENDED_MEAL_ALIMTALK_TEMPLATE_CODE,
    title: "ARCHIVE 추천식단 프로그램",
    reason: "운영자 승인 단건 발송",
    sourceDate: "2026-07-31",
    payload: { shortLinkId: "meal-link-1", reportLinkId: "meal-report-link-1" },
    attempts: 0,
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function privateSurveyRequest(): any {
  return {
    requestId: "psr-test",
    memberId: "member-1",
    bookingId: "booking-1",
    accessTokenHash: createHash("sha256").update("survey-token").digest("hex"),
    status: "pending",
    expiresAt: {
      toMillis: () => nowDate.getTime() + 24 * 60 * 60 * 1000,
    },
  };
}

function privateSurveyBooking(): any {
  return {
    bookingId: "booking-1",
    memberId: "member-1",
    appStatus: "reserved",
    sourceStatus: "active",
    lessonType: "private",
    ticketName: "프라이빗 20회",
  };
}
