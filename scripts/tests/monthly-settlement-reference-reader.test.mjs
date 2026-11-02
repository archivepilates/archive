import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  SettlementSheetPointerError,
  readSettlementSheetPointerFile,
  findSettlementSheetPointer,
} from "../lib/monthly-settlement-reference-reader.mjs";

const ROOT = "/synthetic/settlement";
const FILE = path.join(ROOT, "monthly.gsheet");
const ID = "synthetic_file-123";
const SECRET = "synthetic-sensitive-marker";

function injectedRead(values) {
  const calls = [];
  const sleeps = [];
  return {
    calls,
    sleeps,
    readFile: async (...args) => {
      calls.push(args);
      assert.ok(calls.length <= values.length, "unexpected additional read");
      const value = values[calls.length - 1];
      if (value instanceof Error) throw value;
      return value;
    },
    sleep: async (ms) => { sleeps.push(ms); },
  };
}

function readError(properties) {
  return Object.assign(new Error(`${SECRET}: ${FILE}`), properties);
}

async function rejectsTyped(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof SettlementSheetPointerError);
    assert.equal(error.name, "SettlementSheetPointerError");
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    for (const rendered of [String(error), error.stack, JSON.stringify(error)]) {
      assert.ok(!rendered.includes(ROOT));
      assert.ok(!rendered.includes(SECRET));
    }
    return true;
  });
}

for (const pointer of [{ doc_id: ID }, { id: ID }, { doc_id: ID, id: ID }]) {
  test(`reads valid pointer ${Object.keys(pointer).join("+")}`, async () => {
    const io = injectedRead([JSON.stringify(pointer)]);
    assert.equal(await readSettlementSheetPointerFile(FILE, io), ID);
    assert.deepEqual(io.calls, [[FILE, "utf8"]]);
    assert.deepEqual(io.sleeps, []);
  });
}

test("accepts a synthetic Buffer and ignores unrelated structured metadata", async () => {
  const io = injectedRead([Buffer.from(JSON.stringify({
    metadata: { note: 'quoted "text", braces {} and brackets []', doc_id: "ignored" },
    url: "https://synthetic.invalid/not-fetched",
    doc_id: ID,
  }))]);
  assert.equal(await readSettlementSheetPointerFile(FILE, io), ID);
});

for (const length of [10, 200]) {
  test(`accepts file ID boundary length ${length}`, async () => {
    const id = "a".repeat(length);
    assert.equal(await readSettlementSheetPointerFile(FILE, injectedRead([JSON.stringify({ id })])), id);
  });
}

for (const [label, content, code] of [
  ["malformed JSON", `{"doc_id":"${SECRET}"`, "INVALID_JSON"],
  ["null", "null", "INVALID_ID"],
  ["array", JSON.stringify([{ id: ID }]), "INVALID_ID"],
  ["primitive", JSON.stringify(ID), "INVALID_ID"],
  ["missing ID", "{}", "INVALID_ID"],
  ["numeric ID", '{"id":1234567890}', "INVALID_ID"],
  ["null ID", '{"id":null}', "INVALID_ID"],
  ["short ID", '{"id":"123456789"}', "INVALID_ID"],
  ["long ID", JSON.stringify({ id: "a".repeat(201) }), "INVALID_ID"],
  ["padded ID", JSON.stringify({ id: ` ${ID}` }), "INVALID_ID"],
  ["newline ID", JSON.stringify({ id: `${ID}\n` }), "INVALID_ID"],
  ["URL ID", JSON.stringify({ id: `https://synthetic.invalid/${ID}` }), "INVALID_ID"],
  ["conflicting IDs", JSON.stringify({ doc_id: ID, id: "different_file-123" }), "INVALID_ID"],
  ["empty doc_id with valid id", JSON.stringify({ doc_id: "", id: ID }), "INVALID_ID"],
  ["valid doc_id with invalid id", JSON.stringify({ doc_id: ID, id: false }), "INVALID_ID"],
]) {
  test(`rejects ${label} without retry`, async () => {
    const io = injectedRead([content]);
    await rejectsTyped(() => readSettlementSheetPointerFile(FILE, io), code);
    assert.equal(io.calls.length, 1);
    assert.deepEqual(io.sleeps, []);
  });
}

for (const properties of [{ code: "EAGAIN" }, { code: "EBUSY" }, { errno: -11 }]) {
  test(`retries transient read ${JSON.stringify(properties)} with bounded delays`, async () => {
    const error = readError(properties);
    const io = injectedRead([error, error, error, JSON.stringify({ id: ID })]);
    assert.equal(await readSettlementSheetPointerFile(FILE, io), ID);
    assert.equal(io.calls.length, 4);
    assert.deepEqual(io.sleeps, [250, 1000, 2500]);
  });
}

test("exhausts after four reads with a sanitized typed error", async () => {
  const io = injectedRead(Array(4).fill(readError({ code: "EBUSY" })));
  await rejectsTyped(() => readSettlementSheetPointerFile(FILE, io), "READ_FAILED");
  assert.equal(io.calls.length, 4);
  assert.deepEqual(io.sleeps, [250, 1000, 2500]);
});

for (const properties of [
  {}, { code: "EIO" }, { code: "ENOENT" }, { code: "ETIMEDOUT" }, { code: "429" },
  { code: "EACCES" }, { code: "EPERM" }, { code: "EAUTH" },
  { code: "EACCES", errno: -11 }, { code: "EPERM", errno: -11 },
  { code: "EAUTH", errno: -11 }, { code: "EAGAIN", status: 401 },
  { errno: -11, statusCode: 403 },
]) {
  test(`does not retry unrelated or access error ${JSON.stringify(properties)}`, async () => {
    const io = injectedRead([readError(properties)]);
    await rejectsTyped(() => readSettlementSheetPointerFile(FILE, io), "READ_FAILED");
    assert.equal(io.calls.length, 1);
    assert.deepEqual(io.sleeps, []);
  });
}

for (const attempts of [1, 2, 3, 4]) {
  test(`honors finite attempts=${attempts}`, async () => {
    const io = injectedRead(Array(attempts).fill(readError({ code: "EAGAIN" })));
    await rejectsTyped(() => readSettlementSheetPointerFile(FILE, { ...io, attempts }), "READ_FAILED");
    assert.equal(io.calls.length, attempts);
    assert.deepEqual(io.sleeps, [250, 1000, 2500].slice(0, attempts - 1));
  });
}

for (const attempts of [0, -1, 5, Infinity, NaN, 1.5, "4", null]) {
  test(`rejects invalid attempts=${String(attempts)} before reading`, async () => {
    const io = injectedRead([]);
    await rejectsTyped(() => readSettlementSheetPointerFile(FILE, { ...io, attempts }), "INVALID_ATTEMPTS");
    assert.equal(io.calls.length, 0);
  });
}

test("does not retry validation failures after a transient read", async () => {
  const io = injectedRead([readError({ code: "EBUSY" }), "not JSON"]);
  await rejectsTyped(() => readSettlementSheetPointerFile(FILE, io), "INVALID_JSON");
  assert.equal(io.calls.length, 2);
  assert.deepEqual(io.sleeps, [250]);
});

test("a failed sleep stops reads and sanitizes its error", async () => {
  const io = injectedRead([readError({ code: "EAGAIN" })]);
  io.sleep = async () => { throw new Error(SECRET); };
  await rejectsTyped(() => readSettlementSheetPointerFile(FILE, io), "READ_FAILED");
  assert.equal(io.calls.length, 1);
});

test("finds exactly the NFC and whitespace-normalized name, using the actual entry path", async () => {
  const base = "\uac00 monthly";
  const actual = " \u1100\u1161\tmonthly .gsheet ";
  const io = injectedRead([JSON.stringify({ id: ID })]);
  let lists = 0;
  const result = await findSettlementSheetPointer(ROOT, base, {
    ...io,
    readdir: async (root) => {
      lists += 1;
      assert.equal(root, ROOT);
      return ["other.gsheet", "monthly.gsheet.bak", actual];
    },
  });
  assert.equal(result, ID);
  assert.equal(lists, 1);
  assert.deepEqual(io.calls, [[path.join(ROOT, actual), "utf8"]]);
});

test("no exact match returns empty without reading nearby files", async () => {
  const io = injectedRead([]);
  assert.equal(await findSettlementSheetPointer(ROOT, "monthly", {
    ...io,
    readdir: async () => ["monthly.gsheet.bak", "prefix-monthly.gsheet", "monthly.GSHEET", "monthlygsheet"],
  }), "");
  assert.equal(io.calls.length, 0);
});

test("rejects canonical duplicate names before reading either file", async () => {
  const io = injectedRead([]);
  await rejectsTyped(() => findSettlementSheetPointer(ROOT, "\uac00 monthly", {
    ...io,
    readdir: async () => ["\uac00 monthly.gsheet", "\u1100\u1161monthly.gsheet"],
  }), "AMBIGUOUS_MATCH");
  assert.equal(io.calls.length, 0);
});

for (const baseName of ["../monthly", "/monthly", "nested/monthly", "nested\\monthly", ".", "..", "", " \t", "month\0ly", null, 42]) {
  test(`rejects non-basename ${JSON.stringify(baseName)} before listing`, async () => {
    let lists = 0;
    const io = injectedRead([]);
    await rejectsTyped(() => findSettlementSheetPointer(ROOT, baseName, {
      ...io,
      readdir: async () => { lists += 1; return []; },
    }), "INVALID_BASENAME");
    assert.equal(lists, 0);
    assert.equal(io.calls.length, 0);
  });
}

test("directory failures are sanitized and never retried", async () => {
  let lists = 0;
  const io = injectedRead([]);
  await rejectsTyped(() => findSettlementSheetPointer(ROOT, "monthly", {
    ...io,
    readdir: async () => { lists += 1; throw readError({ code: "EAGAIN" }); },
  }), "LIST_FAILED");
  assert.equal(lists, 1);
  assert.equal(io.calls.length, 0);
  assert.deepEqual(io.sleeps, []);
});

test("finder forwards injected read and sleep, with at most four reads", async () => {
  const io = injectedRead(Array(4).fill(readError({ errno: -11 })));
  await rejectsTyped(() => findSettlementSheetPointer(ROOT, "monthly", {
    ...io, readdir: async () => ["monthly.gsheet"],
  }), "READ_FAILED");
  assert.equal(io.calls.length, 4);
  assert.deepEqual(io.sleeps, [250, 1000, 2500]);
});
