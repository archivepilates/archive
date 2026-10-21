#!/usr/bin/env node
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const require = createRequire(new URL("../firebase/kangsain-functions/functions/package.json", import.meta.url));
const ts = require("typescript");
if (process.argv[2] !== "--apply" || process.argv[3] !== "user_member_dispatch_quiet_hours_20261022")
  throw new Error("Explicit reviewed quiet-hours release reference required");
const functions = {};
for (const name of ["processAlimtalkQueue.ts", "instructorLessonSampleApproval.ts"]) {
  const text = await readFile(new URL(`../firebase/kangsain-functions/functions/src/alimtalk/${name}`, import.meta.url), "utf8");
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  functions[name] = Object.fromEntries(source.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name.text, createHash("sha256").update(node.body.getText(source)).digest("hex")]));
}
const dir = new URL("./fixtures/", import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL("./fixtures/member-dispatch-execution-audit.json", import.meta.url), JSON.stringify({ approval: "user_member_dispatch_quiet_hours_20261022", policy: "member_dispatch_kst_0900_2300_v1", functions }, null, 2) + "\n");
console.log("Generated reviewed dispatch execution hashes; eligibility and duplicate-policy baseline remains unchanged.");
