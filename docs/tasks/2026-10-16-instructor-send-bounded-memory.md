# 강사레슨 승인 발송 메모리 압박 수정

## 상태

- 전용 worktree: instructor-send-bounded-memory / codex/mini/instructor-send-bounded-memory.
- 기준 origin/main: 6b814bc5427a2f55323b3a7d1f98ef8120f73405.
- 구현·오프라인 검증·독립 리뷰와 승인 범위 운영 배포·라이브 확인 완료. 운영 기록과 CORE 상태 표시를 최종 정렬한다.
- 실제 발송과 기존 승인·후보·발송 원장 수정은 하지 않는다.

## 확인된 사실

- archive-pilates / asia-northeast3 / scheduledSendApprovedInstructorLessonAlimtalk, 512MiB, ACTIVE.
- 2026-10-16 09:00:41Z: 513MiB로 종료. 2026-09-17 09:00:52Z: 516MiB로 종료.
- 전체 후보 재생성은 회원 626명, 예약 95,722건, 수업 16,153건을 읽는 구조다. Firestore count()로 같은 수를 재확인했다.
- 2026-10-16 승인 5명 묶음은 sending 상태다. 후보 2건 sent + 원장 done/메시지 ID, 1건 failed/원장 없음, 2건 candidate/원장 없음. 원장 부재만으로 SOLAPI 미접수를 확정하지 않는다.
- 읽기 전용 원본 감사에서 5건의 승인 계약, 예약·수업·회원 일치, 스냅샷 최신성, 취소 없음이 확인됐다. 감사는 발송 가능 승인이나 실제 전달 증거가 아니다.
- SOLAPI GET 조회(18:00~18:02 KST)에서 위 성공 2건의 COMPLETE/4000과 메시지 ID가 일치했다. 페이지 누락 없음. 재발송 없음.

## 변경

- 18:00 전체 재생성 제거, 승인 후보만 순차 조회.
- 모든 후보의 승인 ID·수신자·콘텐츠를 검증하고 선점 시 원본 변경 차단.
- 실제 수업일로 취소 원장 조회 수정, 예약·수업·회원·기존 발송 원장 트랜잭션 검증.
- sending/failed 자동 재개 없음, 1회 시도 및 기존 중복 차단 유지.
- 메모리 관측 로그, 오프라인 테스트, 읽기 전용 감사 도구, CORE 운영규칙·결정 기록 추가.
- 기존 후보가 failed/processing 등 미확인 상태이면 묶음 자체를 보류한다. 선점 직전 원천 변경이나 기존 발송 원장은 확인필요 건수·사유로 기록하고 성공으로 보고하지 않는다.
- 재생성과 발송이 같은 강사레슨 수강권 분류 함수를 사용한다. 해당 함수 추출에 맞춰 기존 순수 함수 검사 도구도 갱신했다.

## 검증 결과

- 승인·원천 단위 테스트 15/15, 실제 발송 함수의 오프라인 VM 테스트 83/83 통과. 실제 네트워크·Firestore·SOLAPI 발송은 가짜 의존성으로 차단했다.
- 주차 13/13, 강사레슨 등록·일정 45/45, CORE 운영 흐름 80/80 통과.
- TypeScript 타입 검사, 5개 Functions 코드베이스 빌드, 릴리스 회귀 방지(신규 VM 테스트 필수 포함), CORE Hosting 정합성 검사, git diff --check 통과.
- 독립 리뷰의 2개 보완 사항을 반영하고 재검토에서 추가 문제 없음. 운영 RAM 개선 실측은 미완료다.
- 실제 영향 코드베이스는 functions-alimtalk만이며 Hosting은 CORE 운영규칙 문구다. package.json/의존성/메모리 설정/스케줄/DB schema 변경 없음.
- StudioMate 프로필·잠금은 사용하지 않았다. 합성 반응형 검증 브라우저만 별도 생성하고 종료한다.

## 운영 배포

- 사용자 승인: 검증 후 관련 Functions·CORE 운영규칙 운영 배포·커밋·푸시. 미발송 건 수동 재발송 제외.
- 소스 커밋 6cf64b80f2175775cf2c8e19a5fde1b6d4d84e6c을 origin/main에 승격하고 clean main(system-hardening-20260914)에서 배포했다.
- functions-alimtalk dry-run·실제 배포 성공, 13개 함수 모두 ACTIVE 및 2026-10-16 20:10 KST 갱신 확인. 다른 4개 코드베이스와 Firestore 규칙·인덱스는 배포하지 않았다.
- 핵심 함수 revision scheduledsendapprovedinstructorlessonalimtalk-00030-vey, 512MiB 유지. Scheduler ENABLED, Asia/Seoul, 0 18 * * * 유지. 수동 실행 없음.
- 실제 GCS 배포 소스 generation 1792149028460585의 lib/alimtalk/instructorLessonSampleApproval.js를 읽어 전체 재계산 미호출과 승인 ID 검증 마커를 확인했다. SHA-256 6b4e909fb7639f298c7a413e222829abb05d7d96d932af36e13854c0844a041b은 로컬 배포 빌드와 일치한다. 임시 다운로드는 삭제했다.
- Hosting archive-pilates 및 archive-pilates-core dry-run·실제 배포 성공. CORE 운영규칙은 양쪽 라이브 URL에서 HTTP 200·로컬 본문 SHA-256 일치 확인. 알림톡 카탈로그는 내용 변경 없이 원천 지문만 재생성·검증했다.
- GitHub Actions 38891563205(ARCHIVE IN Functions Affected Check) 성공.
- 로컬·라이브 합성 반응형 각각 95/95 및 로컬 펼친 규칙 4항목×5화면 검사 통과. 320·390·768·1440·1920px 가로 넘침 없음. 실제 인증·회원 데이터 검증이 아닌 Firebase 차단 정적 검사다.
- 작업 소유 UI 브라우저·서버 종료와 프로세스 잔존 없음 확인. 기존 Chrome 상태 보존.
- CORE 운영규칙에 배포·검증 상태, canonical 원천, 아직 미측정인 운영 메모리와 공용 준비 후속 과제를 명시한다. 이 기록 후속 반영은 Hosting만 대상으로 한다.
- 배포 후 기존 승인 5건은 sending/2 sent/1 failed/2 candidate로 유지, 수신자·원장 변경 없음. 실제 발송 함수·큐·서명·회원 작업을 테스트로 호출하지 않았다.
- 배포 직후 알림톡 이름의 Cloud Run 서비스 ERROR 로그 조회 결과 없음. 이는 향후 정상 발송과 메모리 개선 실측을 대신하지 않는다.

## 추가 전체 경로 점검

- 2026-09-17~10-16 20:06 KST(마지막 일자 부분)의 실행 최대 메모리 지표를 재집계했다. 핵심 18시 함수는 관측 최대 506.30MiB, 90% 이상 16일·98% 이상 4일이다. OOM 로그 2일이 해당 16일 밖에 있으므로 합치면 한도 근접·초과일은 18일이다.
- 일반 일일 준비는 1GiB에서 최대 552.93MiB, 일반 큐는 512MiB에서 155.05MiB, 예약오픈은 1GiB에서 170.07MiB, 일반 승인은 512MiB에서 136.46MiB였다. 실행별 최대 표본이며 하루 종일 점유율이 아니다.
- 현재 미해결 구조: 11:30 전체 회원·예약·수업 적재, 전역 과거 후보 만료 정리, 갱신·후보 반복 쓰기, 일반 승인 날짜 전체 조회와 과거 중복 이력 조회. 이번 배포로 이 영역까지 개선됐다고 보고하지 않는다.
- syncLecturesRange에도 재계산 경로가 있지만 API/관리자 경로의 실제 활성 실행과 구분해야 한다. 기본 Excel 동기화의 시간별 실행으로 오인하지 않는다.
- 후속 우선순위: 회원별 묶음+참조 원천 조회, 과거 후보 범위·페이지 제한, 승인 ID 범위 처리, 불필요 반복 쓰기 제거. 최초 출석·평생 중복·canonical 선택을 보존하며 무발송 비교 후 별도 변경한다.

## 남은 절차

- 운영 기록·CORE 상태 표시의 커밋·푸시·Hosting 확인과 runtime/main/worktree clean 정렬 확인.
- 실제 신규 정기 실행 전까지 운영 RAM 개선 실측은 미완료다.
- 중단된 오늘 건은 별도 공급자 원장 대조와 발송 승인이 필요하다. 이번 수정으로 재발송하지 않는다.
