#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredFiles = [
  "archivein/onsiteWelcome/index.html",
  "archivein/onsiteWelcome/site.webmanifest",
  "archivein/onsiteWelcome/icons/apple-touch-icon.png",
  "archivein/onsiteWelcome/icons/archive-pilates-icon-192.png",
  "archivein/onsiteWelcome/icons/archive-pilates-icon-512.png",
  "firebase/kangsain-functions/functions/src/memberSignup/onsiteWelcomeRequest.ts",
  "firebase/kangsain-functions/functions/src/alimtalk/onsiteWelcomeAlimtalk.ts",
  "firebase/kangsain-functions/functions/src/alimtalk/templates.ts",
  "firebase/kangsain-functions/functions/src/alimtalk/templateTargetRules.ts",
  "firebase/kangsain-functions/functions/src/types/models.ts",
  "firebase/kangsain-functions/functions/src/utils/shortLinks.ts",
];

const requiredSnippets = [
  {
    file: "archivein/onsiteWelcome/index.html",
    snippets: [
      "id=\"sendButton\"",
      "웰컴 알림톡 전송",
      "'lookup_ready'",
      "request.canSendAlimtalk",
      "action: 'send'",
      "archiveOnsiteWelcomeHistory",
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/memberSignup/onsiteWelcomeRequest.ts",
    snippets: [
      "body.action === \"send\"",
      "sendOnsiteWelcomeAlimtalkForRequest",
      "\"lookup_ready\"",
      "canSendAlimtalk",
      "hasSentAlimtalkHistory",
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/alimtalk/onsiteWelcomeAlimtalk.ts",
    snippets: [
      "ONSITE_WELCOME_SETTINGS_DOC",
      "onsiteWelcomeAlimtalk",
      "ALIMTALK_TEMPLATES.onsite_welcome.code",
      "type: \"onsite_welcome\"",
      "ensureShortLink",
      "type: \"member_signup\"",
      "processAlimtalkQueue",
      "existingWelcomeSend",
      "ALIMTALK_TEMPLATES.new_member.code",
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/alimtalk/templates.ts",
    snippets: [
      "| \"onsite_welcome\"",
      "onsite_welcome: {",
      "KA01TP260602101939427lPhGyuDLvFM",
      "신규회원 웰컴 v5",
      "현장 웰컴 영구 1회",
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/alimtalk/templateTargetRules.ts",
    snippets: [
      "onsite_welcome: {",
      "현장 웰컴 페이지에서 가입서 링크가 준비된 lookup_ready 요청",
      "직원이 웰컴 페이지의 알림톡 전송 버튼을 직접 클릭",
      "회원가입서 작성 버튼",
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/types/models.ts",
    snippets: ["| \"lookup_ready\"", "| \"onsite_welcome\"", "alimtalkSendId?: string"],
  },
  {
    file: "firebase/kangsain-functions/functions/src/utils/shortLinks.ts",
    snippets: ["| \"member_signup\"", "? \"ms\""],
  },
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) failures.push(`missing file: ${file}`);
}

for (const check of requiredSnippets) {
  const path = join(root, check.file);
  const content = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const snippet of check.snippets) {
    if (!content.includes(snippet)) failures.push(`missing snippet in ${check.file}: ${snippet}`);
  }
}

if (failures.length) {
  console.error("ARCHIVE IN onsite welcome release guard failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ARCHIVE IN onsite welcome release guard passed.");
