import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadMembershipWelcomeHistory,
  MEMBERSHIP_WELCOME_HISTORY_LIMITS as LIMITS,
  MEMBERSHIP_WELCOME_HISTORY_TEMPLATE_IDS as TEMPLATES,
  type MembershipWelcomeHistoryInput,
  type WelcomeHistoryDb,
  type WelcomeHistoryDocument,
  type WelcomeHistoryQuery,
} from "../../firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomeHistory";

type Data = Record<string, unknown>;
type Store = Record<string, Record<string, Data>>;
type Call = {
  collection: string;
  field: string;
  value: string;
  operator: "==" | "array-contains";
  cursor: string;
  limit: number;
};
const INPUT: MembershipWelcomeHistoryInput = {
  studioId: "synthetic-studio",
  memberId: "member-1",
  phone: "01000000001",
  now: "2026-09-14T00:00:00.000Z",
  elapsedNow: () => 0,
};
const profile = (overrides: Data = {}): Data => ({
  studioId: INPUT.studioId,
  memberId: INPUT.memberId,
  phone: INPUT.phone,
  ...overrides,
});
const welcome = (overrides: Data = {}): Data => ({
  studioId: INPUT.studioId,
  memberId: INPUT.memberId,
  memberPhone: INPUT.phone,
  type: "membership_welcome",
  status: "queued",
  attempts: 0,
  ...overrides,
});
const valueAt = (data: Data, field: string): unknown =>
  field
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object" ? (value as Data)[key] : undefined,
      data,
    );
const snapshot = (id: string, data?: Data): WelcomeHistoryDocument => ({
  id,
  exists: data !== undefined,
  data: () => data,
});

/** Enforces actual equality, array membership, __name__ ordering, limits and ID cursors. */
class FakeDb implements WelcomeHistoryDb {
  readonly calls: Call[] = [];
  readonly docCalls: string[] = [];
  fail?: (call: Call) => boolean;
  transform?: (
    call: Call,
    docs: WelcomeHistoryDocument[],
  ) => WelcomeHistoryDocument[];
  failDoc = false;
  constructor(readonly store: Store = {}) {
    this.store.memberProfiles ??= { "member-1": profile() };
  }
  collection(collection: string): ReturnType<WelcomeHistoryDb["collection"]> {
    assert.ok(
      [
        "memberProfiles",
        "alimtalkCandidates",
        "alimtalkSends",
        "onsiteWelcomeRequests",
      ].includes(collection),
    );
    const makeQuery = (
      field = "",
      operator: Call["operator"] = "==",
      value = "",
      cursor = "",
      limit = 0,
    ): WelcomeHistoryQuery => ({
      where: (nextField, nextOperator, nextValue) => {
        assert.equal(
          field,
          "",
          "single-field queries avoid composite-index dependencies",
        );
        return makeQuery(nextField, nextOperator, nextValue, cursor, limit);
      },
      orderBy: (order) => {
        assert.equal(order, "__name__");
        return makeQuery(field, operator, value, cursor, limit);
      },
      limit: (size) => {
        assert.ok(size > 0 && size <= LIMITS.pageSize);
        return makeQuery(field, operator, value, cursor, size);
      },
      startAfter: (id) => {
        assert.ok(id);
        return makeQuery(field, operator, value, id, limit);
      },
      get: async () => {
        assert.ok(field && limit);
        assert.ok(
          !/status|createdAt|sourceDate|sentAt|template/.test(field),
          "no lookback or success/template-only filtering",
        );
        const call: Call = {
          collection,
          field,
          operator,
          value,
          cursor,
          limit,
        };
        this.calls.push(call);
        if (this.fail?.(call))
          throw new Error(
            "synthetic query/index failure; do not return raw details",
          );
        const docs = Object.entries(this.store[collection] ?? {})
          .filter(([id, data]) => {
            const actual = valueAt(data, field);
            return (
              id > cursor &&
              (operator === "=="
                ? actual === value
                : Array.isArray(actual) && actual.includes(value))
            );
          })
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .slice(0, limit)
          .map(([id, data]) => snapshot(id, data));
        return { docs: this.transform ? this.transform(call, docs) : docs };
      },
    });
    return {
      ...makeQuery(),
      doc: (id) => ({
        get: async () => {
          this.docCalls.push(id);
          if (this.failDoc) throw new Error("synthetic profile read failure");
          return snapshot(id, this.store[collection]?.[id]);
        },
      }),
    };
  }
}

test("empty exhausted canonical history never attests provider completeness", async () => {
  const db = new FakeDb();
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.deepEqual(result, {
    records: [],
    complete: true,
    reason: "",
    memberIds: ["member-1"],
    checkedAt: INPUT.now,
    providerComplete: false,
  });
  for (const collection of [
    "alimtalkCandidates",
    "alimtalkSends",
    "onsiteWelcomeRequests",
  ]) {
    assert.ok(
      db.calls.some(
        (call) => call.collection === collection && call.field === "memberId",
      ),
    );
    assert.ok(
      db.calls.some(
        (call) =>
          call.collection === collection && call.field.includes("Phone"),
      ),
    );
  }
  assert.ok(db.calls.length + db.docCalls.length <= LIMITS.readCalls);
});

test("elapsed budget stops additional reads at the exact boundary", async () => {
  const db = new FakeDb();
  let elapsed = 0;
  db.transform = (_call, docs) => {
    elapsed = LIMITS.elapsedMs;
    return docs;
  };
  const result = await loadMembershipWelcomeHistory(db, {
    ...INPUT,
    elapsedNow: () => elapsed,
  });
  assert.equal(result.complete, false);
  assert.match(result.reason, /history_time_limit/);
  assert.equal(db.calls.length, 1);
  assert.equal(db.docCalls.length, 0);
  assert.equal(result.checkedAt, INPUT.now);
  assert.equal(result.providerComplete, false);
});

test("cumulative slow reads consume a single loader-wide elapsed budget", async () => {
  const db = new FakeDb();
  let elapsed = 0;
  db.transform = (_call, docs) => {
    elapsed += 1000;
    return docs;
  };
  const result = await loadMembershipWelcomeHistory(db, {
    ...INPUT,
    elapsedNow: () => elapsed,
  });
  assert.equal(result.complete, false);
  assert.match(result.reason, /history_time_limit/);
  assert.equal(db.calls.length, LIMITS.elapsedMs / 1000);
});

test("late history response preserves blockers but no further collections are queried", async () => {
  const db = new FakeDb({ alimtalkCandidates: { pending: welcome() } });
  let elapsed = 0;
  db.transform = (call, docs) => {
    if (call.collection === "alimtalkCandidates")
      elapsed = LIMITS.elapsedMs + 1;
    return docs;
  };
  const result = await loadMembershipWelcomeHistory(db, {
    ...INPUT,
    elapsedNow: () => elapsed,
  });
  assert.equal(result.complete, false);
  assert.match(result.reason, /history_time_limit/);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].status, "queued");
  assert.ok(
    !db.calls.some((call) =>
      ["alimtalkSends", "onsiteWelcomeRequests"].includes(call.collection),
    ),
  );
});

test("late final empty page cannot report complete even without another reserve", async () => {
  const baseline = new FakeDb();
  await loadMembershipWelcomeHistory(baseline, {
    ...INPUT,
    elapsedNow: () => 0,
  });
  const last = baseline.calls.at(-1)!;
  const db = new FakeDb();
  let elapsed = 0;
  db.transform = (call, docs) => {
    if (JSON.stringify(call) === JSON.stringify(last))
      elapsed = LIMITS.elapsedMs;
    return docs;
  };
  const result = await loadMembershipWelcomeHistory(db, {
    ...INPUT,
    elapsedNow: () => elapsed,
  });
  assert.equal(result.complete, false);
  assert.equal(result.reason, "history_time_limit");
  assert.equal(db.calls.length, baseline.calls.length);
});

test("clock below deadline remains complete without sleeping", async () => {
  const db = new FakeDb();
  let elapsed = 0;
  db.transform = (_call, docs) => {
    elapsed = LIMITS.elapsedMs - 1;
    return docs;
  };
  const result = await loadMembershipWelcomeHistory(db, {
    ...INPUT,
    elapsedNow: () => elapsed,
  });
  assert.equal(result.complete, true, result.reason);
});

for (const mode of ["backward", "invalid", "throw"])
  test(`invalid elapsed clock ${mode} fails closed`, async () => {
    const db = new FakeDb();
    let elapsed = 0;
    db.transform = (_call, docs) => {
      elapsed = -1;
      return docs;
    };
    const result = await loadMembershipWelcomeHistory(db, {
      ...INPUT,
      elapsedNow: () => {
        if (elapsed === 0) return 0;
        if (mode === "throw") throw new Error("synthetic_clock_failure");
        return mode === "invalid" ? Number.NaN : elapsed;
      },
    });
    assert.equal(result.complete, false);
    assert.match(result.reason, /invalid_history_elapsed_clock/);
    assert.equal(db.calls.length, 1);
  });

for (const templateId of TEMPLATES)
  test(`all-time untyped ledger includes evidenced template ${templateId}`, async () => {
    const db = new FakeDb({
      alimtalkSends: {
        legacy: welcome({
          type: undefined,
          templateCode: templateId,
          status: "done",
          attempts: 1,
          createdAt: "2001-01-01",
        }),
      },
    });
    const result = await loadMembershipWelcomeHistory(db, INPUT);
    assert.equal(result.complete, true);
    assert.equal(
      result.records[0].status,
      "accepted",
      "provider acceptance is not delivery proof",
    );
    assert.equal(result.records[0].templateId, templateId);
    assert.equal(result.records[0].attempted, true);
    assert.equal(result.providerComplete, false);
  });

test("template IDs remain grounded in local historical/current evidence", () => {
  const root = resolve(__dirname, "../..");
  const legacy = readFileSync(
    resolve(root, "docs/kakao-alimtalk-automation-handoff.md"),
    "utf8",
  );
  assert.ok(legacy.includes(TEMPLATES[0]) && legacy.includes(TEMPLATES[1]));
  assert.ok(
    readFileSync(
      resolve(
        root,
        "firebase/kangsain-functions/functions/src/alimtalk/templates.ts",
      ),
      "utf8",
    ).includes(TEMPLATES[2]),
  );
  assert.ok(
    readFileSync(
      resolve(
        root,
        "firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomePolicy.ts",
      ),
      "utf8",
    ).includes(TEMPLATES[3]),
  );
});

for (const type of ["new_member", "onsite_welcome", "membership_welcome"])
  test(`family ${type} blocks even with an unknown template version`, async () => {
    const result = await loadMembershipWelcomeHistory(
      new FakeDb({
        alimtalkCandidates: {
          existing: welcome({ type, templateCode: "unmapped-version" }),
        },
      }),
      INPUT,
    );
    assert.equal(result.complete, true);
    assert.equal(result.records[0].family, "new_member_welcome");
    assert.equal(result.records[0].status, "queued");
  });

for (const formatting of [
  "010-0000-0001",
  " 010-0000-0001 ",
  "010 0000 0001",
  "010.0000.0001",
  "+821000000001",
  "821000000001",
  "+82 10-0000-0001",
  "+82-10-0000-0001",
  "+82 (0)10 0000 0001",
]) {
  test(`phone-only records found across ${formatting}`, async () => {
    const db = new FakeDb({
      memberProfiles: { "member-1": profile({ phone: formatting }) },
      alimtalkSends: {
        old: welcome({
          memberId: undefined,
          memberPhone: formatting,
          status: "done",
        }),
      },
    });
    const result = await loadMembershipWelcomeHistory(db, {
      ...INPUT,
      phone: "+82 10 0000 0001",
    });
    assert.equal(result.complete, true);
    assert.equal(result.records.length, 1);
  });
}

test("last-four discovers a profile's raw formatting but never equates different phones", async () => {
  const result = await loadMembershipWelcomeHistory(
    new FakeDb({
      memberProfiles: {
        "member-1": profile({ phone: "(010) 0000-0001", phoneLast4: "0001" }),
        unrelated: profile({
          memberId: "unrelated",
          phone: "01099990001",
          phoneLast4: "0001",
        }),
      },
      alimtalkSends: {
        old: welcome({
          memberId: undefined,
          memberPhone: "(010) 0000-0001",
          status: "done",
        }),
      },
    }),
    INPUT,
  );
  assert.equal(result.complete, true);
  assert.deepEqual(result.memberIds, ["member-1"]);
  assert.equal(result.records.length, 1);
});

test("raw phone discovered by ID reopens alias lookup and exposes an unlinked profile", async () => {
  const result = await loadMembershipWelcomeHistory(
    new FakeDb({
      memberProfiles: {
        "member-1": profile({ phone: "(010) 0000-0001" }),
        unlinked: profile({ memberId: "unlinked", phone: "(010) 0000-0001" }),
      },
    }),
    INPUT,
  );
  assert.equal(result.complete, false);
  assert.match(result.reason, /member_alias_conflict/);
  assert.deepEqual(result.memberIds, ["member-1", "unlinked"]);
});

test("conflicting profile reread cannot silently change aliases", async () => {
  const db = new FakeDb();
  db.transform = (call, docs) =>
    call.collection === "memberProfiles" && call.field === "memberId"
      ? docs.map((doc) =>
          snapshot(
            doc.id,
            profile({ canonicalMemberId: "new-unverified-alias" }),
          ),
        )
      : docs;
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.equal(result.complete, false);
  assert.match(result.reason, /member_alias_changed_during_read/);
});

test("walks forward/reverse merged aliases and StudioMate ID without losing old sends", async () => {
  const db = new FakeDb({
    memberProfiles: {
      "member-1": profile({
        mergedMemberIds: ["excel_old"],
        memberMerge: { mergedMemberIds: ["excel_old"] },
      }),
      excel_old: profile({
        memberId: "excel_old",
        canonicalMemberId: "member-1",
        mergedInto: "member-1",
        status: "merged",
      }),
      reverse_old: profile({
        memberId: "reverse_old",
        canonicalMemberId: "excel_old",
        phone: "+821000000001",
      }),
      lookup_old: profile({
        memberId: "lookup_old",
        studiomateMemberId: "member-1",
      }),
    },
    alimtalkSends: {
      old: welcome({
        memberId: "reverse_old",
        memberPhone: "",
        type: undefined,
        templateId: TEMPLATES[0],
        status: "done",
      }),
    },
  });
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.equal(result.complete, true, result.reason);
  assert.deepEqual(result.memberIds, [
    "excel_old",
    "lookup_old",
    "member-1",
    "reverse_old",
  ]);
  assert.equal(result.records.length, 1);
  for (const id of result.memberIds)
    assert.ok(
      db.calls.some(
        (call) =>
          call.collection === "alimtalkSends" &&
          call.field === "memberId" &&
          call.value === id,
      ),
    );
});

test("nested onsite lookup, raw request phone, and pending candidates all block", async () => {
  const result = await loadMembershipWelcomeHistory(
    new FakeDb({
      onsiteWelcomeRequests: {
        lookup: {
          studioId: INPUT.studioId,
          status: "lookup_ready",
          lookup: { memberId: INPUT.memberId, memberPhone: "010-0000-0001" },
        },
        phone: {
          studioId: INPUT.studioId,
          status: "pending",
          phone: INPUT.phone,
        },
      },
      alimtalkCandidates: {
        pending: welcome({ status: "candidate", attempted: false }),
      },
    }),
    INPUT,
  );
  assert.equal(result.complete, true);
  assert.equal(result.records.length, 3);
  assert.ok(result.records.every((row) => row.status === "queued"));
});

for (const status of [
  "processing",
  "running",
  "failed",
  "error",
  "cancelled",
  "skipped",
  "sent",
  "unexpected",
  "",
]) {
  test(`ambiguous ${status || "missing"} status/attempts never become safe false`, async () => {
    const result = await loadMembershipWelcomeHistory(
      new FakeDb({
        alimtalkCandidates: {
          old: welcome({ status, attempts: undefined, attempted: false }),
        },
      }),
      INPUT,
    );
    assert.equal(result.records[0].attempted, true);
    assert.equal(
      result.records[0].status === "unknown",
      ["unexpected", ""].includes(status),
    );
  });
}

for (const status of ["failed", "cancelled", "skipped"])
  test(`explicit never-attempted ${status} is preserved`, async () => {
    const result = await loadMembershipWelcomeHistory(
      new FakeDb({
        alimtalkCandidates: {
          old: welcome({ status, attempts: 0, attempted: false }),
        },
      }),
      INPUT,
    );
    assert.equal(result.complete, true);
    assert.equal(result.records[0].attempted, false);
  });

for (const extra of [
  { attempts: 1 },
  { attempts: "0" },
  { attempts: -1 },
  { attempts: 0.5 },
  { attempts: null },
  { attempts: Number.NaN },
  { attempted: undefined },
  { attempted: "false" },
  { solapiMessageId: "synthetic-message" },
  { sentAt: "2001-01-01" },
  { alimtalkSendId: "synthetic-send" },
  { outboundStartedAt: 1 },
  { provider: {} },
  { payload: { messageId: "synthetic-message" } },
  { response: { status: "accepted" } },
  { lastAttemptAt: 1 },
])
  test(`failed evidence is ambiguous with ${JSON.stringify(extra)}`, async () => {
    const result = await loadMembershipWelcomeHistory(
      new FakeDb({
        alimtalkCandidates: {
          old: welcome({
            status: "failed",
            attempts: 0,
            attempted: false,
            ...extra,
          }),
        },
      }),
      INPUT,
    );
    assert.equal(result.records[0].attempted, true);
  });

test("ignore only exact candidate ID, not sibling, send, onsite request, or matching body ID", async () => {
  const result = await loadMembershipWelcomeHistory(
    new FakeDb({
      alimtalkCandidates: {
        own: welcome(),
        sibling: welcome(),
        different: welcome({ candidateId: "own" }),
      },
      alimtalkSends: { own: welcome({ status: "failed" }) },
      onsiteWelcomeRequests: {
        own: {
          studioId: INPUT.studioId,
          phone: INPUT.phone,
          status: "ready",
          alimtalkCandidateId: "own",
        },
      },
    }),
    { ...INPUT, ignoreCandidateId: "own" },
  );
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.records.map((row) => row.id),
    [
      "alimtalkCandidates/different",
      "alimtalkCandidates/sibling",
      "alimtalkSends/own",
      "onsiteWelcomeRequests/own",
    ],
  );
});

test("all-time pagination includes late welcome after unrelated rows and deduplicates overlapping queries", async () => {
  const sends: Record<string, Data> = {};
  for (let i = 0; i < 2 * LIMITS.pageSize; i += 1)
    sends[`a${String(i).padStart(4, "0")}`] = welcome({
      type: "reservation_open",
      status: "done",
    });
  sends.z = welcome({
    type: undefined,
    templateCode: TEMPLATES[1],
    status: "done",
    createdAt: "2001-01-01",
  });
  const db = new FakeDb({ alimtalkSends: sends });
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.equal(result.complete, true, result.reason);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sourceId, "z");
  assert.equal(
    db.calls.filter(
      (call) =>
        call.collection === "alimtalkSends" && call.field === "memberId",
    ).length,
    3,
  );
});

test("exactly full page is followed by an empty exhaustion read", async () => {
  const db = new FakeDb({
    alimtalkCandidates: Object.fromEntries(
      Array.from({ length: LIMITS.pageSize }, (_, i) => [
        `a${String(i).padStart(4, "0")}`,
        welcome(),
      ]),
    ),
  });
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.equal(result.complete, true);
  assert.equal(result.records.length, LIMITS.pageSize);
  assert.equal(
    db.calls.filter(
      (call) =>
        call.collection === "alimtalkCandidates" && call.field === "memberId",
    ).length,
    2,
  );
});

for (const extra of [0, 1])
  test(`page bound never claims exhaustion at cap + ${extra}`, async () => {
    const count = LIMITS.pageSize * LIMITS.pagesPerQuery + extra;
    const db = new FakeDb({
      alimtalkSends: Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `a${String(i).padStart(4, "0")}`,
          welcome({ status: "done" }),
        ]),
      ),
    });
    const result = await loadMembershipWelcomeHistory(db, INPUT);
    assert.equal(result.complete, false);
    assert.match(result.reason, /history_page_limit/);
    assert.equal(result.records.length, LIMITS.pageSize * LIMITS.pagesPerQuery);
  });

for (const mode of ["throw", "repeat", "malformed", "oversized"])
  test(`pagination ${mode} is incomplete and retains preceding blockers`, async () => {
    const db = new FakeDb({
      alimtalkSends: Object.fromEntries(
        Array.from({ length: LIMITS.pageSize + 1 }, (_, i) => [
          `a${String(i).padStart(4, "0")}`,
          welcome({ memberPhone: "", status: "done" }),
        ]),
      ),
    });
    db.fail = (call) => mode === "throw" && !!call.cursor;
    db.transform = (call, docs) => {
      if (!call.cursor) return docs;
      if (mode === "repeat") return [snapshot("a0000", welcome())];
      if (mode === "malformed") return [snapshot("broken")];
      if (mode === "oversized")
        return Array.from({ length: LIMITS.pageSize + 1 }, () =>
          snapshot("z", welcome()),
        );
      return docs;
    };
    const result = await loadMembershipWelcomeHistory(db, INPUT);
    assert.equal(result.complete, false);
    assert.equal(result.records.length, LIMITS.pageSize);
    assert.ok(!result.reason.includes("synthetic query"));
  });

const aliasFailures: Record<string, Record<string, Data>> = {
  missing: {},
  dangling: { "member-1": profile({ canonicalMemberId: "missing" }) },
  conflict: {
    "member-1": profile({ canonicalMemberId: "a", mergedInto: "b" }),
    a: profile({ memberId: "a" }),
    b: profile({ memberId: "b" }),
  },
  cycle: {
    "member-1": profile({ canonicalMemberId: "a" }),
    a: profile({ memberId: "a", canonicalMemberId: "member-1" }),
  },
  shared_phone: {
    "member-1": profile(),
    other: profile({ memberId: "other" }),
  },
  cross_studio: {
    "member-1": profile({ canonicalMemberId: "other" }),
    other: profile({ memberId: "other", studioId: "different" }),
  },
  missing_phone: { "member-1": profile({ phone: undefined }) },
  conflicting_phone: { "member-1": profile({ phone: "01000000002" }) },
  merged_without_target: { "member-1": profile({ status: "merged" }) },
  malformed_list: { "member-1": profile({ mergedMemberIds: "a" }) },
  malformed_id: { "member-1": profile({ memberId: 12 }) },
  alias_limit: {
    "member-1": profile({
      mergedMemberIds: Array.from(
        { length: LIMITS.memberIds + 1 },
        (_, i) => `alias-${i}`,
      ),
    }),
  },
};
for (const [name, profiles] of Object.entries(aliasFailures))
  test(`${name} aliases are incomplete`, async () => {
    const db = new FakeDb({
      memberProfiles: profiles,
      alimtalkCandidates: { pending: welcome() },
    });
    const result = await loadMembershipWelcomeHistory(db, INPUT);
    assert.equal(result.complete, false);
    assert.ok(result.reason);
    assert.equal(
      result.records.length,
      1,
      "incomplete identity must not discard known blockers",
    );
    assert.ok(result.memberIds.length <= LIMITS.memberIds);
  });

test("query and direct-profile read failures fail closed", async () => {
  const db = new FakeDb();
  db.fail = (call) => call.collection === "memberProfiles";
  db.failDoc = true;
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.equal(result.complete, false);
  assert.match(result.reason, /memberProfiles_read_failed/);
});

test("total document budget never reports complete, even across independently paginated queries", async () => {
  const sends = Object.fromEntries(
    Array.from(
      { length: LIMITS.pageSize * LIMITS.pagesPerQuery + 1 },
      (_, i) => [
        `a${String(i).padStart(4, "0")}`,
        welcome({
          status: "done",
          phone: INPUT.phone,
          lookup: { memberId: INPUT.memberId, memberPhone: INPUT.phone },
        }),
      ],
    ),
  );
  const db = new FakeDb({
    alimtalkCandidates: sends,
    alimtalkSends: sends,
    onsiteWelcomeRequests: sends,
  });
  let fetched = 0;
  db.transform = (_call, docs) => {
    fetched += docs.length;
    return docs;
  };
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.equal(result.complete, false);
  assert.match(result.reason, /history_read_limit/);
  assert.ok(fetched + db.docCalls.length <= LIMITS.documents);
  assert.ok(db.calls.length + db.docCalls.length <= LIMITS.readCalls);
  assert.ok(result.records.length > 0);
});

test("total read-call budget is enforced even when most queries are empty", async () => {
  const aliases = Array.from(
    { length: LIMITS.memberIds - 1 },
    (_, i) => `alias-${i}`,
  );
  const profiles = Object.fromEntries(
    aliases.map((id, i) => [
      id,
      profile({
        memberId: id,
        phone: `010${" ".repeat(i + 1)}0000${" ".repeat(i + 1)}0001`,
        canonicalMemberId: INPUT.memberId,
      }),
    ]),
  );
  profiles[INPUT.memberId] = profile({ mergedMemberIds: aliases });
  const rows = Object.fromEntries(
    [INPUT.memberId, ...aliases].flatMap((memberId) =>
      Array.from({ length: LIMITS.pageSize }, (_, i) => [
        `${memberId}-${i}`,
        welcome({ memberId, memberPhone: undefined, type: "pricing_info" }),
      ]),
    ),
  );
  const db = new FakeDb({
    memberProfiles: profiles,
    alimtalkCandidates: rows,
    alimtalkSends: rows,
    onsiteWelcomeRequests: rows,
  });
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.equal(result.complete, false);
  assert.match(result.reason, /history_read_limit/);
  assert.equal(db.calls.length + db.docCalls.length, LIMITS.readCalls);
});

test("profile lookup also paginates and cannot hide an alias past page one", async () => {
  const profiles = Object.fromEntries(
    Array.from({ length: LIMITS.pageSize + 1 }, (_, i) => [
      `a${String(i).padStart(4, "0")}`,
      profile({ studioId: "other-studio" }),
    ]),
  );
  profiles[INPUT.memberId] = profile();
  const db = new FakeDb({ memberProfiles: profiles });
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.equal(result.complete, true, result.reason);
  assert.ok(
    db.calls.some(
      (call) =>
        call.collection === "memberProfiles" &&
        call.field === "phone" &&
        call.cursor,
    ),
  );
});

test("each canonical collection read failure is incomplete and does not discard other collections", async () => {
  for (const failedCollection of [
    "alimtalkCandidates",
    "alimtalkSends",
    "onsiteWelcomeRequests",
  ]) {
    const db = new FakeDb({
      alimtalkCandidates: { a: welcome() },
      alimtalkSends: { b: welcome() },
      onsiteWelcomeRequests: { c: welcome() },
    });
    db.fail = (call) => call.collection === failedCollection;
    const result = await loadMembershipWelcomeHistory(db, INPUT);
    assert.equal(result.complete, false);
    assert.equal(result.records.length, 2);
    assert.ok(result.reason.includes(`${failedCollection}_read_failed`));
  }
});

test("malformed document data is incomplete", async () => {
  const db = new FakeDb({ alimtalkSends: { old: welcome() } });
  db.transform = (call, docs) =>
    call.collection === "alimtalkSends"
      ? docs.map((doc) => ({ ...doc, data: () => undefined }))
      : docs;
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.equal(result.complete, false);
  assert.match(result.reason, /invalid_history_document/);
});

test("nested phone-only onsite request has no dependency on a lookup member ID", async () => {
  const result = await loadMembershipWelcomeHistory(
    new FakeDb({
      onsiteWelcomeRequests: {
        old: {
          studioId: INPUT.studioId,
          lookup: { memberPhone: "+821000000001" },
          status: "error",
        },
      },
    }),
    INPUT,
  );
  assert.equal(result.complete, true);
  assert.equal(result.records[0].status, "failed");
  assert.equal(result.records[0].attempted, true);
});

test("conflicting historical phone is incomplete even for a known alias", async () => {
  const result = await loadMembershipWelcomeHistory(
    new FakeDb({
      alimtalkCandidates: {
        old: welcome({
          memberPhone: "01000000002",
          status: "skipped",
          attempted: false,
        }),
      },
    }),
    INPUT,
  );
  assert.equal(result.complete, false);
  assert.match(result.reason, /history_phone_conflict/);
});

test("concurrent conflicting reads retain a blocker and cannot certify completeness", async () => {
  const db = new FakeDb({
    alimtalkCandidates: { old: welcome({ status: "sent", attempts: 1 }) },
  });
  db.transform = (call, docs) =>
    call.collection === "alimtalkCandidates" && call.field === "memberPhone"
      ? docs.map((doc) =>
          snapshot(
            doc.id,
            welcome({ status: "skipped", attempts: 0, attempted: false }),
          ),
        )
      : docs;
  const result = await loadMembershipWelcomeHistory(db, INPUT);
  assert.equal(result.complete, false);
  assert.match(result.reason, /history_changed_during_read/);
  assert.equal(result.records[0].status, "unknown");
  assert.equal(result.records[0].attempted, true);
});

test("missing studio, unresolved identity, unknown family/state never certify a clean history", async () => {
  const result = await loadMembershipWelcomeHistory(
    new FakeDb({
      alimtalkSends: {
        noStudio: welcome({ studioId: undefined, status: "done" }),
        alias: welcome({ memberId: "unknown-alias", status: "done" }),
        unknown: welcome({
          type: undefined,
          templateCode: "unmapped",
          status: "failed",
          attempts: 0,
          attempted: false,
        }),
        otherStudio: welcome({ studioId: "different", status: "done" }),
        unrelated: welcome({ type: "pricing_info", status: "done" }),
      },
    }),
    INPUT,
  );
  assert.equal(result.complete, false);
  for (const reason of [
    "history_studio_missing",
    "unresolved_history_alias",
    "unknown_welcome_family",
  ])
    assert.ok(result.reason.includes(reason));
  assert.equal(result.records.length, 3);
  assert.equal(
    result.records.find((row) => row.sourceId === "unknown")?.status,
    "unknown",
  );
});

test("welcome template and candidate prefix override a misleading unrelated type", async () => {
  const result = await loadMembershipWelcomeHistory(
    new FakeDb({
      alimtalkSends: {
        first: welcome({
          type: "pricing_info",
          templateCode: TEMPLATES[0],
          status: "done",
        }),
        second: welcome({
          type: undefined,
          candidateId: "onsite_welcome_legacy",
          status: "done",
        }),
        third: welcome({
          type: undefined,
          candidateId: "reservation_open_other",
          status: "done",
        }),
      },
    }),
    INPUT,
  );
  assert.equal(result.records.length, 2);
});

for (const override of [
  { phone: "" },
  { phone: "+1 2345678901" },
  { phone: "bad01000000001" },
  { memberId: "a/b" },
  { studioId: "" },
  { now: "bad" },
  { ignoreCandidateId: "" },
]) {
  test(`invalid input ${JSON.stringify(override)} does no IO`, async () => {
    const db = new FakeDb();
    const result = await loadMembershipWelcomeHistory(db, {
      ...INPUT,
      ...override,
    });
    assert.equal(result.complete, false);
    assert.equal(result.reason, "invalid_history_input");
    assert.equal(db.calls.length + db.docCalls.length, 0);
    assert.equal(result.providerComplete, false);
  });
}
