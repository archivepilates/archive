import { createHash } from "node:crypto";
import { ClimateDevice, ClimateError, ClimateField, ClimateValue, FIELDS, ThinQClient, controlPayload } from "./thinqClient";

export type CommandStatus = "pending" | "verified" | "no_change" | "accepted" | "unknown" | "rejected" | "acknowledged";
export interface ClimateCommand {
  commandId: string; deviceId: string; staffId: string; uid: string;
  field: ClimateField; value: ClimateValue; expectedVersion: string;
  fingerprint: string; status: CommandStatus; createdAt: string; updatedAt: string;
  errorCode: string | null;
  observedVersion?: string; observedValues?: Record<string, ClimateValue | null>;
  reconciledByUid?: string;
  dispatchStartedAt?: string;
}
export interface ClimateStore {
  throttleRead(uid: string, minimumIntervalMs?: number): Promise<void>;
  getCommand(id: string): Promise<ClimateCommand | null>;
  pending(deviceId: string): Promise<ClimateCommand | null>;
  claim(command: ClimateCommand): Promise<ClimateCommand | null>;
  authorizeDispatch(command: ClimateCommand): Promise<void>;
  finish(command: ClimateCommand): Promise<ClimateCommand>;
}
export interface ClimateActor { uid: string; staffId: string }
export interface ClimateControlInput {
  commandId: string; deviceId: string; field: ClimateField; value: ClimateValue; expectedVersion: string;
}
const terminal = (status: CommandStatus) => ["verified", "no_change", "rejected", "acknowledged"].includes(status);
export function parseControlInput(data: any): ClimateControlInput {
  if (!data || Object.keys(data).some(k => !["commandId", "deviceId", "field", "value", "expectedVersion"].includes(k))
    || !validCommandId(data.commandId) || !validDeviceId(data.deviceId)
    || typeof data.field !== "string" || !Object.hasOwn(FIELDS, data.field)
    || typeof data.expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(data.expectedVersion)
    || !["number", "string", "boolean"].includes(typeof data.value)
    || (typeof data.value === "number" && !Number.isFinite(data.value))
    || (typeof data.value === "string" && data.value.length > 64)) throw new ClimateError("invalid_request");
  return { commandId: data.commandId, deviceId: data.deviceId, field: data.field, value: data.value, expectedVersion: data.expectedVersion };
}
export const validCommandId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
export const validDeviceId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);

function dashboardDeviceIds(data: unknown): string[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).some(key => key !== "deviceIds")) throw new ClimateError("invalid_request");
  if (!Object.hasOwn(data, "deviceIds")) return null;
  const ids = (data as { deviceIds: unknown }).deviceIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || !Array.from(ids).every(validDeviceId)
    || new Set(ids).size !== ids.length) throw new ClimateError("invalid_request");
  return [...ids];
}

export class ClimateService {
  constructor(private readonly client: ThinQClient, private readonly store: ClimateStore) {}
  async dashboard(actor: ClimateActor, data: unknown = {}): Promise<{ checkedAt: string; devices: ClimateDevice[]; partial: boolean }> {
    const deviceIds = dashboardDeviceIds(data);
    if (deviceIds?.some(id => !this.client.config.allowedDeviceIds.includes(id))) throw new ClimateError("device_not_allowed");
    await this.store.throttleRead(actor.uid, deviceIds ? 2000 : 10000);
    const listed = await this.client.devices();
    const rows = deviceIds ? deviceIds.map(deviceId => ({ deviceId, descriptor: listed.find(d => d.deviceId === deviceId) }))
      : listed.map(descriptor => ({ deviceId: descriptor.deviceId as string, descriptor }));
    const devices: ClimateDevice[] = new Array(rows.length);
    let next = 0;
    // Keep four devices in flight without waiting for the slowest member of a wave.
    const worker = async () => {
      while (next < rows.length) {
        const index = next++, { deviceId, descriptor } = rows[index];
        let view: ClimateDevice;
        try {
          if (!descriptor) throw new ClimateError("device_not_allowed");
          view = await this.client.read(descriptor);
        }
        catch (error) {
          view = { deviceId, name: String(descriptor?.deviceInfo?.alias || "에어컨").slice(0, 80), model: "",
            checkedAt: new Date().toISOString(), available: false, version: "", values: {}, controls: [],
            errorCode: error instanceof ClimateError ? error.code : "connection_failed", pendingCommand: null };
        }
        const pending = await this.store.pending(deviceId);
        view.pendingCommand = pending ? { commandId: pending.commandId, status: pending.status } : null;
        if (!this.client.config.controlsEnabled) view.controls = [];
        devices[index] = view;
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, () => worker()));
    return { checkedAt: new Date().toISOString(), devices, partial: deviceIds !== null };
  }
  async control(actor: ClimateActor, data: unknown) {
    const input = parseControlInput(data);
    if (!this.client.config.controlsEnabled) throw new ClimateError("control_disabled");
    if (!this.client.config.allowedDeviceIds.includes(input.deviceId)) throw new ClimateError("device_not_allowed");
    const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, uid: actor.uid })).digest("hex");
    const previous = await this.store.getCommand(input.commandId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ClimateError("command_conflict");
      return this.result(previous, null);
    }
    const now = new Date().toISOString();
    const command: ClimateCommand = { ...input, ...actor, fingerprint, status: "pending", createdAt: now, updatedAt: now, errorCode: null };
    const claimed = await this.store.claim(command);
    if (claimed) {
      if (claimed.fingerprint !== fingerprint) throw new ClimateError("command_conflict");
      return this.result(claimed, null);
    }
    let attempted = false;
    let current: ClimateDevice | null = null;
    try {
      current = await this.client.readById(input.deviceId, true);
      if (current.version !== input.expectedVersion) throw new ClimateError("state_changed");
      const payload = controlPayload(current, input.field, input.value);
      if (current.values[input.field] === input.value) {
        command.status = "no_change";
      } else {
        // Claim and preflight are durable before the only mutation. Never retry this POST.
        await this.store.authorizeDispatch(command);
        if (Date.now() - Date.parse(command.createdAt) >= 60_000) throw new ClimateError("command_expired");
        command.dispatchStartedAt = new Date().toISOString();
        attempted = true;
        await this.client.control(input.deviceId, payload);
        command.status = "accepted";
        try {
          current = await this.client.readById(input.deviceId, false);
          if (current.available && current.values[input.field] === input.value) command.status = "verified";
        } catch { current = null; }
      }
    } catch (error) {
      command.errorCode = error instanceof ClimateError ? error.code : "connection_failed";
      command.status = attempted && (!(error instanceof ClimateError) || error.uncertain) ? "unknown" : "rejected";
    }
    command.updatedAt = new Date().toISOString();
    if (current) { command.observedVersion = current.version; command.observedValues = current.values; }
    // If persistence fails after dispatch, the original pending lock survives; no second control is allowed.
    const saved = await this.store.finish(command);
    return this.result(saved, current);
  }
  async reconcile(actor: ClimateActor, data: any) {
    if (!data || Object.keys(data).some(k => !["deviceId", "commandId", "acknowledge"].includes(k))
      || !validCommandId(data.commandId) || !validDeviceId(data.deviceId) || typeof data.acknowledge !== "boolean") throw new ClimateError("invalid_request");
    await this.store.throttleRead(actor.uid);
    let command = await this.store.getCommand(data.commandId);
    if (!command || command.deviceId !== data.deviceId || !this.client.config.allowedDeviceIds.includes(data.deviceId)) throw new ClimateError("command_not_found");
    const current = await this.client.readById(data.deviceId, true);
    if (!terminal(command.status)) {
      // Do not release a lock while the original function may still be between claim and POST.
      if (Date.now() - Date.parse(command.createdAt) < 120_000) return this.result(command, current);
      if (current.available && current.values[command.field] === command.value) command.status = "verified";
      else if (data.acknowledge && current.available) {
        command.status = "acknowledged";
        command.errorCode = "operator_acknowledged_current_state";
      }
      if (terminal(command.status)) {
        command.updatedAt = new Date().toISOString();
        command.observedVersion = current.version;
        command.observedValues = current.values;
        command.reconciledByUid = actor.uid;
        command = await this.store.finish(command);
      }
    }
    return this.result(command, current);
  }
  private result(command: ClimateCommand, device: ClimateDevice | null) {
    if (device) device.pendingCommand = terminal(command.status) ? null : { commandId: command.commandId, status: command.status };
    return { commandId: command.commandId, status: command.status, errorCode: command.errorCode, device };
  }
}
