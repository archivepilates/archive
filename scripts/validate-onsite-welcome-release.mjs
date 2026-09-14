#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const senderPath = "firebase/kangsain-functions/functions/src/alimtalk/onsiteWelcomeAlimtalk.ts";

const requiredFiles = [
  "archivein/onsiteWelcome/index.html",
  "archivein/memberSignup/index.html",
  "firebase/kangsain-functions/functions/src/memberSignup/onsiteWelcomeRequest.ts",
  "firebase/kangsain-functions/functions/src/memberSignup/memberSignupContract.ts",
  "firebase/kangsain-functions/functions/src/assets/NotoSansKR.ttf",
  "firebase/kangsain-functions/functions/src/exports/privateChart.ts",
  "firebase/kangsain-functions/functions/src/memberSignup/memberSignupPdfArchive.ts",
  "firebase/kangsain-functions/functions/src/runtime/functionOptions.ts",
  "firebase/kangsain-functions/functions/src/types/models.ts",
  "firebase/kangsain-functions/functions/src/utils/shortLinks.ts",
  "scripts/process-onsite-welcome-requests.mjs",
];

const requiredSnippets = [
  {
    file: "firebase.json",
    snippets: [
      "\"site\": \"archive-pilates-in\"",
      "\"public\": \"archivein\"",
      '"source": "/api/memberSignupContract"',
      '"source": "/archivein/api/memberSignupContract"',
      '"functionId": "memberSignupContract"',
      '"source": "/api/onsiteWelcomeRequest"',
      '"source": "/archivein/api/onsiteWelcomeRequest"',
      '"functionId": "onsiteWelcomeRequest"',
      '"source": "/s/**"',
      '"functionId": "redirectShortLink"',
    ],
  },
  {
    file: "archivein/onsiteWelcome/index.html",
    snippets: ["data-onsite-welcome-retired", "https://arcpilates.studiomate.kr/users/create"],
    forbiddenPatterns: [/<form\b/i, /<script\b/i, /\bon(?:submit|click)\s*=/i, /sendButton/, /api\/onsiteWelcomeRequest/],
  },
  {
    file: "firebase/kangsain-functions/functions/src/memberSignup/onsiteWelcomeRequest.ts",
    snippets: [
      'if (request.method === "POST") {\n      response.status(410).json({',
      'code: "onsite_welcome_retired"',
      'if (request.method === "GET")',
      "await readAuthorizedRequest(requestId, accessToken)",
      "doc.accessTokenHash !== sha256(accessToken)",
      "const canSendAlimtalk = false",
      "hasSentAlimtalkHistory",
    ],
    forbiddenPatterns: [
      /onsiteWelcomeAlimtalk/,
      /sendOnsiteWelcomeAlimtalkForRequest/,
      /createSignupContract/,
      /request\.body/,
      /\brefs\.[^\n;]*\.(?:set|update|add|delete)\s*\(/,
      /\b(?:db|tx|batch|ref)\.(?:set|update|add|delete|runTransaction|batch)\s*\(/,
      /\.ref\.(?:set|update|delete)\s*\(/,
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/alimtalk/eligibility.ts",
    snippets: [
      'export async function autoSendabilityIssue(candidate: AlimtalkCandidateDoc, today: string): Promise<string> {\n  if (candidate.type === "onsite_welcome") return "현장 웰컴 신규 발송 종료";',
    ],
  },
  {
    file: "archivein/memberSignup/index.html",
    snippets: ["../api/memberSignupContract", "contractId", "accessToken", "signatureImageDataUrl"],
  },
  {
    file: "firebase/kangsain-functions/functions/src/memberSignup/memberSignupContract.ts",
    snippets: [
      "memberSignupContractHandler",
      'if (request.method === "GET")',
      'if (request.method === "POST")',
      "readAuthorizedContract",
      "current.accessTokenHash !== sha256(stringValue(tokenInput))",
      'if (contract.status === "submitted")',
      "duplicate: true",
      "tryArchiveSubmittedContract",
      "enqueueStudioMateProfileWriteJob",
      'if (contract.status === "submitted" || contract.submittedAt || contract.signature) continue;',
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/exports/privateChart.ts",
    snippets: [
      "export const memberSignupContract = onRequest(publicDriveRequestOptions, memberSignupContractHandler)",
      "export const onsiteWelcomeRequest = onRequest(",
      "{ ...publicRequestOptions, secrets: [] }, onsiteWelcomeRequestHandler",
      "onsiteWelcomeRequestHandler",
      "export const redirectShortLink = onRequest(publicRequestOptions, redirectShortLinkHandler)",
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/runtime/functionOptions.ts",
    snippets: [
      "export const publicDriveRequestOptions",
      "secrets: [googleDwdServiceAccountJson]",
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/memberSignup/memberSignupPdfArchive.ts",
    snippets: [
      "ARCHIVE PILATES 회원가입서 PDF",
      "1jpW73Io8GOkrURxoUoWZ2257mWKqEe8X",
      "createMemberSignupPdf",
      "uploadPdfToDrive",
      "NotoSansKR.ttf",
      "signatureImageDataUrl",
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/types/models.ts",
    snippets: ["| \"lookup_ready\"", "| \"onsite_welcome\"", "alimtalkSendId?: string"],
  },
  {
    file: "firebase/kangsain-functions/functions/src/utils/shortLinks.ts",
    snippets: ['| "member_signup"', '? "ms"', "redirectShortLinkHandler", "response.redirect(302, String(data.targetUrl))"],
  },
  {
    file: "scripts/process-onsite-welcome-requests.mjs",
    snippets: ['status: "retired"', 'source: "onsite_welcome_playwright_runner"', "ok: true", "processed: 0"],
    forbiddenPatterns: [
      /\b(?:import|require)\b/,
      /\bfetch\s*\(/,
      /\b(?:firebase-admin|playwright)\b|launchPersistentContext|acquireStudioMateBrowserLock/,
      /claimNextRequest|createSignupContract|onsiteWelcomeRequests|memberSignupContracts/,
      /\.(?:set|update|add|delete|runTransaction|batch)\s*\(/,
    ],
  },
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) failures.push(`missing file: ${file}`);
}
if (existsSync(join(root, senderPath))) failures.push(`retired sender must remain absent: ${senderPath}`);

try {
  const config = JSON.parse(readFileSync(join(root, "firebase.json"), "utf8"));
  for (const [site, prefix] of [["archive-pilates", "/archivein"], ["archive-pilates-in", ""]]) {
    const hosting = config.hosting.find((entry) => entry.site === site);
    for (const [source, functionId] of [
      [`${prefix}/api/memberSignupContract`, "memberSignupContract"],
      [`${prefix}/api/onsiteWelcomeRequest`, "onsiteWelcomeRequest"],
      ["/s/**", "redirectShortLink"],
    ]) {
      const rewrite = hosting?.rewrites?.find((entry) => entry.source === source);
      if (rewrite?.function?.functionId !== functionId) failures.push(`compatibility rewrite missing or changed: ${site} ${source} -> ${functionId}`);
    }
  }
} catch (error) {
  failures.push(`cannot validate compatibility rewrites: ${error.message}`);
}

for (const check of requiredSnippets) {
  const path = join(root, check.file);
  const content = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const snippet of check.snippets) {
    if (!content.includes(snippet)) failures.push(`missing snippet in ${check.file}: ${snippet}`);
  }
  for (const pattern of check.forbiddenPatterns || []) {
    if (pattern.test(content)) failures.push(`retired entrypoint in ${check.file}: ${pattern}`);
  }
}

if (failures.length) {
  console.error("ARCHIVE IN onsite welcome retirement guard failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ARCHIVE IN onsite welcome retirement and existing contract compatibility guard passed.");
