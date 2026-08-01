# 재등록 관리 장부 운영 결정

## 목적

재등록 후보를 매번 화면에서 다시 계산하는 대신, 최신 수강권과 canonical 예약 이력을 바탕으로 상담 상태를 이어서 관리합니다.

## 데이터 경계

- 대상 원천: `memberProfiles.activeTickets`
- 이용속도·다음예약 원천: canonicalized `bookings`
- 발송 원천: 기존 `alimtalkCandidates`와 `alimtalkSends`
- 운영 장부: `renewalCases`
- `renewalCases`는 표시·상담 진행 상태용이며 알림톡 대상 선정이나 발송 원천으로 사용하지 않습니다.

## 식별과 중복

- `caseKey`: studio + canonical member + 수강유형 + source ticket key
- source ticket key 우선순위: `userTicketId`, 그 외 회원·유형·정규화 수강권명·시작일·결제일·최대횟수
- 잔여횟수와 만료일은 보정 가능한 값이므로 key에서 제외합니다.
- 같은 수강권 주기의 재계산은 한 문서를 갱신하고, 새 수강권 주기는 새 문서를 생성해 과거 상담 이력을 보존합니다. 해소된 기존 건은 `active=false`로 닫되 운영자 상태는 덮어쓰지 않습니다.

## 자동 계산

- 최근 8주의 출석, 결석, 당일취소를 수강권 소진으로 계산합니다.
- 듀엣·세미프라이빗은 프라이빗 유형으로 분류합니다.
- 예상 소진일, 다음 예약일, 이용속도, 상담 추천을 갱신합니다.
- 원천 프로필이 72시간 이상 갱신되지 않았으면 기존 case를 자동 완료하지 않습니다.

## 운영 상태

- `open`, `contacted`, `considering`, `snoozed`, `resolved`, `excluded`
- 관리자는 CORE에서 상태와 다음 확인일만 변경할 수 있습니다.
- 서버 재계산은 운영자 상태 필드를 덮어쓰지 않습니다.

## 외부 발송 보호

- 기존 승인 템플릿과 30일 중복발송 방지를 유지합니다.
- 발송 직전에 `memberProfiles`를 다시 읽어 동일 유형 후속 수강권이나 위험 해소를 확인하면 발송을 차단합니다.
- 개인화 추천은 CORE 상담용이며 승인 템플릿 본문에 임의로 삽입하지 않습니다.

## 검증

- 정책 단위 테스트: 유형, 이용속도, 예상 소진일, 안정적인 source key, 발송 직전 재등록 차단
- 배포 전: Functions typecheck/build, 데이터 원천 정책, Functions 경계, CORE hosting guard, Firestore rules 검사
- 배포 후: CORE 양 도메인 번들 marker, 관리자 읽기·상태 변경, 실제 발송 없는 candidate dry-run
