# 구매 영상 시청 분석

## 목적

- 아임웹 구매자 전용 시청 페이지에서 영상별 반복 시청, 활성 재생시간, 90% 완료 여부를 확인한다.
- 기존 상품 구매, 회원그룹 권한, 내 강의실 노출, 환불 흐름은 변경하지 않는다.
- 운영 조회 화면은 폐기된 ARCHIVE IN이 아니라 ARCHIVE CORE에 둔다.

## 구현 상태

- `implemented`: 구매자 전용 `/archive-method-watch-*` 경로와 YouTube 임베드가 함께 있을 때만 작동하는 추적기
- `implemented`: 상세 이벤트 `videoWatchEvents`와 세션 요약 `videoWatchSessions`
- `implemented`: 30분 비활동 세션 분리, 25/50/75/90% 도달, 종료, 활성 재생시간 집계
- `implemented`: ARCHIVE CORE 관리자 전용 `영상 시청 현황` 화면과 7/30/90일 조회
- `implemented`: 상세 이벤트 180일, 세션 요약 1년, rate-limit 2일 TTL 선언
- `implemented`: 개인정보처리방침과 ARCHIVE CORE 운영규칙 반영
- `pending`: Functions, Firestore TTL, ARCHIVE CORE, 개인정보처리방침, 아임웹 body 추적기 운영 배포

## 데이터 정책

- 원천: `videoWatchEvents`
- 계산 미러: `videoWatchSessions`
- 식별키: 아임웹 `MEMBER_HASH`를 브라우저에서 SHA-256으로 다시 가명 처리한 `buyerKey`
- 저장 금지: 이름, 전화번호, 원문 이메일
- 보조 표시: 마스킹된 계정 힌트만 저장
- 허용 독자: ARCHIVE CORE의 staff + manager 권한 운영자
- 금지된 후속 사용: 구매·회원그룹·환불 자동 변경, 광고, 자동 메시지 대상 선정
- 장애 원칙: 추적 실패는 YouTube 재생과 아임웹 구매자 접근을 막지 않는다.

## 배포 순서

1. Functions app codebase에서 `videoWatchEventApi`, `getVideoWatchDashboard`만 배포한다.
2. Firestore의 세 컬렉션 `expiresAt` TTL을 배포하고 활성 상태를 확인한다.
3. ARCHIVE CORE와 개인정보처리방침 Hosting을 배포한다.
4. `npm run prepare:imweb-video-watch-tracker`로 현재 body 스크립트 보존 여부와 dry-run을 확인한다.
5. 현재 CLI body 조회가 약 63KB에서 잘리므로 운영 반영은 인증된 아임웹 관리자 스크립트 편집기에서 기존 내용을 보존한 채 추적기 한 블록만 추가한다. CLI 전체 readback이 복구된 경우에만 `--apply`를 허용한다.

## 운영 검증

- 비회원: 구매자 전용 페이지 접근 불가, 시청 이벤트 없음
- 미구매 회원: 구매자 전용 페이지 접근 불가, 시청 이벤트 없음
- 구매 회원: 기존 내 강의실 목록과 영상 재생 정상, 시청 이벤트 생성
- 추적 API 차단: 영상 재생 정상
- ARCHIVE CORE 비관리자: 영상 시청 현황 조회 불가
- ARCHIVE CORE 관리자: 마스킹된 구매자 단위와 영상별 집계만 조회
- 적용 전 과거 시청 이력은 복원하거나 추정하지 않음

## 로컬 검증 결과

- `npm run test:video-watch-analytics`: 7개 테스트 통과
- Functions TypeScript 빌드 및 전체 Functions 코드베이스 빌드 통과
- Functions 소유 경계와 ARCHIVE IN 데이터 원천 정책 검증 통과
- ARCHIVE CORE Hosting 구성 검증 통과
- 15개 ARCHIVE CORE 화면을 320, 390, 768, 1440, 1920px에서 검사한 80개 반응형 조합 통과
- 아임웹 추적기 준비 결과: 기존 body 스크립트 보존 확인, 추적기 1개 병합 확인, CLI 잘림으로 운영 쓰기 차단
- 운영 데이터 쓰기, Functions 배포, Hosting 배포, 아임웹 스크립트 적용은 실행하지 않음

## 현재 차단점

- 개인정보 수집 시작과 운영 배포는 별도 go-live 승인 후 진행한다.
