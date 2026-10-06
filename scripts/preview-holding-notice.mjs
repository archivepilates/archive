import { readFile } from "node:fs/promises";
import { planHoldingNotice } from "./lib/holding-allowance-notice.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--input") throw new Error("Usage: node scripts/preview-holding-notice.mjs --input <verified-snapshot.json>");
const input = JSON.parse(await readFile(args[1], "utf8"));
console.log(JSON.stringify(planHoldingNotice(input), null, 2));
