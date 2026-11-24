import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const DATE = "2026-05-27";
const FROM = "2025-01-01";
const THROUGH = "2026-05-26";
const ROOT = "/Users/archivepilates/archive-automation";
const ARCHIVE = join(ROOT, "emergency/archive/member-usage", DATE);
const SOURCE = join(ARCHIVE, "member-usage-normalized-2026-05-27.csv");
const SOURCE_RECEIPT = join(ARCHIVE, "member-usage-dry-run-summary-2026-05-27.json");
const RESERVATION_ARCHIVE = join(ROOT, "emergency/archive/reservation");
const PREFERRED = join(ROOT, "operations/2026-11-20-supabase-history-pilot");
const REQUIRE = createRequire("/Users/archivepilates/dev/archive-in-runtime/package.json");
const COLS = [
  "rowKey", "memberKey", "memberName", "memberPhone", "memberId", "memberUrl",
  "lectureDate", "startTime", "endTime", "title", "staffName", "roomName",
  "ticketName", "finalStatus", "statusChangedAt", "sourceFile",
];
const STATUSES = new Map([
  ["출석", "attendance"], ["결석", "absence"], ["노쇼", "noshow"], ["취소", "cancel"],
  ["예약", "booked"], ["예약 확정", "booking_confirmed"], ["예약 대기", "booking_waiting"],
  ["대기 취소", "wait_cancel"], ["예약 대기 취소", "wait_cancel"],
]);
const LESSON_TYPES = new Map([["그룹", "group"], ["개인", "private"], ["프라이빗", "private"]]);
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const NATIVE_ID = /^[1-9]\d{0,15}$/;
const ROW_KEY = /^[0-9a-f]{20}$/;
const INSTANCE_ORIGIN = "https://arcpilates.studiomate.kr";
const SHA = bytes => createHash("sha256").update(bytes).digest("hex");

function argsOf(args) {
  const options = {};
  for (const arg of args) {
    const match = /^(--output-dir|--typed-source)=(.+)$/.exec(arg);
    assert.ok(match && !Object.hasOwn(options, match[1]), "invalid_or_repeated_argument");
    assert.ok(isAbsolute(match[2]), "use_absolute_paths");
    options[match[1]] = match[2];
  }
  return options;
}

// The Excel-derived CSV can contain comma, quote and newline inside a field.
export function* readCsv(text) {
  let record = [], field = "", state = "field";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (state === "quoted") {
      if (char !== '"') field += char;
      else if (next === '"') {
        field += '"';
        index++;
      } else state = "closed";
      continue;
    }
    if (char === ",") {
      record.push(field);
      field = "";
      state = "field";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") index++;
      record.push(field);
      if (record.some(Boolean)) yield record;
      record = [];
      field = "";
      state = "field";
      continue;
    }
    assert.ok(state !== "closed", "malformed_csv");
    if (char === '"') {
      assert.ok(field.length === 0, "malformed_csv");
      state = "quoted";
      continue;
    }
    field += char;
  }
  assert.ok(state !== "quoted", "unterminated_csv_field");
  record.push(field);
  if (record.some(Boolean)) yield record;
}

async function readStable(path, maxBytes) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    assert.ok(before.isFile() && before.uid === process.getuid() && !(before.mode & 0o022) &&
      before.size > 0 && before.size <= maxBytes, "source_file_unverified");
    const bytes = await file.readFile();
    const after = await file.stat();
    assert.ok(bytes.length === before.size && after.size === before.size &&
      after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs,
    "source_changed_during_read");
    return bytes;
  } finally {
    await file.close();
  }
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}

function scopedDay(value) {
  return value >= FROM && value <= THROUGH;
}

function validNativeUrl(value, id) {
  try {
    const url = new URL(value);
    return NATIVE_ID.test(id) && url.origin === INSTANCE_ORIGIN && url.pathname === "/users/detail" &&
      !url.hash && !url.username && !url.password &&
      [...url.searchParams.keys()].length === 1 && url.searchParams.get("id") === id;
  } catch {
    return false;
  }
}

function expectedRowKey(row) {
  const parts = [
    row.memberKey, row.lectureDate, row.startTime, row.endTime, row.title, row.staffName,
    row.roomName, row.ticketName, row.finalStatus, row.statusChangedAt,
  ];
  return SHA(parts.join("|")).slice(0, 20);
}

function sourceBookVerified(path, archiveRoot, cache) {
  if (cache.has(path)) return cache.get(path);
  const checked = (async () => {
    if (!isAbsolute(path) || !path.endsWith(".xlsx")) return false;
    try {
      const canonical = await realpath(path);
      if (!canonical.startsWith(archiveRoot + sep) || dirname(canonical) !== archiveRoot) return false;
      const info = await lstat(canonical);
      return info.isFile() && info.uid === process.getuid() && !(info.mode & 0o022) && info.size > 0;
    } catch {
      return false;
    }
  })();
  cache.set(path, checked);
  return checked;
}

function normalizeLabel(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function normalizePhone(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = "0" + digits.slice(2);
  if (digits.length === 10 && digits.startsWith("10")) digits = "0" + digits;
  return /^01\d{8,9}$/.test(digits) ? digits : "";
}

function composite({ day, start, end, staff, title, room, name, phone, ticket, status }) {
  const contact = normalizePhone(phone);
  const person = normalizeLabel(name);
  if (!isIsoDate(day) || !TIME.test(start) || !TIME.test(end) || !contact || !person) return null;
  return JSON.stringify([
    day, start, end, normalizeLabel(staff), normalizeLabel(title), normalizeLabel(room),
    person, contact, normalizeLabel(ticket), normalizeLabel(status),
  ]);
}

function usageComposite(row) {
  return composite({
    day: row.lectureDate, start: row.startTime, end: row.endTime, staff: row.staffName,
    title: row.title, room: row.roomName, name: row.memberName, phone: row.memberPhone,
    ticket: row.ticketName, status: row.finalStatus,
  });
}

function excelDay(value) {
  const match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(String(value).trim());
  return match ? [match[1], match[2].padStart(2, "0"), match[3].padStart(2, "0")].join("-") : "";
}

function excelTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value).trim());
  return match ? match[1].padStart(2, "0") + ":" + match[2] : "";
}

async function explicitTypes(path, rows) {
  if (!path) return { types: new Map(), sourceSha: null };
  const canonical = await realpath(path);
  const archive = await realpath(RESERVATION_ARCHIVE);
  assert.ok(canonical.startsWith(archive + sep) && canonical.endsWith(".xlsx"), "typed_source_unverified");
  const bytes = await readStable(canonical, 16 * 1024 * 1024);
  const xlsx = REQUIRE("xlsx");
  const workbook = xlsx.read(bytes, { type: "buffer" });
  assert.equal(workbook.SheetNames.length, 1, "typed_source_unexpected_sheets");
  const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    raw: false, defval: "", blankrows: false,
  });
  const targetFrequency = new Map(), candidates = new Map(), frequencies = new Map();
  const nativeIds = new Set();
  for (const row of rows) {
    const key = usageComposite(row);
    if (key) targetFrequency.set(key, (targetFrequency.get(key) ?? 0) + 1);
  }
  for (const row of sheet) {
    const day = excelDay(row["수업일"]);
    if (!scopedDay(day)) continue;
    const nativeId = String(row["예약ID"] ?? "").trim();
    assert.ok(NATIVE_ID.test(nativeId) && !nativeIds.has(nativeId), "typed_source_duplicate_booking_id");
    nativeIds.add(nativeId);
    const type = LESSON_TYPES.get(String(row["수업구분"] ?? "").trim());
    const key = composite({
      day, start: excelTime(row["수업시작"]), end: excelTime(row["수업종료"]), staff: row["강사"],
      title: row["수업명"], room: row["룸"], name: row["회원명"], phone: row["휴대폰번호"],
      ticket: row["수강권명"], status: row["예약상태"],
    });
    if (key) {
      frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
      if (type) candidates.set(key, type);
    }
  }
  const types = new Map();
  for (const [key, type] of candidates) {
    if (targetFrequency.get(key) === 1 && frequencies.get(key) === 1) types.set(key, type);
  }
  return { types, sourceSha: SHA(bytes) };
}

function monthsOfRange() {
  const months = new Map();
  for (let date = new Date(FROM + "T00:00:00Z"); date.toISOString().slice(0, 10) <= THROUGH;
    date.setUTCMonth(date.getUTCMonth() + 1)) {
    const from = date.toISOString().slice(0, 10);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const through = last > THROUGH ? THROUGH : last;
    months.set(from.slice(0, 7), { from, through, sourceRows: 0, held: {}, payload: [] });
  }
  return months;
}

function sortedBookings(rows) {
  return rows.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

async function requirePrivateOutput(path) {
  assert.equal(path, resolve(path), "noncanonical_output_path");
  const info = await lstat(path);
  assert.ok(info.isDirectory() && info.uid === process.getuid() && !(info.mode & 0o077) &&
    await realpath(path) === path, "output_dir_must_be_owner_only");
}

async function writeNew(path, bytes) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function main() {
  const options = argsOf(process.argv.slice(2));
  const output = options["--output-dir"];
  if (output) await requirePrivateOutput(output);

  const archivedCsv = await readStable(SOURCE, 64 * 1024 * 1024);
  const csvSha = SHA(archivedCsv);
  const sourceProof = JSON.parse(await readStable(SOURCE_RECEIPT, 128 * 1024));
  assert.ok(sourceProof.source === "studiomate_member_usage_backfill" &&
    sourceProof.memberCoverage.sourceUniqueMembers === sourceProof.memberCoverage.matchedMemberFiles &&
    sourceProof.memberCoverage.missingCount === 0 &&
    Number.isFinite(Date.parse(sourceProof.generatedAt)), "invalid_source_receipt");
  const observedAt = new Date(sourceProof.generatedAt).toISOString();
  const fileRoot = await realpath(ARCHIVE);

  const records = readCsv(archivedCsv.toString("utf8").replace(/^\uFEFF/, ""));
  const headers = records.next().value ?? [];
  assert.ok(new Set(headers).size === headers.length && COLS.every(column => headers.includes(column)),
    "missing_required_source_columns");
  const idx = new Map(COLS.map(column => [column, headers.indexOf(column)]));
  const rows = [], frequencies = new Map();
  let totalArchiveRows = 0;
  for (const record of records) {
    totalArchiveRows++;
    assert.equal(record.length, headers.length, "malformed_archive_row");
    const day = record[idx.get("lectureDate")];
    assert.ok(isIsoDate(day), "unverifiable_archive_date");
    if (!scopedDay(day)) continue;
    const row = Object.fromEntries(COLS.map(column => [column, record[idx.get(column)]]));
    rows.push(row);
    frequencies.set(row.rowKey, (frequencies.get(row.rowKey) ?? 0) + 1);
  }
  assert.equal(totalArchiveRows, sourceProof.normalized.uniqueRows, "archive_row_count_changed");

  const { types, sourceSha: typedSourceSha } = await explicitTypes(options["--typed-source"], rows);
  const monthRecords = monthsOfRange();
  const workbookCache = new Map();
  const enroll = await import(pathToFileURL(join(PREFERRED, "reconcile-october-booking-pass.mjs")));
  const hmacKey = await enroll.readPrivateKey();
  const signed = (tag, value) =>
    createHmac("sha256", hmacKey).update("archive-ops:studiomate:5330:" + tag + ":" + value).digest("hex");
  try {
    for (const row of rows) {
      const month = monthRecords.get(row.lectureDate.slice(0, 7));
      month.sourceRows++;
      const status = STATUSES.get(row.finalStatus);
      let hold;
      if (!ROW_KEY.test(row.rowKey) || row.rowKey !== expectedRowKey(row)) hold = "invalid_row_key";
      else if (frequencies.get(row.rowKey) !== 1) hold = "duplicate_row_key";
      else if (!validNativeUrl(row.memberUrl, row.memberId)) hold = "unverified_native_member";
      else if (!TIME.test(row.startTime) || !TIME.test(row.endTime) || row.startTime >= row.endTime) hold = "invalid_times";
      else if (!status) hold = "unknown_status";
      else if (!await sourceBookVerified(row.sourceFile, fileRoot, workbookCache)) hold = "missing_original_workbook";
      if (hold) {
        month.held[hold] = (month.held[hold] ?? 0) + 1;
        continue;
      }
      month.payload.push({
        key: signed("usage-booking", row.memberId + ":" + row.rowKey),
        member_key: signed("member", row.memberId),
        service_day: row.lectureDate,
        start_time: row.startTime,
        end_time: row.endTime,
        lesson_type: types.get(usageComposite(row)) ?? null,
        status,
      });
    }
  } finally {
    hmacKey.fill(0);
  }
  assert.ok([...monthRecords.values()].every(month => month.sourceRows > 0), "missing_source_month");
  if (output) {
    for (const { from } of monthRecords.values()) {
      for (const suffix of ["payload", "manifest"]) {
        try {
          await lstat(join(output, from + "." + suffix + ".json"));
          throw Error("output_exists_no_overwrite");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
  }
  const summary = [];
  for (const { from, through, sourceRows, held, payload } of monthRecords.values()) {
    const bytes = Buffer.from(JSON.stringify(sortedBookings(payload)) + "\n");
    const manifest = {
      from, through, kind: "member_usage_excel", sourceRows, acceptedRows: payload.length,
      observedAt, sourceSha: csvSha, payloadSha: SHA(bytes), held,
    };
    assert.equal(sourceRows, payload.length + Object.values(held).reduce((a, b) => a + b, 0));
    if (output) {
      await writeNew(join(output, from + ".payload.json"), bytes);
      await writeNew(join(output, from + ".manifest.json"), Buffer.from(JSON.stringify(manifest) + "\n"));
    }
    summary.push({
      from, through, sourceRows, acceptedRows: payload.length, held,
      classifiedTypes: payload.filter(row => row.lesson_type !== null).length,
      unknownTypes: payload.filter(row => row.lesson_type === null).length,
    });
  }
  console.log(JSON.stringify({
    mode: output ? "stage_private_payloads" : "dry_run",
    source: basename(SOURCE),
    sourceSha: csvSha,
    typedSourceSha,
    observedAt,
    from: FROM,
    through: THROUGH,
    workbookCount: workbookCache.size,
    sourceRows: rows.length,
    acceptedRows: summary.reduce((n, month) => n + month.acceptedRows, 0),
    months: summary,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const message = String(error?.message ?? "");
    const code = String(error?.code ?? "");
    console.error(JSON.stringify({
      ok: false,
      error: /^[a-z0-9_]+$/.test(message) ? message : /^[A-Z0-9_]+$/.test(code) ? code : "archive_prepare_failed",
    }));
    process.exitCode = 1;
  });
}
