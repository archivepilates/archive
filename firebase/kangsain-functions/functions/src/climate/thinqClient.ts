import { createHash, randomUUID } from "node:crypto";

type Json = Record<string, any>;
export class ClimateError extends Error {
  constructor(public readonly code: string, public readonly uncertain = false) { super(code); }
}
export interface ThinQConfig {
  pat: string;
  clientId: string;
  allowedDeviceIds: string[];
  controlsEnabled: boolean;
}
export function parseThinQConfig(raw: string): ThinQConfig {
  try {
    const c = JSON.parse(raw);
    if (!/^thinqpat_[A-Za-z0-9_-]{20,}$/.test(c.pat)
      || !/^[a-zA-Z0-9_-]{8,100}$/.test(c.clientId)
      || !Array.isArray(c.allowedDeviceIds) || !c.allowedDeviceIds.length || c.allowedDeviceIds.length > 16
      || c.allowedDeviceIds.some((id: unknown) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
      || new Set(c.allowedDeviceIds).size !== c.allowedDeviceIds.length) throw new Error();
    return { pat: c.pat, clientId: c.clientId, allowedDeviceIds: c.allowedDeviceIds, controlsEnabled: c.controlsEnabled === true };
  } catch { throw new ClimateError("not_configured"); }
}

export const FIELDS = {
  power: ["operation", "airConOperationMode"],
  mode: ["airConJobMode", "currentJobMode"],
  targetTemperature: ["temperature", "targetTemperature"],
  fan: ["airFlow", "windStrength"],
  swingVertical: ["windDirection", "rotateUpDown"],
  swingHorizontal: ["windDirection", "rotateLeftRight"],
  powerSave: ["powerSave", "powerSaveEnabled"],
} as const;
export type ClimateField = keyof typeof FIELDS;
export type ClimateValue = string | boolean | number;
export interface ClimateControl {
  field: ClimateField; kind: "enum" | "range" | "boolean";
  values?: ClimateValue[]; min?: number; max?: number; step?: number;
}
export interface ClimateDevice {
  deviceId: string; name: string; model: string; checkedAt: string;
  available: boolean; errorCode: string | null; version: string;
  values: Record<string, ClimateValue | null>; controls: ClimateControl[];
  pendingCommand: { commandId: string; status: string } | null;
}
export function projectDevice(device: Json, profile: Json, state: Json, now: string): ClimateDevice {
  if (!profile?.property || !state?.operation || !state?.temperature || !state?.runState) throw new ClimateError("invalid_response");
  const values: ClimateDevice["values"] = {};
  const controls: ClimateControl[] = [];
  for (const [field, [resource, property]] of Object.entries(FIELDS)) {
    const value = state[resource]?.[property];
    values[field] = ["string", "number", "boolean"].includes(typeof value) ? value : null;
    let schema = profile.property[resource]?.[property];
    if (field === "targetTemperature") {
      const modeProperty: Record<string, string> = { COOL: "coolTargetTemperature", HEAT: "heatTargetTemperature", AUTO: "autoTargetTemperature" };
      const specialized = profile.property.temperature?.[modeProperty[state.airConJobMode?.currentJobMode]];
      if (specialized?.mode?.includes("w")) schema = specialized;
    }
    if (!schema?.mode?.includes("w")) continue;
    if (schema.type === "range") {
      const range = schema.value?.w;
      if (!range || ![range.min, range.max, range.step].every(Number.isFinite)
        || range.step <= 0 || range.min > range.max) continue;
      const lower = field === "targetTemperature" && Number.isFinite(state.temperature.minTargetTemperature)
        ? Math.max(range.min, state.temperature.minTargetTemperature) : range.min;
      const upper = field === "targetTemperature" && Number.isFinite(state.temperature.maxTargetTemperature)
        ? Math.min(range.max, state.temperature.maxTargetTemperature) : range.max;
      const min = Number((range.min + Math.ceil((lower - range.min) / range.step - 1e-8) * range.step).toFixed(6));
      const max = Number((range.min + Math.floor((upper - range.min) / range.step + 1e-8) * range.step).toFixed(6));
      if (min <= max) controls.push({ field: field as ClimateField, kind: "range", min, max, step: range.step });
    } else if (["boolean", "enum"].includes(schema.type) && Array.isArray(schema.value?.w)
      && schema.value.w.length && schema.value.w.length <= 24
      && schema.value.w.every((v: unknown) => schema.type === "boolean" ? typeof v === "boolean" : typeof v === "string" && v.length <= 64)) {
      controls.push({ field: field as ClimateField, kind: schema.type, values: schema.value.w });
    }
  }
  values.currentTemperature = state.temperature.unit === "C" && Number.isFinite(state.temperature.currentTemperature)
    ? state.temperature.currentTemperature : null;
  values.humidity = Number.isFinite(state.airQualitySensor?.humidity) ? state.airQualitySensor.humidity : null;
  const available = state.runState.currentState === "NORMAL"
    && ["POWER_ON", "POWER_OFF"].includes(String(values.power)) && state.temperature.unit === "C";
  if (state.temperature.unit !== "C" || state.twoSetTemperature?.twoSetEnabled === true) {
    const index = controls.findIndex(c => c.field === "targetTemperature");
    if (index >= 0) controls.splice(index, 1);
  }
  // Do not reject changes merely because the room temperature/humidity drifted.
  const controlValues = Object.fromEntries(Object.keys(FIELDS).map(field => [field, values[field]]));
  const version = createHash("sha256").update(JSON.stringify({ deviceId: device.deviceId, controlValues, controls, available })).digest("hex");
  return {
    deviceId: device.deviceId, name: String(device.deviceInfo.alias || "에어컨").slice(0, 80),
    model: String(device.deviceInfo.modelName || "").slice(0, 80), checkedAt: now,
    available, errorCode: available ? null : "device_unavailable", version, values, controls, pendingCommand: null,
  };
}
export function controlPayload(device: ClimateDevice, field: ClimateField, value: unknown): Json {
  const cap = device.controls.find(c => c.field === field);
  if (!device.available || !cap) throw new ClimateError("unsupported_control");
  if (cap.kind === "range") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < cap.min! || value > cap.max!
      || Math.abs((value - cap.min!) / cap.step! - Math.round((value - cap.min!) / cap.step!)) > 0.00001) throw new ClimateError("invalid_value");
    if (field === "targetTemperature" && !["COOL", "HEAT", "AUTO"].includes(String(device.values.mode))) throw new ClimateError("unsupported_control");
  } else if (!cap.values?.includes(value as ClimateValue)) throw new ClimateError("invalid_value");
  const [resource, property] = FIELDS[field];
  return { [resource]: { [property]: value } };
}

export class ThinQClient {
  private devicesCache?: { until: number; value: Json[] };
  private profiles = new Map<string, { until: number; value: Json }>();
  constructor(public readonly config: ThinQConfig, private readonly http: typeof fetch = fetch) {}
  private async request(path: string, body?: Json): Promise<Json> {
    const isWrite = body !== undefined;
    try {
      const response = await this.http(`https://api-kic.lgthinq.com${path}`, {
        method: isWrite ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${this.config.pat}`, "x-country": "KR", "x-client-id": this.config.clientId,
          "x-message-id": Buffer.from(randomUUID().replaceAll("-", ""), "hex").toString("base64url"),
          // LG publishes this fixed application key in the ThinQ Connect specification; it is not the PAT.
          "x-api-key": "v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3",
          ...(isWrite ? { "Content-Type": "application/json", "x-conditional-control": "true" } : {}),
        },
        ...(isWrite ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ClimateError(response.status === 401 || response.status === 403 ? "authorization_failed"
          : response.status === 429 ? "rate_limited" : "provider_error", isWrite && response.status >= 500);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ClimateError("invalid_response", isWrite);
      let bytes = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 512_000) { await reader.cancel(); throw new ClimateError("invalid_response", isWrite); }
        chunks.push(chunk.value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || typeof data !== "object" || !Object.hasOwn(data, "response") || data.error) throw new ClimateError("invalid_response", isWrite);
      return data.response;
    } catch (error) {
      if (error instanceof ClimateError) throw error;
      // Never expose upstream bodies, Authorization headers or transport error details.
      throw new ClimateError("connection_failed", isWrite);
    }
  }
  async devices(fresh = false): Promise<Json[]> {
    if (!fresh && this.devicesCache && this.devicesCache.until > Date.now()) return this.devicesCache.value;
    const rows = await this.request("/devices");
    if (!Array.isArray(rows) || rows.length > 100) throw new ClimateError("invalid_response");
    const value = rows.filter(d => this.config.allowedDeviceIds.includes(d.deviceId) && d.deviceInfo?.deviceType === "DEVICE_AIR_CONDITIONER");
    if (new Set(value.map(d => d.deviceId)).size !== value.length) throw new ClimateError("invalid_response");
    this.devicesCache = { until: Date.now() + 600_000, value };
    return value;
  }
  async read(device: Json, fresh = false): Promise<ClimateDevice> {
    if (!this.config.allowedDeviceIds.includes(device.deviceId) || device.deviceInfo?.deviceType !== "DEVICE_AIR_CONDITIONER") throw new ClimateError("device_not_allowed");
    const path = `/devices/${encodeURIComponent(device.deviceId)}`;
    let profile = this.profiles.get(device.deviceId);
    if (fresh || !profile || profile.until <= Date.now()) {
      profile = { until: Date.now() + 600_000, value: await this.request(`${path}/profile`) };
      this.profiles.set(device.deviceId, profile);
    }
    const state = await this.request(`${path}/state`);
    return projectDevice(device, profile.value, state, new Date().toISOString());
  }
  async readById(id: string, fresh = true): Promise<ClimateDevice> {
    const device = (await this.devices(fresh)).find(d => d.deviceId === id);
    if (!device) throw new ClimateError("device_not_allowed");
    return this.read(device, fresh);
  }
  async control(id: string, payload: Json): Promise<void> {
    if (!this.config.controlsEnabled || !this.config.allowedDeviceIds.includes(id)) throw new ClimateError("control_disabled");
    const result = await this.request(`/devices/${encodeURIComponent(id)}/control`, payload);
    if (!result || Array.isArray(result) || typeof result !== "object" || Object.keys(result).length) throw new ClimateError("invalid_response", true);
  }
}
