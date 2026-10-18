#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 2 ||
    args[0] !== "--contract-id" ||
    !/^[a-f0-9]{64}$/.test(args[1])
  )
    throw new Error(
      "Use --contract-id <canonical contract ID>; this inspector is read-only",
    );
  const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json";
  const credential = JSON.parse(await readFile(keyPath, "utf8"));
  if (
    credential.project_id !== "archive-pilates" ||
    credential.client_email !==
      "archive-codex-operator@archive-pilates.iam.gserviceaccount.com" ||
    [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT].some(
      (value) => value && value !== "archive-pilates",
    ) ||
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw new Error("Expected archive-pilates operator service account");
  const require = createRequire(
    new URL(
      "../firebase/kangsain-functions/functions/package.json",
      import.meta.url,
    ),
  );
  const { require: tsRequire } = require("tsx/cjs/api");
  const source = (relative) =>
    tsRequire(
      fileURLToPath(
        new URL(
          `../firebase/kangsain-functions/functions/src/${relative}`,
          import.meta.url,
        ),
      ),
      import.meta.url,
    );
  const { loadMembershipWelcomeHistory } = source(
    "memberSignup/membershipWelcomeHistory.ts",
  );
  const { loadMembershipProviderHistory, loadMembershipWelcomeTemplate } =
    source("memberSignup/membershipWelcomeProvider.ts");
  const { membershipWelcomeKey, membershipWelcomeTemplateIssue } = source(
    "memberSignup/membershipWelcomePolicy.ts",
  );
  const { membershipWelcomeReadbackIssue } = source(
    "memberSignup/membershipWelcomeReadback.ts",
  );
  const admin = require("firebase-admin");
  admin.initializeApp({
    credential: admin.credential.cert(credential),
    projectId: "archive-pilates",
  });
  const db = admin.firestore();
  try {
    const id = args[1],
      record = (
        await db.doc(`studiomateMembershipContracts/${id}`).get()
      ).data();
    const config = (
      await db.doc("systemSettings/membershipContractAutomation").get()
    ).data();
    const phone = String(record?.completion?.memberPhone || "").replace(
      /\D/g,
      "",
    );
    if (
      record?.contractId !== id ||
      record.source !== "studiomate_native_contract" ||
      record.studioId !== "5330" ||
      !record.bindingVerified ||
      !/^01[016789]\d{7,8}$/.test(phone)
    )
      throw new Error("Canonical contract identity required");
    const profile = (
      await db.doc(`memberProfiles/${record.completion.memberId}`).get()
    ).data();
    if (
      profile?.name !== record.memberName ||
      String(profile.phone || "").replace(/\D/g, "") !== phone ||
      profile.studioId !== "5330"
    )
      throw new Error("Canonical member identity mismatch");
    const local = await loadMembershipWelcomeHistory(db, {
      studioId: "5330",
      memberId: record.completion.memberId,
      phone,
    });
    const secret = (name) =>
      execFileSync(
        "gcloud",
        [
          "secrets",
          "versions",
          "access",
          "latest",
          `--secret=${name}`,
          "--project=archive-pilates",
          "--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com",
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 20_000,
        env: {
          ...process.env,
          CLOUDSDK_CORE_LOG_HTTP: "false",
          CLOUDSDK_CORE_VERBOSITY: "error",
        },
        },
      ).trim();
    const apiKey = secret("SOLAPI_API_KEY"),
      apiSecret = secret("SOLAPI_API_SECRET");
    const deadline = Date.now() + 25_000;
    let providerGets = 0;
    const get = async (url) => {
      const parsed = new URL(url);
      if (
        parsed.origin !== "https://api.solapi.com" ||
        !/^\/(messages\/v4\/list|kakao\/v2\/templates\/[^/]+)$/.test(
          parsed.pathname,
        )
      )
        throw new Error("Provider read URL not allowed");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Provider history deadline exceeded");
      const date = new Date().toISOString(),
        salt = randomBytes(16).toString("hex");
      const signature = createHmac("sha256", apiSecret)
        .update(date + salt)
        .digest("hex");
      providerGets++;
      const response = await fetch(parsed, {
        method: "GET",
        headers: {
          Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
        },
        signal: AbortSignal.timeout(Math.min(20_000, remaining)),
      });
      if (!response.ok) throw new Error(`Provider GET ${response.status}`);
      return response.json();
    };
    const coverage = config?.providerHistoryCoverage;
    const provider = await loadMembershipProviderHistory(get, {
      phone,
      startAt: coverage?.startAt,
      now: new Date().toISOString(),
      nonWelcomeTemplateAllowlist: coverage?.nonWelcomeTemplateAllowlist,
      coverageVerified:
        coverage?.allWelcomeVersions === true &&
        coverage?.noRetentionGap === true &&
        coverage?.verified === true &&
        typeof coverage?.auditId === "string" &&
        !!coverage.auditId,
    });
    const templateIssue = provider.complete
      ? membershipWelcomeTemplateIssue(await loadMembershipWelcomeTemplate(get))
      : "not_checked";
    const candidateId = membershipWelcomeKey("5330", phone);
    const evidence = await db.getAll(
      ...["alimtalkCandidates", "alimtalkSends", "membershipWelcomeClaims"].map(
        (c) => db.doc(`${c}/${candidateId}`),
      ),
    );
    console.log(
      JSON.stringify(
        {
          readOnly: true,
          allowedForExternalActions: false,
          contractId: id,
          contractStatus: record.status,
          welcomeStatus: record.welcomeStatus,
          welcomeReason: record.welcomeReason,
          nativeReadbackIssue: membershipWelcomeReadbackIssue(
            record,
            new Date(),
          ),
          local: {
            complete: local.complete,
            reason: local.reason,
            memberAliases: local.memberIds.length,
            welcomeRecords: local.records.length,
          },
          provider: {
            complete: provider.complete,
            reason: provider.reason,
            welcomeRecords: provider.records.length,
            gets: providerGets,
          },
          templateIssue,
          candidateId,
          existing: evidence.map((doc, index) => ({
            kind: ["candidate", "send", "claim"][index],
            exists: doc.exists,
            status: doc.data()?.status || null,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await db.terminate();
  }
}

main().catch(() => {
  console.error(
    JSON.stringify({
      readOnly: true,
      error: "welcome_history_inspection_failed_no_secrets_logged",
    }),
  );
  process.exitCode = 1;
});
