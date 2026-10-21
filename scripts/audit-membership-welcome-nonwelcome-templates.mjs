import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  AUDIT_PROJECT, AUDIT_OPERATOR, DEFAULT_NONWELCOME_SCOPE, NONWELCOME_SCOPES, nonWelcomeScopeTemplateId,
  readNonWelcomeAuditSource, auditMembershipWelcomeNonWelcome,
} from "./lib/membership-welcome-nonwelcome-audit.mjs";

export function parseAuditArgs(args) {
  const options = { apply: false, scope: DEFAULT_NONWELCOME_SCOPE };
  let modeSeen = false, scopeSeen = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--apply", "--dry-run"].includes(arg) && !modeSeen) {
      modeSeen = true;
      options.apply = arg === "--apply";
    } else if (arg === "--scope" && !scopeSeen) {
      scopeSeen = true;
      const scope = args[++index];
      if (scope === undefined) throw new Error("Audit scope value required");
      nonWelcomeScopeTemplateId(scope);
      options.scope = scope;
    } else throw new Error(`Use --dry-run or --apply with optional --scope ${NONWELCOME_SCOPES.join("|")}`);
  }
  return options;
}

export function validateAuditCredential(key, env = {}) {
  if (key?.type !== "service_account" || key.project_id !== AUDIT_PROJECT || key.client_email !== AUDIT_OPERATOR ||
      typeof key.private_key !== "string" || !key.private_key.startsWith("-----BEGIN PRIVATE KEY-----") ||
      key.token_uri !== "https://oauth2.googleapis.com/token" ||
      ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"].some((name) => env[name] && env[name] !== AUDIT_PROJECT) ||
      ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "GOOGLE_APPLICATION_CREDENTIALS_JSON"].some((name) => env[name]))
    throw new Error("Expected archive-pilates operator service-account ADC without target overrides");
}

export function createTemplateGetter({ readSecret, scope = DEFAULT_NONWELCOME_SCOPE, fetchImpl = fetch,
  now = () => new Date().toISOString(), salt = () => randomBytes(16).toString("hex") }) {
  const allowedUrl = `https://api.solapi.com/kakao/v2/templates/${nonWelcomeScopeTemplateId(scope)}`;
  return async (url) => {
    if (url !== allowedUrl) throw new Error("Only the scoped provider template GET is allowed");
    const apiKey = readSecret("SOLAPI_API_KEY"), apiSecret = readSecret("SOLAPI_API_SECRET");
    if (!apiKey || !apiSecret) throw new Error("Provider audit credentials unavailable");
    const date = now(), nonce = salt();
    const signature = createHmac("sha256", apiSecret).update(date + nonce).digest("hex");
    const response = await fetchImpl(url, { method: "GET", redirect: "error", headers: {
      Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${nonce}, signature=${signature}`,
    }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Provider template audit GET failed (${response.status})`);
    return response.json();
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseAuditArgs(args);
  readNonWelcomeAuditSource(options.scope);
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error("Explicit operator service-account ADC path required");
  const key = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
  validateAuditCredential(key, process.env);
  // No login, impersonation, secret writes, provider sends, queue calls or baseline updates.
  const require = createRequire(import.meta.url);
  const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
  const app = admin.initializeApp({ projectId: AUDIT_PROJECT, credential: admin.credential.cert(key) }, "membership-nonwelcome-audit");
  try {
    const readSecret = (name) => execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`,
      `--project=${AUDIT_PROJECT}`, `--account=${AUDIT_OPERATOR}`, "--quiet"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000,
      env: { ...process.env, CLOUDSDK_CORE_LOG_HTTP: "false", CLOUDSDK_CORE_VERBOSITY: "error" },
    }).trim();
    const result = await auditMembershipWelcomeNonWelcome({ db: app.firestore(),
      providerGet: createTemplateGetter({ readSecret, scope: options.scope }), ...options });
    console.log(JSON.stringify(result));
    return result;
  } finally { await app.delete(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // SDK/provider/subprocess errors can contain credentials or private response bodies.
    console.error(JSON.stringify({ status: "failed_or_unconfirmed", error: "nonwelcome_audit_failed_no_secrets_logged" }));
    process.exitCode = 1;
  });
}
