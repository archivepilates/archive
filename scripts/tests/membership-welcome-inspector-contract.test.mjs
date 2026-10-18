import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("history inspector uses canonical loaders, explicit identity and GET-only transport", async () => {
  const code = await readFile(new URL("../inspect-membership-welcome-history.mjs", import.meta.url), "utf8");
  assert.match(code, /args.length !== 2/);
  assert.match(code, /archive-codex-operator@archive-pilates\.iam\.gserviceaccount\.com/);
  assert.match(code, /loadMembershipWelcomeHistory\(\s*db/);
  assert.match(code, /loadMembershipProviderHistory\(\s*get/);
  assert.match(code, /membershipWelcomeTemplateIssue/);
  assert.match(code, /readOnly: true,\s*allowedForExternalActions: false/);
  assert.match(code, /method: "GET"/);
  assert.match(code, /CLOUDSDK_CORE_LOG_HTTP: "false"/);
  assert.match(code, /CLOUDSDK_CORE_VERBOSITY: "error"/);
  assert.match(code, /finally \{\s*await db.terminate\(\);\s*\}/);
  assert.doesNotMatch(code, /\.set\(|\b(?:db|ref|tx|doc)\.update\(|\.create\(|\.delete\(|\.batch\(|runTransaction|processAlimtalkCandidate|queueMembershipWelcome|send-many|method: "POST"/);
});
