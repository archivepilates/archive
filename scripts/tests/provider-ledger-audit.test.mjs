import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const functionsRoot = new URL(
  "../../firebase/kangsain-functions/functions/",
  import.meta.url,
);
let ts;
try {
  ts = createRequire(new URL("package.json", functionsRoot))("typescript");
} catch {
  ts = createRequire(
    resolve(
      process.env.ALIMTALK_TEST_RUNTIME ||
        "/Users/archivepilates/dev/archive-in-runtime",
      "firebase/kangsain-functions/functions/package.json",
    ),
  )("typescript");
}
const source = readFileSync(
  new URL("src/alimtalk/providerLedgerAudit.ts", functionsRoot),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const BASE_DATE = "2026-10-17";
const AUDIT_DATE = "2026-10-16";
const TEMPLATE = "fixture-template";
const require = createRequire(import.meta.url);

function provider(id, patch = {}) {
  return {
    messageId: id,
    groupId: `group-${id}`,
    type: "ATA",
    status: "COMPLETE",
    statusCode: "4000",
    kakaoOptions: { templateId: TEMPLATE },
    ...patch,
  };
}

function ledger(id, patch = {}) {
  return {
    status: "done",
    templateCode: TEMPLATE,
    solapiMessageId: id,
    createdAt: "2026-10-16T09:00:00+09:00",
    updatedAt: "2026-10-16T09:00:00+09:00",
    ...patch,
  };
}

// Every external dependency is replaced; unexpected imports/queries fail closed.
function fixture(providerRows, ledgerRows = [], { queryError, pages } = {}) {
  const queries = [];
  const urls = [];
  const module = { exports: {} };
  const imports = {
    "node:crypto": require("node:crypto"),
    "firebase-functions": { logger: { info() {}, warn() {}, error() {} } },
    "../config/secrets": {
      solapiApiKey: { value: () => "fixture-only" },
      solapiApiSecret: { value: () => "fixture-only" },
    },
    "../firestore/refs": {
      refs: {
        alimtalkSends: () => ({
          where: (field, operation, ids) => {
            assert.ok(["solapiMessageId", "providerMessageId"].includes(field));
            assert.equal(operation, "in");
            assert.ok(ids.length > 0 && ids.length <= 30);
            assert.ok(
              ids.every((id) => typeof id === "string" && id.length > 0),
            );
            queries.push({ field, ids: Array.from(ids) });
            return {
              get: async () => {
                if (queryError) throw new Error(queryError);
                return {
                  docs: ledgerRows
                    .filter((row) => ids.includes(row[field]))
                    .map((row) => ({ data: () => row })),
                };
              },
            };
          },
        }),
      },
    },
    "../google/driveDocsMailer": {
      sendAlimtalkLogEmail: () => assert.fail("Unexpected email"),
    },
    "../utils/date": {
      todayKst: () => BASE_DATE,
      addDays: (date, days) =>
        new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
          .toISOString()
          .slice(0, 10),
    },
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    URL,
    require: (id) => {
      assert.ok(Object.hasOwn(imports, id), `Unexpected dependency: ${id}`);
      return imports[id];
    },
    fetch: async (url) => {
      assert.equal(
        url.origin + url.pathname,
        "https://api.solapi.com/messages/v4/list",
      );
      assert.equal(url.searchParams.get("dateType"), "CREATED");
      assert.equal(
        url.searchParams.get("startDate"),
        "2026-10-15T15:00:00.000Z",
      );
      assert.equal(url.searchParams.get("endDate"), "2026-10-16T15:00:00.000Z");
      assert.equal(url.searchParams.get("type"), "ATA");
      assert.equal(url.searchParams.get("limit"), "500");
      urls.push(url);
      const page = pages ? pages[urls.length - 1] : { rows: providerRows };
      assert.ok(page, "Unexpected provider page");
      return {
        ok: true,
        json: async () => ({
          messageList: Object.fromEntries(
            page.rows.map((row) => [row.messageId, row]),
          ),
          nextKey: page.nextKey,
        }),
      };
    },
  });
  return {
    audit: () =>
      module.exports.auditPreviousDayAlimtalkProviderLedger(BASE_DATE),
    queries,
    urls,
  };
}

const missingIds = (result) =>
  Array.from(result.missingInLedger, (row) => row.messageId);

test("same-day ledger remains visible after updatedAt moves to a later day", async () => {
  const h = fixture(
    [provider("moved")],
    [ledger("moved", { updatedAt: "2026-10-17T08:00:00+09:00" })],
  );
  const result = await h.audit();
  assert.equal(result.date, AUDIT_DATE);
  assert.deepEqual(missingIds(result), []);
  assert.equal(result.ledgerMessageCount, 1);
  assert.equal(h.queries.length, 2);
});

test("an older ledger reused for a current send is found without a createdAt window", async () => {
  const h = fixture(
    [provider("current")],
    [
      ledger("current", {
        createdAt: "2026-09-01T09:00:00+09:00",
        updatedAt: "2026-10-18T09:00:00+09:00",
      }),
    ],
  );
  assert.deepEqual(missingIds(await h.audit()), []);
});

test("exact receipt IDs work even when ledger timestamps are absent", async () => {
  const result = await fixture(
    [provider("no-time")],
    [
      {
        status: "done",
        templateCode: TEMPLATE,
        solapiMessageId: "no-time",
      },
    ],
  ).audit();
  assert.deepEqual(missingIds(result), []);
});

test("a genuine missing ID is not hidden by a same-day unrelated ledger or solapiGroupId", async () => {
  const result = await fixture(
    [provider("missing"), provider("found")],
    [ledger("unrelated", { solapiGroupId: "group-missing" }), ledger("found")],
  ).audit();
  assert.deepEqual(missingIds(result), ["missing"]);
  assert.equal(result.providerMessageCount, 2);
});

test("overwriting an older receipt does not hide the now-missing provider ID", async () => {
  const result = await fixture(
    [provider("first"), provider("replacement")],
    [ledger("replacement")],
  ).audit();
  assert.deepEqual(missingIds(result), ["first"]);
});

for (const field of ["solapiMessageId", "providerMessageId"]) {
  test(`exact ${field} lookup accepts successful matching receipts`, async () => {
    const h = fixture(
      [provider("canonical")],
      [ledger(undefined, { [field]: "canonical" })],
    );
    assert.deepEqual(missingIds(await h.audit()), []);
    assert.equal(
      h.queries.length,
      2,
      "No group fallback needed for a matching receipt",
    );
  });

  test(`legacy groupId stored in ${field} remains compatible across timestamp movement`, async () => {
    const h = fixture(
      [provider("legacy")],
      [
        ledger(undefined, {
          [field]: "group-legacy",
          createdAt: "2026-08-01",
          updatedAt: "2026-10-18",
        }),
      ],
    );
    const result = await h.audit();
    assert.deepEqual(missingIds(result), []);
    assert.equal(result.ledgerMessageCount, 1);
    assert.equal(h.queries.length, 4);
    assert.deepEqual(h.queries[2].ids, ["group-legacy"]);
  });
}

for (const id of ["unmatched", "group-unmatched"]) {
  for (const patch of [
    { status: "failed" },
    { status: "processing" },
    { templateCode: "wrong-template" },
    { templateCode: undefined },
  ]) {
    test(`receipt ${id} does not hide a missing success for ${JSON.stringify(patch)}`, async () => {
      const result = await fixture(
        [provider("unmatched")],
        [ledger(id, patch)],
      ).audit();
      assert.deepEqual(missingIds(result), ["unmatched"]);
    });
  }
}

test("a failed/wrong-template duplicate does not hide a separate valid receipt", async () => {
  const result = await fixture(
    [provider("receipt")],
    [
      ledger("receipt", { status: "failed" }),
      ledger("receipt", { templateCode: "wrong-template" }),
      ledger("receipt"),
    ],
  ).audit();
  assert.deepEqual(missingIds(result), []);
  assert.equal(result.ledgerMessageCount, 1);
});

test("template evidence is checked per message, including messages sharing a legacy group", async () => {
  const result = await fixture(
    [
      provider("correct", { groupId: "shared" }),
      provider("wrong", {
        groupId: "shared",
        kakaoOptions: { templateId: "other-template" },
      }),
    ],
    [ledger("shared")],
  ).audit();
  assert.deepEqual(missingIds(result), ["wrong"]);
});

test("provider pending/failed and non-Alimtalk rows do not create missing-success alerts or ledger reads", async () => {
  const h = fixture([
    provider("pending", { status: "PENDING", statusCode: "2000" }),
    provider("failed", { status: "FAILED", statusCode: "3000" }),
    provider("sms", { type: "SMS" }),
  ]);
  const result = await h.audit();
  assert.equal(result.providerMessageCount, 0);
  assert.equal(result.ledgerMessageCount, 0);
  assert.deepEqual(missingIds(result), []);
  assert.equal(h.queries.length, 0);
});

test("message-ID queries are chunked at 30 and group fallback only checks unresolved IDs", async () => {
  const messages = Array.from({ length: 65 }, (_, i) =>
    provider(`message-${i}`),
  );
  const h = fixture(
    messages,
    messages.slice(0, 64).map((row) => ledger(row.messageId)),
  );
  assert.deepEqual(missingIds(await h.audit()), ["message-64"]);
  assert.deepEqual(
    h.queries.map((query) => query.ids.length),
    [30, 30, 30, 30, 5, 5, 1, 1],
  );
  assert.deepEqual(h.queries.at(-1).ids, ["group-message-64"]);
});

test("provider pagination deduplicates message IDs before indexed ledger reads", async () => {
  const h = fixture([], [ledger("a"), ledger("b")], {
    pages: [
      { rows: [provider("a")], nextKey: "page-2" },
      { rows: [provider("a"), provider("b")] },
    ],
  });
  const result = await h.audit();
  assert.equal(result.providerMessageCount, 2);
  assert.deepEqual(missingIds(result), []);
  assert.equal(h.urls[1].searchParams.get("startKey"), "page-2");
  assert.deepEqual(h.queries[0].ids, ["a", "b"]);
});

test("ledger lookup failures propagate rather than reporting a clean audit", async () => {
  await assert.rejects(
    fixture([provider("failed-read")], [], {
      queryError: "fixture lookup failure",
    }).audit(),
    /fixture lookup failure/,
  );
});
