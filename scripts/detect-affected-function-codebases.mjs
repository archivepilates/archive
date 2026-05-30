import fs from "node:fs";
import { detectAffectedFromCli } from "./lib/affected-functions.mjs";

const args = parseArgs(process.argv.slice(2));
const result = detectAffectedFromCli(process.argv.slice(2));

if (args["github-output"]) writeGithubOutput(result);
console.log(JSON.stringify(result, null, 2));

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function writeGithubOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(
    outputPath,
    [
      `codebases=${result.codebases.join(",")}`,
      `deploy_only=${result.deployOnly}`,
      `all_codebases_affected=${result.allCodebasesAffected ? "true" : "false"}`,
    ].join("\n") + "\n",
  );
}
