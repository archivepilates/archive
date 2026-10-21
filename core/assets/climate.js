import { sharedNavigationRuntime } from "./core-navigation.js";
import { uiIcon } from "./ui-icons.js";
import { startClimateLive } from "./climate-live.js";

const FIELDS = Object.freeze({
  power: "전원", mode: "운전 모드", targetTemperature: "희망 온도", fan: "바람 세기",
  swingVertical: "상하 바람", swingHorizontal: "좌우 바람", powerSave: "절전",
});
const OPTIONS = Object.freeze({
  ON: "켜짐", OFF: "꺼짐", on: "켜짐", off: "꺼짐", POWER_ON: "켜짐", POWER_OFF: "꺼짐",
  COOL: "냉방", HEAT: "난방", DRY: "제습", AIR_DRY: "제습", FAN: "송풍", AUTO: "자동", AI: "AI",
  LOW: "약", MEDIUM: "중", MID: "중", HIGH: "강", SLOW: "미풍", TURBO: "강풍", POWER: "강풍",
  cool: "냉방", heat: "난방", dry: "제습", fan: "송풍", auto: "자동",
});
const COMMANDS = Object.freeze({ verified: "반영 확인", no_change: "변경 없음", accepted: "접수됨 · 결과 확인 필요", pending: "처리 중 · 결과 확인 필요",
  unknown: "결과 미확인 · 재전송 금지", acknowledged: "현재 상태 확인 · 잠금 해제", rejected: "요청 거절 · 재시도하지 않음" });
const DEFINITIVE_ERRORS = Object.freeze({ invalid_request: "요청 항목을 확인하세요.", control_disabled: "제어가 비활성화되어 있습니다.",
  device_not_allowed: "제어 허용 기기가 아닙니다.", device_busy: "기기에 진행 중인 요청이 있습니다.",
  command_conflict: "기기 상태가 바뀌었습니다.", rate_limited: "요청 간격을 두고 새로고침하세요.", not_configured: "기기 연결 설정이 필요합니다." });
const mounted = new WeakMap();
const booleanField = field => ["swingVertical", "swingHorizontal", "powerSave"].includes(field);
const validVersion = value => (typeof value === "string" && value.length > 0) || (typeof value === "number" && Number.isFinite(value));
const iso = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const primitiveFor = (field, value) => booleanField(field) ? typeof value === "boolean"
  : field === "targetTemperature" ? typeof value === "number" && Number.isFinite(value) : typeof value === "string" && value.length > 0;
const valueLabel = value => typeof value === "boolean" ? value ? "켜짐" : "꺼짐"
  : value == null ? "미확인" : Object.hasOwn(OPTIONS, value) ? OPTIONS[value] : String(value);
const powerPair = control => control.field === "power" && control.kind === "enum" && control.values.length === 2
  ? [["POWER_ON", "POWER_OFF"], ["ON", "OFF"], ["on", "off"]].find(pair => pair.every(value => control.values.includes(value))) : null;
const timeLabel = value => iso(value) ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul",
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)) : "미확인";

export function validClimateControl(control) {
  if (!control || !Object.hasOwn(FIELDS, control.field)) return false;
  if (control.kind === "enum") return Array.isArray(control.values) && control.values.length > 0
    && control.values.every(value => primitiveFor(control.field, value))
    && new Set(control.values).size === control.values.length;
  if (control.kind === "boolean") return booleanField(control.field);
  return control.kind === "range" && control.field === "targetTemperature"
    && [control.min, control.max, control.step].every(value => typeof value === "number" && Number.isFinite(value))
    && control.min < control.max && control.step > 0 && control.step <= control.max - control.min;
}

export function validClimateValue(control, value) {
  if (!validClimateControl(control) || !primitiveFor(control.field, value)) return false;
  if (control.kind === "enum") return control.values.includes(value);
  if (control.kind === "boolean") return typeof value === "boolean";
  const steps = (value - control.min) / control.step;
  return value >= control.min && value <= control.max && Math.abs(steps - Math.round(steps)) < 1e-7;
}

export function climateDevice(device) {
  if (!device || typeof device.deviceId !== "string" || !device.deviceId
    || !(validVersion(device.version) || device.available === false && device.version === "")
    || typeof device.available !== "boolean" || !iso(device.checkedAt) || !device.values || !Array.isArray(device.controls)
    || (device.pendingCommand != null && (typeof device.pendingCommand.commandId !== "string"
      || !device.pendingCommand.commandId || typeof device.pendingCommand.status !== "string"))) throw new Error("invalid-device");
  const values = {};
  for (const field of Object.keys(FIELDS)) values[field] = primitiveFor(field, device.values[field]) ? device.values[field] : null;
  for (const field of ["currentTemperature", "humidity"]) values[field] = typeof device.values[field] === "number"
    && Number.isFinite(device.values[field]) ? device.values[field] : null;
  const controls = device.controls.filter(validClimateControl);
  const counts = new Map();
  for (const control of controls) counts.set(control.field, (counts.get(control.field) || 0) + 1);
  return { deviceId: device.deviceId, name: typeof device.name === "string" ? device.name : "에어컨",
    model: typeof device.model === "string" ? device.model : "", checkedAt: device.checkedAt, version: device.version,
    available: device.available, errorCode: typeof device.errorCode === "string" ? device.errorCode : null, values,
    controls: controls.filter(control => counts.get(control.field) === 1).map(control => ({ field: control.field,
      kind: control.kind, ...(control.kind === "enum" ? { values: [...control.values] }
        : control.kind === "range" ? { min: control.min, max: control.max, step: control.step } : {}) })),
    pendingCommand: device.pendingCommand ? { commandId: device.pendingCommand.commandId, status: device.pendingCommand.status } : null };
}

export function climateSnapshot(data, requestedIds) {
  if (!iso(data?.checkedAt) || !Array.isArray(data?.devices) || data.devices.length > 8
    || data.partial !== undefined && typeof data.partial !== "boolean") throw new Error("invalid-snapshot");
  const devices = data.devices.map(climateDevice);
  if (new Set(devices.map(device => device.deviceId)).size !== devices.length) throw new Error("duplicate-device");
  if (data.partial && (!requestedIds?.length || devices.some(device => !requestedIds.includes(device.deviceId)))) throw new Error("unexpected-partial-device");
  return { checkedAt: data.checkedAt, devices, partial: data.partial === true };
}

function currentRuntime() {
  const shared = sharedNavigationRuntime();
  if (shared) return shared;
  const host = window.archiveCoreNavigation;
  return host?.session?.role === "manager" && host.session.mustChangePassword !== true
    && host.uid && host.uid === host.runtime?.authClient?.currentUser?.uid ? host.runtime : null;
}

export function mountClimate(root, getRuntime = currentRuntime) {
  if (!root) return;
  if (mounted.has(root)) return mounted.get(root);
  const doc = root.ownerDocument, win = doc.defaultView;
  const list = root.querySelector("[data-climate-devices]");
  const refresh = root.querySelector("[data-climate-refresh]");
  const status = root.querySelector("[data-climate-status]");
  const checked = root.querySelector("[data-climate-checked]");
  const count = root.querySelector("[data-climate-count]");
  const bulkOff = root.querySelector("[data-climate-bulk-off]");
  const bulkResult = root.querySelector("[data-climate-bulk-result]");
  let active = null, generation = 0, reading = false, batchBusy = false, disposed = false, blockedUser = null;
  let mutationEpoch = 0, live;
  const writes = new Set(), cards = new Map();
  let devices = [], locks = new Map(), messages = new Map(), checkedAt = null, trusted = false;
  const expanded = new Set();
  let watchedRuntime, unsubscribe;
  let parentDoc;
  try { if (win.parent !== win && win.frameElement?.hasAttribute("data-core-navigation-frame")) parentDoc = win.parent.document; } catch { /* No cross-origin runtime. */ }
  const text = (tag, value, className) => {
    const node = doc.createElement(tag); node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  // Only locally bundled icon markup is parsed; device data always uses textContent.
  function iconNode(name) {
    const icon = doc.createElement("template");
    icon.innerHTML = uiIcon(name);
    return icon.content.cloneNode(true);
  }
  refresh.replaceChildren(iconNode("refresh-cw"));
  bulkOff.replaceChildren(iconNode("power"), text("span", "전체 끄기"));

  function session() {
    if (disposed || !root.isConnected || doc.documentElement.dataset.coreAccess !== "manager"
      || root.classList.contains("core-navigation-container")
      || parentDoc && parentDoc.documentElement.dataset.coreAccess !== "manager") return null;
    for (let node = root.parentElement; node; node = node.parentElement) if (node.hidden || node.inert) return null;
    const runtime = getRuntime();
    const user = runtime?.authClient?.currentUser;
    if (!user?.uid || user === blockedUser || typeof runtime.httpsCallable !== "function") return null;
    const host = parentDoc ? win.parent.archiveCoreNavigation : win.archiveCoreNavigation;
    if (host && (host.runtime !== runtime || host.uid !== user.uid || host.session?.role !== "manager"
      || host.session.mustChangePassword === true)) return null;
    return { runtime, user, uid: user.uid };
  }
  const same = (a, b) => Boolean(a && b && a.runtime === b.runtime && a.user === b.user && a.uid === b.uid);
  function notice(message, error = false) { status.textContent = message; status.dataset.error = String(error); }
  function clear() {
    live?.dispose(); live = undefined;
    generation++; reading = false; batchBusy = false; writes.clear(); cards.clear();
    devices = []; locks.clear(); messages.clear(); expanded.clear(); checkedAt = null; trusted = false;
    list.replaceChildren(); checked.textContent = "조회 전"; checked.removeAttribute("datetime"); count.textContent = "기기 —";
    bulkOff.disabled = true; bulkResult.replaceChildren(); bulkResult.hidden = true;
    notice(""); root.setAttribute("aria-busy", "false"); refresh.disabled = true;
  }
  function watch(runtime) {
    if (watchedRuntime === runtime) return;
    unsubscribe?.(); unsubscribe = undefined; watchedRuntime = runtime;
    if (runtime?.auth?.onAuthStateChanged) unsubscribe = runtime.auth.onAuthStateChanged(runtime.authClient, accessChanged);
  }
  function accessChanged() {
    if (disposed) return;
    if (!root.isConnected) { dispose(); return; }
    const next = session();
    if (same(active, next) || !active && !next) { live?.sync(); return; }
    clear(); active = next; root.hidden = !next;
    watch(next?.runtime || watchedRuntime);
    if (next) {
      const owner = next;
      live = startClimateLive({ win, doc, parentDoc, runtime: next.runtime,
        active: () => same(owner, session()) && !root.hidden,
        knownIds: () => devices.map(device => device.deviceId),
        blocked: () => reading || batchBusy || writes.size > 0,
        read: ids => load(ids, true) });
      if (doc.visibilityState !== "hidden") void load();
    }
  }
  function signedOut() { blockedUser = active?.user || getRuntime()?.authClient?.currentUser; clear(); active = null; root.hidden = true; }
  function begin(deviceId, batch = false) {
    accessChanged();
    if (!active || batchBusy || reading && !devices.length || !same(active, session())
      || batch && writes.size || deviceId && writes.has(deviceId)) return null;
    const request = { session: active, generation, deviceId, batch };
    mutationEpoch++;
    if (batch) batchBusy = true;
    else writes.add(deviceId);
    live?.wake(); render();
    return request;
  }
  function current(request) { return request.generation === generation && same(request.session, session()); }
  function end(request) {
    if (!current(request)) { accessChanged(); return; }
    if (request.batch) batchBusy = false;
    else writes.delete(request.deviceId);
    render(); live?.wake();
  }
  const call = async (request, name, payload) => {
    const runtime = request.session.runtime;
    return (await runtime.httpsCallable(runtime.functionsClient, name)(payload))?.data;
  };
  function adopt(snapshot) {
    const previous = devices;
    if (snapshot.partial) {
      if (snapshot.devices.some(device => !previous.some(item => item.deviceId === device.deviceId))) throw new Error("unknown-partial-device");
      const incoming = new Map(snapshot.devices.map(device => [device.deviceId, device]));
      devices = previous.map(device => incoming.get(device.deviceId) || device);
    } else { devices = snapshot.devices; checkedAt = snapshot.checkedAt; trusted = true; }
    for (const device of devices) {
      if (device.pendingCommand && !locks.has(device.deviceId)) locks.set(device.deviceId, { ...device.pendingCommand, canAcknowledge: false });
    }
    // An empty read cannot erase an unresolved local command.
    for (const device of previous) if (locks.has(device.deviceId) && !devices.some(next => next.deviceId === device.deviceId)) {
      devices.push({ ...device, available: false, controls: [] });
    }
  }
  async function load(ids, background = false) {
    if (!active || reading || batchBusy || writes.size || !same(active, session()) || root.hidden
      || doc.visibilityState === "hidden" || parentDoc?.visibilityState === "hidden") return null;
    const requestedIds = Array.isArray(ids) ? [...new Set(ids)].filter(id => devices.some(device => device.deviceId === id)).slice(0, 8) : undefined;
    if (requestedIds && !requestedIds.length) return null;
    const request = { session: active, generation, epoch: mutationEpoch };
    const ownerLive = live;
    reading = true; ownerLive?.started(requestedIds); render();
    if (!background) notice("조회 중");
    let success = null;
    try {
      const data = await call(request, "getCoreAirConditioners", requestedIds ? { deviceIds: requestedIds } : {});
      if (!current(request)) return null;
      if (request.epoch !== mutationEpoch || background && (doc.visibilityState === "hidden" || parentDoc?.visibilityState === "hidden" || root.hidden)) {
        ownerLive?.requestFull(); return null;
      }
      adopt(climateSnapshot(data, requestedIds)); success = true;
      if (!background) notice(devices.length ? "조회 완료" : "연결된 기기 없음");
      return true;
    } catch {
      success = false;
      if (current(request)) {
        if (!background) trusted = false;
        notice("기기를 조회하지 못했습니다. 새로고침으로 다시 확인하세요.", true);
      }
      return false;
    } finally {
      if (current(request)) { reading = false; render(); ownerLive?.finished(success, requestedIds); }
    }
  }
  async function control(device, field, value) {
    device = devices.find(item => item.deviceId === device.deviceId);
    if (!device) return;
    if (!trusted || locks.has(device.deviceId) || !device.available || device.errorCode || !validVersion(device.version)) return;
    const descriptor = device.controls.find(item => item.field === field);
    if (!validClimateValue(descriptor, value)) return;
    const request = begin(device.deviceId); if (!request) return;
    try { await sendControl(request, device, field, value); }
    finally { end(request); }
  }
  async function sendControl(request, device, field, value, verifyNoChange = false) {
    let commandId;
    try {
      const displayed = devices.find(item => item.deviceId === device.deviceId);
      if (displayed !== device) { notice("현재 상태를 다시 확인하세요.", true); return; }
      if (device.values[field] === value && !verifyNoChange) { notice("변경 없음"); return "no_change"; }
      commandId = win.crypto.randomUUID();
      locks.set(device.deviceId, { commandId, status: "unknown", canAcknowledge: false });
      notice("요청 중"); render();
      // The server performs the forced fresh read and version check before its sole provider POST.
      const result = await call(request, "operatorControlCoreAirConditioner", {
        deviceId: device.deviceId, commandId, expectedVersion: device.version, field, value,
      });
      if (!current(request)) return;
      applyResult(device.deviceId, commandId, result, false, false);
      return result.status;
    } catch (error) {
      if (current(request)) {
        const code = error?.details?.code;
        if (Object.hasOwn(DEFINITIVE_ERRORS, code)) {
          locks.delete(device.deviceId); trusted = false;
          notice(`${DEFINITIVE_ERRORS[code]} 요청하지 않았습니다. 상태를 새로고침하세요.`, true);
          return "not_sent";
        } else {
          if (!commandId) trusted = false;
          notice(commandId ? "응답 미확인 · 재전송하지 말고 결과를 확인하세요." : "요청을 준비하지 못했습니다. 새로고침하세요.", true);
          return "unknown";
        }
      }
    }
  }
  function applyResult(deviceId, commandId, result, acknowledging, reconciled) {
    if (result?.commandId !== commandId || !Object.hasOwn(COMMANDS, result?.status)) throw new Error("invalid-command-response");
    const device = result.device == null ? null : climateDevice(result.device);
    if (device && device.deviceId !== deviceId) throw new Error("device-mismatch");
    if (device) devices = devices.map(item => item.deviceId === deviceId ? device : item);
    if (result.status === "rejected") {
      locks.delete(deviceId); messages.set(deviceId, COMMANDS.rejected); trusted = false;
      notice("요청 거절 · 상태를 새로고침하세요.", true); return;
    }
    const terminal = ["verified", "no_change", "acknowledged", "rejected"].includes(result.status);
    if (terminal && device && !device.pendingCommand) {
      locks.delete(deviceId); messages.set(deviceId, COMMANDS[result.status]);
    } else {
      locks.set(deviceId, { commandId, status: terminal ? "unknown" : result.status,
        canAcknowledge: !terminal && !acknowledging && reconciled && Boolean(device?.available) });
    }
    notice(COMMANDS[result.status], result.status === "rejected" || result.status === "unknown");
  }
  function offValue(device) {
    const pair = powerPair(device.controls.find(item => item.field === "power") || {});
    return pair && pair.includes(device.values.power) ? pair[1] : null;
  }
  function canTurnOff(device) {
    return device.available && !device.errorCode && validVersion(device.version)
      && !locks.has(device.deviceId) && offValue(device) !== null;
  }
  async function turnAllOff() {
    if (!trusted) return;
    const request = begin(undefined, true); if (!request) return;
    const plan = [...devices];
    const targets = plan.filter(canTurnOff);
    const results = new Map(plan.filter(device => !canTurnOff(device)).map(device => [device.deviceId, "건너뜀 · 연결·잠금·지원 상태 확인 필요"]));
    const paintResults = () => {
      const rows = text("ul", "");
      for (const item of plan) rows.append(text("li", `${item.name}: ${results.get(item.deviceId) || "대기"}`));
      bulkResult.replaceChildren(text("strong", "전체 끄기 결과"), rows);
    };
    try {
      if (!targets.length) { notice("제어 가능한 기기가 없습니다. 연결과 진행 중인 요청을 확인하세요.", true); return; }
      const names = targets.map(device => device.name).join(", ");
      if (!win.confirm(`아카이브 에어컨 ${targets.length}대의 전원을 모두 끌까요?\n${names}\n이미 꺼진 기기는 상태만 재확인합니다. 확인이 필요한 ${plan.length - targets.length}대는 건너뜁니다.`)) return;
      if (!current(request)) return;
      bulkResult.replaceChildren(); bulkResult.hidden = false;
      for (const device of targets) {
        if (!current(request)) return;
        if (!trusted || !canTurnOff(device)) {
          results.set(device.deviceId, "미실행 · 상태 새로고침 필요");
          continue;
        }
        // Each request retains the server's fresh source check, durable lock and one-shot dispatch.
        const value = offValue(device);
        const outcome = await sendControl(request, device, "power", value, true);
        if (!current(request)) return;
        const observed = devices.find(item => item.deviceId === device.deviceId);
        const confirmed = ["verified", "no_change"].includes(outcome) && observed?.available
          && !observed.errorCode && observed.values.power === value && !locks.has(device.deviceId);
        results.set(device.deviceId, confirmed ? "꺼짐 확인" : outcome === "not_sent" ? "미실행 · 상태 새로고침 필요"
          : outcome === "rejected" ? "요청 거절 · 상태 확인 필요" : "결과 미확인 · 재전송 금지");
        paintResults();
      }
      paintResults();
      const confirmed = [...results.values()].filter(value => value === "꺼짐 확인").length;
      notice(`전체 ${plan.length}대 중 꺼짐 확인 ${confirmed}대 · 확인 필요 ${plan.length - confirmed}대`, confirmed !== plan.length);
    } finally { end(request); }
  }
  async function reconcile(deviceId, acknowledge) {
    const lock = locks.get(deviceId);
    if (!lock || acknowledge && !lock.canAcknowledge) return;
    if (acknowledge && !win.confirm("현재 기기 상태를 확인했습니다. 명령을 다시 보내지 않고 이 요청의 잠금을 해제할까요?")) return;
    const request = begin(deviceId); if (!request) return;
    notice(acknowledge ? "잠금 해제 확인 중" : "명령 결과 확인 중");
    try {
      const result = await call(request, "operatorReconcileCoreAirConditioner", { deviceId, commandId: lock.commandId, acknowledge });
      if (current(request)) applyResult(deviceId, lock.commandId, result, acknowledge, true);
    } catch { if (current(request)) notice("결과를 확인하지 못했습니다. 잠금을 유지합니다.", true); }
    finally { end(request); }
  }
  function renderField(device, descriptor, disabled) {
    const form = text("form", "", "climate-field");
    const id = `climate-${encodeURIComponent(device.deviceId)}-${descriptor.field}`;
    const label = text("label", FIELDS[descriptor.field]); label.htmlFor = id;
    const value = device.values[descriptor.field];
    const power = powerPair(descriptor);
    const toggle = descriptor.kind === "boolean" || Boolean(power);
    let input;
    if (toggle) {
      input = doc.createElement("input"); input.type = "checkbox";
      input.checked = power ? value === power[0] : value === true;
      input.indeterminate = power ? !power.includes(value) : value === null;
    } else if (descriptor.kind === "enum") {
      input = doc.createElement("select");
      const unknown = text("option", "선택"); unknown.value = ""; unknown.disabled = true; input.append(unknown);
      descriptor.values.forEach((optionValue, optionIndex) => {
        const option = text("option", valueLabel(optionValue)); option.value = String(optionIndex); input.append(option);
      });
      const selected = descriptor.values.indexOf(value); input.value = selected < 0 ? "" : String(selected);
    } else {
      input = doc.createElement("input"); input.type = "number";
      input.min = descriptor.min; input.max = descriptor.max; input.step = descriptor.step; input.required = true;
      input.value = value ?? ""; input.setAttribute("inputmode", "decimal");
    }
    input.id = id; input.disabled = disabled; form.append(label);
    const readValue = () => power ? power[input.checked ? 0 : 1] : descriptor.kind === "enum" ? descriptor.values[Number(input.value)]
      : descriptor.kind === "boolean" ? input.checked : input.valueAsNumber;
    if (toggle) {
      label.className = "climate-toggle-label"; label.append(input);
      input.addEventListener("change", () => { if (!input.disabled) void control(device, descriptor.field, readValue()); });
    } else {
      const submit = text("button", "적용"); submit.type = "submit"; submit.disabled = disabled;
      submit.setAttribute("aria-label", `${FIELDS[descriptor.field]} 적용`); form.append(input, submit);
    }
    form.dataset.field = descriptor.field; form.dataset.descriptor = JSON.stringify(descriptor);
    if (!toggle) input.addEventListener("input", () => { input.dataset.draft = "true"; });
    form.addEventListener("submit", event => { event.preventDefault();
      if (input.value !== "" && !input.disabled && form.reportValidity()) {
        delete input.dataset.draft; void control(device, descriptor.field, readValue());
      }
    });
    return form;
  }
  function commitCard(deviceId, card, key) {
    const previous = cards.get(deviceId)?.node;
    if (previous) {
      const focused = previous.contains(doc.activeElement) ? doc.activeElement : null;
      const focusId = focused?.id, focusLabel = focused?.getAttribute("aria-label"), focusTag = focused?.tagName;
      card.querySelector("details").open = previous.querySelector("details").open;
      for (const form of card.querySelectorAll(".climate-field")) {
        const old = [...previous.querySelectorAll(".climate-field")].find(item => item.dataset.field === form.dataset.field
          && item.dataset.descriptor === form.dataset.descriptor);
        const input = old?.querySelector("input:not([type=checkbox]),select");
        if (!input || input.dataset.draft !== "true" && input !== focused) continue;
        const disabled = form.querySelector("input,select").disabled;
        old.querySelectorAll("input,select,button").forEach(node => { node.disabled = disabled; });
        form.replaceWith(old);
      }
      previous.dataset.power = card.dataset.power;
      previous.dataset.testid = card.dataset.testid;
      previous.dataset.writing = card.dataset.writing;
      previous.setAttribute("aria-busy", card.getAttribute("aria-busy"));
      previous.replaceChildren(...card.childNodes);
      if (focused) {
        const target = focused.isConnected ? focused : [...previous.querySelectorAll("input,select,button,summary")]
          .find(node => focusId ? node.id === focusId : focusLabel ? node.getAttribute("aria-label") === focusLabel : node.tagName === focusTag);
        if (target && !target.disabled) target.focus({ preventScroll: true });
      }
    } else list.append(card);
    cards.set(deviceId, { node: previous || card, key });
  }
  function render() {
    const focused = doc.activeElement;
    refresh.disabled = reading || batchBusy || writes.size > 0 || !active;
    root.setAttribute("aria-busy", String(reading || batchBusy || writes.size > 0));
    checked.textContent = checkedAt ? `조회 ${timeLabel(checkedAt)}` : "조회 전";
    if (checkedAt) checked.dateTime = checkedAt;
    count.textContent = `${devices.length}대 · 운전 ${devices.filter(device => ["POWER_ON", "ON", "on"].includes(device.values.power)).length}`;
    bulkOff.disabled = batchBusy || writes.size > 0 || reading && !devices.length || !trusted || !devices.length;
    for (const [id, entry] of cards) if (!devices.some(device => device.deviceId === id)) { entry.node.remove(); cards.delete(id); }
    list.querySelectorAll(":scope > .climate-empty").forEach(node => node.remove());
    devices.forEach((device, index) => {
      const on = ["POWER_ON", "ON", "on"].includes(device.values.power);
      const off = ["POWER_OFF", "OFF", "off"].includes(device.values.power);
      const healthy = device.available && !device.errorCode;
      const writing = writes.has(device.deviceId) || batchBusy;
      const disabled = writing || reading && !devices.length || !trusted || !healthy || locks.has(device.deviceId);
      const key = JSON.stringify([index, device, disabled, writing, locks.get(device.deviceId), messages.get(device.deviceId)]);
      if (cards.get(device.deviceId)?.key === key) return;
      const card = text("article", "", "climate-device"); card.dataset.testid = `climate-device-${index}`;
      card.dataset.power = healthy ? on ? "on" : off ? "off" : "unknown" : "unavailable";
      card.dataset.writing = String(writing); card.setAttribute("aria-busy", String(writing));
      const heading = text("div", "", "climate-device-heading");
      const appliance = text("div", "", "climate-appliance"); appliance.setAttribute("aria-hidden", "true"); appliance.append(iconNode("air-vent"));
      const identity = text("div", "", "climate-identity");
      identity.append(text("h2", device.name), text("p", !healthy ? "연결 확인 필요" : on ? valueLabel(device.values.mode) : off ? "꺼짐" : "상태 미확인", "climate-mode"));
      const powerControl = device.controls.find(descriptor => powerPair(descriptor));
      const pair = powerControl && powerPair(powerControl);
      const powerButton = text("button", "", "climate-power"); powerButton.type = "button";
      powerButton.setAttribute("aria-label", "전원"); powerButton.setAttribute("title", `${device.name} ${on ? "전원 끄기" : "전원 켜기"}`);
      if (on || off) powerButton.setAttribute("aria-pressed", String(on));
      powerButton.disabled = disabled || !pair || !on && !off;
      powerButton.setAttribute("aria-busy", String(writing));
      powerButton.append(iconNode(writing ? "refresh-cw" : "power"));
      powerButton.addEventListener("click", () => { if (pair) void control(device, "power", pair[on ? 1 : 0]); });
      heading.append(appliance, identity, powerButton); card.append(heading);
      const readings = text("dl", "", "climate-readings");
      const temperature = field => device.values[field] === null ? "—" : `${device.values[field]}°C`;
      const indoor = text("div", "", "climate-reading climate-indoor");
      indoor.append(text("dt", on ? "실내" : "실내 온도"), text("dd", temperature("currentTemperature")));
      readings.append(indoor);
      if (on) {
        const target = text("div", "", "climate-target");
        const range = device.controls.find(descriptor => descriptor.field === "targetTemperature" && descriptor.kind === "range");
        const current = device.values.targetTemperature;
        const stepButton = direction => {
          const button = text("button", "", "climate-step"); button.type = "button";
          const label = direction < 0 ? "희망 온도 낮추기" : "희망 온도 높이기";
          button.setAttribute("aria-label", label); button.setAttribute("title", label);
          const next = range && typeof current === "number" ? Number((current + direction * range.step).toFixed(6)) : null;
          button.disabled = disabled || !range || next === null || !validClimateValue(range, next)
            || !["COOL", "HEAT", "AUTO"].includes(device.values.mode);
          button.append(iconNode(direction < 0 ? "minus" : "plus"));
          button.addEventListener("click", () => { if (next !== null) void control(device, "targetTemperature", next); });
          return button;
        };
        const desired = text("div", "", "climate-reading"); desired.append(text("dt", "희망"), text("dd", temperature("targetTemperature")));
        if (range) target.append(stepButton(-1));
        target.append(desired);
        if (range) target.append(stepButton(1));
        readings.append(target);
      }
      card.append(readings);
      const details = doc.createElement("details"); details.className = "climate-details"; details.open = expanded.has(device.deviceId);
      const summary = doc.createElement("summary");
      summary.append(text("span", "상세 설정"), iconNode("chevron-down")); details.append(summary);
      details.addEventListener("toggle", () => {
        if (!details.isConnected) return;
        if (details.open) expanded.add(device.deviceId); else expanded.delete(device.deviceId);
      });
      const fields = text("div", "", "climate-fields");
      for (const descriptor of device.controls) if (descriptor.field !== "power") fields.append(renderField(device, descriptor, disabled));
      const readOnly = text("dl", "", "climate-state");
      for (const [field, label] of Object.entries(FIELDS)) if (field !== "targetTemperature"
        && device.values[field] !== null && !device.controls.some(descriptor => descriptor.field === field)) {
        readOnly.append(text("dt", label), text("dd", valueLabel(device.values[field])));
      }
      if (device.values.humidity !== null) readOnly.append(text("dt", "습도"), text("dd", `${device.values.humidity}%`));
      if (readOnly.children.length) fields.append(readOnly);
      details.append(fields, text("p", `확인 ${timeLabel(device.checkedAt)}`, "climate-device-meta"));
      if (!device.controls.length) details.append(text("p", "조회 전용", "climate-readonly"));
      card.append(details);
      const lock = locks.get(device.deviceId);
      if (lock) {
        const pending = text("div", "", "climate-command");
        pending.append(text("p", COMMANDS[lock.status] || "진행 중인 요청 · 결과 확인 필요"));
        const actions = text("div", "", "climate-command-actions");
        const check = text("button", "결과 확인"); check.type = "button"; check.disabled = writing;
        check.addEventListener("click", () => void reconcile(device.deviceId, false)); actions.append(check);
        if (lock.canAcknowledge) {
          const ack = text("button", "현재 상태 확인·잠금 해제"); ack.type = "button"; ack.disabled = writing;
          ack.addEventListener("click", () => void reconcile(device.deviceId, true)); actions.append(ack);
        }
        pending.append(actions); card.append(pending);
      } else if (messages.has(device.deviceId)) card.append(text("p", messages.get(device.deviceId), "climate-readonly"));
      commitCard(device.deviceId, card, key);
    });
    let anchor = list.firstElementChild;
    for (const device of devices) {
      const card = cards.get(device.deviceId).node;
      if (card !== anchor) list.insertBefore(card, anchor);
      anchor = card.nextElementSibling;
    }
    if (focused?.isConnected && list.contains(focused) && doc.activeElement !== focused && !focused.disabled) focused.focus({ preventScroll: true });
    if (!devices.length) list.append(text("p", reading ? "기기 조회 중" : "연결된 기기 없음", "climate-empty"));
  }
  const observer = new win.MutationObserver(accessChanged);
  observer.observe(doc.documentElement, { attributes: true, childList: true, subtree: true,
    attributeFilter: ["data-core-access", "hidden", "inert", "class"] });
  if (parentDoc) observer.observe(parentDoc.documentElement, { attributes: true, childList: true, subtree: true,
    attributeFilter: ["data-core-access", "hidden", "inert", "class"] });
  refresh.addEventListener("click", load);
  bulkOff.addEventListener("click", turnAllOff);
  doc.addEventListener("core-instructor-signed-out", signedOut);
  doc.addEventListener("core-access-changed", accessChanged);
  parentDoc?.addEventListener("core-instructor-signed-out", signedOut);
  win.addEventListener("pagehide", dispose);
  function dispose() {
    if (disposed) return;
    disposed = true; clear(); active = null; root.hidden = true;
    observer.disconnect(); unsubscribe?.();
    refresh.removeEventListener("click", load);
    bulkOff.removeEventListener("click", turnAllOff);
    doc.removeEventListener("core-instructor-signed-out", signedOut);
    doc.removeEventListener("core-access-changed", accessChanged);
    parentDoc?.removeEventListener("core-instructor-signed-out", signedOut);
    win.removeEventListener("pagehide", dispose); mounted.delete(root);
  }
  mounted.set(root, dispose); root.hidden = true; accessChanged();
  return dispose;
}
