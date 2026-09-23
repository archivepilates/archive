#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8");
const requireAll = (file, snippets) => {
  const source = read(file);
  for (const snippet of snippets) {
    if (!source.includes(snippet)) throw new Error(`${file} is missing: ${snippet}`);
  }
};

requireAll("firebase/kangsain-functions/functions/src/alimtalk/templates.ts", [
  "code: MEMBERSHIP_WELCOME_TEMPLATE.templateId",
  "label: MEMBERSHIP_WELCOME_TEMPLATE.name",
  'status: "approved"',
]);
requireAll("firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomePolicy.ts", [
  'templateId: "KA01TP260914091233543JoFDsn7KfCr"',
  'messageType: "BA"',
  'emphasizeType: "IMAGE"',
  'buttonName: "이용안내 보기"',
  'buttonName: "예약방법 보기"',
  'return "legacy_signup_template_forbidden"',
]);
requireAll("firebase/kangsain-functions/macmini-studiomate/com.archive.studiomate-excel-emergency-mode.plist", [
  "STUDIOMATE_MEMBERSHIP_CONTRACT_OBSERVER",
  "<string>shadow</string>",
]);
requireAll("core/rules/index.html", [
  "2026-09-23 SOLAPI 재조회",
  "신규 수강권 감지만 운영 관찰 모드",
  "김기효 계정은 스텝이므로 일반회원 계약 자동화 대상에는 포함하지 않습니다.",
]);

console.log("membership welcome v6 release guard passed");
