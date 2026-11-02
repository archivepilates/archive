import { readFile as fsReadFile, readdir as fsReaddir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const RETRY_DELAYS = [250, 1000, 2500];
const ACCESS_ERRORS = new Set([
  "EACCES", "EPERM", "EAUTH", "EAUTHENTICATION", "EUNAUTHORIZED",
  "UNAUTHENTICATED", "UNAUTHORIZED", "FORBIDDEN",
]);

export class SettlementSheetPointerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SettlementSheetPointerError";
    this.code = code;
  }
}

function failure(code, message) {
  return new SettlementSheetPointerError(code, message);
}

function retryableRead(error) {
  if (ACCESS_ERRORS.has(error?.code)
    || [401, 403].includes(Number(error?.status ?? error?.statusCode))) return false;
  return error?.code === "EAGAIN" || error?.code === "EBUSY" || error?.errno === -11;
}

function parsePointer(content) {
  let pointer;
  try {
    const text = typeof content === "string" ? content : content.toString("utf8");
    pointer = JSON.parse(text);
  } catch {
    throw failure("INVALID_JSON", "Settlement sheet pointer is not valid JSON.");
  }
  if (!pointer || typeof pointer !== "object" || Array.isArray(pointer)) {
    throw failure("INVALID_ID", "Settlement sheet pointer has no valid file ID.");
  }
  const ids = ["doc_id", "id"]
    .filter((key) => Object.hasOwn(pointer, key))
    .map((key) => pointer[key]);
  if (!ids.length || ids.some((id) => typeof id !== "string" || !FILE_ID.test(id))
    || (ids.length === 2 && ids[0] !== ids[1])) {
    throw failure("INVALID_ID", "Settlement sheet pointer has no unambiguous valid file ID.");
  }
  return ids[0];
}

export async function readSettlementSheetPointerFile(file, {
  readFile = fsReadFile,
  sleep = delay,
  attempts = 4,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 4) {
    throw failure("INVALID_ATTEMPTS", "Pointer read attempts must be an integer from 1 to 4.");
  }
  let content;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      content = await readFile(file, "utf8");
      break;
    } catch (error) {
      if (!retryableRead(error) || attempt + 1 === attempts) {
        throw failure("READ_FAILED", "Settlement sheet pointer could not be read.");
      }
      try {
        await sleep(RETRY_DELAYS[attempt]);
      } catch {
        throw failure("READ_FAILED", "Settlement sheet pointer could not be read.");
      }
    }
  }
  return parsePointer(content);
}

function normalizeName(value) {
  return value.normalize("NFC").replace(/\s+/g, "");
}

export async function findSettlementSheetPointer(root, baseName, {
  readdir = fsReaddir,
  readFile = fsReadFile,
  sleep = delay,
} = {}) {
  if (typeof baseName !== "string" || /[/\\\0]/.test(baseName)
    || ["", ".", ".."].includes(normalizeName(baseName))) {
    throw failure("INVALID_BASENAME", "Settlement sheet reference must be a base name.");
  }
  let names;
  try {
    names = await readdir(root);
  } catch {
    throw failure("LIST_FAILED", "Settlement sheet references could not be listed.");
  }
  const wanted = normalizeName(`${baseName}.gsheet`);
  const matches = names.filter((name) => typeof name === "string" && normalizeName(name) === wanted);
  if (matches.length > 1) {
    throw failure("AMBIGUOUS_MATCH", "Multiple settlement sheet references match.");
  }
  if (!matches.length) return "";
  return readSettlementSheetPointerFile(path.join(root, matches[0]), { readFile, sleep });
}
