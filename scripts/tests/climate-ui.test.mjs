import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir, mkdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = file => readFile(new URL(file, root), "utf8");
const source = await read("core/assets/climate.js");
const html = await read("core/climate/index.html");
const appSource = await read("core/assets/app.js");
const liveSource = await read("core/assets/climate-live.js");
const sandbox = {};
vm.runInNewContext(source.replace(/^import .*;\n/gm, "").replace(/^export /gm, "")
  + "\nglobalThis.api = { validClimateControl, validClimateValue, climateDevice, climateSnapshot };", sandbox);
const { validClimateControl, validClimateValue, climateDevice, climateSnapshot } = sandbox.api;
const clone = value => JSON.parse(JSON.stringify(value));
const device = () => ({ deviceId: "synthetic-ac-1", name: "합성 공간 A", model: "가상 모델", checkedAt: "2026-10-21T03:00:00.000Z",
  version: "fixture-v1", available: true, errorCode: null, pendingCommand: null,
  values: { power: "POWER_ON", mode: "COOL", targetTemperature: 24, currentTemperature: 25.5, fan: "MID",
    swingVertical: false, swingHorizontal: null, powerSave: false, humidity: 47 },
  controls: [{ field: "power", kind: "enum", values: ["POWER_ON", "POWER_OFF"] },
    { field: "mode", kind: "enum", values: ["COOL", "HEAT", "AIR_DRY"] },
    { field: "targetTemperature", kind: "range", min: 16, max: 30, step: .5 },
    { field: "fan", kind: "enum", values: ["LOW", "MID", "POWER"] },
    { field: "swingVertical", kind: "boolean" }, { field: "swingHorizontal", kind: "boolean" }, { field: "powerSave", kind: "boolean" }] });
const snapshot = () => ({ checkedAt: "2026-10-21T03:00:00.000Z", devices: [device()] });

test("navigation and command search replace video entry without removing video storage", async () => {
  const commandSource = appSource.slice(appSource.indexOf("const COMMAND_ITEMS ="), appSource.indexOf("const COMMAND_ITEMS =") + 7500);
  assert.match(commandSource, /href: "\.\/climate\/"/);
  assert.doesNotMatch(commandSource, /href: "\.\/video-analytics\/"/);
  assert.match(appSource, /const hiddenSections = new Set\(\[[^\]]*"video-analytics"/);
  assert.match(appSource, /climate: "air-vent"/);
  const navLabels = appSource.slice(appSource.indexOf("const NAV_LABELS ="), appSource.indexOf("function setAdminNavOpen"));
  assert.doesNotMatch(navLabels, /video-analytics|영상 시청/);
  const videoPage = await read("core/video-analytics/index.html");
  assert.doesNotMatch(videoPage, /data-section="video-analytics"/);
  assert.match(videoPage, /href="\.\.\/climate\/" data-section="climate"/);
  assert.match(videoPage, /회원별 영상 시청 현황/);
  const instructorAccess = await read("core/assets/core-instructor-access.js");
  const routes = instructorAccess.slice(instructorAccess.indexOf("const ROUTES ="), instructorAccess.indexOf("const STATUS_LABELS"));
  assert.doesNotMatch(routes, /climate|video-analytics/);
});

test("shell, explicit mount, runtime and command boundaries", () => {
  assert.match(html, /data-firestore-dashboard data-climate-dashboard hidden/);
  assert.match(html, /<h1>에어컨<\/h1>/);
  assert.match(html, /<title>에어컨 · ARCHIVE CORE<\/title>/);
  const styles = [...html.matchAll(/href="([^\"]+\.css)"/g)].map(match => match[1]);
  assert.equal(styles.at(-1), "../assets/interface.css");
  assert.match(html, /icons\/favicon-32\.png\?v=20261011/);
  assert.match(source, /import \{ sharedNavigationRuntime \} from "\.\/core-navigation\.js"/);
  assert.match(source, /export function mountClimate\(root, getRuntime = currentRuntime\)/);
  assert.doesNotMatch(source, /mountClimate\(document|setInterval|setTimeout|fetch\(|XMLHttpRequest|signIn|signOut\(|initializeApp|firebasejs|localStorage|sessionStorage/);
  assert.match(source, /startClimateLive/);
  assert.match(liveSource, /win\.setTimeout\(tick/);
  assert.match(liveSource, /"facilityClimateSignals"\), runtime\.limit\(16\)/);
  assert.doesNotMatch(liveSource, /httpsCallable|operatorControl|operatorReconcile|fetch\(|setInterval|setDoc|updateDoc|addDoc|deleteDoc/);
  const parsedMarkup = source.split("\n").filter(line => line.includes(".innerHTML"));
  assert.ok(parsedMarkup.length > 0);
  parsedMarkup.forEach(line => assert.match(line, /\.innerHTML = uiIcon\(/, "only bundled icon markup may be parsed"));
  const controlSource = source.slice(source.indexOf("async function control("), source.indexOf("function applyResult("));
  assert.doesNotMatch(controlSource, /getCoreAirConditioners/);
  assert.match(controlSource, /expectedVersion: device.version, field, value/);
  assert.match(controlSource, /crypto.randomUUID\(\)/);
});

test("capabilities validate typed enum, range and boolean values and reject arbitrary fields", () => {
  const controls = device().controls;
  controls.forEach(control => assert.equal(validClimateControl(control), true));
  assert.equal(validClimateValue(controls[0], "POWER_OFF"), true);
  assert.equal(validClimateValue(controls[0], false), false);
  assert.equal(validClimateValue(controls[2], 24.5), true);
  for (const invalid of ["24", null, NaN, 15, 31, 24.25]) assert.equal(validClimateValue(controls[2], invalid), false);
  for (const control of [{ field: "deviceId", kind: "enum", values: ["x"] },
    { field: "mode", kind: "enum", values: [{}] }, { field: "mode", kind: "range", min: 1, max: 3, step: 1 },
    { field: "power", kind: "boolean" }, { ...controls[2], step: 0 }, { ...controls[2], max: Infinity },
    { field: "fan", kind: "enum", values: ["LOW", "LOW"] }]) assert.equal(validClimateControl(control), false);
});

test("offline devices retain empty versions without losing other devices; malformed snapshots fail closed", () => {
  const data = snapshot();
  data.devices.push({ ...device(), deviceId: "synthetic-offline", available: false, version: "", controls: [] });
  assert.equal(climateSnapshot(data).devices.length, 2);
  assert.throws(() => climateDevice({ ...device(), version: "" }));
  assert.throws(() => climateSnapshot({ ...data, checkedAt: "invalid" }));
  assert.throws(() => climateSnapshot({ ...data, devices: [device(), device()] }));
  const d = device(); d.controls.push({ ...d.controls[0] }, { field: "unsafe", kind: "boolean" });
  assert.equal(climateDevice(d).controls.some(control => control.field === "power"), false);
  assert.equal(climateDevice(d).controls.some(control => control.field === "unsafe"), false);
});

test("partial snapshots require requested IDs, reject malformed flags and duplicates, and accept legacy full snapshots", () => {
  const data = { ...snapshot(), partial: true };
  assert.equal(climateSnapshot(data, ["synthetic-ac-1"]).partial, true);
  assert.throws(() => climateSnapshot(data));
  assert.throws(() => climateSnapshot(data, ["other"]));
  assert.throws(() => climateSnapshot({ ...data, devices: [device(), device()] }, ["synthetic-ac-1"]));
  assert.throws(() => climateSnapshot({ ...data, partial: "true" }, ["synthetic-ac-1"]));
  assert.equal(climateSnapshot(snapshot()).partial, false);
});

// Synthetic runtime only. No Firebase module, authentication service, credential or device network is used.
function bootstrap(data) {
  const f = window.__fixture = { data, calls: [], listeners: new Set(), hold: null, release: null,
    controlStatus: "verified", reconcileStatus: "unknown", failControl: null, failRead: false,
    nullDevice: false, wrongCommand: false, accessRole: "manager", signalListeners: new Set(),
    signalInitial: [], subscriptions: 0, unsubscriptions: 0, readOverride: null };
  const signalSnapshot = items => {
    const docs = items.map(item => ({ id: item.id, data: () => structuredClone(item.data) }));
    return { docs, docChanges: () => docs.map(doc => ({ type: "modified", doc })) };
  };
  const runtime = window.__runtime = { authClient: { currentUser: { uid: "synthetic-manager" } }, functionsClient: {},
    db: {}, collection: (_db, name) => ({ name }), limit: count => ({ count }), query: (...parts) => ({ parts }),
    onSnapshot(query, next, error) {
      if (query.parts[0].name !== "facilityClimateSignals" || query.parts[1].count !== 16) throw new Error("Unexpected signal query");
      const listener = { next, error }; f.signalListeners.add(listener); f.subscriptions++;
      next(signalSnapshot(f.signalInitial));
      return () => { if (f.signalListeners.delete(listener)) f.unsubscriptions++; };
    },
    auth: { onAuthStateChanged(_auth, callback) { f.listeners.add(callback); return () => f.listeners.delete(callback); } },
    httpsCallable(_client, name) { return async payload => {
      f.calls.push({ name, payload: structuredClone(payload), at: Date.now() });
      const read = structuredClone(f.data);
      if (f.hold === name) { f.hold = null; await new Promise(resolve => { f.release = resolve; }); }
      if (name === "getCoreAccessSession") return { data: { role: f.accessRole, staffName: "합성 운영자", staffId: "fixture-staff", mustChangePassword: false } };
      if (name === "getCoreAirConditioners") {
        if (f.failRead) throw new Error("synthetic-read-error");
        return { data: f.readOverride || (payload.deviceIds ? { ...read, partial: true,
          devices: read.devices.filter(device => payload.deviceIds.includes(device.deviceId)) } : read) };
      }
      if (name !== "operatorControlCoreAirConditioner" && name !== "operatorReconcileCoreAirConditioner") throw new Error("Unexpected synthetic callable: " + name);
      if (name === "operatorControlCoreAirConditioner" && f.failControl) {
        const error = new Error("synthetic-command-error");
        if (f.failControl !== "network") error.details = { code: f.failControl };
        throw error;
      }
      const status = name === "operatorControlCoreAirConditioner" ? f.controlStatus
        : payload.acknowledge ? "acknowledged" : f.reconcileStatus;
      const d = f.data.devices.find(item => item.deviceId === payload.deviceId);
      if (status === "verified" && payload.field) { d.values[payload.field] = payload.value; d.version += "-next"; }
      d.pendingCommand = ["accepted", "unknown", "pending"].includes(status) ? { commandId: payload.commandId, status } : null;
      return { data: { commandId: f.wrongCommand ? "wrong-synthetic-command" : payload.commandId, status,
        device: f.nullDevice ? null : structuredClone(d) } };
    } } };
  f.auth = uid => { runtime.authClient.currentUser = uid ? { uid } : null; [...f.listeners].forEach(callback => callback(runtime.authClient.currentUser)); };
  f.signals = items => [...f.signalListeners].forEach(listener => listener.next(signalSnapshot(items)));
  f.signalError = () => [...f.signalListeners].forEach(listener => listener.error(new Error("synthetic-signal-error")));
  if (location.pathname === "/integration/") window.archiveCoreNavigation = { runtime, uid: runtime.authClient.currentUser.uid,
    session: { role: "manager" }, ready() { window.__navigationReady = true; } };
}

async function fixtureServer() {
  const assets = new Map();
  for (const file of await readdir(new URL("core/assets/", root))) if (/^[\w-]+\.(js|css)$/.test(file)) {
    assets.set(`/core/assets/${file}`, [file.endsWith(".js") ? "text/javascript" : "text/css", await read(`core/assets/${file}`)]);
  }
  const boot = `<script>(${bootstrap.toString()})(${JSON.stringify(snapshot())});</script>`;
  const fixtureHtml = html.replace('<script src="../firebase-config.js"></script>', boot)
    .replace('<script type="module" src="../assets/app.js"></script>', `<script type="module">
      import { initCoreNavigationDocument } from "../assets/core-navigation.js";
      import { mountClimate } from "../assets/climate.js";
      initCoreNavigationDocument();
      window.__mount = (defaultRuntime = false) => window.__dispose = defaultRuntime
        ? mountClimate(document.querySelector('[data-climate-dashboard]'))
        : mountClimate(document.querySelector('[data-climate-dashboard]'), () => window.__runtime);
    </script>`)
    .replace(/<div id="coreAccessLoading"[^]*?<\/div>/, "");
  assets.set("/core/climate/", ["text/html", fixtureHtml]);
  assets.set("/core/climate/integration.html", ["text/html", html.replace('<script src="../firebase-config.js"></script>', "")
    .replace('<nav class="nav">', '<nav class="nav"><a href="../video-analytics/" data-section="video-analytics">영상 시청</a>')]);
  assets.set("/integration/", ["text/html", `<!doctype html><html lang="ko" data-core-access="manager"><head>${boot}</head><body>
    <iframe data-testid="integration-frame" data-core-navigation-frame src="/core/climate/integration.html" title="합성 권한 통합" style="width:100%;height:900px;border:0"></iframe></body></html>`]);
  const server = createServer((req, res) => {
    const asset = assets.get(new URL(req.url, "http://fixture").pathname);
    res.writeHead(asset ? 200 : 404, { "Content-Type": `${asset?.[0] || "text/plain"}; charset=utf-8`, "Cache-Control": "no-store" });
    res.end(asset?.[1] || "fixture-only");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test("synthetic browser lifecycle, commands, auth integration and responsive QA", {
  skip: !process.env.PLAYWRIGHT_MODULE_PATH && !process.env.CLIMATE_UI_BROWSER,
}, async t => {
  const { chromium } = await (process.env.PLAYWRIGHT_MODULE_PATH
    ? import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href) : import("playwright"));
  const { server, origin } = await fixtureServer();
  let browser;
  try {
    const screenshotDir = process.env.CLIMATE_UI_SCREENSHOTS || await mkdtemp(join(tmpdir(), "climate-ui-"));
    await mkdir(screenshotDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    async function withPage(run, options = {}) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
        storageState: { cookies: [], origins: [] }, ...options });
      const external = [], errors = [];
      try {
        await context.route("**/*", route => {
          if (route.request().url().startsWith(`${origin}/`)) return route.continue();
          external.push(route.request().url()); return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`${origin}/core/climate/`);
        await page.waitForFunction(() => typeof window.__mount === "function");
        await run(page);
        assert.deepEqual(external, [], "no external network");
        assert.deepEqual(errors, [], "no unhandled browser errors");
      } finally { await context.close(); }
    }
    const mount = async page => {
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "manager"; window.__mount(); });
      await page.getByRole("heading", { name: "합성 공간 A", exact: true }).waitFor();
      await idle(page);
    };
    const idle = page => page.waitForFunction(() => document.querySelector("[data-climate-dashboard]").getAttribute("aria-busy") === "false");
    const calls = (page, name) => page.evaluate(name => window.__fixture.calls.filter(call => call.name === name), name);
    const power = page => page.getByRole("button", { name: "전원", exact: true });
    const temperatureButton = (page, direction) => page.getByRole("button", {
      name: direction < 0 ? "희망 온도 낮추기" : "희망 온도 높이기", exact: true,
    });
    const displayedTarget = page => page.getByTestId("climate-device-0").evaluate(node => node.querySelector(".climate-target dd").textContent);
    // Chromium exposes native details as a group, without a button role for summary.
    const toggleDetails = async card => {
      const details = card.getByRole("group");
      const position = await details.evaluate(node => {
        const box = node.getBoundingClientRect(), summary = node.querySelector("summary").getBoundingClientRect();
        return { x: summary.left - box.left + summary.width / 2, y: summary.top - box.top + summary.height / 2 };
      });
      await details.click({ position });
    };
    const openDetails = async (page, card = page.getByTestId("climate-device-0")) => {
      const details = card.getByRole("group");
      assert.equal(await details.evaluate(node => node.querySelector("summary").textContent), "상세 설정");
      if (!await details.evaluate(node => node.open)) await toggleDetails(card);
    };
    const changeMode = async page => {
      await openDetails(page);
      await page.getByLabel("운전 모드", { exact: true }).selectOption({ label: "난방" });
      await page.getByRole("button", { name: "운전 모드 적용", exact: true }).click();
      await idle(page);
      await openDetails(page);
    };

    await t.test("white on and grey off cards expose circular pressed power buttons and collapsed advanced forms", () => withPage(async page => {
      await page.evaluate(() => {
        const off = structuredClone(window.__fixture.data.devices[0]);
        off.deviceId = "synthetic-ac-off"; off.name = "합성 공간 OFF"; off.values.power = "POWER_OFF";
        window.__fixture.data.devices.push(off);
      });
      await mount(page);
      assert.equal(await page.getByRole("checkbox", { name: "전원", exact: true, includeHidden: true }).count(), 0);
      for (const [index, pressed] of [[0, "true"], [1, "false"]]) {
        const card = page.getByTestId(`climate-device-${index}`);
        const button = card.getByRole("button", { name: "전원", exact: true });
        assert.equal(await button.getAttribute("aria-pressed"), pressed);
        const shape = await button.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return { width: rect.width, height: rect.height, radius: parseFloat(getComputedStyle(node).borderTopLeftRadius) };
        });
        assert.ok(shape.width >= 44 && Math.abs(shape.width - shape.height) <= 1 && shape.radius >= shape.width / 2,
          "power is a circular touch target");
        const rgb = await card.evaluate(node => getComputedStyle(node).backgroundColor.match(/\d+/g).slice(0, 3).map(Number));
        if (index === 0) assert.deepEqual(rgb, [255, 255, 255], "on card is white");
        else assert.ok(Math.max(...rgb) - Math.min(...rgb) <= 12 && rgb.every(channel => channel >= 180 && channel < 255), "off card is grey");
        const header = await card.evaluate(node => ({
          icon: Boolean(node.querySelector(".climate-device-heading .climate-appliance svg")),
          mode: node.querySelector(".climate-device-heading .climate-mode").textContent,
          indoor: node.querySelector(".climate-indoor dd").textContent,
        }));
        assert.equal(header.icon, true, "bundled device icon is present");
        assert.equal(header.mode, index === 0 ? "냉방" : "꺼짐");
        assert.equal(header.indoor, "25.5°C");
        assert.equal(await card.getByLabel("희망 온도", { exact: true }).isVisible(), false);
        assert.equal(await card.getByRole("button", { name: "희망 온도 적용", exact: true }).count(), 0);
        assert.equal(await card.getByLabel("운전 모드", { exact: true }).isVisible(), false);
        const details = card.getByRole("group");
        assert.equal(await details.evaluate(node => node.querySelector("summary").textContent), "상세 설정");
        await details.evaluate(node => node.querySelector("summary").focus()); await page.keyboard.press("Enter");
        assert.equal(await card.getByLabel("희망 온도", { exact: true }).isVisible(), true);
        assert.equal(await card.getByRole("button", { name: "희망 온도 적용", exact: true }).isVisible(), true);
        assert.equal(await card.getByLabel("운전 모드", { exact: true }).isVisible(), true);
        await details.evaluate(node => node.querySelector("summary").focus()); await page.keyboard.press("Enter");
        assert.equal(await card.getByLabel("희망 온도", { exact: true }).isVisible(), false);
      }
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
    }));

    await t.test("power state and card colour stay unchanged until verified backend proof", () => withPage(async page => {
      await mount(page);
      const card = page.getByTestId("climate-device-0");
      const before = await card.evaluate(node => getComputedStyle(node).backgroundColor);
      await page.evaluate(() => { window.__fixture.hold = "operatorControlCoreAirConditioner"; });
      await power(page).click();
      await page.waitForFunction(() => typeof window.__fixture.release === "function");
      assert.equal(await power(page).getAttribute("aria-pressed"), "true");
      assert.equal(await card.evaluate(node => getComputedStyle(node).backgroundColor), before);
      assert.equal(await power(page).isDisabled(), true);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
      await page.evaluate(() => window.__fixture.release()); await idle(page);
      assert.equal(await power(page).getAttribute("aria-pressed"), "false");
      assert.notEqual(await card.evaluate(node => getComputedStyle(node).backgroundColor), before);
      await power(page).click(); await idle(page);
      assert.equal(await power(page).getAttribute("aria-pressed"), "true");
      assert.equal(await card.evaluate(node => getComputedStyle(node).backgroundColor), before);
      assert.deepEqual((await calls(page, "operatorControlCoreAirConditioner")).map(call => call.payload.value), ["POWER_OFF", "POWER_ON"]);
    }));

    for (const step of [.1, .5, 1]) for (const direction of [-1, 1]) {
      await t.test(`target ${direction < 0 ? "decrement" : "increment"} uses exact profile step ${step}, one command and backend-only update`, () => withPage(async page => {
        await page.evaluate(step => { window.__fixture.data.devices[0].controls.find(control => control.field === "targetTemperature").step = step; }, step);
        await mount(page);
        const expected = Number((24 + direction * step).toFixed(7));
        await page.evaluate(() => { window.__fixture.hold = "operatorControlCoreAirConditioner"; });
        await temperatureButton(page, direction).click();
        await page.waitForFunction(() => typeof window.__fixture.release === "function");
        const commands = await calls(page, "operatorControlCoreAirConditioner");
        assert.equal(commands.length, 1);
        assert.deepEqual(commands[0].payload, { deviceId: "synthetic-ac-1", expectedVersion: "fixture-v1",
          commandId: commands[0].payload.commandId, field: "targetTemperature", value: expected });
        assert.match(commands[0].payload.commandId, /^[0-9a-f-]{36}$/);
        assert.equal(await page.getByLabel("희망 온도", { exact: true }).inputValue(), "24");
        assert.equal(await displayedTarget(page), "24°C", "visible target is not optimistic");
        assert.equal(await page.evaluate(() => window.__fixture.data.devices[0].values.targetTemperature), 24);
        for (const dir of [-1, 1]) assert.equal(await temperatureButton(page, dir).isDisabled(), true);
        assert.equal(await power(page).isDisabled(), true);
        await page.evaluate(() => window.__fixture.release()); await idle(page);
        assert.equal(await page.getByLabel("희망 온도", { exact: true }).inputValue(), String(expected));
        assert.equal(await displayedTarget(page), `${expected}°C`);
        assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
        assert.equal((await calls(page, "getCoreAirConditioners")).length, 1, "no frontend preflight read");
      }));
    }

    await t.test("expanded details survives busy render and verified response without optimistic values", () => withPage(async page => {
      await mount(page); await openDetails(page);
      const values = await page.evaluate(() => structuredClone(window.__fixture.data.devices[0].values));
      await page.evaluate(() => { window.__fixture.hold = "operatorControlCoreAirConditioner"; });
      await temperatureButton(page, -1).click();
      await page.waitForFunction(() => typeof window.__fixture.release === "function");
      const details = page.getByTestId("climate-device-0").getByRole("group");
      assert.equal(await details.evaluate(node => node.open), true, "busy rerender preserves expansion");
      assert.equal(await page.getByLabel("희망 온도", { exact: true }).isVisible(), true);
      assert.equal(await page.getByLabel("희망 온도", { exact: true }).inputValue(), "24");
      assert.equal(await displayedTarget(page), "24°C");
      assert.deepEqual(await page.evaluate(() => window.__fixture.data.devices[0].values), values);
      await page.evaluate(() => window.__fixture.release()); await idle(page);
      assert.equal(await details.evaluate(node => node.open), true, "response rerender preserves expansion");
      assert.equal(await page.getByLabel("희망 온도", { exact: true }).isVisible(), true);
      assert.equal(await displayedTarget(page), "23.5°C");
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
    }));

    await t.test("accepted temperature command keeps old target and disables both steps until reconciled proof", () => withPage(async page => {
      await mount(page);
      await page.evaluate(() => { window.__fixture.controlStatus = "accepted"; });
      await temperatureButton(page, -1).click(); await idle(page);
      assert.equal(await page.getByLabel("희망 온도", { exact: true }).inputValue(), "24");
      assert.equal(await displayedTarget(page), "24°C");
      for (const dir of [-1, 1]) assert.equal(await temperatureButton(page, dir).isDisabled(), true);
      await page.evaluate(() => {
        const d = window.__fixture.data.devices[0]; d.values.targetTemperature = 23.5; d.version = "fixture-reconciled";
        window.__fixture.reconcileStatus = "verified";
      });
      await page.getByRole("button", { name: "결과 확인", exact: true }).click(); await idle(page);
      assert.equal(await page.getByLabel("희망 온도", { exact: true }).inputValue(), "23.5");
      assert.equal(await displayedTarget(page), "23.5°C");
      for (const dir of [-1, 1]) assert.equal(await temperatureButton(page, dir).isEnabled(), true);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
    }));

    for (const [target, disabled] of [[16, [-1]], [30, [1]], [null, [-1, 1]], [15, [-1, 1]], [31, [-1, 1]], [24.25, [-1, 1]]]) {
      await t.test(`target ${target} disables unsafe out-of-range or off-step commands`, () => withPage(async page => {
        await page.evaluate(target => { window.__fixture.data.devices[0].values.targetTemperature = target; }, target);
        await mount(page);
        for (const dir of [-1, 1]) assert.equal(await temperatureButton(page, dir).isDisabled(), disabled.includes(dir));
        assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
      }));
    }

    for (const state of ["offline", "device-error", "pending", "unsupported", "partial-profile"]) {
      await t.test(`${state} card cannot issue unsupported or locked shortcut commands`, () => withPage(async page => {
        await page.evaluate(state => {
          const d = window.__fixture.data.devices[0];
          if (state === "offline") { d.available = false; d.version = ""; }
          if (state === "device-error") d.errorCode = "synthetic-device-error";
          if (state === "pending") d.pendingCommand = { commandId: "synthetic-pending", status: "pending" };
          if (state === "unsupported") d.controls = [];
          if (state === "partial-profile") d.controls = d.controls.filter(control => !["power", "targetTemperature"].includes(control.field));
        }, state);
        await mount(page);
        for (const button of [power(page), temperatureButton(page, -1), temperatureButton(page, 1)]) {
          if (await button.count()) assert.equal(await button.isDisabled(), true);
        }
        assert.equal(await page.getByRole("checkbox", { name: "전원", exact: true, includeHidden: true }).count(), 0);
        await openDetails(page);
        for (const control of [page.getByLabel("희망 온도", { exact: true }), page.getByRole("button", { name: "희망 온도 적용", exact: true })]) {
          if (await control.count()) assert.equal(await control.isDisabled(), true);
        }
        assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
      }));
    }

    await t.test("manager gate, late runtime mutation, idempotent mount, manual refresh and read failure", () => withPage(async page => {
      await page.evaluate(() => { window.__savedRuntime = window.__runtime; window.__runtime = null; window.__mount(); });
      assert.equal(await page.getByRole("heading", { name: "에어컨", exact: true }).isVisible(), false);
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "manager"; });
      assert.equal((await calls(page, "getCoreAirConditioners")).length, 0);
      await page.evaluate(() => { window.__runtime = window.__savedRuntime; document.body.append(document.createElement("div")); });
      await page.getByRole("heading", { name: "합성 공간 A", exact: true }).waitFor();
      await page.evaluate(() => { window.__mount(); document.body.append(document.createElement("div")); });
      await idle(page);
      assert.equal((await calls(page, "getCoreAirConditioners")).length, 1);
      await page.evaluate(() => { window.__fixture.failRead = true; });
      await page.getByRole("button", { name: "새로고침", exact: true }).click(); await idle(page);
      assert.match(await page.getByRole("status").textContent(), /조회하지 못/);
      assert.equal(await power(page).isDisabled(), true);
      for (const dir of [-1, 1]) assert.equal(await temperatureButton(page, dir).isDisabled(), true);
    }));

    await t.test("typed controls issue one exact command without frontend preflight", () => withPage(async page => {
      await mount(page);
      assert.equal(await page.getByRole("checkbox", { name: "전원", exact: true }).count(), 0);
      assert.equal(await power(page).getAttribute("aria-pressed"), "true");
      await power(page).click(); await idle(page);
      assert.equal(await power(page).getAttribute("aria-pressed"), "false");
      const command = (await calls(page, "operatorControlCoreAirConditioner"))[0];
      assert.deepEqual(Object.keys(command.payload).sort(), ["commandId", "deviceId", "expectedVersion", "field", "value"]);
      assert.match(command.payload.commandId, /^[0-9a-f-]{36}$/);
      assert.equal(command.payload.expectedVersion, "fixture-v1"); assert.equal(command.payload.field, "power");
      assert.equal(command.payload.value, "POWER_OFF");
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
      assert.equal((await calls(page, "getCoreAirConditioners")).length, 1);
      await changeMode(page);
      await page.getByLabel("희망 온도", { exact: true }).fill("24.5");
      await page.getByRole("button", { name: "희망 온도 적용", exact: true }).click(); await idle(page);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).at(-1).payload.value, 24.5);
      await openDetails(page);
      await page.getByLabel("바람 세기", { exact: true }).selectOption({ label: "강풍" });
      await page.getByRole("button", { name: "바람 세기 적용", exact: true }).click(); await idle(page);
      await openDetails(page);
      await page.getByLabel("절전", { exact: true }).check(); await idle(page);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).at(-1).payload.value, true);
      await openDetails(page);
      assert.equal(await page.getByRole("option", { name: "제습", exact: true }).count(), 1);
    }));

    await t.test("network uncertainty retains stable UUID across refresh, reconcile and explicit acknowledgement", () => withPage(async page => {
      await mount(page);
      await page.evaluate(() => { window.__fixture.failControl = "network"; });
      await changeMode(page);
      const commandId = (await calls(page, "operatorControlCoreAirConditioner"))[0].payload.commandId;
      assert.equal(await page.getByLabel("운전 모드", { exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "현재 상태 확인·잠금 해제", exact: true }).count(), 0);
      await page.getByRole("button", { name: "새로고침", exact: true }).click(); await idle(page);
      assert.equal(await page.getByLabel("운전 모드", { exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "결과 확인", exact: true }).click(); await idle(page);
      assert.equal((await calls(page, "operatorReconcileCoreAirConditioner"))[0].payload.commandId, commandId);
      page.once("dialog", dialog => dialog.dismiss());
      await page.getByRole("button", { name: "현재 상태 확인·잠금 해제", exact: true }).click();
      assert.equal((await calls(page, "operatorReconcileCoreAirConditioner")).length, 1);
      page.once("dialog", dialog => { assert.match(dialog.message(), /다시 보내지 않고/); return dialog.accept(); });
      await page.getByRole("button", { name: "현재 상태 확인·잠금 해제", exact: true }).click(); await idle(page);
      assert.deepEqual((await calls(page, "operatorReconcileCoreAirConditioner")).at(-1).payload,
        { deviceId: "synthetic-ac-1", commandId, acknowledge: true });
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
      assert.equal(await page.getByLabel("운전 모드", { exact: true }).isEnabled(), true);
    }));

    for (const state of ["accepted", "unknown", "pending"]) await t.test(`${state} remains locked; read-only reconcile enables acknowledgement`, () => withPage(async page => {
      await mount(page); await page.evaluate(state => { window.__fixture.controlStatus = state; window.__fixture.reconcileStatus = state; }, state);
      await changeMode(page);
      assert.equal(await power(page).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "현재 상태 확인·잠금 해제", exact: true }).count(), 0);
      await page.getByRole("button", { name: "결과 확인", exact: true }).click(); await idle(page);
      assert.equal(await page.getByRole("button", { name: "현재 상태 확인·잠금 해제", exact: true }).isEnabled(), true);
    }));

    await t.test("another manager's acknowledged result unlocks with fresh device proof; mismatched IDs stay locked", () => withPage(async page => {
      await mount(page); await page.evaluate(() => { window.__fixture.controlStatus = "accepted"; }); await changeMode(page);
      await page.evaluate(() => { window.__fixture.reconcileStatus = "acknowledged"; window.__fixture.nullDevice = true; });
      await page.getByRole("button", { name: "결과 확인", exact: true }).click(); await idle(page);
      assert.equal(await power(page).isDisabled(), true);
      await page.evaluate(() => { window.__fixture.nullDevice = false; window.__fixture.wrongCommand = true; });
      await page.getByRole("button", { name: "결과 확인", exact: true }).click(); await idle(page);
      assert.equal(await power(page).isDisabled(), true);
      await page.evaluate(() => { window.__fixture.wrongCommand = false; });
      await page.getByRole("button", { name: "결과 확인", exact: true }).click(); await idle(page);
      assert.equal(await power(page).isEnabled(), true);
    }));

    for (const code of ["invalid_request", "control_disabled", "device_not_allowed", "device_busy", "command_conflict", "rate_limited", "not_configured"]) {
      await t.test(`definitive ${code} clears only local lock and requires refreshed state`, () => withPage(async page => {
        await mount(page); await page.evaluate(code => { window.__fixture.failControl = code; }, code); await changeMode(page);
        assert.equal(await page.getByRole("button", { name: "결과 확인", exact: true }).count(), 0);
        assert.equal(await power(page).isDisabled(), true);
        assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
        await page.getByRole("button", { name: "새로고침", exact: true }).click(); await idle(page);
        assert.equal(await power(page).isEnabled(), true);
      }));
    }
    for (const code of ["service_unavailable", "permission-denied"]) await t.test(`${code} is ambiguous and remains locked`, () => withPage(async page => {
      await mount(page); await page.evaluate(code => { window.__fixture.failControl = code; }, code); await changeMode(page);
      assert.equal(await page.getByRole("button", { name: "결과 확인", exact: true }).isEnabled(), true);
      assert.equal(await power(page).isDisabled(), true);
    }));

    await t.test("rejected with null device is definitive, but refresh is required", () => withPage(async page => {
      await mount(page); await page.evaluate(() => { window.__fixture.controlStatus = "rejected"; window.__fixture.nullDevice = true; });
      await changeMode(page);
      assert.match(await page.getByRole("status").textContent(), /요청 거절/);
      assert.equal(await page.getByRole("button", { name: "결과 확인", exact: true }).count(), 0);
      assert.equal(await power(page).isDisabled(), true);
    }));

    await t.test("writing card stays disabled, populated reads stay operable; account changes ignore stale responses", () => withPage(async page => {
      await mount(page);
      await openDetails(page);
      await page.evaluate(() => { window.__fixture.hold = "operatorControlCoreAirConditioner"; });
      await page.getByLabel("운전 모드", { exact: true }).selectOption({ label: "난방" });
      await page.getByRole("button", { name: "운전 모드 적용", exact: true }).click();
      await page.waitForFunction(() => typeof window.__fixture.release === "function");
      assert.equal(await page.getByRole("button", { name: "새로고침", exact: true }).isDisabled(), true);
      assert.equal(await page.getByLabel("절전", { exact: true }).isDisabled(), true);
      assert.equal(await power(page).isDisabled(), true);
      for (const dir of [-1, 1]) assert.equal(await temperatureButton(page, dir).isDisabled(), true);
      await page.evaluate(() => { window.__fixture.data.devices[0].name = "합성 공간 B"; window.__fixture.auth("synthetic-other-manager"); });
      await page.getByRole("heading", { name: "합성 공간 B", exact: true }).waitFor();
      await page.evaluate(() => window.__fixture.release()); await idle(page);
      assert.equal(await page.getByRole("heading", { name: "합성 공간 A", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "결과 확인", exact: true }).count(), 0);
      await page.evaluate(() => { window.__fixture.hold = "getCoreAirConditioners"; window.__fixture.release = null; });
      await page.getByRole("button", { name: "새로고침", exact: true }).click();
      await page.waitForFunction(() => typeof window.__fixture.release === "function");
      assert.equal(await power(page).isDisabled(), false);
      for (const dir of [-1, 1]) assert.equal(await temperatureButton(page, dir).isDisabled(), false);
      await page.evaluate(() => { window.__fixture.auth(null); document.dispatchEvent(new Event("core-instructor-signed-out")); window.__fixture.release(); });
      await page.waitForFunction(() => document.querySelector("[data-climate-dashboard]").hidden);
      assert.equal(await page.getByRole("heading", { name: "합성 공간 B", exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.querySelector("[data-climate-devices]").children.length), 0);
    }));

    await t.test("backend pending, offline and read-only controls render safely as text", () => withPage(async page => {
      await page.evaluate(() => {
        const d = window.__fixture.data.devices[0]; d.name = '<img src=x onerror="alert(1)">'; d.controls = [];
        d.pendingCommand = { commandId: "synthetic-existing-command", status: "pending" };
        window.__fixture.data.devices.push({ ...structuredClone(d), deviceId: "synthetic-offline", name: "합성 오프라인", available: false, version: "", pendingCommand: null });
      });
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "manager"; window.__mount(); }); await idle(page);
      await page.getByRole("heading", { name: '<img src=x onerror="alert(1)">', exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "합성 오프라인", exact: true }).count(), 1);
      assert.equal(await page.getByRole("checkbox").count(), 0);
      assert.equal(await page.evaluate(() => document.querySelector("[data-climate-devices] img") === null), true);
      await page.getByRole("button", { name: "결과 확인", exact: true }).click(); await idle(page);
      assert.equal((await calls(page, "operatorReconcileCoreAirConditioner"))[0].payload.commandId, "synthetic-existing-command");
    }));

    await t.test("fallback runtime requires matching manager uid and late navigation DOM triggers load", () => withPage(async page => {
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "manager";
        window.archiveCoreNavigation = { runtime: window.__runtime, uid: "wrong-uid", session: { role: "manager" } }; window.__mount(true); });
      assert.equal((await calls(page, "getCoreAirConditioners")).length, 0);
      await page.evaluate(() => { window.archiveCoreNavigation.uid = "synthetic-manager"; window.archiveCoreNavigation.session.role = "instructor";
        document.body.append(document.createElement("div")); });
      assert.equal((await calls(page, "getCoreAirConditioners")).length, 0);
      await page.evaluate(() => { window.archiveCoreNavigation.session.role = "manager"; document.body.append(document.createElement("div")); });
      await page.getByRole("heading", { name: "합성 공간 A", exact: true }).waitFor();
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "instructor"; });
      await page.waitForFunction(() => document.querySelector("[data-climate-dashboard]").hidden);
      assert.equal(await page.evaluate(() => document.querySelector("[data-climate-devices]").children.length), 0);
    }));

    const eightDevices = page => page.evaluate(() => {
      const template = window.__fixture.data.devices[0];
      const names = ["합성 공간 A", "QA 프라이빗", "QA 회의실 에어컨", "QA 체어", "QA 상담실", "QA 바렐", "QA 데스크", "QA 샤워실"];
      window.__fixture.data.devices = names.map((name, i) => ({ ...structuredClone(template),
        deviceId: `synthetic-eight-${i}`, name, values: { ...template.values, power: i % 2 ? "POWER_OFF" : "POWER_ON" } }));
    });
    const allOff = page => page.getByRole("button", { name: "아카이브 에어컨 전체 끄기", exact: true });

    await t.test("all-off confirms eight devices, serializes requests, verifies off devices and never updates optimistically", () => withPage(async page => {
      await eightDevices(page); await mount(page);
      const dialogs = []; page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
      await page.evaluate(() => { window.__fixture.hold = "operatorControlCoreAirConditioner"; });
      await allOff(page).click();
      await page.waitForFunction(() => Boolean(window.__fixture.release));
      assert.equal(await allOff(page).isEnabled(), false);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
      assert.equal(await power(page).first().getAttribute("aria-pressed"), "true");
      await page.evaluate(() => window.__fixture.release()); await idle(page);
      const sent = await calls(page, "operatorControlCoreAirConditioner");
      assert.equal(sent.length, 8);
      assert.equal(new Set(sent.map(call => call.payload.commandId)).size, 8);
      assert.ok(sent.every(call => call.payload.field === "power" && call.payload.value === "POWER_OFF" && call.payload.expectedVersion));
      assert.equal(dialogs.length, 1); assert.match(dialogs[0], /8대/);
      assert.equal(await page.getByRole("status").filter({ hasText: "전체 8대 중 꺼짐 확인 8대" }).count(), 1);
      assert.equal(await page.getByRole("listitem").filter({ hasText: "꺼짐 확인" }).count(), 8);
    }));

    await t.test("cancelled all-off sends nothing; already-off status is source-confirmed without a toggle-on", () => withPage(async page => {
      await eightDevices(page); await mount(page);
      page.once("dialog", dialog => dialog.dismiss()); await allOff(page).click(); await idle(page);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
      await page.evaluate(() => { window.__fixture.data.devices.forEach(device => { device.values.power = "POWER_OFF"; }); window.__fixture.controlStatus = "no_change"; });
      await page.getByRole("button", { name: "새로고침", exact: true }).click(); await idle(page);
      page.once("dialog", dialog => dialog.accept()); await allOff(page).click(); await idle(page);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 8);
      assert.equal(await page.getByRole("listitem").filter({ hasText: "꺼짐 확인" }).count(), 8);
    }));

    await t.test("all-off skips offline, unresolved and unsupported devices; no retry for uncertain acceptance", () => withPage(async page => {
      await eightDevices(page);
      await page.evaluate(() => {
        const f = window.__fixture; f.controlStatus = "unknown";
        f.data.devices[1].available = false;
        f.data.devices[2].pendingCommand = { commandId: "other-request", status: "unknown" };
        f.data.devices[3].controls = [];
      });
      await mount(page); page.once("dialog", dialog => dialog.accept());
      await allOff(page).click(); await idle(page);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 5);
      assert.equal(await page.getByRole("listitem").filter({ hasText: "건너뜀" }).count(), 3);
      assert.equal(await page.getByRole("listitem").filter({ hasText: "결과 미확인" }).count(), 5);
      await allOff(page).click(); await idle(page);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 5);
    }));

    await t.test("all-off stops following commands after stale source failure or account change", () => withPage(async page => {
      await eightDevices(page); await mount(page);
      await page.evaluate(() => { window.__fixture.failControl = "command_conflict"; });
      page.once("dialog", dialog => dialog.accept()); await allOff(page).click(); await idle(page);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
      assert.equal(await page.getByRole("listitem").filter({ hasText: "미실행" }).count(), 8);
      await page.evaluate(() => { window.__fixture.failControl = null; });
      await page.getByRole("button", { name: "새로고침", exact: true }).click(); await idle(page);
      await page.evaluate(() => { window.__fixture.hold = "operatorControlCoreAirConditioner"; });
      page.once("dialog", dialog => dialog.accept()); await allOff(page).click();
      await page.waitForFunction(() => Boolean(window.__fixture.release));
      await page.evaluate(() => { window.__fixture.auth(null); window.__fixture.release(); });
      await page.waitForFunction(() => document.querySelector("[data-climate-dashboard]").hidden);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 2);
      assert.equal(await page.getByRole("listitem").count(), 0);
    }));

    await t.test("eight collapsed mixed-state cards have equal heights and expanded details grow naturally", () => withPage(async page => {
      await eightDevices(page); await mount(page);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const sizes = await page.getByTestId("climate-device-0").evaluate(node => [...node.parentElement.children].map(card => card.getBoundingClientRect().height));
        assert.equal(sizes.length, 8);
        assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${width}px collapsed heights: ${sizes}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: join(screenshotDir, `climate-eight-${width}.png`), fullPage: true });
      }
      const card = page.getByTestId("climate-device-1");
      const collapsed = await card.evaluate(node => node.getBoundingClientRect().height);
      await openDetails(page, card);
      assert.ok(await card.evaluate(node => node.getBoundingClientRect().height) > collapsed);
    }));

    const clockMount = async (page, healthy = false) => {
      await page.clock.install({ time: new Date("2026-10-21T03:00:00Z") });
      await page.clock.pauseAt(new Date("2026-10-21T03:00:01Z"));
      await eightDevices(page);
      if (healthy) await page.evaluate(() => { window.__fixture.signalInitial = [
        { id: "receiver-status", data: { connected: true, updatedAt: new Date().toISOString() } },
        { id: "initial", data: { deviceId: "synthetic-eight-0", revision: 0 } },
      ]; });
      await mount(page);
    };
    const advance = async (page, milliseconds) => { await page.clock.runFor(milliseconds); await page.evaluate(() => Promise.resolve()); };
    const readCalls = page => calls(page, "getCoreAirConditioners");
    const visibility = (page, value) => page.evaluate(value => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, value);

    await t.test("clock: missing receiver polls at 15 seconds, hidden pauses/unsubscribes, resume/focus obey full cooldown without catchup", () => withPage(async page => {
      await clockMount(page);
      await advance(page, 14999); assert.equal((await readCalls(page)).length, 1);
      await advance(page, 1); assert.equal((await readCalls(page)).length, 2);
      await visibility(page, "hidden");
      assert.equal(await page.evaluate(() => window.__fixture.signalListeners.size), 0);
      await advance(page, 120000); assert.equal((await readCalls(page)).length, 2);
      await visibility(page, "visible"); await advance(page, 1);
      assert.equal((await readCalls(page)).length, 3);
      await page.evaluate(() => { for (let i = 0; i < 6; i++) window.dispatchEvent(new Event("focus")); });
      await advance(page, 9998); assert.equal((await readCalls(page)).length, 3);
      await advance(page, 2); assert.equal((await readCalls(page)).length, 4);
      const reads = await readCalls(page);
      assert.ok(reads[3].at - reads[2].at >= 10000);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
    }));

    await t.test("clock: healthy receiver selects 60 seconds; stale or failed receiver returns to 15 seconds", () => withPage(async page => {
      await clockMount(page, true);
      await advance(page, 59999); assert.equal((await readCalls(page)).length, 1);
      await advance(page, 1); assert.equal((await readCalls(page)).length, 2);
      await advance(page, 120000); assert.equal((await readCalls(page)).length, 4);
      await advance(page, 14999); assert.equal((await readCalls(page)).length, 4);
      await advance(page, 1); assert.equal((await readCalls(page)).length, 5);
      await page.evaluate(() => window.__fixture.signals([{ id: "receiver-status", data: { connected: true, updatedAt: new Date().toISOString() } }]));
      await page.evaluate(() => window.__fixture.signalError());
      await advance(page, 14999); assert.equal((await readCalls(page)).length, 5);
      await advance(page, 1); assert.equal((await readCalls(page)).length, 6);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
    }));

    await t.test("clock: baseline ignored, signals coalesce for 350ms and targeted reads merge without event values, drops or false whole timestamp", () => withPage(async page => {
      await clockMount(page, true);
      await advance(page, 2000);
      await page.evaluate(() => {
        const f = window.__fixture;
        f.hold = "getCoreAirConditioners";
        f.data.checkedAt = "2026-10-21T03:05:00Z";
        f.data.devices[0].checkedAt = f.data.checkedAt;
        f.data.devices[0].values.currentTemperature = 22;
        f.signals([{ id: "a", data: { deviceId: "synthetic-eight-0", revision: 1, values: { currentTemperature: 99 } } }]);
      });
      await advance(page, 100);
      await page.evaluate(() => window.__fixture.signals([
        { id: "a", data: { deviceId: "synthetic-eight-0", revision: 2 } },
        { id: "b", data: { deviceId: "synthetic-eight-1", revision: 1 } },
        { id: "unknown", data: { deviceId: "unknown-device", revision: 1 } },
        { id: "bad", data: { deviceId: "../invalid", revision: 1 } },
      ]));
      await advance(page, 249); assert.equal((await readCalls(page)).length, 1);
      await advance(page, 1); assert.equal((await readCalls(page)).length, 2);
      assert.equal(await page.getByTestId("climate-device-0").evaluate(n => n.querySelector(".climate-indoor dd").textContent), "25.5°C");
      assert.deepEqual((await readCalls(page))[1].payload, { deviceIds: ["synthetic-eight-0", "synthetic-eight-1"] });
      await page.evaluate(() => window.__fixture.release()); await idle(page);
      assert.equal(await page.getByTestId("climate-device-0").evaluate(n => n.querySelector(".climate-indoor dd").textContent), "22°C");
      assert.equal(await page.getByRole("heading", { level: 2 }).count(), 9);
      assert.match(await page.getByRole("time").textContent(), /12:00:00/);
      await page.evaluate(() => window.__fixture.signals([
        { id: "duplicate", data: { deviceId: "synthetic-eight-0", revision: 2 } },
        { id: "duplicate-b", data: { deviceId: "synthetic-eight-1", revision: 1 } },
        { id: "bad-revision", data: { deviceId: "synthetic-eight-2", revision: {} } },
      ]));
      await advance(page, 5000); assert.equal((await readCalls(page)).length, 2);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
    }));

    await t.test("clock: targeted cooldown is two seconds and unexpected partial IDs are rejected without losing cards", () => withPage(async page => {
      await clockMount(page, true);
      await page.evaluate(() => window.__fixture.signals([{ id: "a", data: { deviceId: "synthetic-eight-0", revision: 1 } }]));
      await advance(page, 1999); assert.equal((await readCalls(page)).length, 1);
      await advance(page, 1); assert.equal((await readCalls(page)).length, 2);
      await page.evaluate(() => {
        const f = window.__fixture;
        f.readOverride = { ...structuredClone(f.data), partial: true, devices: [{ ...structuredClone(f.data.devices[0]), deviceId: "unexpected" }] };
        f.signals([{ id: "a", data: { deviceId: "synthetic-eight-0", revision: 2 } }]);
      });
      await advance(page, 1999); assert.equal((await readCalls(page)).length, 2);
      await advance(page, 1); assert.equal((await readCalls(page)).length, 3);
      assert.equal(await page.getByRole("heading", { level: 2 }).count(), 9);
      assert.equal(await page.getByTestId("climate-device-0").getByRole("button", { name: "전원", exact: true }).isEnabled(), true);
      assert.equal((await readCalls(page))[2].at - (await readCalls(page))[1].at, 2000);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
    }));

    await t.test("clock: read errors back off 15/30/60/120 seconds, focus cannot bypass backoff, no automatic writes", () => withPage(async page => {
      await clockMount(page);
      await page.evaluate(() => { window.__fixture.failRead = true; });
      await advance(page, 15000); assert.equal((await readCalls(page)).length, 2);
      for (const delay of [15000, 30000, 60000, 120000, 120000]) {
        const count = (await readCalls(page)).length;
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await advance(page, delay - 1); assert.equal((await readCalls(page)).length, count);
        await advance(page, 1); assert.equal((await readCalls(page)).length, count + 1);
      }
      assert.equal(await page.getByTestId("climate-device-0").getByRole("button", { name: "전원", exact: true }).isEnabled(), true);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
    }));

    await t.test("clock: one writing card does not block another, automatic reads postpone until writes settle, UUIDs remain unique", () => withPage(async page => {
      await clockMount(page); await advance(page, 14900);
      await page.evaluate(() => { window.__fixture.hold = "operatorControlCoreAirConditioner"; });
      const first = page.getByTestId("climate-device-0"), second = page.getByTestId("climate-device-1");
      await first.getByRole("button", { name: "전원", exact: true }).click();
      assert.equal(await first.getByRole("button", { name: "전원", exact: true }).getAttribute("aria-busy"), "true");
      assert.equal(await second.getByRole("button", { name: "전원", exact: true }).isEnabled(), true);
      await second.getByRole("button", { name: "전원", exact: true }).click();
      assert.equal(await first.getByRole("button", { name: "전원", exact: true }).isDisabled(), true);
      assert.equal(await allOff(page).isDisabled(), true);
      await advance(page, 30000); assert.equal((await readCalls(page)).length, 1);
      const sent = await calls(page, "operatorControlCoreAirConditioner");
      assert.equal(sent.length, 2); assert.equal(new Set(sent.map(call => call.payload.commandId)).size, 2);
      await page.evaluate(() => window.__fixture.release()); await advance(page, 1); await idle(page);
      assert.equal((await readCalls(page)).length, 2);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 2);
    }));

    await t.test("clock: background reads retain draft DOM, open details and focus while updating readings; submitted drafts use fresh version", () => withPage(async page => {
      await clockMount(page);
      const card = page.getByTestId("climate-device-0"); await openDetails(page, card);
      await card.getByLabel("운전 모드", { exact: true }).selectOption({ label: "난방" });
      const input = card.getByLabel("희망 온도", { exact: true }); await input.fill("27"); await input.focus();
      await input.evaluate(node => { window.__draftNode = node; });
      await page.evaluate(() => {
        const f = window.__fixture;
        f.data.devices[0].values.currentTemperature = 22;
        f.data.devices[0].values.targetTemperature = 20;
        f.data.devices[0].version = "fresh-after-poll";
        f.data.devices[1].values.currentTemperature = 21;
      });
      await advance(page, 15000); await idle(page);
      assert.equal(await input.inputValue(), "27");
      assert.equal(await input.evaluate(node => node === window.__draftNode && document.activeElement === node), true);
      assert.equal(await card.getByRole("group").evaluate(node => node.open), true);
      assert.equal(await card.getByLabel("운전 모드", { exact: true }).inputValue(), "1");
      assert.equal(await card.evaluate(node => node.querySelector(".climate-target dd").textContent), "20°C");
      assert.equal(await page.getByTestId("climate-device-1").evaluate(node => node.querySelector(".climate-indoor dd").textContent), "21°C");
      await advance(page, 15000); assert.equal((await readCalls(page)).length, 3);
      await card.getByRole("button", { name: "희망 온도 적용", exact: true }).click(); await idle(page);
      const sent = await calls(page, "operatorControlCoreAirConditioner");
      assert.equal(sent.length, 1); assert.equal(sent[0].payload.value, 27); assert.equal(sent[0].payload.expectedVersion, "fresh-after-poll");
    }));

    await t.test("clock: authoritative polling cannot unlock a local uncertain command, but other devices update", () => withPage(async page => {
      await clockMount(page);
      await page.evaluate(() => { window.__fixture.controlStatus = "unknown"; });
      const first = page.getByTestId("climate-device-0");
      await first.getByRole("button", { name: "전원", exact: true }).click(); await idle(page);
      await page.evaluate(() => {
        window.__fixture.data.devices[0].pendingCommand = null;
        window.__fixture.data.devices[1].values.currentTemperature = 19;
      });
      await advance(page, 15000); await idle(page);
      assert.equal(await first.getByRole("button", { name: "전원", exact: true }).isDisabled(), true);
      assert.equal(await first.getByRole("button", { name: "결과 확인", exact: true }).count(), 1);
      assert.equal(await page.getByTestId("climate-device-1").evaluate(node => node.querySelector(".climate-indoor dd").textContent), "19°C");
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
    }));

    await t.test("clock: in-flight background reads never overlap, controls stay operable and stale read cannot overwrite a newer mutation", () => withPage(async page => {
      await clockMount(page);
      await page.evaluate(() => { window.__fixture.hold = "getCoreAirConditioners"; });
      await advance(page, 15000); assert.equal((await readCalls(page)).length, 2);
      await advance(page, 60000); assert.equal((await readCalls(page)).length, 2);
      const button = page.getByTestId("climate-device-0").getByRole("button", { name: "전원", exact: true });
      assert.equal(await button.isEnabled(), true);
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "false");
      await page.evaluate(() => window.__fixture.release());
      assert.equal(await button.getAttribute("aria-pressed"), "false");
      await advance(page, 1); await idle(page);
      assert.equal((await readCalls(page)).length, 3);
      assert.equal(await button.getAttribute("aria-pressed"), "false");
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 1);
    }));

    await t.test("clock: auth change ignores stale background responses/signals; signout, navigation and pagehide dispose listeners and timers", () => withPage(async page => {
      await clockMount(page);
      await page.evaluate(() => { window.__oldSignal = [...window.__fixture.signalListeners][0]; window.__fixture.hold = "getCoreAirConditioners"; });
      await advance(page, 15000);
      await page.evaluate(() => {
        window.__fixture.data.devices[0].values.currentTemperature = 18;
        window.__fixture.auth("other-manager");
      });
      await idle(page);
      await page.evaluate(() => {
        window.__fixture.release();
        window.__oldSignal.next({ docs: [], docChanges: () => [{ doc: { data: () => ({ deviceId: "synthetic-eight-0", revision: 99 }) } }] });
      });
      await advance(page, 2000);
      assert.equal((await readCalls(page)).length, 3);
      assert.equal(await page.getByTestId("climate-device-0").evaluate(node => node.querySelector(".climate-indoor dd").textContent), "18°C");
      assert.equal(await page.evaluate(() => window.__fixture.signalListeners.size), 1);
      await page.evaluate(() => document.querySelector("[data-climate-dashboard]").classList.add("core-navigation-container"));
      await advance(page, 60000); assert.equal((await readCalls(page)).length, 3);
      assert.equal(await page.evaluate(() => window.__fixture.signalListeners.size), 0);
      await page.evaluate(() => document.querySelector("[data-climate-dashboard]").classList.remove("core-navigation-container"));
      await idle(page); assert.equal((await readCalls(page)).length, 4);
      await page.evaluate(() => window.__fixture.auth(null));
      await advance(page, 120000); assert.equal((await readCalls(page)).length, 4);
      assert.equal(await page.evaluate(() => window.__fixture.signalListeners.size), 0);
      await page.evaluate(() => window.__fixture.auth("next-manager")); await idle(page);
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await advance(page, 120000); assert.equal((await readCalls(page)).length, 5);
      assert.equal(await page.evaluate(() => window.__fixture.signalListeners.size), 0);
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
    }));

    await t.test("actual app.js mobile auth mount uses shared synthetic runtime and no general data reads", () => withPage(async page => {
      await page.goto(`${origin}/integration/`);
      const frame = page.getByTestId("integration-frame").contentFrame();
      try { await frame.getByRole("heading", { name: "합성 공간 A", exact: true }).waitFor(); }
      catch (error) {
        t.diagnostic(JSON.stringify(await page.evaluate(() => ({ calls: window.__fixture.calls,
          body: document.querySelector("iframe").contentDocument.body.innerText,
          role: document.querySelector("iframe").contentDocument.documentElement.dataset.coreAccess }))));
        throw error;
      }
      await page.waitForFunction(() => window.__navigationReady === true);
      assert.deepEqual(await page.evaluate(() => window.__fixture.calls.map(call => call.name)), ["getCoreAccessSession", "getCoreAirConditioners"]);
      assert.equal(await frame.getByRole("heading", { name: "에어컨", exact: true }).isVisible(), true);
      // Navigation frames hide their duplicate sidebar; check the enhanced DOM contract too.
      assert.equal(await frame.getByRole("link", { name: "에어컨", exact: true, includeHidden: true }).count(), 1);
      assert.equal(await frame.getByRole("link", { name: "영상 시청", exact: true, includeHidden: true }).count(), 0);
      assert.equal(await frame.getByRole("link", { name: "에어컨", exact: true, includeHidden: true }).getAttribute("href"), "../climate/");
      await page.evaluate(() => window.__fixture.auth(null));
      await frame.getByRole("heading", { name: "합성 공간 A", exact: true }).waitFor({ state: "hidden" });
    }));

    await t.test("320/390/768/1440 collapsed/open details and read-only screenshots, card geometry, wrapping, focus and touch labels", () => withPage(async page => {
      await page.evaluate(() => {
        const off = structuredClone(window.__fixture.data.devices[0]);
        off.deviceId = "synthetic-geometry-off"; off.name = "합성 공간 B"; off.values.power = "POWER_OFF";
        window.__fixture.data.devices.push(off);
      });
      await mount(page);
      const responsiveIssues = [];
      const layout = async label => {
        const issues = await page.evaluate(() => {
          const root = document.querySelector("[data-climate-dashboard]");
          const issues = [];
          const visible = node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
          if (document.documentElement.scrollWidth > innerWidth) issues.push("horizontal overflow");
          for (const node of root.querySelectorAll("button, select, input[type=number], .climate-toggle-label, summary")) {
            if (!visible(node)) continue;
            if (node.getBoundingClientRect().height < 43.5) issues.push("small touch target: " + node.tagName);
            if (node.scrollWidth > node.clientWidth + 1) issues.push("clipped control: " + node.tagName);
          }
          for (const node of root.querySelectorAll("h1,h2,dt,dd,label")) {
            if (visible(node) && node.scrollWidth > node.clientWidth + 1) issues.push(`clipped text: ${node.tagName} ${node.textContent} (${node.scrollWidth}/${node.clientWidth}px)`);
          }
          for (const card of root.querySelectorAll("[data-testid^=climate-device-]")) {
            const bounds = card.getBoundingClientRect();
            for (const node of card.querySelectorAll("button, input, select, summary, h2, dt, dd")) {
              if (!visible(node)) continue;
              const rect = node.getBoundingClientRect();
              if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) issues.push("content outside card: " + node.tagName);
            }
            const heading = card.querySelector("h2").getBoundingClientRect();
            const power = card.querySelector('button[aria-label="전원"]')?.getBoundingClientRect();
            if (power && Math.min(heading.right, power.right) - Math.max(heading.left, power.left) > 1
              && Math.min(heading.bottom, power.bottom) - Math.max(heading.top, power.top) > 1) issues.push("title overlaps power");
          }
          return issues;
        });
        if (issues.length) responsiveIssues.push({ viewport: label, issues });
      };
      const geometry = async () => {
        const boxes = await page.getByTestId("climate-device-0").evaluate(node => [...node.parentElement.children].map(card => {
          const rect = card.getBoundingClientRect(); return { width: rect.width, height: rect.height };
        }));
        assert.equal(boxes.length, 2);
        assert.ok(Math.abs(boxes[0].width - boxes[1].width) <= 1, "on/off card widths match");
        assert.ok(Math.abs(boxes[0].height - boxes[1].height) <= 1, "on/off card heights match");
        return boxes;
      };
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await layout(`collapsed viewport ${width}`);
        const closed = await geometry();
        await page.keyboard.press("Tab");
        await page.getByRole("button", { name: "새로고침", exact: true }).focus();
        assert.equal(await page.getByRole("button", { name: "새로고침", exact: true }).evaluate(node => getComputedStyle(node).outlineStyle !== "none"), true);
        await page.screenshot({ path: join(screenshotDir, `climate-controls-${width}.png`), fullPage: true });
        const firstCard = page.getByTestId("climate-device-0");
        await firstCard.getByRole("button", { name: "전원", exact: true }).hover();
        assert.deepEqual(await geometry(), closed, "hover does not shift card geometry");
        for (const index of [0, 1]) await openDetails(page, page.getByTestId(`climate-device-${index}`));
        await layout(`expanded viewport ${width}`); await geometry();
        for (const name of ["전원", "희망 온도 낮추기", "희망 온도 높이기"]) {
          const control = firstCard.getByRole("button", { name, exact: true });
          await page.keyboard.press("Tab");
          await control.focus();
          assert.equal(await control.evaluate(node => document.activeElement === node && getComputedStyle(node).outlineStyle !== "none"), true,
            `visible keyboard focus: ${name}`);
        }
        assert.equal(await firstCard.getByRole("group").evaluate(node => {
          const summary = node.querySelector("summary"); summary.focus();
          return document.activeElement === summary && getComputedStyle(summary).outlineStyle !== "none";
        }), true, "visible keyboard focus: 상세 설정");
        await page.screenshot({ path: join(screenshotDir, `climate-details-${width}.png`), fullPage: true });
        for (const index of [0, 1]) await toggleDetails(page.getByTestId(`climate-device-${index}`));
        assert.deepEqual(await geometry(), closed, "details collapse restores original geometry");
      }
      await page.evaluate(() => { const d = window.__fixture.data.devices[0]; d.controls = []; window.__fixture.data.devices = [d];
        window.__fixture.data.devices.push({ ...structuredClone(d), deviceId: "synthetic-long", name: "합성 공간 이름 줄바꿈 확인용 긴 이름 ABCDEFGHIJKLMNOPQRSTUVWXYZ" }); });
      await page.getByRole("button", { name: "새로고침", exact: true }).click(); await idle(page);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await layout(`read-only viewport ${width}`);
        await page.screenshot({ path: join(screenshotDir, `climate-readonly-${width}.png`), fullPage: true });
      }
      assert.equal((await calls(page, "operatorControlCoreAirConditioner")).length, 0);
      assert.deepEqual(responsiveIssues, [], "responsive layout issues");
    }));
    t.diagnostic(`Synthetic screenshots: ${screenshotDir}`);
    t.diagnostic("Actual hardware actions NOT TESTED. Browser contexts closed; fixture HTTP server stopped in finally.");
  } finally {
    try { await browser?.close(); }
    finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    assert.equal(browser?.isConnected() ?? false, false, "task-owned browser disconnected");
    assert.equal(server.listening, false, "fixture HTTP server stopped");
  }
});
