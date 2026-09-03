# ARCHIVE METHOD 수업자료 정오 공개 기본값

## 목적

강사레슨 알림톡을 수업 하루 전에 보내더라도 큐카드 본문은 수업 당일 정오 전까지 노출하지 않고, 모든 자료가 같은 안내 문구와 공개 시각을 사용하게 한다.

## 현재 구현 상태

- `implemented`: `archivein/method/assets/method-access.js`가 수업일의 `12:00 KST`를 기본 공개 시각으로 계산한다.
- `implemented`: 공개 전에는 큐카드 본문 전체를 숨기고 `수업자료는 수업 당일 12시에 공개됩니다.`만 표시한다.
- `implemented`: 기존 7개 큐카드는 공통 타임게이트를 사용한다.
- `implemented`: `scripts/validate-method-cue-card-access.mjs`가 날짜 불일치, 기존 13시 조건, 필수 게이트 누락을 차단한다.
- `verified`: 정적 계약 검증과 로컬 브라우저 검증을 통과해야 완료로 기록한다.
- `pending`: 사용자가 배포를 요청하기 전까지 운영 Hosting에는 반영하지 않는다.

## 운영 규칙

- 강사레슨 수업자료 알림톡은 D-1에 발송한다.
- 큐카드 본문은 수업 당일 12:00 KST에 자동 공개한다.
- 공개 전 안내 문구는 임의로 바꾸지 않는다.
- 스텝 프리뷰는 큐카드에 지정된 프리뷰 코드가 정확히 일치할 때만 시간 제한을 우회한다.
- 타임게이트는 정적 HTML의 운영용 노출 제어이며 인증이나 민감정보 보호를 대신하지 않는다.

## 기준 데이터

- 수업일 원천: 현재 StudioMate 예약 스케줄의 실제 수업일.
- 경로 계약: `archivein/method/<영문주제-YYMMDD>/index.html`.
- 페이지 계약: 경로 날짜와 `data-method-date="YYYY-MM-DD"`가 일치해야 한다.

## 영향 범위

- `archivein/method/**/index.html`
- `archivein/method/assets/method-access.css`
- `archivein/method/assets/method-access.js`
- `scripts/validate-method-cue-card-access.mjs`
- ARCHIVE CORE `운영규칙`의 강사레슨 수업자료 항목

## 배포 및 다음 작업

- 배포 상태: 미배포.
- 다음 ARCHIVE IN Hosting 배포 전 `npm run validate:method-cue-card-access`를 실행한다.
- 배포 후 일반 링크의 공개 전 화면, 정오 공개 상태, 스텝 프리뷰 링크를 각각 확인한다.
