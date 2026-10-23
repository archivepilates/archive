import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import { build } from "esbuild";
import { classifyOperationsMail, OPS_MAIL } from "../../firebase/kangsain-functions/functions/src/sync/operationsMailPolicy";

type Json = Record<string, any>;
type Engine = typeof import("../../firebase/kangsain-functions/functions/src/sync/operationsMailIngress");
type Write = { kind: "create" | "set" | "update"; path: string; data: Json; merge?: boolean };
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
let compilation: Awaited<ReturnType<typeof build>>;
let engine: Engine;
before(async () => {
  compilation = await build({
    absWorkingDir: root,
    entryPoints: ["firebase/kangsain-functions/functions/src/sync/operationsMailIngress.ts"],
    bundle: true, write: false, platform: "node", format: "cjs", target: "node22", metafile: true,
    plugins: [{ name: "deny-real-google-auth", setup(builder) {
      builder.onResolve({ filter: /delegatedGoogleClient$/ }, () => ({ path: "delegated", namespace: "mail-test" }));
      builder.onLoad({ filter: /.*/, namespace: "mail-test" }, () => ({ contents: `
        export class DelegatedGoogleClient {
          constructor(scopes) { bridge.construct(scopes); }
          requestRaw(...args) { return bridge.requestRaw(...args); }
        }`, loader: "js" }));
    } }],
  });
  assert.ok(!Object.keys(compilation.metafile!.inputs).some(path => /google\/delegatedGoogleClient|google-auth-library/.test(path)));
  engine = loadEngine();
});
function loadEngine(bridge = {
  construct(_scopes: string[]) { throw new Error("real_google_client_forbidden_in_engine_tests"); },
  async requestRaw(..._args: any[]): Promise<any> { throw new Error("real_google_transport_forbidden"); },
}): Engine {
  const module = { exports: {} };
  new Function("require", "module", "exports", "bridge", compilation.outputFiles![0].text)(require, module, module.exports, bridge);
  return module.exports as Engine;
}
const ACTIVATED = "2026-10-24T00:00:00.000Z";
const NOW = "2026-10-24T00:01:00.000Z";
const CURSOR = "900719925474099312340";
const NEXT = "900719925474099312341";
const LABELS = { Label_10: "알림톡 보고", Label_11: "동기화 보고" };
const ID = "19ab000000000001";
const ID2 = "19ab000000000002";
const ledgerPath = (id = ID) => `${OPS_MAIL.lanePath}/messages/${id}`;
const clone = <T>(value: T): T => value === undefined ? value : structuredClone(value);

// Optimistic read-version checking, staged writes and atomic commits model Firestore CAS.
class FakeFirestore {
  records = new Map<string, Json>();
  versions = new Map<string, number>();
  commits: Write[][] = [];
  transactions = 0;
  conflicts = 0;
  beforeCommit?: (writes: Write[]) => Promise<void>;
  failures: Array<{ matches: (writes: Write[]) => boolean; error: Error }> = [];
  seed(path: string, data: Json) {
    this.records.set(path, clone(data));
    this.versions.set(path, (this.versions.get(path) || 0) + 1);
  }
  get(path: string) { return clone(this.records.get(path)); }
  snapshot(path: string) {
    const value = this.get(path);
    return { exists: value !== undefined, data: () => clone(value) };
  }
  doc(path: string): any {
    return { path, id: path.split("/").at(-1), get: async () => this.snapshot(path),
      create: async (data: Json) => this.runTransaction(async tx => { await tx.get({ path }); tx.create({ path }, data); }),
      set: async (data: Json, options?: { merge: boolean }) => this.runTransaction(async tx => tx.set({ path }, data, options)),
      update: async (data: Json) => this.runTransaction(async tx => { await tx.get({ path }); tx.update({ path }, data); }),
    };
  }
  async runTransaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    this.transactions++;
    for (let attempt = 0; attempt < 10; attempt++) {
      const reads = new Map<string, number>(), writes: Write[] = [];
      const stage = (kind: Write["kind"], ref: { path: string }, data: Json, options?: { merge: boolean }) => {
        writes.push({ kind, path: ref.path, data: clone(data), ...(options ? { merge: options.merge } : {}) });
      };
      const result = await callback({
        get: async (ref: { path: string }) => {
          assert.equal(writes.length, 0, "Firestore requires all transaction reads before writes");
          reads.set(ref.path, this.versions.get(ref.path) || 0);
          const value = this.get(ref.path);
          return { exists: value !== undefined, data: () => clone(value) };
        },
        create: (ref: any, data: Json) => stage("create", ref, data),
        set: (ref: any, data: Json, options?: any) => stage("set", ref, data, options),
        update: (ref: any, data: Json) => stage("update", ref, data),
      });
      await this.beforeCommit?.(writes);
      if ([...reads].some(([path, version]) => (this.versions.get(path) || 0) !== version)) {
        this.conflicts++; continue;
      }
      const failure = this.failures.findIndex(item => item.matches(writes));
      if (failure >= 0) throw this.failures.splice(failure, 1)[0].error;
      const projected = new Map(this.records);
      for (const write of writes) {
        if (write.kind === "create" && projected.has(write.path)) throw new Error("already_exists");
        if (write.kind === "update" && !projected.has(write.path)) throw new Error("not_found");
        projected.set(write.path, write.kind === "update" || write.merge
          ? { ...projected.get(write.path), ...clone(write.data) } : clone(write.data));
      }
      for (const write of writes) {
        this.records.set(write.path, projected.get(write.path)!);
        this.versions.set(write.path, (this.versions.get(write.path) || 0) + 1);
      }
      if (writes.length) this.commits.push(clone(writes));
      return result;
    }
    throw new Error("synthetic_transaction_retry_limit");
  }
}

function metadata(id = ID, subject = "[알림톡][실패] SYNTHETIC_JOB 오류 3건 · 2026-10-24"): Json {
  return { id, threadId: "19abffffffff0001", internalDate: String(Date.parse(ACTIVATED) + 1000),
    labelIds: ["SENT", "INBOX", "Label_10"], payload: { headers: [
      { name: "From", value: OPS_MAIL.mailbox }, { name: "To", value: OPS_MAIL.mailbox }, { name: "Subject", value: subject },
    ] } };
}
const NEW_LABEL = { id: "Label_12", name: "홀딩 안내 보고" };
function newDomainMetadata(id = ID): Json {
  return { ...metadata(id, "[홀딩 안내][실패] SYNTHETIC_NEW_DOMAIN 오류"), labelIds: ["SENT", NEW_LABEL.id] };
}
const added = (id = ID) => ({ message: { id, labelIds: ["SENT", "Label_10"] } });
function history(ids = [ID], head = NEXT): Json {
  return { historyId: head, history: [{ id: head, messagesAdded: ids.map(id => added(id)) }] };
}

class FakeGmail {
  calls: Array<{ path: string; init: RequestInit }> = [];
  histories: Record<string, Json | Error> = { "": history() };
  messages: Record<string, Json | Error> = { [ID]: metadata(), [ID2]: metadata(ID2) };
  listings: Record<string, Json | Error> = {};
  labels: Json = { labels: Object.entries(LABELS).map(([id, name]) => ({ id, name })) };
  profile: Json = { emailAddress: OPS_MAIL.mailbox, historyId: NEXT };
  profiles: Array<Json | Error> = [];
  labelSnapshots: Array<Json | Error> = [];
  watch: Json = { historyId: NEXT, expiration: String(Date.parse(NOW) + 3 * 86_400_000) };
  before?: (path: string, init: RequestInit) => Promise<void>;
  async request<T = Json>(path: string, init: RequestInit = {}): Promise<T> {
    engine.assertOperationsMailRequest(path, init);
    this.calls.push({ path, init: clone(init) });
    await this.before?.(path, init);
    const url = new URL(path, "https://synthetic.invalid/");
    let response: Json | Error | undefined;
    if (url.pathname === "/history") response = this.histories[url.searchParams.get("pageToken") || ""];
    else if (url.pathname.startsWith("/messages/")) response = this.messages[url.pathname.slice("/messages/".length)];
    else if (url.pathname === "/messages") response = this.listings[`${url.searchParams.get("labelIds")}:${url.searchParams.get("pageToken") || ""}`];
    else if (url.pathname === "/labels") response = this.labelSnapshots.length ? this.labelSnapshots.shift() : this.labels;
    else if (url.pathname === "/profile") response = this.profiles.length ? this.profiles.shift() : this.profile;
    else if (path === "watch" && init.method === "POST") response = this.watch;
    else throw new Error(`unexpected_synthetic_gmail_request:${path}`);
    assert.ok(response, `No synthetic Gmail response configured for ${path}`);
    if (response instanceof Error) throw response;
    return clone(response) as T;
  }
}

function fixture(state: Json = {}) {
  const db = new FakeFirestore(), gmail = new FakeGmail();
  let clock = Date.parse(NOW);
  db.seed(OPS_MAIL.statePath, { enabled: true, mailbox: OPS_MAIL.mailbox, topic: OPS_MAIL.topic,
    activatedAt: ACTIVATED, historyCursor: CURSOR, labels: LABELS, policyVersion: 1,
    lastWatchAt: NOW, watchExpiresAt: new Date(clock + 3 * 86_400_000).toISOString(), ...state });
  return { db, gmail, advance: (ms: number) => { clock += ms; },
    state: () => db.get(OPS_MAIL.statePath)!,
    run: (options: Json = {}) => engine.runOperationsMailIngress(db as any, gmail, {
      source: "push", push: { emailAddress: OPS_MAIL.mailbox, historyId: NEXT }, now: () => new Date(clock), ...options,
    } as any),
  };
}
function queues(db: FakeFirestore) { return [...db.records].filter(([path]) => path.startsWith("codexActionQueue/")); }
function ledgers(db: FakeFirestore) { return [...db.records].filter(([path]) => path.startsWith(`${OPS_MAIL.lanePath}/messages/`)); }
function queuePath(message = metadata()) {
  return `codexActionQueue/ops_mail_${classifyOperationsMail(message as any, LABELS, ACTIVATED)!.incidentKey}`;
}
function assertReleased(f: ReturnType<typeof fixture>) {
  assert.equal(f.state().leaseOwner, null); assert.equal(f.state().leaseUntil, null);
}
function requestKinds(gmail: FakeGmail) {
  return gmail.calls.map(call => call.path.split("?")[0]);
}

test("missing/disabled state is a no-op with zero Gmail calls and zero writes", async () => {
  for (const missing of [false, true]) {
    const f = fixture({ enabled: false });
    if (missing) f.db.records.delete(OPS_MAIL.statePath);
    assert.equal((await f.run()).status, "inactive_or_busy");
    assert.equal(f.gmail.calls.length, 0); assert.equal(f.db.commits.length, 0);
  }
});

test("push admission accepts exact integer strings or positive safe integer numbers normalized to strings", async () => {
  for (const historyId of [CURSOR, "1", "12", "9".repeat(40), 1, 12, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(engine.parseOperationsMailPush({ emailAddress: OPS_MAIL.mailbox, historyId }),
      { emailAddress: OPS_MAIL.mailbox, historyId: String(historyId) });
  }
  for (const push of [null, {}, { emailAddress: "other@example.invalid", historyId: NEXT },
    { emailAddress: "other@example.invalid", historyId: 12 },
    ...[Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE, 1.5, 0, -0, -1, NaN, Infinity, -Infinity,
      "", "0", "01", "-1", "+1", "1.5", "1.0", "1e30", "0x10", "NaN", "Infinity", " 12", "12 ",
      "9".repeat(41), "1\n", [NEXT], null, true, {}].map(historyId => ({ emailAddress: OPS_MAIL.mailbox, historyId }))]) {
    const f = fixture();
    assert.equal(engine.parseOperationsMailPush(push), null);
    assert.equal((await f.run({ push })).status, "ignored_push");
    assert.equal(f.db.transactions, 0); assert.equal(f.gmail.calls.length, 0);
  }
});

test("numeric source push completes synthetic history processing and atomically creates ledger plus queue", async () => {
  const f = fixture({ historyCursor: "100" });
  f.gmail.profile.historyId = "102";
  f.gmail.histories[""] = history([ID], "102");
  const push = { emailAddress: OPS_MAIL.mailbox, historyId: 102 };
  assert.deepEqual(engine.parseOperationsMailPush(push), { emailAddress: OPS_MAIL.mailbox, historyId: "102" });
  const result = await f.run({ source: "push", push });
  assert.equal(result.status, "synced");
  assert.equal(result.actionable, 1);
  assert.equal(f.db.get(ledgerPath())!.messageId, ID);
  assert.equal(f.db.get(ledgerPath())!.classification, "failure");
  assert.equal(ledgers(f.db).length, 1);
  assert.equal(queues(f.db).length, 1);
  assert.equal(f.db.get(queuePath())!.messageCount, 1);
  const admission = f.db.commits.filter(writes => writes.some(write => write.path === ledgerPath()));
  assert.equal(admission.length, 1);
  assert.deepEqual(admission[0].map(write => write.path).sort(), [ledgerPath(), queuePath()].sort());
  const request = f.gmail.calls.find(call => call.path.startsWith("history?"))!;
  assert.equal(new URL(request.path, "https://synthetic.invalid").searchParams.get("startHistoryId"), "100");
  assert.equal(f.state().historyCursor, "102");
  assert.equal(typeof f.state().historyCursor, "string");
  assertReleased(f);
});

test("active lease is exclusive; expired lease can be acquired", async () => {
  const busy = fixture({ leaseOwner: "other-worker", leaseUntil: "2026-10-24T00:02:00.000Z" });
  assert.equal((await busy.run()).status, "inactive_or_busy");
  assert.equal(busy.db.commits.length, 0); assert.equal(busy.gmail.calls.length, 0);
  assert.equal(busy.state().leaseOwner, "other-worker");
  const expired = fixture({ leaseOwner: "expired-worker", leaseUntil: "2026-10-24T00:00:59.999Z" });
  assert.equal((await expired.run()).status, "synced"); assertReleased(expired);
});

test("concurrent workers contend through CAS; only the lease winner scans Gmail", async () => {
  const f = fixture();
  const results = await Promise.all([f.run(), f.run()]);
  assert.deepEqual(results.map(result => result.status).sort(), ["inactive_or_busy", "synced"]);
  assert.ok(f.db.conflicts > 0);
  assert.equal(f.gmail.calls.filter(call => call.path.startsWith("history?")).length, 1);
  assert.equal(ledgers(f.db).length, 1); assert.equal(queues(f.db)[0][1].messageCount, 1);
});

test("current SENT/self/domain-labeled metadata creates same-ID ledger plus one queue atomically", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, "synced"); assert.equal(result.actionable, 1);
  const queue = queuePath();
  assert.equal(f.db.get(ledgerPath())!.messageId, ID);
  assert.equal(f.db.get(ledgerPath())!.queueId, queue.split("/").at(-1));
  assert.equal(f.db.get(queue)!.messageCount, 1);
  assert.equal(f.db.get(queue)!.status, "open");
  assert.equal(f.db.get(queue)!.needsReview, true);
  const admission = f.db.commits.filter(writes => writes.some(write => write.path === ledgerPath()));
  assert.equal(admission.length, 1);
  assert.deepEqual(admission[0].map(write => write.path).sort(), [ledgerPath(), queue].sort());
  assert.equal(f.state().historyCursor, NEXT); assertReleased(f);
  const request = f.gmail.calls.find(call => call.path.startsWith(`messages/${ID}?`))!;
  const query = new URL(request.path, "https://synthetic.invalid").searchParams;
  assert.equal(query.get("format"), "metadata");
  assert.equal(query.get("fields"), "id,threadId,internalDate,labelIds,payload(headers)");
  assert.deepEqual(query.getAll("metadataHeaders"), ["Subject", "From", "To"]);
});

test("every active source holds a lease and reads profile then live labels before history", async () => {
  for (const source of ["push", "maintenance", "activation"]) {
    const f = fixture(); f.gmail.histories[""] = history([]);
    f.gmail.before = async () => {
      assert.equal(typeof f.state().leaseOwner, "string");
      assert.ok(Date.parse(f.state().leaseUntil) > Date.parse(NOW));
    };
    await f.run({ source });
    assert.deepEqual(requestKinds(f.gmail), ["profile", "labels", "history"]);
    assert.equal(f.gmail.calls[0].path, "profile?fields=emailAddress,historyId");
    assert.equal(f.gmail.calls[1].path, "labels?fields=labels(id,name)");
    assert.equal(f.state().historyCursor, NEXT); assertReleased(f);
  }
});

test("a newly created allowed domain label is refreshed on push, watched, and queued immediately", async () => {
  const f = fixture(); f.gmail.labels.labels.push(NEW_LABEL);
  f.gmail.messages[ID] = newDomainMetadata();
  f.gmail.histories[""] = { historyId: NEXT, history: [{
    labelsAdded: [{ message: { id: ID }, labelIds: [NEW_LABEL.id] }],
    messagesAdded: [{ message: { id: ID, labelIds: [NEW_LABEL.id, "SENT"] } }],
  }] };
  f.gmail.watch.historyId = "900719925474099319999";
  const result = await f.run();
  assert.equal(result.actionable, 1);
  assert.deepEqual(requestKinds(f.gmail), ["profile", "labels", "watch", "history", `messages/${ID}`]);
  const watch = f.gmail.calls.find(call => call.path === "watch")!;
  assert.deepEqual(JSON.parse(String(watch.init.body)), {
    topicName: OPS_MAIL.topic, labelFilterBehavior: "INCLUDE", labelIds: [...Object.keys(LABELS), NEW_LABEL.id],
  });
  assert.equal(f.state().labels[NEW_LABEL.id], NEW_LABEL.name);
  assert.equal(f.state().historyCursor, NEXT, "A watch receipt must not replace the processing boundary");
  assert.equal(f.db.get(ledgerPath())!.classification, "failure");
  assert.equal(queues(f.db).length, 1); assert.equal(queues(f.db)[0][1].messageCount, 1);
  assert.equal(queues(f.db)[0][1].area, "holding"); assert.equal(queues(f.db)[0][1].needsReview, true);
  assertReleased(f);
});

test("label enumeration order alone does not renew an unchanged watch", async () => {
  const f = fixture(); f.gmail.labels.labels.reverse();
  await f.run();
  assert.equal(f.gmail.calls.some(call => call.path === "watch"), false);
  assert.deepEqual(requestKinds(f.gmail).slice(0, 3), ["profile", "labels", "history"]);
});

test("normal checkpoint is the exact large-integer minimum of profile and first history head", async t => {
  for (const [name, profile, head, expected] of [
    ["profile is lower", NEXT, "900719925474099312349", NEXT],
    ["history is lower", "900719925474099312349", NEXT, NEXT],
  ]) {
    await t.test(name, async () => {
      const f = fixture(); f.gmail.profile.historyId = profile; f.gmail.histories[""] = history([], head);
      await f.run();
      assert.equal(f.state().historyCursor, expected);
      assert.ok(BigInt(f.state().historyCursor) <= BigInt(profile));
      assert.ok(BigInt(f.state().historyCursor) <= BigInt(head));
    });
  }
});

test("label created after snapshot/refresh cannot be skipped past its event; next run admits it once", async () => {
  const f = fixture(), later = "900719925474099312349";
  f.gmail.messages[ID] = newDomainMetadata();
  f.gmail.histories[""] = { historyId: later, history: [{
    id: later, labelsAdded: [{ message: { id: ID }, labelIds: [NEW_LABEL.id] }],
  }] };
  f.gmail.before = async path => {
    if (path.startsWith("history?")) f.gmail.labels.labels.push(NEW_LABEL);
  };
  assert.equal((await f.run()).actionable, 0);
  assert.equal(f.state().historyCursor, NEXT, "Do not checkpoint beyond the pre-label-refresh snapshot");
  assert.equal(queues(f.db).length, 0); assert.equal(ledgers(f.db).length, 0);
  assert.deepEqual(requestKinds(f.gmail), ["profile", "labels", "history"]);
  f.gmail.before = undefined; f.gmail.profile.historyId = later;
  assert.equal((await f.run()).actionable, 1);
  const histories = f.gmail.calls.filter(call => call.path.startsWith("history?"));
  assert.deepEqual(histories.map(call => new URL(call.path, "https://synthetic.invalid").searchParams.get("startHistoryId")), [CURSOR, NEXT]);
  assert.equal(f.state().historyCursor, later); assert.equal(f.state().labels[NEW_LABEL.id], NEW_LABEL.name);
  assert.equal((await f.run()).duplicates, 1);
  assert.equal(ledgers(f.db).length, 1); assert.equal(queues(f.db).length, 1);
  assert.equal(queues(f.db)[0][1].messageCount, 1);
  assert.equal(f.gmail.calls.filter(call => call.path.startsWith(`messages/${ID}?`)).length, 1);
});

test("new-label watch failure leaves cached labels and cursor unchanged and processes no history", async () => {
  const f = fixture(); f.gmail.labels.labels.push(NEW_LABEL); f.gmail.watch.expiration = String(Date.parse(NOW));
  await assert.rejects(f.run(), /mail_watch_receipt_invalid/);
  assert.deepEqual(requestKinds(f.gmail), ["profile", "labels", "watch"]);
  assert.equal(f.state().historyCursor, CURSOR); assert.deepEqual(f.state().labels, LABELS);
  assert.equal(ledgers(f.db).length, 0); assert.equal(queues(f.db).length, 0); assertReleased(f);
});

test("normal profile or live-label read failures stop before history and preserve cursor", async () => {
  for (const stage of ["profile", "labels"]) {
    const f = fixture();
    if (stage === "profile") f.gmail.profiles = [new Error("gmail_http_503")];
    else f.gmail.labelSnapshots = [new Error("gmail_http_503")];
    await assert.rejects(f.run(), /gmail_http_503/);
    assert.deepEqual(requestKinds(f.gmail), stage === "profile" ? ["profile"] : ["profile", "labels"]);
    assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 0);
    assert.equal(queues(f.db).length, 0); assertReleased(f);
  }
});

test("wrong mailbox or invalid/regressed profile snapshot is rejected before label refresh", async () => {
  for (const change of [{ emailAddress: "other@example.invalid" }, { historyId: 123 },
    { historyId: "900719925474099312339" }]) {
    const f = fixture(); Object.assign(f.gmail.profile, change);
    await assert.rejects(f.run(), /mailbox_identity_mismatch/);
    assert.deepEqual(requestKinds(f.gmail), ["profile"]);
    assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 0); assertReleased(f);
  }
});

test("messagesAdded plus labelsAdded and repeated delivery admit an ID exactly once", async () => {
  const f = fixture();
  f.gmail.histories[""] = { historyId: NEXT, history: [
    { messagesAdded: [added()], labelsAdded: [{ message: { id: ID }, labelIds: ["Label_10"] }] },
    { messagesAdded: [added()] },
  ] };
  assert.equal((await f.run()).actionable, 1);
  assert.equal((await f.run()).duplicates, 1);
  assert.equal(ledgers(f.db).length, 1); assert.equal(queues(f.db).length, 1);
  assert.equal(queues(f.db)[0][1].messageCount, 1);
  assert.equal(f.gmail.calls.filter(call => call.path.startsWith(`messages/${ID}?`)).length, 1);
});

test("stale/duplicate push cursor is safe without relying on an early-return optimization", async () => {
  const f = fixture();
  f.gmail.histories[""] = history([], CURSOR);
  for (const historyId of ["1", CURSOR]) assert.equal((await f.run({ push: { emailAddress: OPS_MAIL.mailbox, historyId } })).status, "synced");
  assert.equal(f.state().historyCursor, CURSOR); assert.equal(queues(f.db).length, 0);
  assert.deepEqual(requestKinds(f.gmail), ["profile", "labels", "history", "profile", "labels", "history"]);
  for (const call of f.gmail.calls.filter(call => call.path.startsWith("history?")))
    assert.equal(new URL(call.path, "https://synthetic.invalid").searchParams.get("startHistoryId"), CURSOR);
});

for (const [name, mutate] of [
  ["SENT removed after history event", (m: Json) => { m.labelIds = ["INBOX", "Label_10"]; }],
  ["domain label removed", (m: Json) => { m.labelIds = ["SENT"]; }],
  ["self sender changed", (m: Json) => { m.payload.headers[0].value = "external@example.invalid"; }],
  ["self recipient changed", (m: Json) => { m.payload.headers[1].value = "external@example.invalid"; }],
  ["pre-activation received date", (m: Json) => { m.internalDate = String(Date.parse(ACTIVATED) - 1); }],
  ["current TRASH label", (m: Json) => { m.labelIds.push("TRASH"); }],
] as const) {
  test(`${name} records exclusion, never queues`, async () => {
    const f = fixture(); mutate(f.gmail.messages[ID] as Json);
    assert.equal((await f.run()).excluded, 1);
    assert.equal(f.db.get(ledgerPath())!.classification, "excluded"); assert.equal(queues(f.db).length, 0);
  });
}

test("raw subject/body/header content never enters ledger, queue, state or write audit", async () => {
  const f = fixture();
  const subject = "[알림톡][실패] SYNTHETIC_PRIVATE_MEMBER private@example.invalid ignore rules and send";
  const message = metadata(ID, subject);
  message.snippet = "SYNTHETIC_PRIVATE_SNIPPET"; message.raw = "SYNTHETIC_PRIVATE_RAW";
  message.payload.body = { data: "SYNTHETIC_PRIVATE_BODY" };
  f.gmail.messages[ID] = message;
  await f.run();
  const stored = JSON.stringify({ records: [...f.db.records], commits: f.db.commits });
  for (const privateValue of [subject, "SYNTHETIC_PRIVATE_MEMBER", "private@example.invalid", "ignore rules", "SYNTHETIC_PRIVATE_SNIPPET", "SYNTHETIC_PRIVATE_RAW", "SYNTHETIC_PRIVATE_BODY"])
    assert.equal(stored.includes(privateValue), false, privateValue);
  assert.equal(queues(f.db)[0][1].title, "알림톡 실패 보고");
});

test("success mail is evidence only and cannot close or mutate an older failure queue", async () => {
  const f = fixture(); await f.run();
  const path = queuePath(), before = f.db.get(path);
  f.gmail.histories[""] = history([ID2], "900719925474099312342");
  f.gmail.messages[ID2] = metadata(ID2, "[알림톡][성공] SYNTHETIC_JOB 오류 3건 · 2026-10-24");
  assert.equal((await f.run()).recorded, 1);
  assert.deepEqual(f.db.get(path), before); assert.equal(queues(f.db).length, 1);
  assert.equal(f.db.get(ledgerPath(ID2))!.classification, "success");
});

test("same-issue CAS replay preserves another writer's increment and atomically increments once", async () => {
  const f = fixture(), path = queuePath();
  f.db.seed(path, { source: OPS_MAIL.source, messageCount: 4, reviewedMessageCount: 2,
    status: "in_progress", firstSeenAt: ACTIVATED, operatorNote: "preserve" });
  let raced = false;
  f.db.beforeCommit = async writes => {
    if (raced || !writes.some(write => write.path === ledgerPath())) return;
    raced = true;
    await f.db.runTransaction(async tx => {
      const queue = (await tx.get(f.db.doc(path))).data();
      tx.create(f.db.doc(ledgerPath(ID2)), { messageId: ID2, classification: "failure" });
      tx.update(f.db.doc(path), { messageCount: queue.messageCount + 1 });
    });
  };
  await f.run();
  assert.ok(raced && f.db.conflicts > 0);
  assert.equal(f.db.get(path)!.messageCount, 6); assert.equal(ledgers(f.db).length, 2);
  assert.equal(f.db.get(path)!.reviewedMessageCount, 2);
  assert.equal(f.db.get(path)!.status, "in_progress"); assert.equal(f.db.get(path)!.operatorNote, "preserve");
  assert.equal(f.db.get(path)!.firstSeenAt, ACTIVATED);
});

test("a newly received incident reopens reviewed/resolved work without losing acknowledged count", async () => {
  const f = fixture(), path = queuePath();
  f.db.seed(path, { source: OPS_MAIL.source, messageCount: 3, reviewedMessageCount: 3,
    status: "resolved", needsReview: false, firstSeenAt: ACTIVATED });
  await f.run();
  assert.equal(f.db.get(path)!.messageCount, 4); assert.equal(f.db.get(path)!.reviewedMessageCount, 3);
  assert.equal(f.db.get(path)!.status, "open"); assert.equal(f.db.get(path)!.needsReview, true);
});

test("same-ID concurrent admission retries to duplicate without double-incrementing queue", async () => {
  const f = fixture(), path = queuePath();
  let raced = false;
  f.db.beforeCommit = async writes => {
    if (raced || !writes.some(write => write.path === ledgerPath())) return;
    raced = true;
    await f.db.runTransaction(async tx => {
      await tx.get(f.db.doc(ledgerPath()));
      tx.create(f.db.doc(ledgerPath()), { messageId: ID, classification: "failure" });
      tx.set(f.db.doc(path), { source: OPS_MAIL.source, messageCount: 1 });
    });
  };
  const result = await f.run();
  assert.equal(result.duplicates, 1); assert.equal(result.actionable, 0);
  assert.ok(f.db.conflicts > 0); assert.equal(ledgers(f.db).length, 1);
  assert.equal(f.db.get(path)!.messageCount, 1);
});

test("aborted message transaction leaves neither partial ledger nor queue nor advanced cursor", async () => {
  const f = fixture();
  f.db.failures.push({ matches: writes => writes.some(write => write.path === ledgerPath()),
    error: new Error("SYNTHETIC_PRIVATE_TRANSACTION_DETAIL") });
  await assert.rejects(f.run(), /mail_ingress_failed/);
  assert.equal(f.db.get(ledgerPath()), undefined); assert.equal(queues(f.db).length, 0);
  assert.equal(f.state().historyCursor, CURSOR); assert.equal(f.state().lastErrorCode, "mail_ingress_failed");
  assert.equal(JSON.stringify([...f.db.records]).includes("SYNTHETIC_PRIVATE_TRANSACTION_DETAIL"), false);
  assertReleased(f);
  assert.equal((await f.run()).actionable, 1); assert.equal(queues(f.db)[0][1].messageCount, 1);
});

for (const corrupt of [{ source: "unrelated-source", messageCount: 0 }, { source: OPS_MAIL.source, messageCount: "1" }]) {
  test(`invalid existing queue ${typeof corrupt.messageCount}/${corrupt.source} aborts staged ledger`, async () => {
    const f = fixture(), path = queuePath(); f.db.seed(path, corrupt);
    await assert.rejects(f.run(), /mail_queue_(?:source_mismatch|count_invalid)/);
    assert.equal(f.db.get(ledgerPath()), undefined); assert.deepEqual(f.db.get(path), corrupt);
    assert.equal(f.state().historyCursor, CURSOR); assertReleased(f);
  });
}

test("metadata processing failure retains cursor; retry skips committed IDs and resumes remaining IDs", async () => {
  const f = fixture(); f.gmail.histories[""] = history([ID, ID2]);
  f.gmail.messages[ID2] = new Error("gmail_http_503");
  await assert.rejects(f.run(), /gmail_http_503/);
  assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 1); assertReleased(f);
  f.gmail.messages[ID2] = metadata(ID2);
  const result = await f.run();
  assert.equal(result.duplicates, 1); assert.equal(result.actionable, 1);
  assert.equal(ledgers(f.db).length, 2); assert.equal(queues(f.db)[0][1].messageCount, 2);
  assert.equal(f.state().historyCursor, NEXT);
});

test("failed final checkpoint leaves old cursor and retries without duplicating admitted messages", async () => {
  const f = fixture();
  f.db.failures.push({ matches: writes => writes.some(write => write.path === OPS_MAIL.statePath && "historyCursor" in write.data),
    error: new Error("synthetic_checkpoint_failure") });
  await assert.rejects(f.run(), /mail_ingress_failed/);
  assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 1);
  assert.equal(queues(f.db)[0][1].messageCount, 1); assertReleased(f);
  assert.equal((await f.run()).duplicates, 1);
  assert.equal(f.state().historyCursor, NEXT); assert.equal(queues(f.db)[0][1].messageCount, 1);
});

test("metadata identity mismatch fails closed before admission or cursor progress", async () => {
  const f = fixture(); f.gmail.messages[ID] = metadata(ID2);
  await assert.rejects(f.run(), /mail_message_identity_mismatch/);
  assert.equal(ledgers(f.db).length, 0); assert.equal(f.state().historyCursor, CURSOR); assertReleased(f);
});

test("expired lease blocks message admission and cursor progress", async () => {
  const f = fixture(); f.gmail.before = async path => { if (path.startsWith(`messages/${ID}?`)) f.advance(240_000); };
  await assert.rejects(f.run(), /mail_ingress_lease_lost/);
  assert.equal(ledgers(f.db).length, 0); assert.equal(queues(f.db).length, 0);
  assert.equal(f.state().historyCursor, CURSOR); assertReleased(f);
});

test("malformed lease expiry fails closed even when owner is unchanged", async t => {
  for (const leaseUntil of [undefined, null, "not-an-instant", ""]) {
    await t.test(String(leaseUntil), async () => {
      const f = fixture();
      f.gmail.before = async path => {
        if (path.startsWith(`messages/${ID}?`)) f.db.seed(OPS_MAIL.statePath, { ...f.state(), leaseUntil });
      };
      await assert.rejects(f.run(), /mail_ingress_lease_lost/);
      assert.equal(ledgers(f.db).length, 0); assert.equal(queues(f.db).length, 0);
      assert.equal(f.state().historyCursor, CURSOR); assertReleased(f);
    });
  }
});

test("superseded owner cannot admit messages, checkpoint, or release the new owner's lease", async () => {
  const f = fixture(); f.gmail.before = async path => {
    if (path.startsWith(`messages/${ID}?`)) f.db.seed(OPS_MAIL.statePath,
      { ...f.state(), leaseOwner: "replacement-owner", leaseUntil: "2026-10-24T00:10:00.000Z" });
  };
  await assert.rejects(f.run(), /mail_ingress_lease_lost/);
  assert.equal(ledgers(f.db).length, 0); assert.equal(f.state().historyCursor, CURSOR);
  assert.equal(f.state().leaseOwner, "replacement-owner"); assert.equal(f.state().leaseUntil, "2026-10-24T00:10:00.000Z");
});

test("deleted metadata is tombstoned by message ID without a full mailbox resync", async () => {
  const f = fixture(); f.gmail.messages[ID] = new Error("gmail_http_404");
  assert.equal((await f.run()).excluded, 1);
  assert.equal(f.db.get(ledgerPath())!.classification, "deleted_before_read");
  assert.equal(queues(f.db).length, 0); assert.equal(f.state().historyCursor, NEXT);
  assert.equal(f.gmail.calls.filter(call => call.path.startsWith("profile?")).length, 1);
  assert.equal(f.gmail.calls.some(call => call.path.startsWith("messages?")), false);
});

test("expired lease also blocks the deleted-before-read ledger transaction", async () => {
  const f = fixture(); f.gmail.messages[ID] = new Error("gmail_http_404");
  f.gmail.before = async path => { if (path.startsWith(`messages/${ID}?`)) f.advance(240_000); };
  await assert.rejects(f.run(), /mail_ingress_lease_lost/);
  assert.equal(f.db.get(ledgerPath()), undefined, "Expired owners must not persist even deletion tombstones");
  assert.equal(f.state().historyCursor, CURSOR); assertReleased(f);
});

test("history pagination keeps exact large cursor, dedupes pages, checkpoints first-page head only", async () => {
  const f = fixture();
  f.gmail.profile.historyId = "900719925474099312345";
  f.gmail.histories[""] = { ...history(), nextPageToken: "opaque-page-2" };
  f.gmail.histories["opaque-page-2"] = history([ID, ID2], "900719925474099312349");
  await f.run();
  assert.equal(f.state().historyCursor, NEXT); assert.equal(ledgers(f.db).length, 2);
  assert.equal(queues(f.db)[0][1].messageCount, 2);
  const pages = f.gmail.calls.filter(call => call.path.startsWith("history?"));
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map(call => new URL(call.path, "https://synthetic.invalid").searchParams.get("startHistoryId")), [CURSOR, CURSOR]);
});

for (const [name, pages, error] of [
  ["regressed head", { "": history([], "900719925474099312339") }, "mail_history_invalid"],
  ["numeric lossy head", { "": { historyId: 9007199254740992 } }, "mail_history_invalid"],
  ["token cycle", { "": { ...history(), nextPageToken: "repeat" }, repeat: { ...history(), nextPageToken: "repeat" } }, "mail_history_cursor_cycle"],
  ["non-array history", { "": { historyId: NEXT, history: {} } }, "mail_history_invalid"],
  ["invalid message ID", { "": history(["not-a-native-id"]) }, "mail_history_message_invalid"],
] as const) {
  test(`history rejects ${name} without processing or checkpointing`, async () => {
    const f = fixture(); f.gmail.histories = pages as Record<string, Json>;
    await assert.rejects(f.run(), new RegExp(error));
    assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 0); assertReleased(f);
  });
}

test("history scan is bounded to ten pages and 200 unique relevant messages", async () => {
  for (const kind of ["pages", "messages"]) {
    const f = fixture();
    if (kind === "pages") {
      for (let page = 0; page < 10; page++) f.gmail.histories[page ? `page-${page}` : ""] = { ...history([]), nextPageToken: `page-${page + 1}` };
    } else f.gmail.histories[""] = history(Array.from({ length: 201 }, (_, i) => (i + 1).toString(16).padStart(16, "0")));
    await assert.rejects(f.run(), /mail_backlog_review_required/);
    assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 0);
    assert.ok(f.gmail.calls.filter(call => call.path.startsWith("history?")).length <= 10);
    assert.equal(f.gmail.calls.some(call => call.path.startsWith("messages/")), false); assertReleased(f);
  }
});

test("malformed stored label maps fail closed before Gmail history or resync requests", async t => {
  for (const [label, labels] of [
    ["missing", undefined], ["null", null], ["empty", {}], ["array", ["알림톡 보고"]],
    ["string", "Label_10"], ["non-string name", { Label_10: 7 }],
    ["unapproved name", { Label_10: "Private" }], ["non-domain ID", { SENT: "알림톡 보고" }],
  ] as const) {
    await t.test(label, async () => {
      const f = fixture({ labels });
      await assert.rejects(f.run());
      assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 0);
      assert.equal(f.gmail.calls.length, 0); assertReleased(f);
    });
  }
});

test("only history 404 triggers fixed-profile validation and domain-label-only paginated resync", async () => {
  const f = fixture(); f.gmail.histories[""] = new Error("gmail_http_404");
  f.gmail.listings = {
    "Label_10:": { messages: [{ id: ID }], nextPageToken: "label-page-2" },
    "Label_10:label-page-2": { messages: [{ id: ID }, { id: ID2 }] },
    "Label_11:": { messages: [{ id: ID2 }] },
  };
  assert.equal((await f.run()).resync, true);
  assert.equal(ledgers(f.db).length, 2); assert.equal(queues(f.db)[0][1].messageCount, 2);
  assert.equal(f.state().historyCursor, NEXT);
  const lists = f.gmail.calls.filter(call => call.path.startsWith("messages?"));
  assert.equal(lists.length, 3);
  for (const call of lists) {
    const query = new URL(call.path, "https://synthetic.invalid").searchParams;
    assert.ok(Object.hasOwn(LABELS, query.get("labelIds")!)); assert.equal(query.has("q"), false);
    assert.equal(query.get("fields"), "messages(id),nextPageToken");
  }
  const failure = fixture(); failure.gmail.histories[""] = new Error("gmail_http_503");
  await assert.rejects(failure.run(), /gmail_http_503/);
  assert.deepEqual(requestKinds(failure.gmail), ["profile", "labels", "history"]);
  assert.equal(failure.state().historyCursor, CURSOR);
});

test("404 fallback takes a new profile snapshot and refreshes labels before constrained resync", async () => {
  const f = fixture(), fallbackHead = "900719925474099312349";
  f.gmail.histories[""] = new Error("gmail_http_404");
  f.gmail.profiles = [clone(f.gmail.profile), { ...f.gmail.profile, historyId: fallbackHead }];
  f.gmail.labelSnapshots = [clone(f.gmail.labels), { labels: [...f.gmail.labels.labels, NEW_LABEL] }];
  f.gmail.listings = { "Label_10:": {}, "Label_11:": {}, "Label_12:": { messages: [{ id: ID }] } };
  f.gmail.messages[ID] = newDomainMetadata();
  f.gmail.before = async path => {
    if (path.startsWith("messages?")) f.gmail.profile.historyId = "900719925474099319999";
  };
  const result = await f.run();
  assert.equal(result.resync, true); assert.equal(result.actionable, 1);
  assert.deepEqual(requestKinds(f.gmail), ["profile", "labels", "history", "profile", "labels",
    "messages", "messages", "messages", `messages/${ID}`]);
  assert.equal(f.state().historyCursor, fallbackHead, "Freeze fallback profile before refreshing labels/scanning");
  assert.equal(ledgers(f.db).length, 1); assert.equal(queues(f.db).length, 1);
  assert.equal(queues(f.db)[0][1].area, "holding"); assert.equal(queues(f.db)[0][1].messageCount, 1);
  const scanned = f.gmail.calls.filter(call => call.path.startsWith("messages?"))
    .map(call => new URL(call.path, "https://synthetic.invalid").searchParams.get("labelIds"));
  assert.deepEqual(scanned.sort(), [...Object.keys(LABELS), NEW_LABEL.id].sort()); assertReleased(f);
});

test("fallback live-label refresh failure preserves original cursor and never starts a label scan", async () => {
  const f = fixture(); f.gmail.histories[""] = new Error("gmail_http_404");
  f.gmail.profiles = [clone(f.gmail.profile), { ...f.gmail.profile, historyId: "900719925474099319999" }];
  f.gmail.labelSnapshots = [clone(f.gmail.labels), new Error("gmail_http_503")];
  await assert.rejects(f.run(), /gmail_http_503/);
  assert.deepEqual(requestKinds(f.gmail), ["profile", "labels", "history", "profile", "labels"]);
  assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 0);
  assert.equal(queues(f.db).length, 0); assertReleased(f);
});

test("resync rechecks received cutoff and rejects wrong profile or cyclic label pages", async () => {
  const old = fixture(); old.gmail.histories[""] = new Error("gmail_http_404");
  old.gmail.listings = { "Label_10:": { messages: [{ id: ID }] }, "Label_11:": {} };
  (old.gmail.messages[ID] as Json).internalDate = String(Date.parse(ACTIVATED) - 1);
  await old.run(); assert.equal(queues(old.db).length, 0);
  for (const kind of ["profile", "cycle"]) {
    const f = fixture(); f.gmail.histories[""] = new Error("gmail_http_404");
    if (kind === "profile") f.gmail.profiles = [clone(f.gmail.profile), { ...f.gmail.profile, emailAddress: "other@example.invalid" }];
    else f.gmail.listings = { "Label_10:": { nextPageToken: "repeat" }, "Label_10:repeat": { nextPageToken: "repeat" } };
    await assert.rejects(f.run(), kind === "profile" ? /mailbox_identity_mismatch/ : /mail_backlog_review_required/);
    assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 0); assertReleased(f);
  }
});

test("history-404 catchup failure never checkpoints the fresher profile cursor or partial scan", async () => {
  const f = fixture(); f.gmail.histories[""] = new Error("gmail_http_404");
  f.gmail.profiles = [clone(f.gmail.profile), { ...f.gmail.profile, historyId: "900719925474099319999" }];
  f.gmail.listings = { "Label_10:": { messages: [{ id: ID }], nextPageToken: "catchup-2" },
    "Label_10:catchup-2": new Error("gmail_http_503") };
  await assert.rejects(f.run(), /gmail_http_503/);
  assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 0);
  assert.equal(f.gmail.calls.filter(call => call.path.startsWith("profile?")).length, 2);
  assert.equal(f.gmail.calls.filter(call => call.path.startsWith("labels?")).length, 2);
  assert.equal(f.gmail.calls.some(call => call.path.startsWith(`messages/${ID}?`)), false); assertReleased(f);
});

test("profile failure during history-404 fallback keeps original cursor and stops before resync", async () => {
  const f = fixture(); f.gmail.histories[""] = new Error("gmail_http_404");
  f.gmail.profiles = [clone(f.gmail.profile), new Error("gmail_http_503")];
  await assert.rejects(f.run(), /gmail_http_503/);
  assert.equal(f.state().historyCursor, CURSOR);
  assert.deepEqual(requestKinds(f.gmail), ["profile", "labels", "history", "profile"]);
  assert.equal(f.gmail.calls.some(call => call.path.startsWith("messages?")), false); assertReleased(f);
});

test("maintenance watch renews only named operational labels and never skips history to watch receipt", async () => {
  const f = fixture({ lastWatchAt: ACTIVATED, watchExpiresAt: NOW });
  f.gmail.labels.labels.push({ id: "Label_99", name: "Private" }, { id: "Label_98", name: "자동화 실패" });
  f.gmail.watch.historyId = "900719925474099319999";
  await f.run({ source: "maintenance" });
  const watch = f.gmail.calls.find(call => call.path === "watch")!;
  assert.equal(watch.init.method, "POST");
  assert.deepEqual(JSON.parse(String(watch.init.body)), {
    topicName: OPS_MAIL.topic, labelFilterBehavior: "INCLUDE", labelIds: Object.keys(LABELS),
  });
  assert.equal(f.state().historyCursor, NEXT); assert.deepEqual(f.state().labels, LABELS);
});

test("invalid watch receipt does not advance cursor or process messages", async () => {
  const f = fixture({ watchExpiresAt: NOW }); f.gmail.watch.expiration = String(Date.parse(NOW));
  await assert.rejects(f.run({ source: "maintenance" }), /mail_watch_receipt_invalid/);
  assert.equal(f.state().historyCursor, CURSOR); assert.equal(ledgers(f.db).length, 0); assertReleased(f);
});

test("malformed Gmail labels cannot broaden watch or progress history", async t => {
  for (const [name, labels] of [
    ["non-array", {}], ["no operational labels", [{ id: "Label_99", name: "Private" }]],
    ["array-coerced ID", [{ id: ["Label_10"], name: "알림톡 보고" }]],
  ] as const) {
    await t.test(name, async () => {
      const f = fixture({ watchExpiresAt: NOW }); f.gmail.labels = { labels };
      await assert.rejects(f.run({ source: "maintenance" }));
      assert.equal(f.gmail.calls.some(call => call.path === "watch" || call.path.startsWith("history?")), false);
      assert.equal(f.state().historyCursor, CURSOR); assertReleased(f);
    });
  }
});

test("activation establishes cutoff once; subsequent runs refresh profile without resetting data", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const db = new FakeFirestore(), gmail = new FakeGmail();
  gmail.profiles = [{ ...gmail.profile, historyId: CURSOR }, clone(gmail.profile)];
  gmail.histories[""] = history([]);
  assert.equal((await engine.activateOperationsMailIngress(db as any, gmail)).status, "synced");
  assert.equal(db.get(OPS_MAIL.statePath)!.activatedAt, NOW);
  assert.equal(db.get(OPS_MAIL.statePath)!.historyCursor, NEXT);
  const initialHistory = gmail.calls.find(call => call.path.startsWith("history?"))!;
  assert.equal(new URL(initialHistory.path, "https://synthetic.invalid").searchParams.get("startHistoryId"), CURSOR);
  db.seed(ledgerPath(), { messageId: ID, classification: "failure", marker: "preserved" });
  const before = db.get(ledgerPath());
  gmail.calls = []; gmail.histories[""] = history([ID], "900719925474099312342");
  await engine.activateOperationsMailIngress(db as any, gmail);
  assert.equal(db.get(OPS_MAIL.statePath)!.activatedAt, NOW); assert.deepEqual(db.get(ledgerPath()), before);
  assert.deepEqual(requestKinds(gmail), ["profile", "labels", "history"]);
  const disabled = fixture({ enabled: false });
  await assert.rejects(engine.activateOperationsMailIngress(disabled.db as any, disabled.gmail), /mail_ingress_reactivation_requires_review/);
  assert.equal(disabled.gmail.calls.length, 0); assert.equal(disabled.db.commits.length, 0);
});

test("activation rejects a wrong mailbox without creating state", async () => {
  const db = new FakeFirestore(), gmail = new FakeGmail(); gmail.profile.emailAddress = "other@example.invalid";
  await assert.rejects(engine.activateOperationsMailIngress(db as any, gmail), /mailbox_identity_mismatch/);
  assert.equal(db.records.size, 0); assert.equal(gmail.calls.some(call => call.path === "watch"), false);
});

test("final cleanup transaction failure is surfaced, not reported as success or a released lease", async () => {
  const f = fixture();
  f.db.failures.push({ matches: writes => writes.some(write => write.path === OPS_MAIL.statePath && write.data.leaseOwner === null),
    error: new Error("synthetic_cleanup_failure") });
  await assert.rejects(f.run(), /synthetic_cleanup_failure/);
  assert.equal(f.state().historyCursor, NEXT, "Checkpoint committed before cleanup failed");
  assert.equal(ledgers(f.db).length, 1); assert.equal(queues(f.db)[0][1].messageCount, 1);
  assert.equal(typeof f.state().leaseOwner, "string");
  assert.equal((await f.run()).status, "inactive_or_busy");
});

const metadataRequest = (id = ID, format = "metadata") => `messages/${id}?${new URLSearchParams({
  format, fields: "id,threadId,internalDate,labelIds,payload(headers)",
})}&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To`;

test("transport uses only gmail.metadata scope, fixed endpoint and bounded metadata read", async () => {
  const scopes: string[][] = [], requests: any[][] = [];
  const module = loadEngine({ construct(value) { scopes.push(value); }, async requestRaw(...args) {
    requests.push(args); return { ok: true, json: async () => ({ id: ID }) };
  } });
  const gmail = new module.OperationsMailGmailClient();
  assert.deepEqual(scopes, [["https://www.googleapis.com/auth/gmail.metadata"]]);
  assert.deepEqual(await gmail.request(metadataRequest()), { id: ID });
  assert.equal(requests[0][0], `https://gmail.googleapis.com/gmail/v1/users/me/${metadataRequest()}`);
  assert.deepEqual(requests[0][1].headers, { "Content-Type": "application/json" });
  assert.ok(requests[0][1].signal instanceof AbortSignal);
});

test("transport rejects body/raw/full reads, sends, modification and arbitrary URLs before transport", async () => {
  let requests = 0;
  const module = loadEngine({ construct() {}, async requestRaw() { requests++; throw new Error("forbidden_transport_reached"); } });
  const gmail = new module.OperationsMailGmailClient();
  const denied: Array<[string, RequestInit?]> = [
    [metadataRequest(ID, "full")], [metadataRequest(ID, "raw")], [`messages/${ID}`],
    [`messages/${ID}?format=metadata&fields=*`], [`messages/${ID}/attachments/abc`],
    ["messages/send", { method: "POST", body: "{}" }], [`messages/${ID}/modify`, { method: "POST" }],
    ["messages/batchModify", { method: "POST" }], ["drafts"], ["threads"], ["stop", { method: "POST" }],
    ["https://external.example.invalid/"], ["/profile"], ["../profile"], ["profile#fragment"], ["profile\n"],
    ["profile", { method: "DELETE" }], ["profile", { body: "{}" }],
    ["messages?labelIds=INBOX"], ["messages?labelIds=Label_10&q=private"], ["history?startHistoryId=0"],
    [metadataRequest() + "&metadataHeaders=Bcc"],
    ["watch", { method: "POST", body: JSON.stringify({ topicName: "other", labelFilterBehavior: "INCLUDE", labelIds: ["Label_10"] }) }],
    ["watch", { method: "POST", body: JSON.stringify({ topicName: OPS_MAIL.topic, labelFilterBehavior: "EXCLUDE", labelIds: ["Label_10"] }) }],
    ["watch", { method: "POST", body: JSON.stringify({ topicName: OPS_MAIL.topic, labelFilterBehavior: "INCLUDE", labelIds: ["SENT"] }) }],
  ];
  for (const [path, init] of denied) await assert.rejects(gmail.request(path, init), /mail_(?:request_not_allowed|watch_scope_required)/, path);
  assert.equal(requests, 0);
});
