import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import {buildInquiryGuidance} from './build-member-inquiry-guidance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function buildMemberInquiryContract({ check = false } = {}) {
  const sourcePath = "firebase/packages/contracts/src/member-inquiries.ts";
  const source = fs.readFileSync(path.join(root, sourcePath), "utf8");
  const require = createRequire(import.meta.url);
  const ts = require(path.join(root, "firebase/kangsain-functions/functions/node_modules/typescript"));
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(output.outputText, { exports }, { timeout: 1000 });
  const { memberInquiryContract: contract, memberInquirySchema: categories } = exports;
  if (!contract || !categories || Object.keys(categories).length !== 6) throw new Error("Invalid canonical inquiry contract");
  const schema = JSON.stringify({ version: contract.policyVersion, privacyVersion: contract.privacyVersion, categories }, null, 2) + "\n";
  const outputs = {
    "firebase/kangsain-functions/functions/src/memberInquiries/contract.ts": `// Generated from ${sourcePath}; run node scripts/build-member-inquiry-contract.mjs.\n${source}`,
    "help/assets/inquiry-schema.json": schema,
    "core/assets/member-inquiry-schema.json": schema,
  };
  for (const [file, text] of Object.entries(outputs)) {
    const target = path.join(root, file);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== text) throw new Error(`Stale inquiry contract: ${file}`);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
    }
  }
  buildInquiryGuidance({check});
  return Object.keys(outputs);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log((process.argv.includes("--check") ? "Verified " : "Generated ") + buildMemberInquiryContract({ check: process.argv.includes("--check") }).join(", "));
}
