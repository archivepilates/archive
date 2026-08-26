import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

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
