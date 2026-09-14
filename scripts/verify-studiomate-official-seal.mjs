#!/usr/bin/env node

import { verifyStudioMateOfficialSeal } from "./lib/studiomate-membership-contract-seal.mjs";

try {
  const result = await verifyStudioMateOfficialSeal();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
