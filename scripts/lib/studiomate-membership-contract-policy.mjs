import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL(
    "../../firebase/kangsain-functions/functions/package.json",
    import.meta.url,
  ),
);
const { require: tsRequire } = require("tsx/cjs/api");
const policy = tsRequire(
  fileURLToPath(
    new URL(
      "../../firebase/kangsain-functions/functions/src/memberSignup/membershipContractPolicy.ts",
      import.meta.url,
    ),
  ),
  import.meta.url,
);
export const {
  normalizeMembershipPhone,
  membershipContractJobKey,
  baselineDiff,
  evaluateMembershipContractEligibility,
} = policy;
