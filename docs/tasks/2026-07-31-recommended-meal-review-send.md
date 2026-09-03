# ARCHIVE 추천식단 검토·공개

## 목표

회원 설문 제출 직후 최신 InBody 측정값을 연결해 추천식단 초안을 자동 생성하고, ARCHIVE CORE에서 운영자가 수정·검토한 뒤 최초 설문 알림톡의 리포트 링크에 공개한다.

## 데이터 흐름

1. `recommendedMealProgramRequests`: 설문 초대와 회원 식별
2. `recommendedMealProgramResponses`: 민감한 설문 원문과 InBody 참조
3. `recommendedMealProgramDrafts`: AI/운영자 편집 식단과 revision
4. `recommendedMealProgramReports`: 승인·공개 스냅샷과 공개 토큰 해시
5. `alimtalkCandidates`, `alimtalkSends`: 최초 설문 알림톡 발송 이력

민감 설문 응답은 알림톡 후보, 짧은 링크 ID, CORE 목록, 회원 리포트에 복사하지 않는다.

## 완료 조건

- 설문 제출 트리거 기반 자동 초안 생성, 운영자 전용 목록·상세·수정·주의 응답 확인·리포트 공개
- 7일 식단과 안전 안내를 포함한 토큰형 회원 리포트
- 승인 전 공개 차단, 수정 후 재승인, 공개 후 수정 잠금
- 최초 알림톡 1회만 발송하고 같은 접근 토큰으로 완성 리포트 제공
- Functions/Firestore/Hosting 경계 검증 및 반응형 QA
