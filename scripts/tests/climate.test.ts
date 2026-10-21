import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ClimateError, ThinQClient, controlPayload, parseThinQConfig, projectDevice } from "../../firebase/kangsain-functions/functions/src/climate/thinqClient";
import { ClimateCommand, ClimateService, ClimateStore, parseControlInput } from "../../firebase/kangsain-functions/functions/src/climate/climateService";

const conf = { pat: `thinqpat_${"synthetic".repeat(6)}`, clientId: "synthetic-core-client", allowedDeviceIds: ["qa-aircon"], controlsEnabled: true };
const descriptor = { deviceId: "qa-aircon", deviceInfo: { alias: "QA 에어컨", deviceType: "DEVICE_AIR_CONDITIONER", modelName: "QA" } };
const enumeration = (values: unknown[]) => ({ type: "enum", mode: ["r", "w"], value: { w: values } });
const profile = { property: {
  operation: { airConOperationMode: enumeration(["POWER_ON", "POWER_OFF"]) },
  airConJobMode: { currentJobMode: enumeration(["COOL", "HEAT", "AUTO", "FAN", "AIR_DRY"]) },
  airFlow: { windStrength: enumeration(["LOW", "MID", "HIGH", "AUTO"]) },
  temperature: {
    targetTemperature: { type: "range", mode: ["r", "w"], value: { w: { min: 16, max: 30, step: .5 } } },
    autoTargetTemperature: { type: "range", mode: ["w"], value: { w: { min: 18, max: 30, step: .5 } } },
  },
  windDirection: { rotateUpDown: { type: "boolean", mode: ["r", "w"], value: { w: [false, true] } } },
} };
function state() { return { runState: { currentState: "NORMAL" }, operation: { airConOperationMode: "POWER_OFF" }, airConJobMode: { currentJobMode: "COOL" },
  temperature: { unit: "C", currentTemperature: 25, targetTemperature: 24, minTargetTemperature: 16, maxTargetTemperature: 30 },
  airFlow: { windStrength: "LOW" }, windDirection: { rotateUpDown: false } }; }
function view(s = state()) { return projectDevice(descriptor, profile, s, new Date().toISOString()); }
const actor = { uid: "qa-owner", staffId: "qa-staff" };
function input() { return { commandId: randomUUID(), deviceId: "qa-aircon", expectedVersion: view().version, field: "power", value: "POWER_ON" }; }
class Store implements ClimateStore {
  rows = new Map<string, ClimateCommand>(); locked: string | null = null; failFinish = false;
  throttles: { uid: string; minimumIntervalMs: number }[] = [];
  async throttleRead(uid: string, minimumIntervalMs = 10000) { this.throttles.push({ uid, minimumIntervalMs }); }
  async getCommand(id: string) { return this.rows.has(id) ? structuredClone(this.rows.get(id)!) : null; }
  async pending() { return this.locked ? this.getCommand(this.locked) : null; }
  async claim(row: ClimateCommand) {
    if (this.rows.has(row.commandId)) return this.rows.get(row.commandId)!;
    if (this.locked) throw new ClimateError("device_busy");
    this.rows.set(row.commandId, structuredClone(row)); this.locked = row.commandId; return null;
  }
  async authorizeDispatch(row: ClimateCommand) {
    const current = this.rows.get(row.commandId)!;
    if (this.locked !== row.commandId || current.status !== "pending" || current.dispatchStartedAt
      || Date.now() - Date.parse(current.createdAt) >= 60_000) throw new ClimateError("command_expired");
    current.dispatchStartedAt = new Date().toISOString();
  }
  async finish(row: ClimateCommand) {
    if (this.failFinish) throw new Error("fixture persistence failure");
    const current = this.rows.get(row.commandId)!;
    if (["verified", "no_change", "rejected", "acknowledged"].includes(current.status)) return current;
    this.rows.set(row.commandId, structuredClone(row));
    if (["verified", "no_change", "rejected", "acknowledged"].includes(row.status)) this.locked = null;
    return row;
  }
}
function fixture(options: { dispatch?: "timeout" | "reject" | "lag"; readFailure?: boolean; disabled?: boolean } = {}) {
  const store = new Store(); let current = state(); let writes = 0; let reads = 0;
  const client = {
    config: { ...conf, controlsEnabled: !options.disabled }, devices: async () => [descriptor],
    read: async () => { if (options.readFailure) throw new ClimateError("connection_failed"); return view(current); },
    readById: async () => { reads++; if (options.readFailure) throw new ClimateError("connection_failed"); return view(current); },
    control: async (_id: string, payload: any) => {
      writes++;
      if (options.dispatch === "timeout") throw new ClimateError("connection_failed", true);
      if (options.dispatch === "reject") throw new ClimateError("authorization_failed");
      if (options.dispatch !== "lag") for (const [resource, values] of Object.entries(payload)) Object.assign((current as any)[resource], values);
    },
  } as unknown as ThinQClient;
  return { store, service: new ClimateService(client, store), writes: () => writes, reads: () => reads,
    change: (fn: (s: ReturnType<typeof state>) => void) => fn(current) };
}

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function httpFixture(options: { count?: number; dispatch?: "timeout" | "lag"; failPostRead?: boolean } = {}) {
  const descriptors = Array.from({ length: options.count || 1 }, (_, i) => ({ ...descriptor,
    deviceId: i ? `qa-aircon-${i}` : descriptor.deviceId }));
  const states = new Map(descriptors.map(d => [d.deviceId, state()]));
  const posted = new Set<string>(), requests: { path: string; method: string }[] = [];
  const http = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname, id = path.split("/")[2];
    requests.push({ path, method: init.method! });
    let response: unknown;
    if (path === "/devices") response = descriptors;
    else if (path.endsWith("/profile")) response = profile;
    else if (path.endsWith("/control")) {
      posted.add(id);
      if (options.dispatch === "timeout") throw new Error("synthetic-control-timeout");
      if (options.dispatch !== "lag") for (const [resource, values] of Object.entries(JSON.parse(String(init.body)))) {
        Object.assign((states.get(id)! as any)[resource], values);
      }
      response = {};
    } else if (path.endsWith("/state")) {
      if (posted.has(id) && options.failPostRead) throw new Error("synthetic-readback-failure");
      response = states.get(id);
    } else throw new Error("Unexpected synthetic path");
    return new Response(JSON.stringify({ response }));
  }) as typeof fetch;
  const store = new Store(), client = new ThinQClient({ ...conf, allowedDeviceIds: descriptors.map(d => d.deviceId) }, http);
  return { store, client, service: new ClimateService(client, store), requests, descriptors, states };
}

test("valid connection requires exact nonempty device allowlist and stable client ID", () => {
  assert.equal(parseThinQConfig(JSON.stringify(conf)).controlsEnabled, true);
  assert.equal(parseThinQConfig(JSON.stringify({ ...conf, controlsEnabled: undefined })).controlsEnabled, false);
  for (const patch of [{ pat: "missing" }, { clientId: "bad space" }, { allowedDeviceIds: [] }, { allowedDeviceIds: ["../x"] }, { allowedDeviceIds: ["a", "a"] }, { allowedDeviceIds: Array(17).fill("a") }]) {
    assert.throws(() => parseThinQConfig(JSON.stringify({ ...conf, ...patch })), /not_configured/);
  }
});
test("only supported profile write properties appear; boolean absent means no control", () => {
  assert.equal(view().controls.some(c => c.field === "swingHorizontal"), false);
  assert.equal(view().controls.some(c => c.field === "swingVertical"), true);
  assert.deepEqual(controlPayload(view(), "power", "POWER_ON"), { operation: { airConOperationMode: "POWER_ON" } });
});
for (const value of [15, 31, 24.1, "24", null, NaN, Infinity]) test(`reject invalid temperature ${String(value)}`, () => {
  assert.throws(() => controlPayload(view(), "targetTemperature", value), /invalid_value/);
});
test("mode-specific range, unsupported mode, Fahrenheit and dual-set are fail closed", () => {
  const s = state(); s.airConJobMode.currentJobMode = "AUTO";
  assert.throws(() => controlPayload(view(s), "targetTemperature", 17), /invalid_value/);
  s.airConJobMode.currentJobMode = "FAN";
  assert.throws(() => controlPayload(view(s), "targetTemperature", 24), /unsupported_control/);
  s.temperature.unit = "F"; assert.equal(view(s).available, false);
  s.temperature.unit = "C"; (s as any).twoSetTemperature = { twoSetEnabled: true };
  assert.throws(() => controlPayload(view(s), "targetTemperature", 24), /unsupported_control/);
});
test("sensor changes do not invalidate control version but power/mode changes do", () => {
  const s = state(); s.temperature.currentTemperature = 27;
  assert.equal(view().version, view(s).version); s.operation.airConOperationMode = "POWER_ON";
  assert.notEqual(view().version, view(s).version);
});
test("clipped temperature bounds preserve profile step origin", () => {
  const p = structuredClone(profile); p.property.temperature.targetTemperature.value.w.step = 1;
  const s = state(); s.temperature.minTargetTemperature = 16.5; s.temperature.maxTargetTemperature = 29.5;
  const device = projectDevice(descriptor, p, s, new Date().toISOString());
  assert.equal(device.controls.find(c => c.field === "targetTemperature")!.min, 17);
  assert.deepEqual(controlPayload(device, "targetTemperature", 17), { temperature: { targetTemperature: 17 } });
  assert.throws(() => controlPayload(device, "targetTemperature", 17.5), /invalid_value/);
});
for (const patch of [{ commandId: "../x" }, { deviceId: "../x" }, { field: "__proto__" }, { expectedVersion: "stale" }, { value: {} }, { url: "https://elsewhere.invalid" }]) test(`reject arbitrary command input ${Object.keys(patch)[0]}`, () => {
  assert.throws(() => parseControlInput({ ...input(), ...patch }), /invalid_request/);
});
test("dispatch once and read back; duplicate same key never POSTs again", async () => {
  const f = fixture(); const i = input();
  assert.equal((await f.service.control(actor, i)).status, "verified");
  assert.equal((await f.service.control(actor, i)).status, "verified");
  assert.equal(f.writes(), 1); assert.equal(f.store.locked, null); assert.equal(f.reads(), 2);
});
test("simultaneous same command and different commands cannot double dispatch", async () => {
  const f = fixture(); const i = input();
  await Promise.allSettled([f.service.control(actor, i), f.service.control(actor, i), f.service.control(actor, input())]);
  assert.equal(f.writes(), 1);
});
test("same key cannot be reused for another actor/value", async () => {
  const f = fixture(); const i = input(); await f.service.control(actor, i);
  await assert.rejects(() => f.service.control({ ...actor, uid: "other" }, i), /command_conflict/);
  await assert.rejects(() => f.service.control(actor, { ...i, value: "POWER_OFF" }), /command_conflict/);
});
test("stale version, invalid range and source failure stop before dispatch", async () => {
  const f = fixture(); const i = input(); f.change(s => { s.airConJobMode.currentJobMode = "HEAT"; });
  assert.equal((await f.service.control(actor, i)).errorCode, "state_changed");
  assert.equal(f.writes(), 0);
  const g = fixture({ readFailure: true }); assert.equal((await g.service.control(actor, input())).status, "rejected"); assert.equal(g.writes(), 0);
});
test("disabled and unknown devices are rejected before claim/provider", async () => {
  const f = fixture({ disabled: true }); await assert.rejects(() => f.service.control(actor, input()), /control_disabled/);
  assert.equal(f.store.rows.size, 0);
  const g = fixture(); await assert.rejects(() => g.service.control(actor, { ...input(), deviceId: "not-allowed" }), /device_not_allowed/);
  assert.equal(g.reads(), 0);
});
test("no-op request is recorded without sending", async () => {
  const f = fixture(); assert.equal((await f.service.control(actor, { ...input(), value: "POWER_OFF" })).status, "no_change"); assert.equal(f.writes(), 0);
});
for (const dispatch of ["timeout", "lag"] as const) test(`${dispatch} remains locked, duplicate never resends, read-only reconcile before explicit acknowledgement`, async () => {
  const f = fixture({ dispatch }); const i = input(); const first = await f.service.control(actor, i);
  assert.equal(first.status, dispatch === "timeout" ? "unknown" : "accepted");
  await f.service.control(actor, i); assert.equal(f.writes(), 1);
  await assert.rejects(() => f.service.control(actor, input()), /device_busy/);
  const q = { commandId: i.commandId, deviceId: i.deviceId, acknowledge: true };
  assert.equal((await f.service.reconcile(actor, q)).status, first.status);
  f.store.rows.get(i.commandId)!.createdAt = new Date(Date.now() - 121_000).toISOString();
  assert.equal((await f.service.reconcile(actor, { ...q, acknowledge: false })).status, first.status);
  assert.equal((await f.service.reconcile(actor, q)).status, "acknowledged");
  assert.equal(f.writes(), 1); assert.equal(f.store.locked, null);
});
test("late readback verifies without acknowledgement or resend", async () => {
  const f = fixture({ dispatch: "lag" }); const i = input(); await f.service.control(actor, i);
  f.store.rows.get(i.commandId)!.createdAt = new Date(Date.now() - 121_000).toISOString();
  f.change(s => { s.operation.airConOperationMode = "POWER_ON"; });
  assert.equal((await f.service.reconcile(actor, { commandId: i.commandId, deviceId: i.deviceId, acknowledge: false })).status, "verified");
  assert.equal(f.writes(), 1);
});
test("transaction winning reconciliation state is returned, not a stale local success", async () => {
  const f = fixture({ dispatch: "lag" }); const i = input(); await f.service.control(actor, i);
  f.store.rows.get(i.commandId)!.createdAt = new Date(Date.now() - 121_000).toISOString();
  f.change(s => { s.operation.airConOperationMode = "POWER_ON"; });
  const finish = f.store.finish.bind(f.store);
  f.store.finish = async row => {
    const winner = f.store.rows.get(row.commandId)!; winner.status = "acknowledged"; f.store.locked = null;
    return finish(row);
  };
  const result = await f.service.reconcile(actor, { commandId: i.commandId, deviceId: i.deviceId, acknowledge: false });
  assert.equal(result.status, "acknowledged");
});
test("delayed preflight beyond dispatch deadline cannot POST after reconciliation/unlock", async () => {
  const f = fixture(); const i = input();
  f.change(() => {});
  const authorize = f.store.authorizeDispatch.bind(f.store);
  f.store.authorizeDispatch = async row => {
    f.store.rows.get(row.commandId)!.createdAt = new Date(Date.now() - 121_000).toISOString();
    f.store.rows.get(row.commandId)!.status = "acknowledged"; f.store.locked = null;
    await authorize(row);
  };
  assert.equal((await f.service.control(actor, i)).status, "acknowledged");
  assert.equal(f.writes(), 0);
});
test("persistence failure after POST leaves original pending claim", async () => {
  const f = fixture(); f.store.failFinish = true; const i = input();
  await assert.rejects(() => f.service.control(actor, i));
  assert.equal(f.store.rows.get(i.commandId)?.status, "pending");
  await f.service.control(actor, i); assert.equal(f.writes(), 1);
});
test("provider rejection is not delivery; it does not leave unsafe active lock", async () => {
  const f = fixture({ dispatch: "reject" }); assert.equal((await f.service.control(actor, input())).status, "rejected"); assert.equal(f.store.locked, null);
});
test("dashboard isolates failed device and disabled controls", async () => {
  const f = fixture({ readFailure: true }); const data = await f.service.dashboard(actor);
  assert.equal(data.devices[0].available, false); assert.deepEqual(data.devices[0].controls, []);
  const g = fixture({ disabled: true }); assert.deepEqual((await g.service.dashboard(actor)).devices[0].controls, []);
});

test("default and explicit full dashboards remain full, targeted reads touch only requested devices", async () => {
  const f = httpFixture({ count: 8 });
  for (const data of [undefined, {}]) {
    const result = await f.service.dashboard(actor, data);
    assert.equal(result.partial, false); assert.equal(result.devices.length, 8);
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  }
  f.requests.length = 0;
  const ids = ["qa-aircon-6", "qa-aircon"];
  const result = await f.service.dashboard(actor, { deviceIds: ids });
  assert.equal(result.partial, true);
  assert.deepEqual(result.devices.map(d => d.deviceId), ids);
  assert.deepEqual(f.requests.map(r => r.path), ["/devices/qa-aircon-6/state", "/devices/qa-aircon/state"]);
  assert.deepEqual(f.store.throttles, [{ uid: actor.uid, minimumIntervalMs: 10000 },
    { uid: actor.uid, minimumIntervalMs: 10000 }, { uid: actor.uid, minimumIntervalMs: 2000 }]);
});

test("cold full dashboard uses 17 HTTP requests, warm full uses 8 state-only requests", async () => {
  const f = httpFixture({ count: 8 });
  await f.service.dashboard(actor);
  assert.equal(f.requests.length, 17);
  assert.equal(f.requests.filter(r => r.path.endsWith("/profile")).length, 8);
  assert.equal(f.requests.filter(r => r.path.endsWith("/state")).length, 8);
  f.requests.length = 0;
  await f.service.dashboard(actor);
  assert.equal(f.requests.length, 8);
  assert.ok(f.requests.every(r => r.method === "GET" && r.path.endsWith("/state")));
});

for (const count of [1, 8]) test(`targeted dashboard accepts ${count} unique allowlisted IDs and remains partial`, async () => {
  const f = httpFixture({ count: 8 }), ids = f.descriptors.slice(0, count).map(d => d.deviceId);
  const result = await f.service.dashboard(actor, { deviceIds: ids });
  assert.equal(result.partial, true); assert.equal(result.devices.length, count);
  assert.equal(f.requests.length, 1 + 2 * count);
  assert.deepEqual(result.devices.map(d => d.deviceId), ids);
  assert.equal(f.store.throttles[0].minimumIntervalMs, 2000);
});

const invalidDashboards = [null, false, true, 1, "", "qa-aircon", [], ["qa-aircon"],
  { extra: true }, { deviceIds: ["qa-aircon"], minimumIntervalMs: 0 }, { partial: true }, { uid: "other" },
  ...[undefined, null, "qa-aircon", 1, false, {}, [], Array(9).fill("qa-aircon"),
    ["qa-aircon", "qa-aircon"], ["../x"], [""], [1], [null], [false], [{}], Array(1)].map(deviceIds => ({ deviceIds }))];
invalidDashboards.forEach((data, index) => test(`invalid dashboard shape ${index + 1} fails before throttle and LG`, async () => {
  const f = httpFixture();
  await assert.rejects(() => f.service.dashboard(actor, data), /invalid_request/);
  assert.deepEqual(f.requests, []); assert.deepEqual(f.store.throttles, []);
}));

test("non-allowlisted targeted IDs fail before any LG call, including mixed valid/invalid targets", async () => {
  for (const ids of [["other"], ["qa-aircon", "other"]]) {
    const f = httpFixture();
    await assert.rejects(() => f.service.dashboard(actor, { deviceIds: ids }), /device_not_allowed/);
    assert.deepEqual(f.requests, []); assert.deepEqual(f.store.throttles, []);
  }
});

test("targeted dashboard preserves pending/disabled state and reports a missing allowlisted device as unavailable", async () => {
  const f = fixture({ disabled: true });
  const pending = { ...input(), ...actor, field: "power" as const, fingerprint: "fixture", status: "unknown" as const,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), errorCode: null };
  await f.store.claim(pending);
  const result = await f.service.dashboard(actor, { deviceIds: [descriptor.deviceId] });
  assert.equal(result.partial, true); assert.deepEqual(result.devices[0].controls, []);
  assert.deepEqual(result.devices[0].pendingCommand, { commandId: pending.commandId, status: "unknown" });
  const client = { config: conf, devices: async () => [], read: async () => { throw new Error("Must not read an unlisted device"); } } as unknown as ThinQClient;
  const missing = await new ClimateService(client, new Store()).dashboard(actor, { deviceIds: [descriptor.deviceId] });
  assert.equal(missing.partial, true); assert.equal(missing.devices.length, 1);
  assert.equal(missing.devices[0].deviceId, descriptor.deviceId); assert.equal(missing.devices[0].available, false);
  assert.equal(missing.devices[0].errorCode, "device_not_allowed");
});

test("four-worker dashboard fills free slots without wave barriers, preserves order and isolates read errors", { timeout: 3000 }, async () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...descriptor, deviceId: `qa-pool-${i}` }));
  const gates = new Map<string, ReturnType<typeof deferred<void>>>(), started: string[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];
  let active = 0, peak = 0, releaseAll = false;
  const waitFor = (count: number) => started.length >= count ? Promise.resolve()
    : new Promise<void>(resolve => waiters.push({ count, resolve }));
  const client = { config: { ...conf, allowedDeviceIds: rows.map(d => d.deviceId) }, devices: async () => rows,
    read: async (d: typeof descriptor) => {
      active++; peak = Math.max(peak, active); started.push(d.deviceId);
      const gate = deferred<void>(); gates.set(d.deviceId, gate);
      waiters.filter(w => started.length >= w.count).forEach(w => w.resolve());
      try {
        if (!releaseAll) await gate.promise;
        if (d.deviceId === "qa-pool-2") throw new ClimateError("connection_failed");
        return projectDevice(d, profile, state(), new Date().toISOString());
      } finally { active--; }
    } } as unknown as ThinQClient;
  const pending = new ClimateService(client, new Store()).dashboard(actor);
  try {
    await waitFor(4); assert.equal(active, 4); assert.equal(started.length, 4);
    gates.get("qa-pool-1")!.resolve(); await waitFor(5);
    assert.equal(started[4], "qa-pool-4"); assert.equal(active, 4);
  } finally { releaseAll = true; gates.forEach(gate => gate.resolve()); }
  const result = await pending;
  assert.equal(peak, 4); assert.equal(active, 0); assert.equal(result.partial, false);
  assert.deepEqual(result.devices.map(d => d.deviceId), rows.map(d => d.deviceId));
  assert.equal(result.devices[2].available, false); assert.equal(result.devices[2].errorCode, "connection_failed");
  assert.equal(result.devices.filter(d => d.available).length, 7);
});

for (const warm of [false, true]) test(`${warm ? "warm" : "cold"} control performs fresh preflight plus post-state only: exactly five HTTP requests`, async () => {
  const f = httpFixture();
  if (warm) { await f.client.readById(descriptor.deviceId, false); f.requests.length = 0; }
  const command = input(), result = await f.service.control(actor, command);
  assert.equal(result.status, "verified"); assert.equal(result.device!.values.power, "POWER_ON");
  assert.deepEqual(f.requests, [
    { path: "/devices", method: "GET" }, { path: "/devices/qa-aircon/profile", method: "GET" },
    { path: "/devices/qa-aircon/state", method: "GET" }, { path: "/devices/qa-aircon/control", method: "POST" },
    { path: "/devices/qa-aircon/state", method: "GET" },
  ]);
  await f.service.control(actor, command);
  assert.equal(f.requests.length, 5, "duplicate UUID does not read or dispatch again");
});

test("warm metadata cannot bypass a stale control version; no-change still requires three fresh reads", async () => {
  const f = httpFixture(); await f.client.readById(descriptor.deviceId, false); f.requests.length = 0;
  f.states.get(descriptor.deviceId)!.airConJobMode.currentJobMode = "HEAT";
  assert.equal((await f.service.control(actor, input())).status, "rejected");
  assert.deepEqual(f.requests.map(r => r.path), ["/devices", "/devices/qa-aircon/profile", "/devices/qa-aircon/state"]);
  const g = httpFixture();
  assert.equal((await g.service.control(actor, { ...input(), value: "POWER_OFF" })).status, "no_change");
  assert.equal(g.requests.length, 3); assert.ok(g.requests.every(r => r.method === "GET"));
});

for (const options of [{ dispatch: "timeout" as const }, { dispatch: "lag" as const }, { failPostRead: true }]) {
  test(`optimized readback does not invent success or retry on ${JSON.stringify(options)}`, async () => {
    const f = httpFixture(options), command = input(), result = await f.service.control(actor, command);
    assert.equal(result.status, options.dispatch === "timeout" ? "unknown" : "accepted");
    assert.equal(f.store.locked, command.commandId);
    assert.equal(f.requests.length, options.dispatch === "timeout" ? 4 : 5);
    await f.service.control(actor, command);
    assert.equal(f.requests.filter(r => r.method === "POST").length, 1);
    if (options.failPostRead) assert.equal(result.device, null);
  });
}

for (const first of ["profile", "state"]) test(`profile/state reads start together and settle both after early ${first} failure`, async () => {
  const calls: string[] = [], firstProfile = deferred<Response>(), firstState = deferred<Response>();
  let phase = 0;
  const client = new ThinQClient(conf, (async (url: string) => {
    const path = new URL(url).pathname; calls.push(path);
    if (phase === 0) return path.endsWith("/profile") ? firstProfile.promise : firstState.promise;
    return new Response(JSON.stringify({ response: path.endsWith("/profile") ? profile : state() }));
  }) as typeof fetch);
  const read = client.read(descriptor);
  let settled = false; void read.then(() => { settled = true; }, () => { settled = true; });
  assert.deepEqual(calls, ["/devices/qa-aircon/profile", "/devices/qa-aircon/state"]);
  const rejected = assert.rejects(read, /connection_failed/);
  (first === "profile" ? firstProfile : firstState).reject(new Error("synthetic-first-failure"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false, "a failed read cannot release its worker while the other GET is still pending");
  (first === "profile" ? firstState : firstProfile).reject(new Error("synthetic-second-failure"));
  await rejected;
  await new Promise<void>(resolve => setImmediate(resolve));
  phase = 1; calls.length = 0;
  await client.read(descriptor); await client.read(descriptor);
  assert.deepEqual(calls, ["/devices/qa-aircon/profile", "/devices/qa-aircon/state", "/devices/qa-aircon/state"]);
});
test("HTTP client has fixed destination/headers, caches only profile/list, no automatic mutation retry", async () => {
  const requests: any[] = [];
  const http = (async (url: string, options: any) => {
    requests.push({ url, ...options });
    if (options.method === "POST") throw new Error("SYNTHETIC_PRIVATE_ERROR");
    return new Response(JSON.stringify({ response: url.endsWith("/devices") ? [descriptor] : url.endsWith("/profile") ? profile : state() }));
  }) as typeof fetch;
  const client = new ThinQClient(conf, http); await client.readById("qa-aircon", false); await client.readById("qa-aircon", false);
  assert.equal(requests.filter(r => r.url.endsWith("/state")).length, 2);
  assert.equal(requests.filter(r => r.url.endsWith("/profile")).length, 1);
  assert.equal(requests[0].headers["x-message-id"].length, 22);
  assert.equal(requests[0].redirect, "error");
  await assert.rejects(() => client.control("qa-aircon", { operation: { airConOperationMode: "POWER_ON" } }), e => e instanceof ClimateError && e.uncertain && !e.message.includes("SYNTHETIC"));
  assert.equal(requests.filter(r => r.method === "POST").length, 1);
  assert.equal(requests.at(-1).headers["x-conditional-control"], "true");
});
for (const status of [401, 403, 429, 500]) test(`provider ${status} is sanitized with uncertainty only for server failure`, async () => {
  const client = new ThinQClient(conf, (async () => new Response("SYNTHETIC_PRIVATE_ERROR", { status })) as typeof fetch);
  await assert.rejects(() => client.control("qa-aircon", {}), e => e instanceof ClimateError && e.uncertain === (status >= 500) && !e.message.includes("SYNTHETIC"));
});
test("authorization is executed before secret/client creation and client Firestore access stays denied", () => {
  const source = readFileSync(new URL("../../firebase/kangsain-functions/functions/src/climate/climateCallables.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("export async function climateHandler"));
  assert.ok(handler.indexOf("await requireStaff") < handler.indexOf("isManagerRole"));
  assert.ok(handler.indexOf("isManagerRole") < handler.indexOf("service().dashboard"));
  assert.match(handler, /staff\.role !== "instructor"/);
  const rules = readFileSync(new URL("../../firebase/kangsain-functions/firestore.rules", import.meta.url), "utf8");
  assert.ok(!rules.includes("facilityClimateCommands") && !rules.includes("facilityClimateGuards"));
  assert.ok(!source.includes("console."));
});
