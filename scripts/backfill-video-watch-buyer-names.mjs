#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = "archive-pilates";
const EXPECTED_SITE_CODE = "S20260516852c71a014d08";
const VIDEO_WATCH_SESSION_COLLECTION = "videoWatchSessions";
const BUYER_KEY_PREFIX = "archive-pilates-video-watch:v1:";
const DEFAULT_CREDENTIALS = path.join(
  os.homedir(),
  "ArchiveIN/secrets/google/archive-codex-operator.json",
);

export function buyerKeyFromMemberCode(memberCode) {
  const normalizedCode = String(memberCode || "").trim();
  if (!normalizedCode) return "";
  const memberHash = createHash("sha1").update(normalizedCode).digest("hex");
  return createHash("sha256").update(`${BUYER_KEY_PREFIX}${memberHash}`).digest("hex");
}

export function cleanBuyerName(value) {
  const name = String(value || "")
    .replace(/[<>\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .replace(/\s*님$/, "")
    .trim();
  if (!name || name.includes("@") || /\d{3,}/.test(name)) return "";
  if (name.length < 2 || !/^[가-힣A-Za-z][가-힣A-Za-z .'-]{1,39}$/.test(name)) return "";
  if (/^(관리자|소유자|로그인|회원|마이페이지)$/i.test(name)) return "";
  return name;
}

export function buildMemberDirectory(memberRows) {
  const candidates = new Map();
  for (const row of Array.isArray(memberRows) ? memberRows : []) {
    const buyerKey = buyerKeyFromMemberCode(row?.memberCode);
    const buyerName = cleanBuyerName(row?.name);
    if (!buyerKey || !buyerName) continue;
    const names = candidates.get(buyerKey) || new Set();
    names.add(buyerName);
    candidates.set(buyerKey, names);
  }

  const directory = new Map();
  let collisions = 0;
  for (const [buyerKey, names] of candidates) {
    if (names.size !== 1) {
      collisions += 1;
      continue;
    }
    directory.set(buyerKey, [...names][0]);
  }
  return { directory, collisions };
}

export function memberRowsFromResponse(response) {
  if (Array.isArray(response)) return response;
  return Array.isArray(response?.data?.list) ? response.data.list : [];
}

export function buildBackfillPlan(sessionRows, directory) {
  const plan = [];
  let alreadyNamed = 0;
  let unmatched = 0;
  let invalidBuyerKeys = 0;
  for (const row of Array.isArray(sessionRows) ? sessionRows : []) {
    const currentName = cleanBuyerName(row?.data?.buyerName);
    if (currentName) {
      alreadyNamed += 1;
      continue;
    }
    const buyerKey = String(row?.data?.buyerKey || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(buyerKey)) {
      invalidBuyerKeys += 1;
      continue;
    }
    const buyerName = directory.get(buyerKey);
    if (!buyerName) {
      unmatched += 1;
      continue;
    }
    plan.push({ id: String(row.id), buyerName });
  }
  return { plan, alreadyNamed, unmatched, invalidBuyerKeys };
}

function runImweb(args) {
  const raw = execFileSync("imweb", ["--output", "json", ...args], {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    encoding: "utf8",
    maxBuffer: 24 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const args = new Set(argv);
  const maxWritesArg = argv.find((value) => value.startsWith("--max-writes="));
  const maxWrites = Number(maxWritesArg?.split("=")[1] || 1000);
  if (!Number.isInteger(maxWrites) || maxWrites < 1 || maxWrites > 5000) {
    throw new Error("--max-writes must be an integer between 1 and 5000.");
  }
  return {
    apply: args.has("--apply"),
    confirmed: args.has("--confirm-video-watch-buyer-name-backfill"),
    maxWrites,
  };
}

async function applyPlan(db, plan) {
  for (let offset = 0; offset < plan.length; offset += 400) {
    const batch = db.batch();
    for (const row of plan.slice(offset, offset + 400)) {
      batch.set(
        db.collection(VIDEO_WATCH_SESSION_COLLECTION).doc(row.id),
        {
          buyerName: row.buyerName,
          buyerNameSource: "imweb-member-code-exact-match",
          buyerNameSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.apply && !config.confirmed) {
    throw new Error(
      "Refusing to write without --confirm-video-watch-buyer-name-backfill.",
    );
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(DEFAULT_CREDENTIALS)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_CREDENTIALS;
  }

  const context = runImweb(["config", "context"]);
  const siteCode = context?.resolved_profile?.site_code;
  if (siteCode !== EXPECTED_SITE_CODE) {
    throw new Error(`Unexpected Imweb target: ${siteCode || "missing site"}`);
  }
  const memberResponse = runImweb([
    "member",
    "list",
    "--all",
    "--max-pages",
    "50",
    "--limit",
    "50",
  ]);
  const members = memberRowsFromResponse(memberResponse);
  const { directory, collisions } = buildMemberDirectory(members);
  if (config.apply && collisions > 0) {
    throw new Error("Refusing to write because the member directory contains hash collisions.");
  }

  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();
  const snapshot = await db.collection(VIDEO_WATCH_SESSION_COLLECTION).get();
  const sessions = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  const result = buildBackfillPlan(sessions, directory);
  if (result.plan.length > config.maxWrites) {
    throw new Error(
      `Planned writes ${result.plan.length} exceed --max-writes=${config.maxWrites}.`,
    );
  }
  if (config.apply) await applyPlan(db, result.plan);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: config.apply ? "apply" : "dry-run",
    projectId: PROJECT_ID,
    siteCode,
    membersScanned: members.length,
    exactDirectoryEntries: directory.size,
    directoryCollisions: collisions,
    sessionsScanned: sessions.length,
    alreadyNamed: result.alreadyNamed,
    exactMatches: result.plan.length,
    unmatched: result.unmatched,
    invalidBuyerKeys: result.invalidBuyerKeys,
    writesApplied: config.apply ? result.plan.length : 0,
    containsPiiInOutput: false,
  }, null, 2)}\n`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
