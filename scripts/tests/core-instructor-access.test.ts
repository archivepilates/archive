import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import {
  assertCoreInstructorAccess,
  assertCoreSessionFresh,
  coreInstructorAccessIssue,
  ownsCoreBooking,
  safeCoreChartUrl,
  validCorePassword,
  type CoreInstructorStaff,
} from "../../firebase/kangsain-functions/functions/src/security/coreInstructorAccess";
import { AppError } from "../../firebase/kangsain-functions/functions/src/utils/errors";

const NOW = Date.parse("2026-10-11T03:00:00Z");
const AUTH_TIME = NOW / 1000;
const DATE = "2026-10-11";
const CHART_URL =
  "https://in.archivepilates.com/private-chart/?r=request-1&t=test-token";

function staff(overrides: Record<string, unknown> = {}): CoreInstructorStaff {
  return {
    staffId: "staff-1",
    uid: "uid-1",
    studioId: "studio-1",
    name: "Test Instructor",
    email: "instructor@example.invalid",
    role: "instructor",
    active: true,
    studiomateStaffId: "source-staff-1",
    visibleLectureStaffNames: [],
    createdAt: { seconds: AUTH_TIME },
    updatedAt: { seconds: AUTH_TIME },
    employmentStatus: "current",
    employmentSource: "studiomate_staff_tab_browser_scan",
    coreAccessEnabled: true,
    coreMustChangePassword: false,
    coreAuthAfter: AUTH_TIME,
    ...overrides,
  } as CoreInstructorStaff;
}

function auth(token: Record<string, unknown> = {}, uid = "uid-1"): any {
  return {
    uid,
    token: {
      staffId: "staff-1",
      studioId: "studio-1",
      role: "instructor",
      email: "instructor@example.invalid",
      auth_time: AUTH_TIME,
      ...token,
    },
  };
}

function booking(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    bookingId: "12345",
    staffId: "staff-1",
    studioId: "studio-1",
    memberId: "member-1",
    memberName: "Test Member",
    lectureDate: DATE,
    lectureStartAt: { seconds: AUTH_TIME },
    lessonType: "private",
    appStatus: "booked",
    sourceStatus: "reserved",
    canonicalBookingKey: "test-canonical-key",
    ...overrides,
  };
}

function chartRequest(
  overrides: Record<string, unknown> = {},
): Record<string, any> {
  return {
    bookingId: "12345",
    staffId: "staff-1",
    studioId: "studio-1",
    memberId: "member-1",
    lessonDate: DATE,
    status: "pending",
    manualTest: false,
    postUrl: CHART_URL,
    postStatus: "pending",
    ...overrides,
  };
}

test("access accepts the current canonical instructor at and after coreAuthAfter", () => {
  assert.equal(coreInstructorAccessIssue(staff(), auth()), "");
  assert.equal(
    coreInstructorAccessIssue(staff(), auth({ auth_time: AUTH_TIME + 1 })),
    "",
  );
});

for (const [label, value] of [
  ["pending", true],
  ["missing", undefined],
  ["null", null],
] as const) {
  test(`access denies ${label} password state except the first-login gate`, () => {
    const current = staff({ coreMustChangePassword: value });
    assert.equal(
      coreInstructorAccessIssue(current, auth()),
      "password_change_required",
    );
    assert.equal(coreInstructorAccessIssue(current, auth(), true), "");
    assert.throws(() => assertCoreInstructorAccess(current, auth()), {
      code: "PERMISSION_DENIED",
    });
  });
}

const accessDenials: Array<[string, Record<string, unknown>, any, string]> = [
  ["unauthenticated", {}, undefined, "identity_mismatch"],
  ["wrong uid", {}, auth({}, "uid-2"), "identity_mismatch"],
  ["missing staff uid", { uid: undefined }, auth(), "identity_mismatch"],
  ["wrong token staff", {}, auth({ staffId: "staff-2" }), "identity_mismatch"],
  [
    "missing token staff",
    {},
    auth({ staffId: undefined }),
    "identity_mismatch",
  ],
  [
    "wrong token studio",
    {},
    auth({ studioId: "studio-2" }),
    "identity_mismatch",
  ],
  [
    "missing token studio",
    {},
    auth({ studioId: undefined }),
    "identity_mismatch",
  ],
  ["manager token", {}, auth({ role: "manager" }), "identity_mismatch"],
  ["viewer token", {}, auth({ role: "viewer" }), "identity_mismatch"],
  ["missing token role", {}, auth({ role: undefined }), "identity_mismatch"],
  ["manager staff", { role: "manager" }, auth(), "account_disabled"],
  ["viewer staff", { role: "viewer" }, auth(), "account_disabled"],
  ["inactive staff", { active: false }, auth(), "account_disabled"],
  ["missing active", { active: undefined }, auth(), "account_disabled"],
  ["disabled access", { coreAccessEnabled: false }, auth(), "account_disabled"],
  [
    "missing enabled",
    { coreAccessEnabled: undefined },
    auth(),
    "account_disabled",
  ],
  [
    "nonboolean enabled",
    { coreAccessEnabled: "true" },
    auth(),
    "account_disabled",
  ],
  [
    "former employee",
    { employmentStatus: "inactive" },
    auth(),
    "not_current_staff",
  ],
  [
    "missing employment",
    { employmentStatus: undefined },
    auth(),
    "not_current_staff",
  ],
  [
    "missing canonical source",
    { employmentSource: undefined },
    auth(),
    "not_current_staff",
  ],
  [
    "Excel employment source",
    { employmentSource: "excel" },
    auth(),
    "not_current_staff",
  ],
  [
    "old session",
    {},
    auth({ auth_time: AUTH_TIME - 1 }),
    "fresh_login_required",
  ],
  [
    "missing session time",
    {},
    auth({ auth_time: undefined }),
    "fresh_login_required",
  ],
  [
    "missing auth cutoff",
    { coreAuthAfter: undefined },
    auth(),
    "fresh_login_required",
  ],
  ["NaN auth cutoff", { coreAuthAfter: NaN }, auth(), "fresh_login_required"],
  ["fractional auth cutoff", { coreAuthAfter: AUTH_TIME - 0.5 }, auth(), "fresh_login_required"],
  ["negative auth cutoff", { coreAuthAfter: -1 }, auth(), "fresh_login_required"],
  ["fractional auth time", {}, auth({ auth_time: AUTH_TIME + 0.5 }), "fresh_login_required"],
  [
    "infinite auth cutoff",
    { coreAuthAfter: Infinity },
    auth(),
    "fresh_login_required",
  ],
];
for (const [label, overrides, session, issue] of accessDenials) {
  test(`access denies ${label}, including during first login`, () => {
    for (const firstLogin of [false, true]) {
      assert.equal(
        coreInstructorAccessIssue(staff(overrides), session, firstLogin),
        issue,
      );
      assert.throws(
        () => assertCoreInstructorAccess(staff(overrides), session, firstLogin),
        { code: issue === "fresh_login_required" ? "AUTH_REQUIRED" : "PERMISSION_DENIED" },
      );
    }
  });
}

for (const [label, value] of [
  ["NaN", NaN],
  ["nonnumeric", "bad-time"],
  ["infinite", Infinity],
] as const) {
  test(`access fails closed for ${label} auth_time`, () => {
    assert.equal(
      coreInstructorAccessIssue(staff(), auth({ auth_time: value })),
      "fresh_login_required",
    );
  });
}

for (const field of ["uid", "staffId", "studioId"] as const) {
  test(`access rejects jointly missing ${field} instead of treating undefined as identity`, () => {
    const session = auth({ [field]: undefined });
    if (field === "uid") session.uid = undefined;
    assert.notEqual(
      coreInstructorAccessIssue(staff({ [field]: undefined }), session),
      "",
    );
  });
}

for (const value of [
  "abcdefgh",
  "a".repeat(64),
  "new password",
  "New-pass-123",
]) {
  test(`password accepts valid length ${value.length}`, () =>
    assert.equal(validCorePassword(value), true));
}
for (const [label, value] of [
  ["bootstrap", "111111"],
  ["empty", ""],
  ["seven characters", "abcdefg"],
  ["65 characters", "a".repeat(65)],
  ["leading space", " abcdefgh"],
  ["trailing space", "abcdefgh "],
  ["leading newline", "\nabcdefgh"],
  ["trailing tab", "abcdefgh\t"],
  ["null", null],
  ["missing", undefined],
  ["number", 12345678],
  ["object", { password: "abcdefgh" }],
  ["array", ["abcdefgh"]],
  ["boxed string", new String("abcdefgh")],
] as Array<[string, unknown]>) {
  test(`password rejects ${label}`, () =>
    assert.equal(validCorePassword(value), false));
}

test("booking accepts an owned canonical source and exactly bound request", () => {
  assert.equal(ownsCoreBooking(staff(), booking()), true);
  assert.equal(ownsCoreBooking(staff(), booking(), chartRequest()), true);
});
for (const [label, overrides] of [
  ["changed owner", { staffId: "staff-2" }],
  ["other studio", { studioId: "studio-2" }],
  ["missing member", { memberId: undefined }],
  ["empty member", { memberId: "" }],
  ["cancelled", { appStatus: "cancelled" }],
  ["canceled", { appStatus: "canceled" }],
  ["deleted", { appStatus: "deleted" }],
  ["source cancellation", { sourceStatus: "예약 취소" }],
  ["source deletion", { sourceStatus: "삭제됨" }],
] as Array<[string, Record<string, unknown>]>) {
  test(`booking denies ${label}, with or without a request`, () => {
    assert.equal(ownsCoreBooking(staff(), booking(overrides)), false);
    assert.equal(
      ownsCoreBooking(staff(), booking(overrides), chartRequest()),
      false,
    );
  });
}
for (const [label, overrides] of [
  ["wrong staff", { staffId: "staff-2" }],
  ["wrong studio", { studioId: "studio-2" }],
  ["wrong member", { memberId: "member-2" }],
  ["missing member", { memberId: undefined }],
  ["wrong booking", { bookingId: "67890" }],
  ["missing booking", { bookingId: undefined }],
  ["wrong date", { lessonDate: "2026-10-12" }],
  ["missing date", { lessonDate: undefined }],
  ["cancelled", { status: "cancelled" }],
  ["manual test", { manualTest: true }],
] as Array<[string, Record<string, unknown>]>) {
  test(`request binding rejects ${label}`, () => {
    assert.equal(
      ownsCoreBooking(staff(), booking(), chartRequest(overrides)),
      false,
    );
  });
}
for (const [label, source, request] of [
  ["booking id", { bookingId: undefined }, { bookingId: undefined }],
  ["lesson date", { lectureDate: undefined }, { lessonDate: undefined }],
] as Array<[string, Record<string, unknown>, Record<string, unknown>]>) {
  test(`request binding rejects jointly missing ${label}`, () => {
    assert.equal(
      ownsCoreBooking(staff(), booking(source), chartRequest(request)),
      false,
    );
  });
}

for (const path of [
  "/private-chart",
  "/private-chart/",
  "/archivein/private-chart",
  "/archivein/private-chart/",
]) {
  test(`chart URL accepts canonical ${path} with both tokens`, () => {
    const url = `https://in.archivepilates.com${path}?r=request-1&t=test-token`;
    assert.equal(safeCoreChartUrl(url), url);
    assert.equal(safeCoreChartUrl(url, "request-1"), url);
  });
}
test("chart URL binds the decoded request parameter to exactly the supplied document id", () => {
  assert.equal(safeCoreChartUrl(CHART_URL, "request-1"), CHART_URL);
  assert.equal(safeCoreChartUrl(CHART_URL, undefined), CHART_URL);
  const encoded = CHART_URL.replace("r=request-1", "r=%72equest-1");
  assert.equal(safeCoreChartUrl(encoded, "request-1"), encoded);
  for (const id of [
    "request-2",
    "request",
    "request-10",
    "Request-1",
    " request-1",
    "12345",
  ]) {
    assert.equal(
      safeCoreChartUrl(CHART_URL, id),
      "",
      `Must reject request id ${id}`,
    );
  }
});
for (const [label, value] of [
  ["javascript", "javascript:alert(1)"],
  ["data", "data:text/html,test"],
  ["http", CHART_URL.replace("https:", "http:")],
  ["relative", "/private-chart/?r=x&t=y"],
  ["protocol relative", "//in.archivepilates.com/private-chart/?r=x&t=y"],
  ["wrong host", CHART_URL.replace("in.archivepilates.com", "evil.example")],
  [
    "host suffix",
    CHART_URL.replace(
      "in.archivepilates.com",
      "in.archivepilates.com.evil.example",
    ),
  ],
  [
    "userinfo host spoof",
    "https://in.archivepilates.com@evil.example/private-chart/?r=x&t=y",
  ],
  [
    "username on canonical host",
    "https://user@in.archivepilates.com/private-chart/?r=request-1&t=test-token",
  ],
  [
    "password on canonical host",
    "https://user:pass@in.archivepilates.com/private-chart/?r=request-1&t=test-token",
  ],
  [
    "noncanonical port",
    "https://in.archivepilates.com:8443/private-chart/?r=request-1&t=test-token",
  ],
  [
    "subdomain",
    CHART_URL.replace("in.archivepilates.com", "sub.in.archivepilates.com"),
  ],
  ["wrong path", "https://in.archivepilates.com/core/?r=x&t=y"],
  ["path suffix", "https://in.archivepilates.com/private-chart/evil?r=x&t=y"],
  ["encoded path", "https://in.archivepilates.com/%70rivate-chart/?r=x&t=y"],
  ["missing request", "https://in.archivepilates.com/private-chart/?t=y"],
  ["missing token", "https://in.archivepilates.com/private-chart/?r=x"],
  ["empty request", "https://in.archivepilates.com/private-chart/?r=&t=y"],
  ["empty token", "https://in.archivepilates.com/private-chart/?r=x&t="],
  ["invalid URL", "not a URL"],
  ["null", null],
  ["missing", undefined],
] as Array<[string, unknown]>) {
  test(`chart URL rejects ${label}`, () => {
    assert.equal(safeCoreChartUrl(value), "");
    assert.equal(safeCoreChartUrl(value, "request-1"), "");
  });
}

// Load the complete handler and shared guard with a closed import allowlist;
// neither Firebase initialization nor credentials/network code can be imported.
const requireFunctions = createRequire(
  new URL(
    "../../firebase/kangsain-functions/functions/package.json",
    import.meta.url,
  ),
);
const ts = requireFunctions("typescript");
function compiled(relativePath: string): string {
  return ts.transpileModule(
    fs.readFileSync(
      new URL(
        `../../firebase/kangsain-functions/functions/src/${relativePath}`,
        import.meta.url,
      ),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
}
const guardCode = compiled("security/authGuards.ts");
const callableCode = compiled("callable/coreInstructorAccess.ts");
function loadMocked(
  code: string,
  dependencies: Record<string, any>,
  now: () => number,
): any {
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    Date: class extends Date {
      static now() {
        return now();
      }
    },
    require(id: string) {
      assert.ok(
        Object.hasOwn(dependencies, id),
        `Unexpected runtime import: ${id}`,
      );
      return dependencies[id];
    },
  });
  return exports;
}

type RuntimeOptions = {
  current?: CoreInstructorStaff | null;
  transactionStaff?: CoreInstructorStaff;
  fallbackStaff?: CoreInstructorStaff;
  documents?: Record<string, Record<string, any>>;
  failAt?: "password" | "revoke" | "finalize";
};
function runtime(options: RuntimeOptions = {}) {
  let now = NOW;
  let current =
    options.current === undefined
      ? staff({ coreMustChangePassword: true })
      : options.current;
  const documents = options.documents || {};
  const events: string[] = [];
  const reads: string[] = [];
  const queryCalls: any[] = [];
  const failure = new Error(`injected ${options.failAt || "none"} failure`);
  let failOnce = Boolean(options.failAt);
  let password = "111111";
  function failAt(stage: RuntimeOptions["failAt"]) {
    if (failOnce && options.failAt === stage) {
      failOnce = false;
      throw failure;
    }
  }
  const snapshot = (path: string) => ({
    id: path.split("/").at(-1),
    exists: Object.hasOwn(documents, path),
    data: () => documents[path],
  });
  const db = {
    doc(path: string) {
      return {
        path,
        async update(patch: any) {
          assert.equal(
            path,
            "staffs/staff-1",
            "Only the authenticated staff may be written",
          );
          events.push(
            patch.coreMustChangePassword === false ? "finalize" : "unlock",
          );
          if (patch.coreMustChangePassword === false) failAt("finalize");
          assert.ok(current);
          current = { ...current, ...patch };
        },
      };
    },
    async runTransaction(callback: any) {
      const updates: any[] = [];
      await callback({
        get: async (ref: any) => {
          assert.equal(ref.path, "staffs/staff-1");
          return { data: () => options.transactionStaff || current };
        },
        update: (ref: any, patch: any) => {
          assert.equal(ref.path, "staffs/staff-1");
          updates.push(patch);
        },
      });
      for (const patch of updates) {
        events.push("lock");
        current = { ...current!, ...patch };
      }
    },
    collection(name: string) {
      assert.ok(["bookings", "privateLessonChartRequests"].includes(name));
      let rows = Object.keys(documents)
        .filter((path) => path.startsWith(`${name}/`))
        .map(snapshot);
      const query: any = {
        where(field: string, op: string, value: any) {
          queryCalls.push([name, field, op, value]);
          assert.ok(["==", ">=", "<="].includes(op));
          rows = rows.filter((row) =>
            op === "=="
              ? row.data()[field] === value
              : op === ">="
                ? row.data()[field] >= value
                : row.data()[field] <= value,
          );
          return query;
        },
        orderBy: () => query,
        limit(n: number) {
          rows = rows.slice(0, n);
          return query;
        },
        async get() {
          return { size: rows.length, docs: rows };
        },
      };
      return query;
    },
    async getAll(...refs: any[]) {
      reads.push(...refs.map((ref) => ref.path));
      return refs.map((ref) => snapshot(ref.path));
    },
  };
  const dependencies: Record<string, any> = {
    "../firestore/staffRepository": {
      getStaffByUid: async () => current,
      getStaffByEmail: async () => options.fallbackStaff || null,
    },
    "../security/coreInstructorAccess": {
      assertCoreInstructorAccess,
      assertCoreSessionFresh,
      ownsCoreBooking,
      safeCoreChartUrl,
      validCorePassword,
    },
    "./coreInstructorAccess": { assertCoreInstructorAccess, assertCoreSessionFresh },
    "../utils/errors": { AppError },
  };
  const guards = loadMocked(guardCode, dependencies, () => now);
  const handlers = loadMocked(
    callableCode,
    {
      ...dependencies,
      "../security/authGuards": guards,
      "../config/firebase": { db },
      "firebase-admin/auth": {
        getAuth: () => ({
          async updateUser(uid: string, patch: any) {
            assert.equal(uid, "uid-1");
            events.push("password");
            failAt("password");
            password = patch.password;
          },
          async revokeRefreshTokens(uid: string) {
            assert.equal(uid, "uid-1");
            events.push("revoke");
            failAt("revoke");
          },
        }),
      },
      "firebase-admin/firestore": {
        Timestamp: { now: () => ({ seconds: now / 1000 }) },
      },
      "../utils/date": {
        todayKst: () => DATE,
        addDays: (value: string, days: number) =>
          new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000)
            .toISOString()
            .slice(0, 10),
      },
    },
    () => now,
  );
  return {
    handlers,
    guards,
    events,
    reads,
    queryCalls,
    failure,
    advanceSeconds(seconds: number) {
      now += seconds * 1000;
    },
    // Models password-based reauthentication only; it does not issue or verify
    // a real Firebase token, or simulate network timeouts after committed writes.
    reauthenticate(inputPassword: string) {
      assert.equal(
        inputPassword,
        password,
        "Mock login rejects the old password",
      );
      return auth({ auth_time: now / 1000 });
    },
    get current() {
      return current;
    },
    get password() {
      return password;
    },
  };
}
function call(data: Record<string, unknown> = {}, session = auth()): any {
  return { data, auth: session };
}

for (const role of ["owner", "manager"] as const) {
  test(`${role} session returns manager while preserving full shared-guard authority`, async () => {
    const current = staff({
      role,
      coreAccessEnabled: undefined,
      coreMustChangePassword: undefined,
      coreAuthAfter: undefined,
      employmentStatus: undefined,
      employmentSource: undefined,
    });
    const r = runtime({ current });
    const request = call({}, auth({ role }));
    const session = await r.handlers.getCoreAccessSessionHandler(request);
    assert.equal(session.role, "manager");
    assert.equal(session.staffId, current.staffId);
    assert.equal(session.staffName, current.name);
    assert.equal(session.mustChangePassword, false);
    const authorized = await r.guards.requireStaff(request);
    assert.equal(
      authorized.role,
      role,
      "Session normalization must not downgrade the canonical staff",
    );
    assert.equal(r.guards.isManagerRole(authorized.role), true);
    assert.doesNotThrow(() => r.guards.requireManager(authorized));
    assert.doesNotThrow(() => r.guards.assertOwnStaff(authorized, "staff-2"));
    await assert.rejects(
      r.handlers.completeCoreFirstLoginHandler(
        call({ password: "New-pass-123" }, auth({ role })),
      ),
      { code: "INVALID_ARGUMENT" },
    );
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.queryCalls, []);
  });
}
test("inactive owner cannot acquire a manager session or shared-guard authority", async () => {
  const r = runtime({ current: staff({ role: "owner", active: false }) });
  const request = call({}, auth({ role: "owner" }));
  await assert.rejects(r.handlers.getCoreAccessSessionHandler(request), {
    code: "PERMISSION_DENIED",
  });
  await assert.rejects(r.guards.requireStaff(request), {
    code: "PERMISSION_DENIED",
  });
  assert.deepEqual(r.events, []);
});

for (const role of ["owner", "manager"] as const) {
  test(`${role} revocation rejects the old token and permits freshly authenticated access`, async () => {
    const r = runtime({ current: staff({ role, coreAuthAfter: AUTH_TIME + 1 }) });
    for (const handler of [r.handlers.getCoreAccessSessionHandler, r.guards.requireStaff]) {
      await assert.rejects(handler(call({}, auth({ role }))), { code: "AUTH_REQUIRED" });
      assert.ok(await handler(call({}, auth({ role, auth_time: AUTH_TIME + 1 }))));
    }
    assert.deepEqual(r.events, []);
  });
}
for (const value of [undefined, null, "0", NaN, Infinity, AUTH_TIME + 0.5]) {
  test(`session reset fails closed for invalid auth time ${String(value)}`, () => {
    assert.throws(() => assertCoreSessionFresh(staff({ role: "manager" }), auth({ auth_time: value })), { code: "AUTH_REQUIRED" });
  });
}
test("session reset does not alter legacy manager accounts without a cutoff", () => {
  assert.doesNotThrow(() => assertCoreSessionFresh(staff({ role: "manager", coreAuthAfter: undefined }), auth({ auth_time: undefined })));
});

test("session allows pending first login while the real shared guard and workspace deny it", async () => {
  const r = runtime();
  assert.equal(
    (await r.handlers.getCoreAccessSessionHandler(call())).mustChangePassword,
    true,
  );
  await assert.rejects(r.guards.requireStaff(call()), {
    code: "PERMISSION_DENIED",
  });
  await assert.rejects(r.handlers.getCoreInstructorWorkspaceHandler(call()), {
    code: "PERMISSION_DENIED",
  });
  assert.deepEqual(r.queryCalls, []);
  assert.deepEqual(r.events, []);
});
for (const [label, overrides] of [
  ["inactive", { active: false }],
  ["former employee", { employmentStatus: "inactive" }],
  ["missing canonical employment", { employmentSource: undefined }],
  ["missing enabled", { coreAccessEnabled: undefined }],
  ["viewer", { role: "viewer" }],
] as Array<[string, Record<string, unknown>]>) {
  test(`shared guard and session handler reject ${label} without I/O`, async () => {
    const r = runtime({ current: staff(overrides) });
    await assert.rejects(r.guards.requireStaff(call()), {
      code: "PERMISSION_DENIED",
    });
    await assert.rejects(r.handlers.getCoreAccessSessionHandler(call()), {
      code: "PERMISSION_DENIED",
    });
    await assert.rejects(r.handlers.getCoreInstructorWorkspaceHandler(call()), {
      code: "PERMISSION_DENIED",
    });
    await assert.rejects(
      r.handlers.completeCoreFirstLoginHandler(
        call({ password: "New-pass-123" }),
      ),
      { code: "PERMISSION_DENIED" },
    );
    assert.deepEqual(r.events, []);
  });
}
test("email fallback cannot authorize a different instructor uid", async () => {
  const r = runtime({ current: null, fallbackStaff: staff({ uid: "uid-2" }) });
  await assert.rejects(r.handlers.getCoreAccessSessionHandler(call()), {
    code: "PERMISSION_DENIED",
  });
  await assert.rejects(r.guards.requireStaff(call()), {
    code: "PERMISSION_DENIED",
  });
  assert.deepEqual(r.events, []);
});
test("unauthenticated handlers reject before staff writes or workspace reads", async () => {
  const r = runtime();
  for (const handler of Object.values(r.handlers) as any[]) {
    await assert.rejects(handler({ data: {} }), { code: "AUTH_REQUIRED" });
  }
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.queryCalls, []);
});
for (const password of [
  undefined,
  "111111",
  "short",
  " New-pass-123",
  "a".repeat(65),
]) {
  test(`first login rejects invalid password ${String(password).length} before writes`, async () => {
    const r = runtime();
    await assert.rejects(
      r.handlers.completeCoreFirstLoginHandler(call({ password })),
      { code: "INVALID_ARGUMENT" },
    );
    assert.deepEqual(r.events, []);
  });
}
test("first login rejects an auth session older than 600 seconds", async () => {
  const r = runtime({
    current: staff({
      coreMustChangePassword: true,
      coreAuthAfter: AUTH_TIME - 1000,
    }),
  });
  await assert.rejects(
    r.handlers.completeCoreFirstLoginHandler(
      call({ password: "New-pass-123" }, auth({ auth_time: AUTH_TIME - 601 })),
    ),
    { code: "PERMISSION_DENIED" },
  );
  assert.deepEqual(r.events, []);
});
test("first login accepts the exact 600-second reauthentication boundary", async () => {
  const r = runtime({
    current: staff({
      coreMustChangePassword: true,
      coreAuthAfter: AUTH_TIME - 1000,
    }),
  });
  assert.equal(
    (
      await r.handlers.completeCoreFirstLoginHandler(
        call(
          { password: "New-pass-123" },
          auth({ auth_time: AUTH_TIME - 600 }),
        ),
      )
    ).ok,
    true,
  );
});
for (const [label, overrides] of [
  ["changed uid", { uid: "uid-2" }],
  ["inactive employment", { employmentStatus: "inactive" }],
  ["disabled", { coreAccessEnabled: false }],
  ["already completed", { coreMustChangePassword: false }],
  ["concurrent lock", { corePasswordChangeLockUntil: NOW + 1 }],
] as Array<[string, Record<string, unknown>]>) {
  test(`first-login transaction rechecks ${label} before changing Auth`, async () => {
    const r = runtime({
      transactionStaff: staff({ coreMustChangePassword: true, ...overrides }),
    });
    await assert.rejects(
      r.handlers.completeCoreFirstLoginHandler(
        call({ password: "New-pass-123" }),
      ),
      { code: "PERMISSION_DENIED" },
    );
    assert.deepEqual(r.events, []);
    assert.equal(r.password, "111111");
  });
}
test("successful first login revokes tokens and denies the old token when the gate opens", async () => {
  const r = runtime();
  assert.equal(
    (
      await r.handlers.completeCoreFirstLoginHandler(
        call({ password: "New-pass-123" }),
      )
    ).requireFreshLogin,
    true,
  );
  assert.deepEqual(r.events, ["lock", "password", "revoke", "finalize"]);
  assert.equal(r.current!.coreMustChangePassword, false);
  assert.equal(r.current!.coreAuthAfter, AUTH_TIME + 1);
  assert.equal(r.current!.corePasswordChangeLockUntil, 0);
  await assert.rejects(r.guards.requireStaff(call()), {
    code: "AUTH_REQUIRED",
  });
  r.advanceSeconds(1);
  assert.equal(
    (await r.guards.requireStaff(call({}, auth({ auth_time: AUTH_TIME + 1 }))))
      .uid,
    "uid-1",
  );
});
for (const stage of ["password", "revoke", "finalize"] as const) {
  test(`first-login ${stage} failure keeps access pending, unlocks and permits a reauthenticated retry`, async () => {
    const r = runtime({ failAt: stage });
    await assert.rejects(
      r.handlers.completeCoreFirstLoginHandler(
        call({ password: "New-pass-123" }),
      ),
      (error) => error === r.failure,
    );
    assert.equal(r.current!.coreMustChangePassword, true);
    assert.equal(r.current!.corePasswordChangeLockUntil, 0);
    assert.equal(r.current!.coreAuthAfter, AUTH_TIME);
    assert.equal(r.password, stage === "password" ? "111111" : "New-pass-123");
    assert.deepEqual(
      r.events,
      stage === "password"
        ? ["lock", "password", "unlock"]
        : stage === "revoke"
          ? ["lock", "password", "revoke", "unlock"]
          : ["lock", "password", "revoke", "finalize", "unlock"],
    );
    await assert.rejects(r.guards.requireStaff(call()), {
      code: "PERMISSION_DENIED",
    });
    // Auth succeeded in the latter two failures: retry using the new password's
    // freshly authenticated identity, not the now-invalid bootstrap password.
    r.advanceSeconds(1);
    if (stage !== "password") {
      assert.throws(() => r.reauthenticate("111111"), {
        code: "ERR_ASSERTION",
      });
    }
    const retry = call(
      { password: "New-pass-123" },
      r.reauthenticate(stage === "password" ? "111111" : "New-pass-123"),
    );
    assert.equal(
      (await r.handlers.getCoreAccessSessionHandler(retry)).mustChangePassword,
      true,
    );
    assert.equal(
      (await r.handlers.completeCoreFirstLoginHandler(retry)).ok,
      true,
    );
    assert.equal(r.current!.coreMustChangePassword, false);
    assert.equal(r.current!.coreAuthAfter, AUTH_TIME + 2);
    assert.equal(r.password, "New-pass-123");
    await assert.rejects(r.guards.requireStaff(retry), {
      code: "AUTH_REQUIRED",
    });
    r.advanceSeconds(1);
    assert.equal(
      (await r.guards.requireStaff(call({}, r.reauthenticate("New-pass-123"))))
        .uid,
      "uid-1",
    );
  });
}

test("workspace returns only bound tasks and never uses another staff/studio record's status", async () => {
  const r = runtime({
    current: staff(),
    documents: {
      "bookings/12345": booking(),
      "bookings/67890": booking({ bookingId: "67890", staffId: "staff-2" }),
      "privateLessonChartRequests/request-1": chartRequest(),
      "privateLessonChartRequests/wrong-staff": chartRequest({
        staffId: "staff-2",
      }),
      "privateLessonChartRequests/wrong-studio": chartRequest({
        studioId: "studio-2",
      }),
      "privateLessonChartRequests/outside-range": chartRequest({
        lessonDate: "2026-12-01",
      }),
      "privateLessonChartRecords/request-1": {
        staffId: "staff-2",
        studioId: "studio-1",
        report: { status: "completed" },
      },
    },
  });
  const result = await r.handlers.getCoreInstructorWorkspaceHandler(call());
  assert.deepEqual(
    Array.from(result.lessons, (row: any) => row.id),
    ["12345"],
  );
  assert.deepEqual(
    Array.from(result.privateTasks, (row: any) => row.id),
    ["request-1"],
  );
  assert.equal(result.privateTasks[0].status, "pending");
  assert.equal(result.privateTasks[0].recordUrl, CHART_URL);
  assert.equal(
    new URL(result.privateTasks[0].recordUrl).searchParams.get("r"),
    result.privateTasks[0].id,
  );
  assert.equal(result.privateTasks[0].surveyUrl, "");
  assert.equal(result.privateTasks[0].reportUrl, "");
  assert.deepEqual(r.events, []);
  for (const collection of ["bookings", "privateLessonChartRequests"]) {
    assert.ok(
      r.queryCalls.some(
        ([name, field, op, value]) =>
          name === collection &&
          field === "staffId" &&
          op === "==" &&
          value === "staff-1",
      ),
    );
    assert.ok(
      r.queryCalls.some(
        ([name, field, op, value]) =>
          name === collection &&
          field === "studioId" &&
          op === "==" &&
          value === "studio-1",
      ),
    );
  }
});
for (const [label, source, request] of [
  ["missing canonical booking", null, {}],
  ["changed source owner", { staffId: "staff-2" }, {}],
  ["cancelled source", { appStatus: "cancelled" }, {}],
  ["cancelled request", {}, { status: "cancelled" }],
  ["manual test", {}, { manualTest: true }],
  ["wrong member", {}, { memberId: "member-2" }],
  ["wrong date", {}, { lessonDate: "2026-10-10" }],
  ["invalid booking path", null, { bookingId: "../staffs/staff-1" }],
  ["unsafe URL", {}, { postUrl: "javascript:alert(1)" }],
  [
    "different chart request capability",
    {},
    { postUrl: CHART_URL.replace("r=request-1", "r=request-2") },
  ],
  [
    "forged request id field",
    {},
    {
      requestId: "request-2",
      postUrl: CHART_URL.replace("r=request-1", "r=request-2"),
    },
  ],
] as Array<[string, Record<string, unknown> | null, Record<string, unknown>]>) {
  test(`workspace omits ${label} and does not load its chart record`, async () => {
    const r = runtime({
      current: staff(),
      documents: {
        ...(source ? { "bookings/12345": booking(source) } : {}),
        "privateLessonChartRequests/request-1": chartRequest(request),
      },
    });
    const result = await r.handlers.getCoreInstructorWorkspaceHandler(call());
    assert.equal(result.privateTasks.length, 0);
    assert.ok(!r.reads.includes("privateLessonChartRecords/request-1"));
    assert.ok(!r.reads.some((path) => path.includes("..")));
    assert.deepEqual(r.events, []);
  });
}
test("workspace prefers the real source over fallback duplicates of a canonical event", async () => {
  const documents: Record<string, any> = {};
  for (const [id, requestId] of [
    ["excel_booking_1", "excel"],
    ["usage_booking_1", "usage"],
    ["12345", "canonical"],
  ]) {
    documents[`bookings/${id}`] = booking({ bookingId: id });
    documents[`privateLessonChartRequests/${requestId}`] = chartRequest({
      bookingId: id,
      postUrl: CHART_URL.replace("r=request-1", `r=${requestId}`),
    });
  }
  const r = runtime({ current: staff(), documents });
  const result = await r.handlers.getCoreInstructorWorkspaceHandler(call());
  assert.deepEqual(
    Array.from(result.privateTasks, (row: any) => row.id),
    ["canonical"],
  );
  assert.deepEqual(
    r.reads.filter((path) => path.startsWith("privateLessonChartRecords/")),
    ["privateLessonChartRecords/canonical"],
  );
  assert.equal(
    new URL(result.privateTasks[0].recordUrl).searchParams.get("r"),
    "canonical",
  );
});
test("workspace rejects a borrowed capability even when both requests bind to the same owned booking", async () => {
  const r = runtime({
    current: staff(),
    documents: {
      "bookings/12345": booking(),
      "privateLessonChartRequests/request-1": chartRequest(),
      "privateLessonChartRequests/request-2": chartRequest({
        requestId: "request-1",
      }),
    },
  });
  const result = await r.handlers.getCoreInstructorWorkspaceHandler(call());
  assert.deepEqual(
    Array.from(result.privateTasks, (row: any) => row.id),
    ["request-1"],
  );
  assert.ok(r.reads.includes("privateLessonChartRecords/request-1"));
  assert.ok(!r.reads.includes("privateLessonChartRecords/request-2"));
  assert.equal(result.privateTasks[0].recordUrl, CHART_URL);
  assert.deepEqual(r.events, []);
});

// Exercise the actual home/private task filter without browser startup. Only
// task-row markup is stubbed; status selection and terminal statuses stay real.
const instructorUiSource = fs.readFileSync(
  new URL("../../core/assets/core-instructor-access.js", import.meta.url),
  "utf8",
);
const instructorUiTree = ts.createSourceFile(
  "core-instructor-access.js",
  instructorUiSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.JS,
);
const rendererDeclarations = instructorUiTree.statements.filter(
  (node: any) =>
    (ts.isFunctionDeclaration(node) &&
      ["renderWorkspace", "escapeHtml"].includes(node.name?.text)) ||
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration: any) =>
          declaration.name.getText(instructorUiTree) === "TERMINAL_STATUSES",
      )),
);
assert.equal(
  rendererDeclarations.length,
  3,
  "Expected real renderer, escaping and terminal-status declarations",
);
const rendererCode = rendererDeclarations
  .map((node: any) => node.getText(instructorUiTree))
  .join("\n");
function renderedTaskIds(workspace: any, route: "home" | "private"): string[] {
  const ids: string[] = [];
  const renderer = vm.runInNewContext(`${rendererCode}\nrenderWorkspace;`, {
    taskMarkup(task: any) {
      ids.push(task.id);
      return "<li>Test task</li>";
    },
  });
  renderer(
    { innerHTML: "" },
    workspace,
    { staffName: "Test Instructor" },
    route,
  );
  return ids;
}

async function workspaceWithRecord(
  record: Record<string, any> | null,
  requestOverrides: Record<string, unknown> = {},
) {
  const r = runtime({
    current: staff(),
    documents: {
      "bookings/12345": booking(),
      "privateLessonChartRequests/request-1": chartRequest(requestOverrides),
      ...(record
        ? {
            "privateLessonChartRecords/request-1": {
              recordId: "request-1",
              requestId: "request-1",
              bookingId: "12345",
              memberId: "member-1",
              staffId: "staff-1",
              studioId: "studio-1",
              lessonDate: DATE,
              ...record,
            },
          }
        : {}),
    },
  });
  const result = await r.handlers.getCoreInstructorWorkspaceHandler(call());
  assert.equal(result.privateTasks.length, 1);
  assert.deepEqual(r.events, []);
  return result;
}

const sentRecordMarkers: Array<[string, Record<string, any>]> = [
  ["public approval sent status", { publicReportApproval: { status: "sent" } }],
  [
    "legacy public approval sentAt",
    {
      publicReportApproval: {
        status: "pending",
        sentAt: { seconds: AUTH_TIME },
      },
    },
  ],
  ["legacy publicReportSentAt", { publicReportSentAt: { seconds: AUTH_TIME } }],
  ["sent revision", { sentRevision: "revision-1" }],
];
for (const [label, marker] of sentRecordMarkers) {
  test(`workspace ${label} proves delivery and excludes a legacy real-model report from home pending`, async () => {
    const result = await workspaceWithRecord(
      {
        gptStatus: "published",
        postSubmittedAt: { seconds: AUTH_TIME },
        report: { status: "pending" },
        ...marker,
      },
      { postStatus: "submitted" },
    );
    assert.equal(
      result.privateTasks[0].status,
      "delivered",
      "Delivery evidence outranks review, submission and stale pending status",
    );
    assert.deepEqual(renderedTaskIds(result, "home"), []);
    assert.deepEqual(renderedTaskIds(result, "private"), ["request-1"]);
    assert.equal(result.privateTasks[0].recordUrl, CHART_URL);
    assert.equal(result.privateTasks[0].surveyUrl, "");
    assert.equal(result.privateTasks[0].reportUrl, "");
  });
}
for (const gptStatus of ["draft_created", "approved", "published"]) {
  test(`workspace ${gptStatus} alone is report review, never delivery proof`, async () => {
    const result = await workspaceWithRecord({
      gptStatus,
      publicReportApproval: { status: "approved", sentAt: null },
      publicReportSentAt: null,
      sentRevision: "",
      report: { status: "pending" },
    });
    assert.equal(result.privateTasks[0].status, "report_review");
    assert.deepEqual(renderedTaskIds(result, "home"), ["request-1"]);
    assert.deepEqual(renderedTaskIds(result, "private"), ["request-1"]);
  });
}
test("workspace report review takes precedence over submission and legacy report status", async () => {
  const result = await workspaceWithRecord(
    {
      gptStatus: "draft_created",
      postSubmittedAt: { seconds: AUTH_TIME },
      report: { status: "pending" },
    },
    { postStatus: "submitted" },
  );
  assert.equal(result.privateTasks[0].status, "report_review");
});
for (const [label, record, request] of [
  [
    "own record postSubmittedAt",
    { postSubmittedAt: { seconds: AUTH_TIME }, report: { status: "pending" } },
    {},
  ],
  ["request submitted without a record", null, { postStatus: "submitted" }],
  [
    "request submitted over stale record pending",
    { report: { status: "pending" } },
    { postStatus: "submitted" },
  ],
] as Array<[string, Record<string, any> | null, Record<string, unknown>]>) {
  test(`workspace ${label} maps to submitted and remains in home pending`, async () => {
    const result = await workspaceWithRecord(record, request);
    assert.equal(result.privateTasks[0].status, "submitted");
    assert.deepEqual(renderedTaskIds(result, "home"), ["request-1"]);
  });
}
for (const [label, record, expected] of [
  ["missing record", null, "pending"],
  ["empty record", {}, "pending"],
  ["legacy report status", { report: { status: "recording" } }, "recording"],
  [
    "empty sent evidence",
    {
      publicReportApproval: { status: "pending", sentAt: null },
      publicReportSentAt: null,
      sentRevision: "",
    },
    "pending",
  ],
] as Array<[string, Record<string, any> | null, string]>) {
  test(`workspace preserves the ${label} fallback without inventing delivery`, async () => {
    const result = await workspaceWithRecord(record);
    assert.equal(result.privateTasks[0].status, expected);
    assert.deepEqual(renderedTaskIds(result, "home"), ["request-1"]);
  });
}
for (const [label, identity] of [
  ["different staff", { staffId: "staff-2" }],
  ["different studio", { studioId: "studio-2" }],
] as Array<[string, Record<string, string>]>) {
  test(`workspace ignores sent/review/submitted evidence belonging to ${label}`, async () => {
    const result = await workspaceWithRecord({
      ...identity,
      publicReportApproval: { status: "sent", sentAt: { seconds: AUTH_TIME } },
      publicReportSentAt: { seconds: AUTH_TIME },
      sentRevision: "revision-1",
      gptStatus: "published",
      postSubmittedAt: { seconds: AUTH_TIME },
      report: { status: "delivered" },
    });
    assert.equal(result.privateTasks[0].status, "pending");
    assert.deepEqual(renderedTaskIds(result, "home"), ["request-1"]);
  });
}

test("workspace fails closed at the query cap rather than returning a partial source set", async () => {
  const documents = Object.fromEntries(
    Array.from({ length: 200 }, (_, index) => [
      `bookings/${index}`,
      booking({ bookingId: String(index) }),
    ]),
  );
  const r = runtime({ current: staff(), documents });
  await assert.rejects(r.handlers.getCoreInstructorWorkspaceHandler(call()), {
    code: "PERMISSION_DENIED",
  });
  assert.deepEqual(r.reads, []);
});
