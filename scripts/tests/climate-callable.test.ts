import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import * as access from "../../firebase/kangsain-functions/functions/src/security/coreInstructorAccess";
import * as errors from "../../firebase/kangsain-functions/functions/src/utils/errors";
import * as client from "../../firebase/kangsain-functions/functions/src/climate/thinqClient";
import * as service from "../../firebase/kangsain-functions/functions/src/climate/climateService";

const require = createRequire(new URL("../../firebase/kangsain-functions/functions/package.json", import.meta.url));
const { HttpsError } = require("firebase-functions/v2/https");
const ts = require("typescript");
function compile(relative: string, imports: Record<string, unknown>, suffix = "") {
  const source = fs.readFileSync(new URL(`../../firebase/kangsain-functions/functions/src/${relative}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {} as any, require: (name: string) => {
    if (!Object.hasOwn(imports, name)) throw new Error(`Unmocked import ${name}`);
    return imports[name];
  }, Date, Buffer, JSON, console: { log() { throw new Error("Unexpected logging"); } } };
  vm.runInNewContext(output + suffix, context);
  return context.exports;
}
function harness(staff: any = null, dashboard?: (actor: service.ClimateActor, data: unknown) => Promise<unknown>) {
  const rows = new Map<string, any>(); let reads = 0, secrets = 0; let serial = Promise.resolve();
  const ref = (path: string): any => ({ path, async get() { reads++; const value = rows.get(path); return {
    exists: value !== undefined, data: () => value === undefined ? undefined : structuredClone(value),
  }; } });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (fn: any) => {
      const previous = serial; let release: () => void = () => {};
      serial = new Promise<void>(r => { release = r; }); await previous;
      const writes: (() => void)[] = [];
      try {
        const tx = {
          get: (r: any) => r.get(),
          create: (r: any, value: any) => writes.push(() => { assert.ok(!rows.has(r.path)); rows.set(r.path, structuredClone(value)); }),
          set: (r: any, value: any, opts?: any) => writes.push(() => rows.set(r.path, structuredClone(opts?.merge ? { ...rows.get(r.path), ...value } : value))),
          update: (r: any, value: any) => writes.push(() => rows.set(r.path, structuredClone({ ...rows.get(r.path), ...value }))),
        };
        const value = await fn(tx); for (const write of writes) write(); return value;
      } finally { release(); }
    },
  };
  const guards = compile("security/authGuards.ts", {
    "../utils/errors": errors, "./coreInstructorAccess": access,
    "../firestore/staffRepository": { getStaffByUid: async () => staff, getStaffByEmail: async () => staff },
  });
  const module = compile("climate/climateCallables.ts", {
    "node:crypto": { createHash }, "firebase-functions/params": { defineSecret: () => ({ value() {
      secrets++;
      if (dashboard) return JSON.stringify({ pat: `thinqpat_${"synthetic".repeat(6)}`, clientId: "synthetic-core-client",
        allowedDeviceIds: ["qa-device"], controlsEnabled: false });
      throw new Error("SYNTHETIC_SECRET_MUST_NOT_BE_READ");
    } }) },
    "firebase-functions/v2/https": { HttpsError }, "../config/firebase": { db }, "../security/authGuards": guards,
    "../utils/errors": errors, "./climateService": dashboard ? { ...service, ClimateService: class { dashboard = dashboard; } } : service,
    "./thinqClient": client,
  }, "\nexports.TestStore = FirestoreClimateStore;");
  return { rows, store: new module.TestStore(), handler: module.climateHandler, reads: () => reads, secrets: () => secrets };
}
const fresh = Math.floor(Date.now() / 1000);
const request = { auth: { uid: "qa", token: { email: "qa@example.invalid", auth_time: fresh } }, data: {} };
for (const [name, staff, req, expected] of [
  ["unauthenticated", null, { data: {} }, "unauthenticated"],
  ["missing canonical staff", null, request, "permission-denied"],
  ["inactive owner", { role: "owner", active: false }, request, "permission-denied"],
  ["viewer", { role: "viewer", active: true }, request, "permission-denied"],
  ["incomplete instructor", { role: "instructor", active: true }, request, "permission-denied"],
  ["revoked manager", { uid: "qa", role: "manager", active: true, coreAuthAfter: fresh + 10 }, request, "unauthenticated"],
] as const) test(`callable ${name} denied before PAT/provider`, async () => {
  const h = harness(staff);
  for (const action of ["dashboard", "control", "reconcile"]) {
    for (const data of [{}, { deviceIds: ["qa-device"] }]) {
      await assert.rejects(() => h.handler({ ...req, data }, action), (e: any) => e.code === expected);
    }
  }
  assert.equal(h.secrets(), 0); assert.equal(h.reads(), 0);
});
for (const role of ["owner", "manager"]) test(`fresh canonical ${role} reaches server configuration, raw secret errors sanitized`, async () => {
  const h = harness({ uid: "qa", staffId: "qa", role, active: true, coreAuthAfter: fresh });
  await assert.rejects(() => h.handler(request, "dashboard"), (e: any) => e.code === "failed-precondition" && !e.message.includes("SYNTHETIC"));
  assert.equal(h.secrets(), 1);
});
const instructor = { uid: "qa", staffId: "qa-staff", studioId: "qa-studio", role: "instructor", active: true,
  employmentStatus: "current", employmentSource: "studiomate_staff_tab_browser_scan", coreAccessEnabled: true,
  coreMustChangePassword: false, coreAuthAfter: fresh };
const instructorRequest = { auth: { uid: "qa", token: { email: "qa@example.invalid", auth_time: fresh,
  staffId: "qa-staff", studioId: "qa-studio", role: "instructor" } }, data: {} };
for (const action of ["dashboard", "control", "reconcile"] as const) {
  test(`eligible instructor reaches ${action} configuration through the same canonical authorization`, async () => {
    const h = harness(instructor);
    await assert.rejects(() => h.handler(instructorRequest, action), (e: any) =>
      e.code === "failed-precondition" && !e.message.includes("SYNTHETIC"));
    assert.equal(h.secrets(), 1);
  });
}
for (const [label, patch, authPatch] of [
  ["inactive", { active: false }, {}],
  ["former", { employmentStatus: "former" }, {}],
  ["unverified source", { employmentSource: "manual" }, {}],
  ["disabled access", { coreAccessEnabled: false }, {}],
  ["missing activation", { coreAccessEnabled: undefined }, {}],
  ["first login", { coreMustChangePassword: true }, {}],
  ["missing password completion", { coreMustChangePassword: undefined }, {}],
  ["revoked session", { coreAuthAfter: fresh + 10 }, {}],
  ["wrong canonical uid", { uid: "other" }, {}],
  ["wrong claimed staff", {}, { staffId: "other" }],
  ["wrong claimed studio", {}, { studioId: "other" }],
  ["spoofed manager role", {}, { role: "manager" }],
] as const) test(`${label} instructor cannot read, control or reconcile before PAT/provider access`, async () => {
  const h = harness({ ...instructor, ...patch });
  const request = { ...instructorRequest, auth: { ...instructorRequest.auth,
    token: { ...instructorRequest.auth.token, ...authPatch } } };
  for (const action of ["dashboard", "control", "reconcile"]) {
    await assert.rejects(() => h.handler(request, action), (e: any) =>
      ["permission-denied", "unauthenticated"].includes(e.code));
  }
  assert.equal(h.secrets(), 0); assert.equal(h.reads(), 0);
});
function command(): service.ClimateCommand { const now = new Date().toISOString(); return { commandId: randomUUID(), deviceId: "qa-device", uid: "qa", staffId: "qa", field: "power", value: "POWER_ON", expectedVersion: "a".repeat(64), fingerprint: "fixture-fingerprint", status: "pending", createdAt: now, updatedAt: now, errorCode: null }; }
test("actual store concurrent claim has one winning command and per-device lock", async () => {
  const h = harness(), c = command(), other = command();
  const results = await Promise.allSettled([h.store.claim(c), h.store.claim(c), h.store.claim(other)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 2);
  assert.equal(h.rows.get(`facilityClimateCommands/${other.commandId}`), undefined);
  assert.equal((await h.store.pending(c.deviceId)).commandId, c.commandId);
});
test("actual store dispatch authorization fenced by age, owner and one-shot marker", async () => {
  const h = harness(), c = command(); await h.store.claim(c); await h.store.authorizeDispatch(c);
  await assert.rejects(() => h.store.authorizeDispatch(c), /command_expired/);
  const g = harness(), d = command(); d.createdAt = new Date(Date.now() - 61_000).toISOString(); await g.store.claim(d);
  await assert.rejects(() => g.store.authorizeDispatch(d), /command_expired/);
});
test("actual finish returns persisted concurrent resolution, never locally invented status", async () => {
  const h = harness(), c = command(); await h.store.claim(c);
  const winner = await h.store.finish({ ...c, status: "acknowledged" });
  const late = await h.store.finish({ ...c, status: "verified" });
  assert.equal(winner.status, "acknowledged"); assert.equal(late.status, "acknowledged");
  assert.equal(await h.store.pending(c.deviceId), null);
});
test("unknown keeps lock and explicit resolution releases it, preserving ledger", async () => {
  const h = harness(), c = command(); await h.store.claim(c);
  await h.store.finish({ ...c, status: "unknown" }); assert.equal((await h.store.pending(c.deviceId)).status, "unknown");
  await h.store.finish({ ...c, status: "verified" }); assert.equal(await h.store.pending(c.deviceId), null);
  assert.equal((await h.store.getCommand(c.commandId)).status, "verified");
});
test("actual read throttle serializes concurrent reads for same user", async () => {
  const h = harness(); const values = await Promise.allSettled([h.store.throttleRead("qa"), h.store.throttleRead("qa")]);
  assert.equal(values.filter(v => v.status === "fulfilled").length, 1);
});

test("dashboard callable forwards full and targeted request data after unchanged manager authorization", async () => {
  const seen: { actor: service.ClimateActor; data: unknown }[] = [];
  const h = harness({ uid: "qa", staffId: "qa", role: "manager", active: true, coreAuthAfter: fresh }, async (actor, data) => {
    seen.push({ actor, data });
    return { checkedAt: new Date().toISOString(), devices: [], partial: Boolean((data as any)?.deviceIds) };
  });
  for (const data of [undefined, {}, { deviceIds: ["qa-device"] }]) {
    const result = await h.handler({ ...request, data }, "dashboard");
    assert.equal(result.partial, Boolean(data?.deviceIds));
    assert.equal(seen.at(-1)!.data, data);
    assert.equal(seen.at(-1)!.actor.uid, "qa"); assert.equal(seen.at(-1)!.actor.staffId, "qa");
  }
  assert.equal(h.secrets(), 3);
});

for (const interval of [2000, 10000]) test(`actual ${interval}ms read guard uses the same UID document for full and targeted reads`, async () => {
  const h = harness();
  await h.store.throttleRead("qa", interval);
  const keys = [...h.rows.keys()];
  assert.equal(keys.length, 1); assert.match(keys[0], /^facilityClimateGuards\/read_/);
  await assert.rejects(() => h.store.throttleRead("qa", 2000), /rate_limited/);
  await assert.rejects(() => h.store.throttleRead("qa"), /rate_limited/);
  assert.deepEqual([...h.rows.keys()], keys);
  h.rows.get(keys[0]).lastReadAt = Date.now() - 3000;
  await assert.rejects(() => h.store.throttleRead("qa"), /rate_limited/);
  await h.store.throttleRead("qa", 2000);
  h.rows.get(keys[0]).lastReadAt = Date.now() - 11000;
  await h.store.throttleRead("qa");
  await h.store.throttleRead("other", 2000);
  assert.equal(h.rows.size, 2, "different authenticated UIDs keep independent guards");
});

test("actual full and targeted read guards cannot race around the shared UID lock", async () => {
  const h = harness();
  const values = await Promise.allSettled([h.store.throttleRead("qa", 2000), h.store.throttleRead("qa"), h.store.throttleRead("qa", 2000)]);
  assert.equal(values.filter(v => v.status === "fulfilled").length, 1); assert.equal(h.rows.size, 1);
});

for (const interval of [0, -1, 1, 1999, 2000.5, 9999, 10001, NaN, Infinity, null, "2000"]) {
  test(`invalid internal throttle interval ${String(interval)} fails before any store access`, async () => {
    const h = harness();
    await assert.rejects(() => h.store.throttleRead("qa", interval), /invalid_request/);
    assert.equal(h.reads(), 0); assert.equal(h.rows.size, 0);
  });
}
