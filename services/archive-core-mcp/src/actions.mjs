// Fixed onCall exports and handler inputs, cross-checked against core/assets and CORE HTML.
// This catalog grants no permission and makes no deployment/liveness claim. Backend guards remain authoritative.
// required lists the CORE input spelling; aliases and conditional requirements are described in notes.
// sources binds input document IDs only, never phone numbers, ticket keys, device IDs or mirror-derived targets.
export const ACTIONS = [
  {
    name: 'getCoreAirConditioners', mode: 'read', label: '에어컨 상태 조회', memberFacing: false,
    required: [], sources: [],
    notes: 'deviceIds는 선택 배열(최대 8개)이며 ThinQ 기기 ID이지 Firestore 문서 ID가 아닙니다. 서버 허용 기기·권한·조회 제한을 유지합니다.',
  },
  {
    name: 'operatorControlCoreAirConditioner', mode: 'write', label: '에어컨 설정 변경', memberFacing: false,
    required: ['commandId', 'deviceId', 'field', 'value', 'expectedVersion'], sources: [],
    notes: 'commandId는 새 명령의 중복방지 ID이므로 기존 문서가 필수인 원본으로 조회하지 않습니다. 최신 상태의 expectedVersion과 서버 기기 잠금·단회 실행 가드를 유지합니다. 결과 불명 시 재전송하지 않습니다.',
  },
  {
    name: 'operatorReconcileCoreAirConditioner', mode: 'write', label: '에어컨 명령 결과 확인·잠금 조정', memberFacing: false,
    required: ['deviceId', 'commandId', 'acknowledge'],
    sources: [{ collection: 'facilityClimateCommands', key: 'commandId' }],
    notes: 'acknowledge는 boolean 필수입니다. false도 명령 원장의 확인 상태를 갱신할 수 있어 쓰기로 분류합니다. true는 현재 상태 확인 후 잠금 해제 승인이지 기존 제어 재전송이 아닙니다.',
  },
  {
    name: 'getCoreInstructorWorkspace', mode: 'read', label: '내 강사 업무 조회', memberFacing: false,
    required: [], sources: [],
    notes: 'month는 선택 YYYY-MM입니다. 인증된 강사의 bookings·privateLessonChartRequests 범위만 반환하며 임의 staffId를 전달해 권한을 확대하지 않습니다.',
  },
  {
    name: 'getInstructorHome', mode: 'read', label: '강사 수업 홈 조회', memberFacing: false,
    required: [], sources: [{ collection: 'staffs', key: 'staffId', optional: true }],
    notes: 'date/fromDate/toDate/staffId는 선택입니다. 최대 14일 instructorViews를 읽는 파생 조회이며 다른 강사 조회는 서버 관리자 권한이 필요합니다. 결과를 외부 쓰기 대상 원천으로 사용하지 않습니다.',
  },
  {
    name: 'searchMembers', mode: 'read', label: '담당 회원 검색', memberFacing: false,
    required: ['query'], sources: [],
    notes: 'query는 2자 이상, type은 선택 name/phone(기본 name)입니다. 최근 90일 bookings와 담당 권한 기준 최대 20명이며 전체 실시간 StudioMate 회원 검색이 아닙니다.',
  },
  {
    name: 'getMemberMemoHistory', mode: 'read', label: '회원 메모 이력 조회', memberFacing: false,
    required: ['memberId'], sources: [{ collection: 'memberProfiles', key: 'memberId' }],
    notes: 'limit은 선택 1~50입니다. 담당 이력·공개범위 검증을 유지합니다. memberMemos가 메모 원천이며 출석 요약은 파생 조회입니다. 민감한 메모 전문을 일반 결과에 노출하지 않습니다.',
  },
  {
    name: 'submitBookingAttendance', mode: 'write', label: '예약 출석 상태 변경', memberFacing: false,
    required: ['bookingId', 'attendanceStatus'], sources: [{ collection: 'bookings', key: 'bookingId' }],
    notes: 'attendanceStatus는 attended/absent/late_cancel/unchecked입니다. 담당 강사·예약확정·수업 시작 후 조건을 유지합니다. 원장 변경 및 레거시 writeQueue의 bookingAttendanceUpdate를 생성합니다. 현행 Excel 기본 정책과 외부 작업 실행 경로를 별도 확인해야 하며 이 목록은 운영 활성화 승인이 아닙니다.',
  },
  {
    name: 'submitMemberMemo', mode: 'write', label: '수업 회원 메모 저장', memberFacing: false,
    required: ['bookingId', 'memberId', 'lectureId', 'content'],
    sources: [{ collection: 'bookings', key: 'bookingId' }, { collection: 'memberProfiles', key: 'memberId' },
      { collection: 'lectures', key: 'lectureId' }],
    notes: '예약의 회원·수업 ID와 입력 ID를 일치시킨 뒤 사용합니다. visibility와 memoType은 선택입니다. 현재 member_note는 studiomateMemoWriteJobs가 아닌 레거시 writeQueue의 memberMemoCreate를 생성하므로 현행 append-only·memoId 중복방지·브라우저 잠금 경로와 별도 대조가 필요합니다. 서버가 새 memoId를 생성하므로 자동 재시도하지 않습니다.',
  },
  {
    name: 'lookupKioskCheckin', mode: 'read', label: '키오스크 오늘 예약 조회', memberFacing: false,
    required: ['phoneLast4'], sources: [],
    notes: 'phoneLast4는 정확한 4자리, date는 선택입니다. 서버 키오스크/직원 접근 검증을 유지하며 끝자리 일치만으로 외부 작업의 회원 신원을 확정하지 않습니다.',
  },
  {
    name: 'submitKioskCheckin', mode: 'write', label: '키오스크 출석·주차 접수', memberFacing: false,
    required: ['bookingId', 'memberId'],
    sources: [{ collection: 'bookings', key: 'bookingId' }, { collection: 'memberProfiles', key: 'memberId' }],
    notes: '오늘 예약확정 및 예약 회원 일치를 서버에서 검증합니다. carNumber가 있으면 saveVehicle/applyParking은 기본 true입니다. 로컬 출석·차량 저장·주차 작업 생성이며 StudioMate 출석 전송 완료가 아닙니다.',
  },
  {
    name: 'getKioskParkingJobStatus', mode: 'read', label: '키오스크 주차 작업 조회', memberFacing: false,
    required: ['jobId'], sources: [{ collection: 'parkingDiscountJobs', key: 'jobId' }],
    notes: '정확한 주차 작업 ID와 서버 접근·지점 검증을 사용합니다. 큐 생성과 실제 할인 적용을 구분합니다.',
  },
  {
    name: 'getParkingDashboard', mode: 'read', label: '주차 운영 현황 조회', memberFacing: false,
    required: [], sources: [],
    notes: '서버 관리자 권한으로 등록 차량·할인 작업·운영 설정을 조회합니다. 차량 및 개인정보는 필요한 범위로만 표시합니다.',
  },
  {
    name: 'registerParkingVehicle', mode: 'write', label: '주차 차량 등록', memberFacing: false,
    required: ['carNumber'], sources: [],
    notes: 'ownerType은 member/staff/visitor(기본 member)이며 visitor 이외에는 ownerName 또는 ownerPhone이 필요합니다. note는 선택입니다. 서버가 신원을 매칭하고 vehicleId를 계산하므로 번호를 문서 ID로 사용하지 않습니다.',
  },
  {
    name: 'removeParkingVehicle', mode: 'write', label: '등록 차량 해제', memberFacing: false,
    required: ['vehicleId'], sources: [{ collection: 'parkingVehicles', key: 'vehicleId' }],
    notes: 'pv_ 차량 원본 ID를 사용합니다. 차량 비활성화와 연결 카드·기본 차량 정리를 서버가 수행합니다. 향후 자동 할인 대상에 영향을 줍니다.',
  },
  {
    name: 'runParkingAutoApplyNow', mode: 'write', label: '주차 자동 적용 작업 생성', memberFacing: false,
    required: [], sources: [],
    notes: 'date는 선택(기본 오늘)입니다. 서버가 현재 예약·등록 차량으로 할인 작업을 생성하고 기존 작업을 중복방지합니다. 주차 공급자 적용 완료와 작업 생성은 별개입니다.',
  },
  {
    name: 'getAlimtalkTargetValidation', mode: 'read', label: '알림톡 후보 원본 검증', memberFacing: false,
    required: ['candidateIds'], sources: [{ collection: 'alimtalkCandidates', key: 'candidateIds' }],
    notes: 'candidateIds는 정확한 후보 ID 배열 1~10개입니다. sources.key가 배열이므로 원소별 문서 스냅샷을 확인해야 합니다. 이 조회는 발송 승인이 아닙니다.',
  },
  {
    name: 'getMemberOperationProgress', mode: 'read', label: '홀딩 안내 처리 단계 조회', memberFacing: false,
    required: ['kind', 'operationId'],
    sources: [{ collection: 'holdingNoticeEvents', key: 'operationId', optional: true },
      { collection: 'alimtalkCandidates', key: 'operationId', optional: true },
      { collection: 'alimtalkSends', key: 'operationId', optional: true },
      { collection: 'holdingNoticeClaims', key: 'operationId', optional: true }],
    notes: 'kind는 holding만 지원하며 operationId는 holding_operator_notice_와 SHA-256 해시입니다. 증거 부재도 정상 조회 결과입니다. 서버가 파생 memoId로 memberMemos·studiomateMemoWriteJobs를 추가 확인합니다. 실시간 StudioMate 재조회나 발송 근거가 아닙니다.',
  },
  {
    name: 'operatorApproveHoldingNotice', mode: 'write', label: '홀딩 현황 안내 승인', memberFacing: true,
    required: ['candidateId', 'expectedSnapshot'], sources: [{ collection: 'alimtalkCandidates', key: 'candidateId' }],
    notes: 'holding_notice_ 후보 ID와 현재 원본의 승인 스냅샷 해시가 필요합니다. 서버의 관리자·지점·설정·원본 일치 검증을 유지합니다. 승인은 후속 회원 발송 큐를 허용하므로 회원 발송 시간 및 명시적 대상·내용 승인을 적용합니다.',
  },
  {
    name: 'operatorSendPricingInquiryAlimtalk', mode: 'write', label: '수강료 문의 안내 발송', memberFacing: true,
    required: ['phone'], sources: [],
    notes: 'CORE 입력은 phone(서버 별칭 memberPhone), memberName/note는 선택입니다. 현재 승인 템플릿·중복 이력·수신번호·09:00~23:00 미만 KST 검증을 유지합니다. 요청 원장 ID는 서버가 계산하며 전화번호가 문서 ID는 아닙니다.',
  },
  {
    name: 'operatorSendRecommendedMealProgramAlimtalk', mode: 'write', label: '추천식단 설문 안내 발송', memberFacing: true,
    required: ['phone'], sources: [],
    notes: 'CORE 입력은 phone(서버 별칭 memberPhone), memberName/note는 선택입니다. 회원·최신 InBody·동의·템플릿·중복 및 발송시간 가드를 유지합니다. testCampaign은 일반 업무 권한이나 시간 제한 우회 수단이 아닙니다.',
  },
  {
    name: 'getRecommendedMealProgramReview', mode: 'read', label: '추천식단 검토 원본 조회', memberFacing: false,
    required: ['requestId'], sources: [{ collection: 'recommendedMealProgramRequests', key: 'requestId' }],
    notes: '동일 requestId의 responses/drafts/reports와 연결 InBody를 서버에서 결합합니다. 설문·건강정보는 일반 결과에서 제한하고 검토 권한 범위 안에서만 사용합니다.',
  },
  {
    name: 'generateRecommendedMealProgramDraft', mode: 'write', label: '추천식단 관리자 작성 대기 표시', memberFacing: false,
    required: ['requestId'], sources: [{ collection: 'recommendedMealProgramRequests', key: 'requestId' }],
    notes: '호환용 endpoint입니다. 현재 구현은 operator_call_required 상태를 기록하며 모델 호출이나 자동 초안 생성을 하지 않습니다. 이름만 보고 AI 생성 완료로 보고하지 않습니다.',
  },
  {
    name: 'saveRecommendedMealProgramDraft', mode: 'write', label: '추천식단 초안 저장', memberFacing: false,
    required: ['requestId', 'expectedRevision', 'expectedResponseHash', 'publicContent'],
    sources: [{ collection: 'recommendedMealProgramRequests', key: 'requestId' },
      { collection: 'recommendedMealProgramResponses', key: 'requestId' },
      { collection: 'recommendedMealProgramDrafts', key: 'requestId', optional: true }],
    notes: '초안이 없으면 expectedRevision은 빈 문자열입니다. 현재 설문 해시와 revision을 사용하며 변경 시 저장을 거부합니다. reviewAcknowledged/authoringMode는 선택이고 검토 사유가 있으면 확인이 필요합니다. publicContent 세부 스키마와 공개 후 수정금지는 서버 검증을 따릅니다.',
  },
  {
    name: 'operatorPublishRecommendedMealPlan', mode: 'write', label: '추천식단 승인·공개', memberFacing: true,
    required: ['requestId', 'confirmPublish'],
    sources: [{ collection: 'recommendedMealProgramRequests', key: 'requestId' },
      { collection: 'recommendedMealProgramDrafts', key: 'requestId' }],
    notes: 'confirmPublish=true가 필요합니다. 최초 설문 링크에 현재 검토 revision을 공개하며 별도 도착 알림톡 발송이 아닙니다. 공개 후 수정할 수 없고 기존 공개·revision·건강 검토 가드를 유지합니다.',
  },
  {
    name: 'getRefundMemberTickets', mode: 'read', label: '환불 대상 회원·수강권 조회', memberFacing: false,
    required: [], sources: [{ collection: 'memberProfiles', key: 'memberId', optional: true }],
    notes: 'memberId 또는 memberName+memberPhone으로 조회합니다. memberId/전화번호 없이 memberName만 입력하면 후보 검색입니다. 최소 한 조회 방식은 필수이며 required 배열은 이 대체 조건을 표현하지 않습니다. 회원 확정 전 환불 동의서를 요청하지 않습니다.',
  },
  {
    name: 'previewRefund', mode: 'read', label: '환불 금액 미리보기', memberFacing: false,
    required: ['ticketKey', 'ticketKind'], sources: [{ collection: 'memberProfiles', key: 'memberId', optional: true }],
    notes: 'memberId 또는 memberName+memberPhone이 추가 필수입니다. ticketKind=count/period이며 ticketKey는 프로필 내 수강권 식별자이지 문서 ID가 아닙니다. requestedAt/paidAmount/normalUnitAmount/giftDeductionAmount/paymentSourceNote는 선택이나 원천에 따라 금액 근거가 필요합니다. 최신 calculationHash를 후속 발송에 사용합니다.',
  },
  {
    name: 'queueRefundStudioMateSms', mode: 'write', label: '환불 안내 문자 작업 접수', memberFacing: true,
    required: ['ticketKey', 'ticketKind', 'calculationHash', 'confirmed'],
    sources: [{ collection: 'memberProfiles', key: 'memberId', optional: true }],
    notes: 'previewRefund와 동일한 회원 대체 입력·계산 입력 및 confirmed=true가 필요합니다. 현재 계산 해시를 다시 검증해 StudioMate 문자 큐를 생성합니다. 큐 등록은 발송·도달 완료가 아니며 발송시간·중복·결과 불명 재전송 금지를 유지합니다.',
  },
  {
    name: 'sendRefundAgreement', mode: 'write', label: '환불 동의서 요청 접수', memberFacing: true,
    required: ['ticketKey', 'ticketKind', 'calculationHash', 'confirmed'],
    sources: [{ collection: 'memberProfiles', key: 'memberId', optional: true }],
    notes: 'previewRefund와 동일한 회원 대체 입력·계산 입력 및 confirmed=true가 필요합니다. 서버가 환불 원장과 이폼싸인 요청 큐를 생성하며 실제 환불·서명 완료는 아닙니다. 현행 계약 상태·현재 계산 해시·중복·회원 요청 시간 가드를 유지합니다.',
  },
  {
    name: 'getInstructorLessonRegistrationDashboard', mode: 'read', label: '강사레슨 접수·명단 조회', memberFacing: false,
    required: [], sources: [],
    notes: 'limit은 선택 최대 100입니다. 서버의 등록·작업·수강권 원천 대조 결과를 사용하며 단순 파생 카드만으로 좌석이나 결제를 확정하지 않습니다.',
  },
  {
    name: 'operatorCreateInstructorLessonRegistration', mode: 'write', label: '강사레슨 등록 확정 접수', memberFacing: true,
    required: ['memberName', 'memberPhone', 'lessonDate', 'paymentMethod', 'paymentConfirmed', 'seatConfirmed'], sources: [],
    notes: '일반·팀 확정 접수는 paymentConfirmed=true와 seatConfirmed=true가 필요합니다. courseKind=waitlist는 paymentMethod=none, paymentConfirmed=false, seatConfirmed=false로 내부 대기만 등록하며 정원 점유·수강권·가입서·안내 작업을 만들지 않습니다. 같은 연락처·수강일의 대기를 이후 확정 접수하면 기존 중복키와 대기 이력을 보존하고 결제·접수 확인 후 기존 정규 처리로 전환합니다. 서버가 registrationId를 계산하며 취소·기존 접수 가드는 유지합니다. 접수는 결제·예약·전자서명 요청 완료가 아닙니다.',
  },
  {
    name: 'operatorQueueInstructorLessonCancellation', mode: 'write', label: '강사레슨 취소 작업 접수', memberFacing: false,
    required: ['memberId', 'lessonDate', 'reason', 'confirmed'],
    sources: [{ collection: 'instructorLessonRegistrations', key: 'registrationId', optional: true }],
    notes: 'confirmed=true, 실제 StudioMate 숫자 memberId, 오늘 이후 수강일 및 2~200자 사유가 필요합니다. registrationId는 선택입니다. memberId는 프로필 문서 ID와 다를 수 있어 서버가 studiomateMemberId로도 해석합니다. 수강권·예약 취소 및 미발송 후보 차단 큐이며 환불 실행이 아닙니다.',
  },
  {
    name: 'confirmInstructorLessonBookingAndQueueAlimtalk', mode: 'write', label: '강사레슨 예약 확인·확정 안내 접수', memberFacing: true,
    required: ['registrationId'], sources: [{ collection: 'instructorLessonRegistrations', key: 'registrationId' }],
    notes: '검증된 발급 수강권·수강자·취소·현재 등록 원본을 확인한 뒤 확정 알림톡 후보를 생성합니다. 후보 생성과 공급자 접수·최종 도달을 구분하며 명시적 승인·발송시간·교차채널 중복 가드를 유지합니다.',
  },
  {
    name: 'getInstructorEvaluationQuiz', mode: 'read', label: '강사 평가 문항·대상 조회', memberFacing: false,
    required: [], sources: [],
    notes: '서버가 직원 권한에 따라 활성 강사 목록과 공개 문항을 반환합니다. 다른 강사 권한을 클라이언트 필드로 만들지 않습니다.',
  },
  {
    name: 'submitInstructorEvaluationQuiz', mode: 'write', label: '강사 평가 답안 제출', memberFacing: false,
    required: ['answers'], sources: [{ collection: 'staffs', key: 'staffId', optional: true },
      { collection: 'staffs', key: 'targetStaffId', optional: true }],
    notes: 'staffId(별칭 targetStaffId)는 선택이며 기본은 인증 강사입니다. answers 구조·채점·담당 권한은 서버가 검증합니다. 평가 원장·인사 카드 저장 및 내부 보고 메일이 발생할 수 있고 새 submissionId를 생성하므로 자동 재제출하지 않습니다.',
  },
  {
    name: 'adjustInstructorEvaluationEssayScore', mode: 'write', label: '강사 평가 서술형 점수 조정', memberFacing: false,
    required: ['submissionId', 'earnedPoints'], sources: [{ collection: 'staffEvaluationSubmissions', key: 'submissionId' }],
    notes: 'earnedPoints의 서버 별칭은 score입니다. questionId는 기본 q19_imprint_description, note는 선택입니다. 서버 관리자 권한·허용 점수·서술형 문항 검증을 유지하고 연결 평가·인사 카드·감사 원장을 갱신합니다.',
  },
  {
    name: 'getVideoWatchDashboard', mode: 'read', label: '영상 시청 현황 조회', memberFacing: false,
    required: [], sources: [],
    notes: 'rangeDays는 선택입니다. 서버 관리자 권한과 허용 조회 기간을 유지합니다. 시청 통계는 구매·수강권·40일 접근권 부여의 원천이 아닙니다.',
  },
  {
    name: 'getInstagramContentDashboard', mode: 'read', label: '인스타그램 콘텐츠 현황 조회', memberFacing: false,
    required: [], sources: [],
    notes: 'limit/verifyConnection은 선택입니다. 초안·발행 작업·지표 및 계정 연결 상태를 반환하며 verifyConnection=true는 공급자 프로필 조회를 포함할 수 있습니다. 공급자 설정이나 자격증명을 변경하는 endpoint가 아닙니다.',
  },
  {
    name: 'saveInstagramContentDraft', mode: 'write', label: '인스타그램 초안 저장', memberFacing: false,
    required: ['contentType', 'pillar', 'caption', 'media', 'publishAt'],
    sources: [{ collection: 'socialContentDrafts', key: 'contentId', optional: true }],
    notes: 'contentId는 기존 수정 때만 사용합니다. contentType=image/carousel/reel, pillar는 서버 허용 값, media는 유형에 맞는 HTTPS 자산 배열입니다. location/cta/intent는 선택입니다. 초안 또는 검토 요청 저장이지 발행 승인이 아닙니다.',
  },
  {
    name: 'approveInstagramContent', mode: 'write', label: '인스타그램 발행 승인', memberFacing: false,
    required: ['contentId'], sources: [{ collection: 'socialContentDrafts', key: 'contentId' }],
    notes: '기존 콘텐츠·현재 연결 계정·중복 발행 키를 검증해 공개 게시 작업을 승인합니다. memberFacing=false여도 외부 공개 권한은 별도 명시적 승인이 필요합니다. 승인·예약과 실제 게시 완료를 구분합니다.',
  },
  {
    name: 'holdInstagramContent', mode: 'write', label: '인스타그램 발행 보류', memberFacing: false,
    required: ['contentId'], sources: [{ collection: 'socialContentDrafts', key: 'contentId' }],
    notes: 'reason은 선택(기본 운영자 보류)입니다. 현재 콘텐츠 및 연결 발행 작업을 서버 트랜잭션으로 보류하며 이미 실행된 공급자 게시를 취소·삭제한 것으로 보고하지 않습니다.',
  },
];

export const UNSUPPORTED = [
  { name: 'getCoreAccessSession', reason: '인증·접근 세션 조회는 auth 모듈 전용입니다. 업무 액션으로 중복 노출하지 않습니다.' },
  { name: 'completeCoreFirstLogin', reason: '최초 비밀번호 설정은 인증 정보 변경이므로 업무 MCP에서 제외합니다.' },
  { name: 'loginStaffWithPin', reason: 'PIN 인증과 인증 토큰 발급은 업무 액션이 아닙니다.' },
  { name: 'setupStaffPinWithTempCode', reason: '임시코드·PIN 변경은 업무 MCP에서 제외합니다.' },
  { name: 'adminIssueStaffTempCode', reason: '관리자 임시 인증코드 발급은 업무 MCP에서 제외합니다.' },
  { name: 'registerFcmToken', reason: '기기 푸시 토큰 등록은 기기·인증 세션 전용이며 비밀 값 거부 정책을 우회하지 않습니다.' },
  { name: 'adminSyncLecturesRange', reason: '실재하는 callable이지만 StudioMate API 동기화입니다. 현재 Excel 기본 동기화 정책상 일반 운영 MCP에 노출하지 않습니다. startDate/endDate가 필요한 레거시 경로이며 Excel 작업을 이 이름으로 대체 호출하지 않습니다.' },
  { name: 'adminSyncManagerStaffs', reason: '실재하는 callable이지만 StudioMate 관리자 API 동기화입니다. 현재 Excel 기본 운영정책에 따라 제외하며 자격증명 변경용 endpoint도 아닙니다.' },
  { name: 'adminPollManagerNotices', reason: '실재하는 callable이지만 StudioMate 관리자 API 공지 동기화입니다. 현재 Excel 기본 운영정책에 따라 제외합니다.' },
  { name: 'renewalCases', reason: '직접 Firestore 쓰기: CORE app.js가 workflowStatus·nextActionAt·operatorUpdatedAt·operatorUpdatedByUid를 updateDoc합니다. 대응 callable이 없어 MCP 업무 endpoint를 발명하거나 Admin SDK 쓰기로 보안규칙을 우회하지 않습니다.' },
  { name: 'sequenceNotes / sequenceNoteImages', reason: '직접 Firestore 쓰기: sequence-store.js가 소유자·revision 충돌 검증 트랜잭션으로 노트와 이미지를 저장하고 삭제 표식·이미지 정리를 수행합니다. 대응 callable이 없으므로 별도 보안설계 전에는 읽기 범위만 검토합니다.' },
  { name: 'HTTP APIs / scheduled functions / Firestore triggers', reason: 'onRequest·스케줄·트리거는 callable이 아닙니다. 설문·개인 차트·리포트·계약 링크·웹훅·영상 이벤트 및 syncDashboardNow를 callable로 위장하지 않습니다. 기존 회원 링크와 토큰·서명 검증을 보존합니다.' },
  { name: 'CORE 조회 전용 컬렉션과 운영 작업', reason: '회원 상세·매출·재등록·프라이빗·자동화·설정·운영규칙은 직접 조회/정적 HTML도 포함합니다. Excel 실행·일반 후보 발송/재시도·회원/수강권/예약/연락처 수정·계약 재요청·영상 접근권 변경·운영규칙 저장의 범용 CORE callable은 확인되지 않았습니다. 전용 endpoint나 승인된 기존 실행 경로 없이는 직접 쓰기를 추가하지 않습니다.' },
];
