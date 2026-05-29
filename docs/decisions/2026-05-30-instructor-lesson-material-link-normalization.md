# 2026-05-30 강사레슨 수업자료 링크 정규화

## 배경

강사레슨 수업자료 테스트 발송에서 관리번호에 테스트용 식별자(`kg02`, `bm01`, `jy03`)가 섞여
`circulation-kg02-260530` 같은 잘못된 수업자료 URL이 생성되었다.

## 결정

- 강사레슨 수업자료 관리번호는 `영문수업주제-YYMMDD` 형식으로 정규화한다.
- 수업명 또는 기존 링크 안에 회원/테스트 식별자가 섞여 있으면 영문 주제와 날짜만 남긴다.
- 예: `circulation-kg02-260530` -> `circulation-260530`
- 후보 생성, 발송 변수, 중복 발송 키, 발송 가능성 검사에서 같은 정규화 함수를 사용한다.
- 강사레슨 수업자료 단축링크는 같은 수업자료를 여러 후보가 공유할 수 있으므로 `sourceIds`에 사용 후보를 누적하고, 기존 `sourceId`를 반복 발송 때 덮어쓰지 않는다.

## 운영 보정

이미 발송된 잘못된 테스트 단축링크 3개는 클릭 시 정상 수업자료 페이지로 이동하도록 Firestore `shortLinks` 타깃을 보정했다.

- `mt-7a3ca4d7efa4`: `circulation-kg02-260530` -> `circulation-260530`
- `mt-09bc60dca0f4`: `circulation-jy03-260530` -> `circulation-260530`
- `mt-48595c62a48b`: `circulation-bm01-260530` -> `circulation-260530`

정상 수업자료 링크:

- `https://in.archivepilates.com/method/circulation-260530`

## 검증

- `npm run typecheck`
- `npm run build`
- 단축링크 4개 모두 `https://in.archivepilates.com/method/circulation-260530`으로 302 리다이렉트 확인
