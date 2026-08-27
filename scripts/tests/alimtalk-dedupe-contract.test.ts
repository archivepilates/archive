import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { hasExplicitAlimtalkTestOverride } from "../../firebase/kangsain-functions/functions/src/alimtalk/testRecipients";

const dedupeSource = fs.readFileSync(
  new URL(
    "../../firebase/kangsain-functions/functions/src/alimtalk/dedupe.ts",
    import.meta.url,
  ),
  "utf8",
);
const rebuildSource = fs.readFileSync(
  new URL(
    "../../firebase/kangsain-functions/functions/src/alimtalk/rebuildAlimtalkCandidates.ts",
    import.meta.url,
  ),
  "utf8",
);
const testRecipientSource = fs.readFileSync(
  new URL(
    "../../firebase/kangsain-functions/functions/src/alimtalk/testRecipients.ts",
    import.meta.url,
  ),
  "utf8",
);
const eligibilitySource = fs.readFileSync(
  new URL(
    "../../firebase/kangsain-functions/functions/src/alimtalk/eligibility.ts",
    import.meta.url,
  ),
  "utf8",
);

test("checks every matching completed send before applying a time-window dedupe policy", () => {
  assert.doesNotMatch(
    dedupeSource,
    /\.where\("dedupeKey", "==", dedupeKey\)[\s\S]{0,180}\.limit\(/,
    "A limited unordered query can select an old send and miss a newer duplicate.",
  );
});

test("does not truncate ticket or instructor fallback history", () => {
  assert.doesNotMatch(
    dedupeSource,
    /\.alimtalkSends\(\)[\s\S]{0,240}\.limit\((?:1|20)\)/,
    "Fallback dedupe checks must not ignore matching completed sends beyond an arbitrary limit.",
  );
});

test("records candidate-generation duplicate blocks with the canonical reason code", () => {
  assert.match(rebuildSource, /reasonCode: "duplicate_send_blocked"/);
});

test("blocks long-absence messages after any recent member-care message", () => {
  assert.match(dedupeSource, /candidate\.type === "long_absence"/);
  assert.match(dedupeSource, /findRecentMemberCareDuplicate\(candidate, 14\)/);
  assert.match(dedupeSource, /"private_count_low"/);
  assert.match(dedupeSource, /"private_ticket_expiring"/);
});

test("does not generate automatic member candidates for excluded staff accounts", () => {
  assert.doesNotMatch(
    rebuildSource,
    /ALIMTALK_MEMBER_EXCLUSION_REASONS\[profile\.memberId\][^\n]*isAlimtalkTestRecipient/,
  );
  assert.match(
    rebuildSource,
    /if \(ALIMTALK_MEMBER_EXCLUSION_REASONS\[profile\.memberId\]\) return null;/,
  );
});

test("limits the test-recipient bypass to explicit operator-approved sends", () => {
  assert.match(testRecipientSource, /input\.queuedBy === "operator"/);
  assert.match(testRecipientSource, /!reviewedByUid\.startsWith\("system:"\)/);
  assert.match(
    eligibilitySource,
    /hasExplicitAlimtalkTestOverride\(candidate\)/,
  );
});

test("does not treat an automatic Kim test-recipient candidate as an explicit test send", () => {
  const recipient = {
    memberId: "1982133",
    memberName: "김기효",
    memberPhone: "01086488585",
  };
  assert.equal(
    hasExplicitAlimtalkTestOverride({
      ...recipient,
      queuedBy: "auto",
      reviewedByUid: "system:auto-daily-1130",
    }),
    false,
  );
  assert.equal(
    hasExplicitAlimtalkTestOverride({ ...recipient, queuedBy: "operator" }),
    true,
  );
  assert.equal(
    hasExplicitAlimtalkTestOverride({
      ...recipient,
      reviewedByUid: "operator-user",
    }),
    true,
  );
});
