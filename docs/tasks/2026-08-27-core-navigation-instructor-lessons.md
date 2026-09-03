# ARCHIVE CORE 탐색 단순화와 강사레슨 메뉴

## 목적

- 주 탐색에서 사용성이 낮은 회원, 수업, 콘텐츠 메뉴를 제거한다.
- 현장 웰컴 회원가입서 발송 화면을 CORE 메뉴에서 바로 연다.
- 강사레슨 운영 도구를 한 화면에 모은다.

## 구현

- 기존 회원, 수업, 콘텐츠 URL과 코드는 삭제하지 않고 탐색 메뉴에서만 제외한다.
- 회원가입서 메뉴는 `https://in.archivepilates.com/onsiteWelcome/?v=icon-check`를 사용한다.
- `core/instructor-lessons/`는 StudioMate, 이폼싸인, 알림톡, 강사 인사기록, 강사 테스트, 운영규칙을 연결한다.
- 강사레슨 허브는 운영자 인증만 확인하고 대시보드 컬렉션은 읽지 않는다.
- 홈 빠른 실행과 명령 검색에도 회원가입서와 강사레슨을 추가한다.

## 검증

- `npm run validate:archive-core-hosting`
- `npm run verify:archive-core-responsive`
- 모바일 320px, 390px, 태블릿 768px, 데스크톱 1440px와 1920px에서 가로 넘침과 터치 영역을 확인한다.

## 배포 상태

- 구현과 로컬 검증 후 별도 배포 승인 시 ARCHIVE CORE Hosting만 배포한다.
