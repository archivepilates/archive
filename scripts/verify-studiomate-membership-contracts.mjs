#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { evaluateMembershipContractEligibility } from "./lib/studiomate-membership-contract-policy.mjs";
import { planMembershipContractWelcome } from "./lib/studiomate-membership-welcome.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--input") {
  throw new Error(
    "Usage: node scripts/verify-studiomate-membership-contracts.mjs --input <verified-evidence.json>. Read-only; no --apply/send mode.",
  );
}
const batch = JSON.parse(await readFile(args[1], "utf8"));
if (!Array.isArray(batch) || batch.length > 500)
  throw new Error("Expected at most 500 verified evidence objects");
const results = batch.map((input, index) => ({
  index,
  ...evaluateMembershipContractEligibility(input),
  welcome: planMembershipContractWelcome({
    ...input?.welcomeCompletion,
    selection: input,
  }),
}));
const counts = {};
for (const result of results)
  counts[result.status] = (counts[result.status] || 0) + 1;
console.log(
  JSON.stringify({ mode: "read_only", sends: 0, counts, results }, null, 2),
);
