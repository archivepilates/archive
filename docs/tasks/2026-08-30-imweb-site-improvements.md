# ARCHIVE PILATES 아임웹 사이트 개선

## 목표

2026-08-29 전체 점검에서 확인한 기능·디자인 문제 중 라이브 전역 코드로 안전하게 개선할 수 있는 항목을 반영한다.

## 적용 범위

- 좌측 패널 회원 정보의 글자 대비
- 모바일 헤더, 알림, 커뮤니티 글쓰기, 내 강의실 나가기의 터치 영역과 접근성 이름
- 커뮤니티 목록의 실제 `h1`, 작성 화면의 `COMMUNITY` 명칭, 하단 중복 글쓰기 버튼
- 강사레슨 목록의 명시적인 페이지 제목
- 니티도 상품 카드 이미지 지연 로딩, 크기 예약, 낮은 우선순위 로딩
- 공식 홈과 아임웹 홈, 상품 별칭 URL, 기구별 필터, 내 강의실의 canonical·robots 정책

## 제외 범위

- 결제, 주문, 재고, 회원 그룹과 영상 권한
- 아임웹이 생성하는 sitemap 자체 수정
- 리뷰가 없는 상품의 `review` 또는 `aggregateRating` 구조화 데이터 생성
- native `header_more_menu.js` 교체

## 적용 방식

- CLI로 읽히는 Header·Body·Footer 스크립트와 관리자 공통 코드 편집기 값을 각각 로컬 `artifacts/imweb-site-improvements-20260830`에 백업한다.
- `data-archive-pilates-site-improvements-p1` 블록은 버전 표식으로 한 번만 교체한다.
- 니티도 상품 카드 템플릿의 `loading="eager"` 한 곳만 `loading="lazy"`로 변경한다.
- CLI dry-run으로 변경 범위와 확인 토큰을 검증한다.
- 전체 스크립트 세트가 CLI 로컬 쓰기 안전 한도 50건을 초과하므로 CLI apply는 사용하지 않는다.
- 인증된 아임웹 관리자 `설정 > SEO > 공통 코드 삽입`의 Header·Footer에 저장하고, 페이지 새로고침 후 편집기 값을 다시 읽어 일치 여부를 확인한다.

## 적용 결과

- 대상 사이트: `S20260516852c71a014d08`
- 최종 전역 개선 버전: `2026-08-30d`
- Header 개선 블록: 1개
- Footer 니티도 이미지 템플릿 최적화: 1개
- 관리자 저장 알림: `내용을 정상적으로 저장했어요`
- 관리자 새로고침 후 Header·Footer 값 일치 확인 완료

## 롤백

백업한 `admin/header-before.html`, `admin/footer-before.html`을 아임웹 관리자 공통 코드 편집기에 다시 적용한다.

## 검증

- 320px, 390px, 768px, 1440px 반응형 화면
- 홈, 영상구매, 강사레슨, 판매상품, 커뮤니티, 내 강의실
- 커뮤니티 목록·작성 화면
- 상품 canonical 별칭과 내 강의실 robots
- 니티도 카드 이미지 `loading`, `width`, `height`, `fetchpriority`
- 콘솔 오류와 가로 넘침

## 라이브 검증 결과

- 320px, 390px, 768px, 1440px 모두 가로 넘침 0
- 모바일 메뉴·장바구니·검색 터치 영역 44px 이상
- 좌측 패널 회원명·이메일 대비 정상, 메뉴 행 정렬 일치
- 커뮤니티 목록 `COMMUNITY` 제목, 화면별 글쓰기 버튼 1개, 모바일 버튼 높이 44px
- 커뮤니티 작성 화면 `COMMUNITY` 명칭 확인
- 내 강의실 나가기 버튼 높이 44px, `noindex,nofollow`
- 강사레슨 목록 `h1`과 `ARCHIVE PILATES LESSON` 표식 확인
- 니티도 상품 이미지 27개 모두 lazy/low priority/960x960, 깨진 이미지 0
- 영상 상품 카드 26개 이미지의 빈 alt 0
- 공개 페이지 검사 중 콘솔 error·warning 0
