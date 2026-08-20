# ARCHIVE CORE 환불 안내·동의서

## 목적

운영자가 회원 이름으로 유효회원 후보를 찾고 정확한 회원카드를 선택한 뒤, StudioMate 동기화 원천으로 환불 예상액을 확인하고 이폼싸인 환불동의서를 한 건만 발송한다.

## 현재 구현

- 화면: `ARCHIVE CORE /refunds/`
- 조회 원천: `memberProfiles.activeTickets`
- 처리 기록: `refundCases`, `eformsignRefundJobs`
- 권한: ARCHIVE CORE manager 전용
- 규정 원천: Notion `회원권 환불 및 양도` 2026-08-19 버전
- 공통 계산: 모든 환불에서 실결제금액의 10% 위약금 공제
- 횟수권 사용분: 정상 1회 단가 × (`총횟수 - StudioMate 잔여횟수`)
- 기간권 사용분: 실결제금액 × (`총 계약 주수 - StudioMate 잔여 주수`) ÷ 총 계약 주수
- 별도 공제: 증정·이벤트·프로모션 혜택
- 외부 실행: 운영자 확인 후 이폼싸인 환불동의서 발송만 수행

## 데이터 원칙

- `member360Cards`, `members/{memberId}/purchases`, 잔여수강권 보고서는 환불 판단 원천으로 사용하지 않는다.
- 이름으로 조회한 현재 유효회원 후보에서 운영자가 마스킹 연락처·활성 수강권 수·원천 갱신일을 확인해 선택한다.
- 후보 선택 후 계산과 발송은 화면 텍스트가 아닌 canonical `memberId`와 동일 스튜디오 권한으로 다시 검증하며, 실제 연락처는 `memberProfiles`에서 읽는다.
- 서버가 큐 등록 전에 원천과 계산 해시를 검증하고, Mac mini 처리기가 발송 직전 현재 `memberProfiles.activeTickets`를 다시 읽어 금액·사용·상태·유효기간 변경을 차단한다.
- 수강권 유형은 화면에서 바꿀 수 없고 원천 횟수 필드로만 판정한다.
- 횟수권 사용횟수는 운영자가 덮어쓸 수 없다. 기간권의 총 주수·잔여 주수·사용 주수도 StudioMate 시작일·만료일·환불 요청일로 자동 산출하며 수동 입력을 허용하지 않는다.
- 기간권 잔여 주수는 남은 일수를 7일 단위로 환산하며, 남은 7일 미만은 환불 잔여 주수에 포함하지 않는다. 날짜 원천이 없거나 서로 맞지 않으면 계산을 중단한다.
- 홀딩이나 기간 연장은 StudioMate 원천에 먼저 반영한다. CORE에서 별도의 실제 사용 주수나 홀딩 근거를 다시 입력하지 않는다.
- 환불 요청일은 미래일 수 없으며, 처리 시점에 이미 만료된 수강권은 과거 요청일 입력으로 우회할 수 없다.
- 회원과 수강권을 선택하면 현재 원천으로 예상액을 바로 계산할 수 있다. 무료·증정·이벤트·프로모션 혜택과 완료수업·회원 귀책 노쇼 공제 여부는 외부 발송 전에 운영자가 확인한다.
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
- 환불동의서 v9 필드 계약은 회원명 `ozinput_24`, 연락처 `ozinput_27`, 실결제금액 `ozinput_29`, 위약금 `ozinput_30`, 사용·혜택 공제 `ozinput_31`, 예상 환불금액 `ozinput_32`를 사용한다.
- SMS 수신자 입력 후 진행 중 문서함에서 문서명, 문서 ID, 대상 연락처가 함께 확인되어야 `done`으로 전환한다.

## 환불 후 운영 처리

1. 환불 요청 접수
2. 예상금액 검토와 내부 승인
3. 이폼싸인 환불동의서 발송과 서명
4. 결제수단별 실제 환불 처리
5. StudioMate 메모와 회원 안내

ARCHIVE CORE 환불 메뉴는 1~3단계만 지원한다. 실제 결제 취소와 StudioMate 수강권 변경은 자동 실행하지 않는다.

## 검증과 배포 상태

- 구현: 완료
- 기존 운영 배포: 이름+연락처 방식의 v1 Functions와 CORE 화면이 배포됨
- 이번 개선 구현: 이름 후보 선택, canonical memberId 검증, 횟수권 잔여횟수 자동 산정, 기간권 잔여 주수 자동 산정, 사용 횟수·주수 수동 입력 제거 완료
- 로컬 검증: 환불정책 15건, 이폼싸인 큐 안전성 10건, affected-only 환불 매핑, Functions 전체 빌드와 경계·데이터 원천 검사 통과
- 라이브 검증: 김기효 격리 계정 조회, 사전등록 100회권 선택, 실결제금액 100,000원·위약금 10,000원·사용 공제 0원·예상 환불 90,000원 확인
- 이폼싸인 실발송: `archivepilates@gmail.com` 프로필에서 SMS 단건 발송 완료. 문서 `2026-08-20_환불동의서_김기효_d9e786e3`, 문서 ID `193d256294be423c9406cda7d0f393c4`, Firestore 작업 `done`, 케이스 `agreement_sent` 확인
- 실제 결제 환불, StudioMate 문자, 수강권 변경은 실행하지 않음
- v9 필드·수신자·문서함 증거 보강은 `codex/mini/refund-eform-v9-field-map` worktree에서 검증 완료했으며 운영 승격 전 상태
