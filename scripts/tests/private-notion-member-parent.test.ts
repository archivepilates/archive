import assert from "node:assert/strict";
import test from "node:test";
import {
  privateNotionMemberIdentity,
  ensurePrivateNotionMemberPage,
  type PrivateNotionMemberPageState,
} from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonNotionMemberPage";

// Entirely synthetic fixtures; no Firebase, Notion, provider or credential adapters.
const ROOT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_ROOT = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const PAGE = "11111111-2222-4333-8444-555555555555";

function fixture() {
  return {
    record: {
      recordId: "fake-record", requestId: "fake-request", bookingId: "fake-booking",
      memberId: "900001", staffId: "900002", studioId: "5330",
      memberPhone: "010-0000-0001", postSubmittedAt: 1,
    } as Record<string, any>,
    request: {
      requestId: "fake-request", bookingId: "fake-booking", memberId: "900001",
      staffId: "900002", studioId: "5330", memberPhone: "01000000001",
      status: "active", postStatus: "submitted",
    } as Record<string, any>,
    profile: {
      memberId: "900001", studiomateMemberId: "900001", studioId: "5330",
      name: "FAKE MEMBER", phone: "+82 10-0000-0001",
    } as Record<string, any>,
    staff: { staffId: "900002", studioId: "5330", active: true, role: "instructor" } as Record<string, any>,
    root: ROOT,
    staffRoot: ROOT,
  };
}

type Source = ReturnType<typeof fixture>;

function identify(source: Source) {
  return privateNotionMemberIdentity(source.record, source.request, source.profile,
    source.staff, source.root, source.staffRoot);
}

test("matching numeric source identities produce a canonical private member binding", () => {
  const source = fixture();
  const before = structuredClone(source);
  source.staffRoot = ROOT.replaceAll("-", "").toUpperCase();
  const identity = identify(source);
  assert.ok(identity.memberId === before.record.memberId);
  assert.ok(identity.staffId === before.staff.staffId);
  assert.ok(identity.recordId === before.record.recordId);
  assert.ok(identity.rootPageId === ROOT.replaceAll("-", ""));
  assert.ok(identity.title === `${before.profile.name}\uB2D8`);
  assert.match(identity.sourceHash, /^[a-f0-9]{64}$/);
  assert.ok(identity.sourceHash === identify(source).sourceHash);
  assert.ok(JSON.stringify({ ...source, staffRoot: before.staffRoot }) === JSON.stringify(before));
  assert.equal(Object.hasOwn(identity, "phone"), false);
  assert.equal(Object.hasOwn(identity, "memberPhone"), false);
});

for (const role of ["instructor", "manager", "owner"]) {
  test(`active authorized ${role} role is accepted`, () => {
    const source = fixture();
    source.staff.role = role;
    assert.doesNotThrow(() => identify(source));
  });
}

test("either canonical submission marker permits an otherwise matching source", () => {
  const source = fixture();
  delete source.record.postSubmittedAt;
  assert.doesNotThrow(() => identify(source));
  source.record.postSubmittedAt = 1;
  source.request.postStatus = "pending";
  assert.doesNotThrow(() => identify(source));
});

test("numeric member and staff values preserve their canonical string binding", () => {
  const source = fixture();
  source.record.memberId = source.request.memberId = source.profile.memberId = 900001;
  source.profile.studiomateMemberId = 900001;
  source.record.staffId = source.request.staffId = source.staff.staffId = 900002;
  const identity = identify(source);
  assert.ok(identity.memberId === String(source.record.memberId));
  assert.ok(identity.staffId === String(source.staff.staffId));
});

for (const target of ["record", "request", "profile"] as const) {
  for (const value of [undefined, ""]) {
    test(`absent ${target} phone (${value === undefined ? "missing" : "empty"}) fails closed`, () => {
      const source = fixture();
      source[target][target === "profile" ? "phone" : "memberPhone"] = value;
      assert.throws(() => identify(source), Error);
    });
  }
}

const invalidSources: [string, (source: Source) => void][] = [
  ["request member mismatch", (s) => { s.request.memberId = "900099"; }],
  ["profile member mismatch", (s) => { s.profile.memberId = "900099"; }],
  ["native profile member mismatch", (s) => { s.profile.studiomateMemberId = "900099"; }],
  ["record member mismatch", (s) => { s.record.memberId = "900099"; }],
  ["request id mismatch", (s) => { s.request.requestId = "fake-other-request"; }],
  ["record request id absent", (s) => { delete s.record.requestId; }],
  ["both source request ids absent", (s) => { delete s.record.requestId; delete s.request.requestId; }],
  ["request booking mismatch", (s) => { s.request.bookingId = "fake-other-booking"; }],
  ["record id absent", (s) => { delete s.record.recordId; }],
  ["record member absent", (s) => { delete s.record.memberId; }],
  ["record staff absent", (s) => { delete s.record.staffId; }],
  ["record booking absent", (s) => { delete s.record.bookingId; }],
  ["request staff mismatch", (s) => { s.request.staffId = "900099"; }],
  ["staff source mismatch", (s) => { s.staff.staffId = "900099"; }],
  ["inactive staff", (s) => { s.staff.active = false; }],
  ["unconfirmed active staff", (s) => { delete s.staff.active; }],
  ["unauthorized staff role", (s) => { s.staff.role = "member"; }],
  ["record studio mismatch", (s) => { s.record.studioId = "9999"; }],
  ["request studio mismatch", (s) => { s.request.studioId = "9999"; }],
  ["profile studio mismatch", (s) => { s.profile.studioId = "9999"; }],
  ["staff studio mismatch", (s) => { s.staff.studioId = "9999"; }],
  ["root mismatch", (s) => { s.staffRoot = OTHER_ROOT; }],
  ["root absent", (s) => { s.root = ""; }],
  ["staff root absent", (s) => { s.staffRoot = ""; }],
  ["malformed matching roots", (s) => { s.root = s.staffRoot = "fake-invalid-root"; }],
  ["unresolved excel native identity", (s) => {
    s.record.memberId = s.request.memberId = s.profile.memberId = "excel_fake_member";
    delete s.profile.studiomateMemberId;
  }],
  ["nonnumeric native identity", (s) => { s.profile.studiomateMemberId = "fake-native"; }],
  ["cancelled record", (s) => { s.record.cancelledAt = 1; }],
  ["cancelled request", (s) => { s.request.status = "cancelled"; }],
  ["unsubmitted source", (s) => { delete s.record.postSubmittedAt; s.request.postStatus = "pending"; }],
  ["alias record", (s) => { s.record.notionProjectionControl = { aliasOfRecordId: "fake-original" }; }],
  ["absent member name", (s) => { delete s.profile.name; }],
  ["whitespace-only member name", (s) => { s.profile.name = "   "; }],
];

for (const [label, invalidate] of invalidSources) {
  test(`${label} fails closed`, () => {
    const source = fixture();
    invalidate(source);
    assert.throws(() => identify(source), Error);
  });
}

test("domestic and +82 full-phone forms normalize to exactly the same source hash", () => {
  const source = fixture();
  const baseline = identify(source).sourceHash;
  for (const value of ["01000000001", "010-0000-0001", "+82 10 0000 0001", "821000000001"]) {
    source.profile.phone = value;
    source.record.memberPhone = value;
    source.request.memberPhone = value;
    assert.ok(identify(source).sourceHash === baseline);
  }
});

for (const target of ["record", "request", "profile"] as const) {
  test(`same suffix but different full ${target} phone fails closed`, () => {
    const source = fixture();
    source[target][target === "profile" ? "phone" : "memberPhone"] = "01099990001";
    assert.throws(() => identify(source), Error);
  });
}

for (const [label, value] of [
  ["suffix only", "0001"],
  ["missing domestic prefix", "1000000001"],
  ["invalid international prefix", "+81 10 0000 0001"],
  ["extra digit", "010000000011"],
] as const) {
  test(`matching but invalid ${label} phones fail closed`, () => {
    const source = fixture();
    source.profile.phone = source.record.memberPhone = source.request.memberPhone = value;
    assert.throws(() => identify(source), Error);
  });
}

test("a changed full phone changes the source hash even with the same suffix", () => {
  const source = fixture();
  const baseline = identify(source).sourceHash;
  source.profile.phone = source.record.memberPhone = source.request.memberPhone = "01099990001";
  assert.ok(identify(source).sourceHash !== baseline);
});

type Dependencies = Parameters<typeof ensurePrivateNotionMemberPage>[1];

function serializedMapping(initial?: PrivateNotionMemberPageState) {
  const rows = new Map<string, PrivateNotionMemberPageState>();
  if (initial) rows.set("fake-mapping", structuredClone(initial));
  const statuses: PrivateNotionMemberPageState["status"][] = [];
  let tail = Promise.resolve();
  let transactions = 0;
  // Clone both sides of a serial transaction, so callbacks cannot mutate persisted state.
  const transact: Dependencies["transact"] = (update) => {
    const result = tail.then(() => {
      transactions++;
      const current = rows.get("fake-mapping");
      const change = update(current && structuredClone(current));
      if (change.next) {
        rows.set("fake-mapping", structuredClone(change.next));
        statuses.push(change.next.status);
      }
      return change.result;
    });
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  return {
    transact,
    statuses,
    state: () => structuredClone(rows.get("fake-mapping")),
    transactions: () => transactions,
  };
}

class FakeRejected extends Error {}

function harness(initial?: PrivateNotionMemberPageState) {
  const source = fixture();
  const identity = identify(source);
  const store = serializedMapping(initial);
  const calls = { validate: 0, absent: 0, create: 0, verify: 0 };
  const events: string[] = [];
  const hooks: {
    validate?: (call: number) => void | Promise<void>;
    absent?: () => void | Promise<void>;
    create?: () => Promise<string>;
    verify?: (pageId: string) => void | Promise<void>;
  } = {};
  const deps: Dependencies = {
    transact: store.transact,
    validate: async () => {
      events.push("validate");
      calls.validate++;
      await hooks.validate?.(calls.validate);
      if (identify(source).sourceHash !== identity.sourceHash) throw new Error("fake source changed");
    },
    assertAbsent: async () => {
      events.push("absent");
      calls.absent++;
      await hooks.absent?.();
    },
    create: async () => {
      events.push("create");
      calls.create++;
      return hooks.create ? hooks.create() : PAGE;
    },
    verify: async (pageId) => {
      events.push("verify");
      calls.verify++;
      assert.ok(pageId === PAGE, "verification receives the synthetic page binding");
      await hooks.verify?.(pageId);
    },
    rejected: (error) => error instanceof FakeRejected,
  };
  return { source, identity, store, calls, events, hooks, deps,
    run: () => ensurePrivateNotionMemberPage(identity, deps) };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("one success persists ready and reuse verifies again without creating", async () => {
  const h = harness();
  assert.ok(await h.run() === PAGE);
  assert.equal(h.store.state()?.status, "ready");
  assert.ok(h.store.state()?.pageId === PAGE);
  assert.ok(h.store.state()?.sourceHash === h.identity.sourceHash);
  assert.ok(h.store.state()?.sourceRecordId === h.identity.recordId);
  assert.ok(Boolean(h.store.state()?.attemptId));
  assert.deepEqual(h.store.statuses, ["creating", "ready"]);
  assert.deepEqual(h.events.filter((event) => event !== "validate"), ["absent", "create", "verify"]);
  assert.ok(h.calls.validate >= 3);
  const validations = h.calls.validate;
  const eventCount = h.events.length;
  assert.ok(await h.run() === PAGE);
  assert.equal(h.calls.absent, 1);
  assert.equal(h.calls.create, 1);
  assert.equal(h.calls.verify, 2);
  assert.ok(h.calls.validate >= validations + 2);
  assert.deepEqual(h.events.slice(eventCount).filter((event) => event !== "validate"), ["verify"]);
  assert.deepEqual(h.store.statuses, ["creating", "ready"]);
});

test("concurrent claimant is blocked while creating and can reuse only after ready", async () => {
  const h = harness();
  const entered = deferred();
  const release = deferred();
  h.hooks.create = async () => { entered.resolve(); await release.promise; return PAGE; };
  const winner = h.run();
  try {
    await entered.promise;
    assert.equal(h.store.state()?.status, "creating");
    await assert.rejects(h.run(), Error);
    assert.equal(h.calls.create, 1);
    assert.equal(h.calls.verify, 0);
    assert.equal(h.store.state()?.status, "creating");
  } finally {
    release.resolve();
    await winner;
  }
  assert.equal(h.store.state()?.status, "ready");
  assert.ok(await h.run() === PAGE);
  assert.equal(h.calls.create, 1);
  assert.equal(h.calls.verify, 2);
});

test("simultaneous claims serialize to one creator rather than two missing-state reads", async () => {
  const h = harness();
  const entered = deferred();
  const release = deferred();
  h.hooks.create = async () => { entered.resolve(); await release.promise; return PAGE; };
  const first = h.run();
  const second = h.run();
  const settled = Promise.allSettled([first, second]);
  try {
    await entered.promise;
    await assert.rejects(second, Error);
    assert.equal(h.calls.create, 1);
  } finally {
    release.resolve();
  }
  const results = await settled;
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
  assert.deepEqual(h.store.statuses, ["creating", "ready"]);
});

test("explicit creation rejection permits a later fresh claim and one successful retry", async () => {
  const h = harness();
  const rejected = new FakeRejected("fake explicit rejection before page creation");
  h.hooks.create = async () => { throw rejected; };
  await assert.rejects(h.run(), (error) => error === rejected);
  const firstAttempt = h.store.state()?.attemptId;
  assert.equal(h.store.state()?.status, "rejected");
  assert.equal(h.store.state()?.pageId, undefined);
  assert.equal(h.calls.verify, 0);
  delete h.hooks.create;
  assert.ok(await h.run() === PAGE);
  assert.equal(h.store.state()?.status, "ready");
  assert.ok(h.store.state()?.attemptId !== firstAttempt);
  assert.equal(h.calls.create, 2);
  assert.deepEqual(h.store.statuses, ["creating", "rejected", "creating", "ready"]);
});

test("ambiguous timeout persists review and never repeats creation", async () => {
  const h = harness();
  const timeout = new Error("fake ambiguous transport timeout");
  h.hooks.create = async () => { throw timeout; };
  await assert.rejects(h.run(), (error) => error === timeout);
  const attemptId = h.store.state()?.attemptId;
  assert.equal(h.store.state()?.status, "review");
  assert.equal(h.store.state()?.pageId, undefined);
  delete h.hooks.create;
  await assert.rejects(h.run(), Error);
  assert.equal(h.calls.create, 1);
  assert.equal(h.calls.verify, 0);
  assert.ok(h.store.state()?.attemptId === attemptId);
  assert.deepEqual(h.store.statuses, ["creating", "review"]);
});

for (const call of [1, 2]) {
  test(`source validation failure at ${call === 1 ? "entry" : "pre-dispatch"} prevents creation`, async () => {
    const h = harness();
    h.hooks.validate = (count) => { if (count === call) h.source.request.status = "cancelled"; };
    await assert.rejects(h.run(), Error);
    assert.equal(h.calls.create, 0);
    assert.equal(h.calls.absent, 0);
    assert.equal(h.calls.verify, 0);
    if (call === 1) {
      assert.equal(h.store.state(), undefined);
      assert.equal(h.store.transactions(), 0);
    } else {
      assert.equal(h.store.state()?.status, "rejected");
      assert.deepEqual(h.store.statuses, ["creating", "rejected"]);
    }
  });
}

test("source invalidated during absence lookup is revalidated before dispatch", async () => {
  const h = harness();
  h.hooks.absent = () => { h.source.request.status = "cancelled"; };
  await assert.rejects(h.run(), Error);
  assert.equal(h.calls.absent, 1);
  assert.equal(h.calls.create, 0);
  assert.equal(h.calls.verify, 0);
  assert.equal(h.store.state()?.status, "rejected");
});

test("source changes after creation retain pageId in review and prohibit recreation", async () => {
  const h = harness();
  h.hooks.create = async () => { h.source.profile.name = "FAKE RENAMED MEMBER"; return PAGE; };
  await assert.rejects(h.run(), Error);
  assert.equal(h.store.state()?.status, "review");
  assert.ok(h.store.state()?.pageId === PAGE);
  assert.equal(h.calls.verify, 1);
  h.source.profile.name = fixture().profile.name;
  await assert.rejects(h.run(), Error);
  assert.equal(h.calls.create, 1);
  assert.deepEqual(h.store.statuses, ["creating", "review"]);
});

test("independent verification failure never marks a created page ready", async () => {
  const h = harness();
  const failure = new Error("fake wrong page ancestry");
  h.hooks.verify = () => { throw failure; };
  await assert.rejects(h.run(), (error) => error === failure);
  assert.equal(h.store.state()?.status, "review");
  assert.ok(h.store.state()?.pageId === PAGE);
  delete h.hooks.verify;
  await assert.rejects(h.run(), Error);
  assert.equal(h.calls.create, 1);
  assert.equal(h.calls.verify, 1);
  assert.deepEqual(h.store.statuses, ["creating", "review"]);
});

test("ready reuse still fails if independent verification no longer passes", async () => {
  const h = harness();
  await h.run();
  const failure = new Error("fake archived page");
  h.hooks.verify = () => { throw failure; };
  await assert.rejects(h.run(), (error) => error === failure);
  assert.equal(h.calls.create, 1);
  assert.equal(h.calls.verify, 2);
});

test("ready reuse revalidates the current source before returning its page", async () => {
  const h = harness();
  await h.run();
  const revalidation = h.calls.validate + 2;
  h.hooks.validate = (count) => { if (count === revalidation) h.source.request.status = "cancelled"; };
  await assert.rejects(h.run(), Error);
  assert.equal(h.calls.create, 1);
  assert.equal(h.calls.verify, 1);
  assert.deepEqual(h.store.statuses, ["creating", "ready"]);
});

for (const label of ["absence cannot be proven", "same-name collision"]) {
  test(`${label} prevents creation`, async () => {
    const h = harness();
    const failure = new Error(`fake ${label}`);
    h.hooks.absent = () => { throw failure; };
    await assert.rejects(h.run(), (error) => error === failure);
    assert.equal(h.calls.absent, 1);
    assert.equal(h.calls.create, 0);
    assert.equal(h.calls.verify, 0);
    assert.equal(h.store.state()?.status, "rejected");
    assert.equal(h.store.state()?.pageId, undefined);
  });
}

for (const field of ["memberId", "staffId", "rootPageId"] as const) {
  test(`existing wrong ${field} mapping binding fails closed`, async () => {
    const identity = identify(fixture());
    const initial: PrivateNotionMemberPageState = {
      ...identity, sourceRecordId: identity.recordId, status: "ready", attemptId: "fake-old-attempt", pageId: PAGE,
    };
    initial[field] = field === "rootPageId" ? OTHER_ROOT.replaceAll("-", "") : "900099";
    const h = harness(initial);
    await assert.rejects(h.run(), Error);
    assert.equal(h.calls.create, 0);
    assert.equal(h.calls.verify, 0);
    assert.equal(h.calls.absent, 0);
    assert.equal(h.store.statuses.length, 0);
    assert.ok(JSON.stringify(h.store.state()) === JSON.stringify(initial));
  });
}

test("even a malformed rejected claim cannot replay a recorded created page", async () => {
  const identity = identify(fixture());
  const h = harness({ ...identity, sourceRecordId: identity.recordId, status: "rejected", attemptId: "old", pageId: PAGE });
  await assert.rejects(h.run());
  assert.equal(h.calls.create, 0);
});
