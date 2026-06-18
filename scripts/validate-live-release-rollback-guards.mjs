#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const guardGroups = [
  {
    id: "archive-core-home-actions",
    reason: "ARCHIVE CORE 홈 액션 보드와 수강료 문의 즉시발송 UI가 예전 번들로 되돌아가는 것을 막습니다.",
    files: [
      {
        file: "core/index.html",
        markers: [
          "homeActionTotal",
          "수강료 문의 즉시발송",
          "pricingInquiryForm",
          "pricingInquiryHistoryPanel",
          "최근 발송/메모 보기",
        ],
      },
      {
        file: "core/assets/app.js",
        markers: [
          "pricingInquiryAlimtalkRequests",
          "pricingInquiryDisplayPhone",
          "pricingInquiryHistoryPanel",
          "operatorSendPricingInquiryAlimtalk",
          "homeActionTotal",
        ],
      },
      {
        file: "core/assets/styles.css",
        markers: [".kpis > .metric", "min-height: 156px"],
      },
    ],
  },
  {
    id: "pricing-inquiry-alimtalk",
    reason: "수강료 문의 알림톡 발송과 내부 메모 기록 기능이 빠지는 것을 막습니다.",
    files: [
      {
        file: "firebase/kangsain-functions/functions/src/alimtalk/pricingInquiryAlimtalk.ts",
        markers: [
          "pricingInquiryAlimtalkRequests",
          "operatorSendPricingInquiryAlimtalkHandler",
          "note",
          "pricingUrl",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/exports/alimtalk.ts",
        markers: [
          "operatorSendPricingInquiryAlimtalk",
          "operatorSendPricingInquiryAlimtalkHandler",
        ],
      },
    ],
  },
  {
    id: "private-chart-edit-before-send",
    reason: "프라이빗 리포트 발송 전 수정 기능과 다음수업 메모 분리 정책이 롤백되는 것을 막습니다.",
    files: [
      {
        file: "archivein/private-chart/index.html",
        markers: [
          "reportSummaryEdit",
          "reportNextDirectionEdit",
          "data-save-report-edit",
          "회원 리포트 알림톡 발송이 완료되어 기록을 수정할 수 없습니다.",
          "다음 수업 준비 메모",
          "회원 리포트의 다음 수업 방향에는 그대로 노출되지 않습니다.",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts",
        markers: [
          "String(body.action || \"\") === \"editReport\"",
          "publicSummary",
          "publicNextDirection",
          "delete (postRecord as Record<string, unknown>).nextMemo",
          "점수, 평균, 등급, 평가처럼 느껴지는 표현은 쓰지 않습니다.",
        ],
      },
    ],
  },
  {
    id: "private-media-drive-direct-upload",
    reason: "프라이빗 사진/영상 업로드가 Drive 직접 업로드가 아닌 예전 Function 중계 구조로 되돌아가는 것을 막습니다.",
    files: [
      {
        file: "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonMedia.ts",
        markers: [
          "const CHUNK_SIZE = 16 * 1024 * 1024;",
          "directUpload",
          "uploadMode: \"drive_direct\"",
          "completePrivateLessonMediaUpload",
        ],
      },
      {
        file: "archivein/private-chart/index.html",
        markers: [
          "init.chunkSize || 16 * 1024 * 1024",
          "uploadMediaFileDirect",
          "completeMediaUpload",
          "Drive 직접 업로드 중",
        ],
      },
      {
        file: "scripts/validate-private-media-upload-live.mjs",
        markers: [
          "uploadMode: \"drive_direct\"",
          "chunkSize",
          "completeMediaUpload",
        ],
      },
    ],
  },
  {
    id: "onsite-welcome-current-flow",
    reason: "현장 웰컴 가입서 알림톡과 StudioMate 후속 처리 흐름이 예전 코드로 되돌아가는 것을 막습니다.",
    files: [
      {
        file: "archivein/onsiteWelcome/index.html",
        markers: [
          "가입서 링크 준비",
          "웰컴 알림톡 발송 완료",
          "스튜디오메이트 확인 대기",
          "서명완료 가입서 PDF 폴더",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/memberSignup/onsiteWelcomeRequest.ts",
        markers: [
          "onsiteWelcomeRequestHandler",
          "lookup_ready",
          "sendOnsiteWelcomeAlimtalkForRequest",
        ],
      },
      {
        file: "scripts/process-onsite-welcome-requests.mjs",
        markers: [
          "onsiteWelcomeRequests",
          "StudioMate",
          "memberSignupContracts",
        ],
      },
    ],
  },
  {
    id: "core-operating-rules",
    reason: "Notion 대신 ARCHIVE CORE 운영규칙 탭을 기준으로 쓰는 운영 정책이 빠지는 것을 막습니다.",
    files: [
      {
        file: "core/rules/index.html",
        markers: [
          "운영규칙",
          "수강료 문의 즉시발송",
          "Private Session Records DB는 사용하지 않습니다",
          "업로드는 16MB 청크 기준",
          "기능 브랜치만 라이브에 배포되고 main으로 승격되지 않은 상태는 rollback",
        ],
      },
    ],
  },
];

const failures = [];
for (const group of guardGroups) {
  for (const item of group.files) {
    const content = readFile(item.file);
    if (!content) {
      failures.push({ group: group.id, reason: group.reason, file: item.file, missing: "__file__" });
      continue;
    }
    for (const marker of item.markers) {
      if (!content.includes(marker)) {
        failures.push({ group: group.id, reason: group.reason, file: item.file, missing: marker });
      }
    }
  }
}

if (failures.length) {
  console.error("Live release rollback guard failed.");
  console.error("This deploy appears to remove or overwrite a currently active ARCHIVE PILATES feature.");
  console.error(JSON.stringify({ failures }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      guard: "archive-live-release-rollback-guards",
      groups: guardGroups.map((group) => group.id),
      checkedFiles: [...new Set(guardGroups.flatMap((group) => group.files.map((item) => item.file)))],
    },
    null,
    2,
  ),
);

function readFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}
