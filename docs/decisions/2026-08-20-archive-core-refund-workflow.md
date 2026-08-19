# ARCHIVE CORE 환불 안내·동의서

## 목적

운영자가 회원 이름과 전체 연락처로 정확한 회원을 찾고, 보유 수강권의 환불 예상액과 계산 근거를 확인한 뒤 이폼싸인 환불동의서를 한 건만 발송한다.

## 현재 구현

- 화면: `ARCHIVE CORE /refunds/`
- 조회 원천: `memberProfiles.activeTickets`
- 처리 기록: `refundCases`, `eformsignRefundJobs`
- 권한: ARCHIVE CORE manager 전용
- 규정 원천: Notion `회원권 환불 및 양도` 2026-08-19 버전
- 공통 계산: 모든 환불에서 실결제금액의 10% 위약금 공제
- 횟수권 사용분: 정상 1회 단가 × 사용 횟수
- 기간권 사용분: 실결제금액 × 홀딩 제외 실제 사용 주수 ÷ 총 계약 주수
- 별도 공제: 증정·이벤트·프로모션 혜택
- 외부 실행: 운영자 확인 후 이폼싸인 환불동의서 발송만 수행

## 데이터 원칙

- `member360Cards`, `members/{memberId}/purchases`, 잔여수강권 보고서는 환불 판단 원천으로 사용하지 않는다.
- 이름과 전체 연락처가 모두 일치하고 canonical member가 하나일 때만 진행하며, 환불 이력은 로그인 토큰의 동일 스튜디오에서만 읽는다.
- 서버가 큐 등록 전에 원천과 계산 해시를 검증하고, Mac mini 처리기가 발송 직전 현재 `memberProfiles.activeTickets`를 다시 읽어 금액·사용·상태·유효기간 변경을 차단한다.
- 수강권 유형은 화면에서 바꿀 수 없고 원천 횟수 필드로만 판정한다.
- 환불 요청일은 미래일 수 없으며, 처리 시점에 이미 만료된 수강권은 과거 요청일 입력으로 우회할 수 없다.
- 무료·증정·이벤트·프로모션 혜택과 완료수업·회원 귀책 노쇼 공제 여부를 운영자가 확인해야 계산할 수 있다.
- 회원의 같은 수강권에는 활성 환불 건을 하나만 허용하며, 계산값이나 근거 문구를 바꿔 새 문서를 우회 발송할 수 없다.
- 발송 결과는 문서명과 해당 문서 ID가 함께 확인된 완료 화면 또는 발송 문서 목록만 성공으로 기록한다. 불명확하면 자동 재발송하지 않고 운영자 확인 상태로 둔다.
- 계좌정보 등 지급에 필요한 민감정보는 이폼싸인에서 회원이 직접 작성하며 ARCHIVE CORE와 Firestore에 저장하지 않는다.
- 실제 결제 환불, StudioMate 수강권 종료와 수정은 자동 실행하지 않는다.

## 이폼싸인 연결

현재 이폼싸인 계정은 Personal 요금제라 API와 Webhook을 사용할 수 없다. ARCHIVE CORE는 발송 작업을 Firestore 큐에 한 번만 등록하고, Mac mini의 로그인된 전용 Playwright 프로필이 순차 처리한다.

- 템플릿: 환불동의서 `fbdd279c2d7447938bc4e997f249c7b5`
- 처리기: `scripts/process-eformsign-refund-jobs.mjs`
- 잠금: `~/ArchiveIN/automation/locks/eformsign-browser-profile.lock`
- 프로필: `~/ArchiveIN/automation/eformsign-browser-profile`
- LaunchAgent: `com.archive.eformsign-refund-queue`
- 상태: `pending → processing → sending → done`
- 처리기가 중단되면 전송 클릭 전 작업만 `retry`로 회수하고, 전송 클릭 가능성이 있는 작업은 `send_review_required`로 보내 자동 중복 발송을 막는다.
- 전송 클릭 후 성공 여부가 모호하면 `send_review_required`로 멈추며 자동 재시도하지 않는다.

## 환불 후 운영 처리

1. 환불 요청 접수
2. 예상금액 검토와 내부 승인
3. 이폼싸인 환불동의서 발송과 서명
4. 결제수단별 실제 환불 처리
5. StudioMate 메모와 회원 안내

ARCHIVE CORE 환불 메뉴는 1~3단계만 지원한다. 실제 결제 취소와 StudioMate 수강권 변경은 자동 실행하지 않는다.

## 검증과 배포 상태

- 구현: 완료
- 로컬 검증: 환불정책 8건, 이폼싸인 큐 안전성 9건, Functions 전체 빌드와 경계·데이터 원천 검사 통과
- 라이브 검증: 김기효 격리 계정 조회, 수강권 선택, 10% 위약금 계산, 안내 문구 생성, 발송 큐 단건 등록 완료
- 이폼싸인 실발송: 전용 Playwright 프로필의 `archivepilates@gmail.com` 1회 로그인 대기. 테스트 작업은 `pending`에서 안전 정지
- 운영 배포: Functions 5개 codebase, Firestore 규칙, ARCHIVE CORE Hosting 배포 및 14개 메뉴 × 4개 화면 크기 canary 통과
