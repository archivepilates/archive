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
- `deployed, verified`: 구매자 프로필 이름을 세션 요약에만 저장하고 관리자 화면에서 이름을 우선 표시
- `deployed, verified`: ARCHIVE CORE 구매자별 이용은 회원명만 표시하고 측정 기준 설명 섹션은 제거한 간결한 운영 화면
- `deployed, verified`: 상단 조회 패널, 날짜 차트, 구매자·최근 시청 패널의 내부 여백과 20px 섹션 간격 정리
- `applied, verified`: 기존 세션은 아임웹 `memberCode` 기반 익명 키가 정확히 일치할 때만 이름을 보강하며 충돌·미일치 기록은 건드리지 않음
- `deployed`: `videoWatchEventApi`, `getVideoWatchDashboard`, 세 컬렉션 TTL, ARCHIVE CORE, 개인정보처리방침
- `deployed`: CORE 정적 추적기와 아임웹 body 외부 로더. 기존 body 스크립트 19개를 보존하고 로더 1개만 추가했다.

## 데이터 정책

- 원천: `videoWatchEvents`
- 계산 미러: `videoWatchSessions`
- 식별키: 아임웹 `MEMBER_HASH`를 브라우저에서 SHA-256으로 다시 가명 처리한 `buyerKey`
- 세션 요약 표시: 아임웹 프로필의 정제된 구매자 이름
- 저장 금지: 전화번호, 원문 이메일, 상세 재생 이벤트의 구매자 이름
- 보조 표시: 구매자별 이용에서 이름이 없는 기존 세션은 `회원명 확인 필요`로 표시
- 허용 독자: ARCHIVE CORE의 staff + manager 권한 운영자
- 금지된 후속 사용: 구매·회원그룹·환불 자동 변경, 광고, 자동 메시지 대상 선정
- 장애 원칙: 추적 실패는 YouTube 재생과 아임웹 구매자 접근을 막지 않는다.

## 배포 순서

1. Functions app codebase에서 `videoWatchEventApi`, `getVideoWatchDashboard`만 배포한다.
2. Firestore의 세 컬렉션 `expiresAt` TTL을 배포하고 활성 상태를 확인한다.
3. ARCHIVE CORE와 개인정보처리방침 Hosting을 배포한다.
4. 추적기 본체는 `core/assets/imweb-video-watch-tracker-20260826.js`로 배포하고 공개 파일 해시를 확인한다.
5. `npm run prepare:imweb-video-watch-tracker`로 기존 body 스크립트를 보존한 외부 로더를 점검한다. CLI read 출력이 64KB에서 잘리면 기존 body를 덮어쓰지 않는다. 현재 로더 URL은 `max-age=0, must-revalidate`이며 CORE 정적 파일만 배포해 새 추적기 해시가 즉시 반영되는 것을 확인했다.
6. 공개 아임웹 HTML에서 기존 마커 19개, 추적기 로더 1개, CORE 정적 파일 URL을 다시 확인한다.
7. 라이브 이름 수집을 확인한 뒤 `node scripts/backfill-video-watch-buyer-names.mjs --apply --confirm-video-watch-buyer-name-backfill`로 정확 일치하는 기존 세션만 보강하고 건수를 재조회한다.

## 운영 검증

- 비회원: 구매자 전용 페이지 접근 불가, 시청 이벤트 없음
- 미구매 회원: 구매자 전용 페이지 접근 불가, 시청 이벤트 없음
- 구매 회원: 기존 내 강의실 목록과 영상 재생 정상, 시청 이벤트 생성
- 추적 API 차단: 영상 재생 정상
- ARCHIVE CORE 비관리자: 영상 시청 현황 조회 불가
- ARCHIVE CORE 관리자: 구매자 이름 단위와 영상별 집계를 조회하며 구매자별 이용에는 회원명만 표시
- 적용 전 과거 시청 이력은 복원하거나 추정하지 않음

## 검증 결과

- `npm run test:video-watch-analytics`: 이름 정제, 상세 이벤트 이름 제외, 지연 렌더링 재조회, 기존 세션 정확 매칭을 포함한 12개 테스트 통과
- `node scripts/backfill-video-watch-buyer-names.mjs`: 아임웹 회원 59명과 기존 세션 3건을 확인해 충돌 0건, 정확 일치 1건만 보강했다. 재조회 결과 이름 있음 1건, 미일치 2건, 추가 쓰기 0건이다.
- Functions TypeScript 빌드 및 전체 Functions 코드베이스 빌드 통과
- Functions 소유 경계와 ARCHIVE IN 데이터 원천 정책 검증 통과
- ARCHIVE CORE Hosting 구성 검증 통과
- 구매자별 이용에 회원명 외 정보가 다시 노출되거나 측정 기준 섹션이 재등장하면 Hosting 검증이 실패하도록 회귀 방지 규칙 추가
- 15개 ARCHIVE CORE 화면을 320, 390, 768, 1440, 1920px에서 검사한 80개 반응형 조합 통과
- Functions 두 개 `ACTIVE`, 허용 Origin CORS 204, 잘못된 요청 400, 비허용 Origin 403, 비로그인 관리자 호출 401 확인
- Firestore TTL 세 개 `ACTIVE`, 세션 조회 인덱스 `READY` 확인
- ARCHIVE CORE와 개인정보처리방침 사용자 도메인 HTTP 200 및 320/390/768/1440/1920px 화면 검증 통과
- CORE 추적기 정적 파일은 배포본과 소스 SHA-256 일치 확인
- 아임웹 공개 HTML의 기존 로더 1개가 `max-age=0, must-revalidate` CORE 정적 파일을 불러오며, 공개 파일과 소스 SHA-256이 일치하고 인라인 중복 추적기는 없음
- 유효한 합성 시청 이벤트는 운영 데이터에 만들지 않았다. 첫 실제 구매자 재생부터 집계한다.

## 남은 운영 확인

- 이름이 없는 과거 세션 2건은 추정 매칭하지 않는다. 해당 회원이 다시 재생하면 새 추적기가 프로필 이름을 세션 요약에 보강하는지 확인한다.
- 관리자 계정 외 역할의 로그인 후 차단 화면은 운영 계정을 가장하지 않고 별도 테스트 계정으로 확인한다.
