// Generated from firebase/packages/contracts/src/member-inquiries.ts; run node scripts/build-member-inquiry-contract.mjs.
/** Member intent only; never a source for booking, payment or ticket mutations. */
export const memberInquiryContract = {
  laneId: "member-inquiry-intake", studioId: "5330",
  requests: "memberInquiryRequests", limits: "memberInquiryRateLimits",
  events: "memberInquiryEvents", commands: "memberInquiryCommands",
  settingsPath: "settings/memberInquiryIntake",
  ownerCodebase: "functions-app", policyVersion: "2026-11-09.2", privacyVersion: "2026-11-09.1",
  retentionDays: 90,
} as const;
export type InquiryQuestion = { id: string; label: string; options?: readonly string[]; type?: string; optional?: boolean; multiple?: boolean; when?: readonly string[] };
export type InquiryCategory = { title: string; owner: string; policy: string; link: string; questions: readonly InquiryQuestion[] };
export const memberInquirySchema: Record<string, InquiryCategory> = {
  "renewal": {
    "title": "재등록 문의",
    "owner": "상담 담당",
    "policy": "현재 수강료와 희망 상품을 확인해 안내합니다. 재등록 혜택과 적용 자격은 담당자가 확인합니다.",
    "link": "https://app.notion.com/p/3ebd49eae4bf8198ba47c4cb222d7c69",
    "questions": [
      {
        "id": "lesson",
        "label": "어떤 수업을 생각하고 계세요?",
        "options": [
          "그룹레슨",
          "프라이빗",
          "듀엣레슨",
          "상담 후 결정"
        ]
      },
      {
        "id": "start",
        "label": "언제 시작하고 싶으세요?",
        "options": [
          "현재 수강권 종료 후",
          "이번 달",
          "다음 달",
          "아직 미정"
        ]
      }
    ]
  },
  "booking": {
    "title": "수업 취소·변경 요청",
    "owner": "예약 담당",
    "policy": "고정예약 수업은 취소·변경이 불가합니다. 자유예약은 수업 종류와 마감시각을 확인합니다. 예외 검토 요청은 관리자에게 전달하며 접수만으로 예약은 바뀌지 않습니다.",
    "link": "https://app.notion.com/p/27ad49eae4bf8045afd9e2c2fdc3e28e",
    "questions": [
      {
        "id": "request",
        "label": "무엇을 요청하시나요?",
        "options": [
          "수업 취소",
          "다른 수업으로 변경",
          "가능 여부만 상담"
        ]
      },
      {
        "id": "mode",
        "label": "어떤 예약인가요?",
        "options": [
          "자유예약",
          "고정예약",
          "잘 모르겠어요"
        ]
      },
      {
        "id": "classDate",
        "label": "문의할 수업 날짜",
        "type": "date",
        "optional": true
      },
      {
        "id": "classTime",
        "label": "문의할 수업 시간",
        "type": "time",
        "optional": true
      },
      {
        "id": "nextDay",
        "label": "변경을 희망하는 요일",
        "options": [
          "월",
          "화",
          "수",
          "목",
          "금",
          "토",
          "일",
          "상담 후 결정"
        ],
        "multiple": true,
        "when": [
          "request",
          "다른 수업으로 변경"
        ]
      },
      {
        "id": "nextTime",
        "label": "변경을 희망하는 시간대",
        "options": [
          "오전",
          "오후",
          "저녁",
          "상담 후 결정"
        ],
        "when": [
          "request",
          "다른 수업으로 변경"
        ]
      }
    ]
  },
  "holding": {
    "title": "수강권 홀딩",
    "owner": "회원권 담당",
    "policy": "기본 홀딩은 전체 수강권 기간의 20% 이내입니다. 기간권은 월~일, 횟수권은 7일 단위로 유효기간 내 사전 신청합니다. 남은 한도와 겹치는 예약을 확인한 뒤 안내드립니다.",
    "link": "https://app.notion.com/p/216d49eae4bf806983abfb9665af7992",
    "questions": [
      {
        "id": "ticket",
        "label": "어떤 수강권인가요?",
        "options": [
          "기간권",
          "횟수권",
          "잘 모르겠어요"
        ]
      },
      {
        "id": "startDate",
        "label": "언제부터 쉬고 싶으세요?",
        "type": "date",
        "optional": true
      },
      {
        "id": "duration",
        "label": "희망 기간을 선택해 주세요",
        "options": [
          "1주",
          "2주",
          "3주",
          "4주",
          "다른 기간 상담",
          "아직 미정"
        ]
      },
      {
        "id": "reason",
        "label": "어떤 사유인가요?",
        "options": [
          "개인 일정",
          "여행·출장",
          "사유는 별도 상담",
          "기타"
        ],
        "optional": true
      }
    ]
  },
  "conversion": {
    "title": "수강권 전환 문의",
    "owner": "관리자",
    "policy": "현재 수강권의 남은 횟수·기간과 전환 조건을 검토한 뒤 안내드립니다. 전환 가능 여부와 추가 비용은 관리자 확인이 필요합니다.",
    "link": "",
    "questions": [
      {
        "id": "current",
        "label": "지금 이용하는 수업은 무엇인가요?",
        "options": [
          "그룹레슨",
          "프라이빗",
          "듀엣레슨",
          "잘 모르겠어요"
        ]
      },
      {
        "id": "desired",
        "label": "어떤 수업으로 바꾸고 싶으세요?",
        "options": [
          "그룹레슨",
          "프라이빗",
          "듀엣레슨",
          "상담 후 결정"
        ]
      },
      {
        "id": "start",
        "label": "언제부터 바꾸고 싶으세요?",
        "options": [
          "가능한 빠르게",
          "현재 수강권 종료 후",
          "다음 달",
          "상담 후 결정"
        ]
      }
    ]
  },
  "fixed": {
    "title": "고정예약 문의",
    "owner": "고정예약 담당",
    "policy": "고정예약 수업은 취소·변경이 불가합니다. 새 신청·해지는 월별 명단과 해당 규정을 확인합니다. 예외 상담 접수는 취소·변경 승인이나 완료를 뜻하지 않습니다.",
    "link": "https://app.notion.com/p/27ad49eae4bf8045afd9e2c2fdc3e28e",
    "questions": [
      {
        "id": "request",
        "label": "어떤 문의인가요?",
        "options": [
          "새 고정예약 신청",
          "해지 방법 문의",
          "이용 규정 문의",
          "취소·변경 예외 상담"
        ]
      },
      {
        "id": "month",
        "label": "문의할 수업의 월을 선택해 주세요",
        "type": "month",
        "optional": true
      },
      {
        "id": "days",
        "label": "희망하는 요일을 선택해 주세요",
        "options": [
          "월",
          "화",
          "수",
          "목",
          "금",
          "토",
          "일",
          "상담 후 결정"
        ],
        "multiple": true,
        "when": [
          "request",
          "새 고정예약 신청"
        ]
      },
      {
        "id": "time",
        "label": "희망하는 시간대는 언제인가요?",
        "options": [
          "오전",
          "오후",
          "저녁",
          "상담 후 결정"
        ],
        "when": [
          "request",
          "새 고정예약 신청"
        ]
      }
    ]
  },
  "other": {
    "title": "기타 문의",
    "owner": "데스크 → 필요 시 관리자",
    "policy": "선택한 내용을 확인해 담당자에게 전달합니다. 자세한 설명이 필요한 경우 담당자가 연락드릴게요.",
    "link": "",
    "questions": [
      {
        "id": "topic",
        "label": "어떤 내용인가요?",
        "options": [
          "시설 이용",
          "예약 앱 이용",
          "수업·서비스 불편",
          "환불·양도 상담",
          "그 외 문의"
        ]
      },
      {
        "id": "reply",
        "label": "어떤 도움이 필요하세요?",
        "options": [
          "이용 방법 안내",
          "담당자 상담",
          "불편 사항 전달"
        ]
      }
    ]
  }
};
export const memberInquiryStatuses = ["received", "in_review", "awaiting_approval", "approved", "needs_information", "rejected", "completed"] as const;
export type InquiryStatus = typeof memberInquiryStatuses[number];
