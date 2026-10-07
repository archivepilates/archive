import assert from "node:assert/strict";
import test from "node:test";
import { selectHoldingQueueCandidates } from "../../firebase/kangsain-functions/functions/src/alimtalk/holdingQueueSelection";
import { HOLDING_NOTICE_TEMPLATE_CODE, isHoldingNoticeCandidate } from "../../firebase/kangsain-functions/functions/src/alimtalk/holdingNoticeQueue";

type Data = Record<string, unknown>;
type Snapshot = { id: string; data(): Data };
type PageCall = { cursor?: Snapshot; limit: number; docs: Snapshot[] };

class Store {
  rows = new Map<string, Data>();
  calls: PageCall[] = [];
  emitted = new Set<Snapshot>();

  add(id: string, holding = false, extra: Data = {}) {
    this.rows.set(id, { candidateId: id, status: "queued", type: "reservation_open",
      ...(holding ? { type: "manual_review", templateCode: HOLDING_NOTICE_TEMPLATE_CODE } : {}), ...extra });
  }

  query(cursor?: Snapshot, limit = Infinity) {
    const store = this;
    return {
      limit(count: number) { return store.query(cursor, count); },
      startAfter(snapshot: Snapshot) {
        assert.ok(store.emitted.has(snapshot), "cursor must be the original snapshot, not an ID or offset");
        return store.query(snapshot, limit);
      },
      async get(): Promise<{ docs: Snapshot[] }> {
        const docs = [...store.rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .filter(([id, data]) => (!cursor || id > cursor.id) && ["queued", "processing"].includes(String(data.status)))
          .slice(0, limit).map(([id, data]) => ({ id, data: () => ({ ...data }) }));
        for (const snapshot of docs) store.emitted.add(snapshot);
        store.calls.push({ cursor, limit, docs });
        return { docs };
      },
    };
  }

  completeNonHolding(candidates: Snapshot[]) {
    for (const snapshot of candidates) {
      if (!isHoldingNoticeCandidate(snapshot.data())) this.rows.get(snapshot.id)!.status = "sent";
    }
  }
}

const id = (prefix: string, index: number) => `${prefix}_${String(index).padStart(5, "0")}`;
const generic = (candidates: Snapshot[]) => candidates.filter(snapshot => !isHoldingNoticeCandidate(snapshot.data()));
const holding = (candidates: Snapshot[]) => candidates.filter(snapshot => isHoldingNoticeCandidate(snapshot.data()));

test("empty shared queue returns no candidates and reads one bounded page", async () => {
  const store = new Store();
  assert.deepEqual(await selectHoldingQueueCandidates(store.query()), []);
  assert.equal(store.calls.length, 1);
  assert.equal(store.calls[0].limit, 20);
  assert.equal(store.calls[0].cursor, undefined);
});

test("disabled/nonclaimable holding rows cannot starve normal sends across repeated runs", async () => {
  const store = new Store();
  for (let i = 0; i < 65; i++) store.add(id("holding", i), true);
  for (let i = 0; i < 3; i++) store.add(id("reservation", i));

  const first = await selectHoldingQueueCandidates(store.query());
  assert.deepEqual(generic(first).map(snapshot => snapshot.id), [0, 1, 2].map(i => id("reservation", i)));
  assert.equal(holding(first).length, 1);
  assert.equal(first.at(-1)!.id, id("holding", 0));
  assert.equal(store.calls.length, 4);
  for (let i = 1; i < store.calls.length; i++) {
    assert.equal(store.calls[i].cursor, store.calls[i - 1].docs.at(-1));
    assert.equal(store.calls[i].limit, 20);
  }

  // Model generic completion while the disabled holding family remains entirely queued.
  store.completeNonHolding(first);
  for (let i = 3; i < 5; i++) store.add(id("reservation", i));
  const second = await selectHoldingQueueCandidates(store.query());
  assert.deepEqual(generic(second).map(snapshot => snapshot.id), [3, 4].map(i => id("reservation", i)));
  assert.equal(holding(second).length, 1);
  assert.equal(holding(second)[0].id, id("holding", 0));
  assert.equal([...store.rows.values()].filter(data => data.type === "manual_review" && data.status === "queued").length, 65);
});

test("holding-only full pages are exhausted without selecting duplicate holding work", async () => {
  const store = new Store();
  for (let i = 0; i < 40; i++) store.add(id("holding", i), true, { status: "processing" });
  const candidates = await selectHoldingQueueCandidates(store.query());
  assert.deepEqual(candidates.map(snapshot => snapshot.id), [id("holding", 0)]);
  assert.equal(store.calls.length, 3);
  assert.equal(store.calls.at(-1)!.docs.length, 0);
});

test("normal queue preserves ordering and the existing twenty-candidate cap across runs", async () => {
  const store = new Store();
  for (let i = 0; i < 45; i++) store.add(id("reservation", i));
  for (const [start, count] of [[0, 20], [20, 20], [40, 5]]) {
    const candidates = await selectHoldingQueueCandidates(store.query());
    assert.deepEqual(candidates.map(snapshot => snapshot.id), Array.from({ length: count }, (_, i) => id("reservation", start + i)));
    assert.equal(holding(candidates).length, 0);
    store.completeNonHolding(candidates);
  }
  assert.deepEqual(await selectHoldingQueueCandidates(store.query()), []);
  assert.equal(store.calls.length, 4);
});

test("mixed pages keep twenty normal candidates plus at most one holding candidate", async () => {
  const store = new Store();
  for (let i = 0; i < 80; i++) store.add(id("mixed", i), i % 4 !== 0);
  const candidates = await selectHoldingQueueCandidates(store.query());
  assert.deepEqual(generic(candidates).map(snapshot => snapshot.id), Array.from({ length: 20 }, (_, i) => id("mixed", i * 4)));
  assert.deepEqual(holding(candidates).map(snapshot => snapshot.id), [id("mixed", 1)]);
  assert.equal(candidates.length, 21);
  assert.equal(new Set(candidates.map(snapshot => snapshot.id)).size, 21);
  assert.equal(store.calls.length, 4);
});

test("holding-heavy queues still cap normal work at twenty and leave the rest for later runs", async () => {
  const store = new Store();
  for (let i = 0; i < 21; i++) store.add(id("holding", i), true);
  for (let i = 0; i < 25; i++) store.add(id("reservation", i));
  const first = await selectHoldingQueueCandidates(store.query());
  assert.equal(generic(first).length, 20);
  assert.equal(holding(first).length, 1);
  store.completeNonHolding(first);
  const second = await selectHoldingQueueCandidates(store.query());
  assert.deepEqual(generic(second).map(snapshot => snapshot.id), [20, 21, 22, 23, 24].map(i => id("reservation", i)));
  assert.equal(holding(second).length, 1);
});

test("no fixed page cap restores starvation behind a large holding backlog", async () => {
  const store = new Store();
  for (let i = 0; i < 2040; i++) store.add(id("holding", i), true);
  store.add(id("reservation", 0));
  const candidates = await selectHoldingQueueCandidates(store.query());
  assert.deepEqual(generic(candidates).map(snapshot => snapshot.id), [id("reservation", 0)]);
  assert.equal(holding(candidates).length, 1);
  assert.equal(store.calls.length, 103);
});

test("malformed holding payload markers never consume the normal selection budget", async () => {
  const store = new Store();
  for (let i = 0; i < 30; i++) store.add(id("holding", i), false, {
    templateCode: "wrong", payload: i % 2 ? { holdingNotice: false } : { holdingSourceId: "invalid" },
  });
  store.add(id("reservation", 0));
  const candidates = await selectHoldingQueueCandidates(store.query());
  assert.deepEqual(generic(candidates).map(snapshot => snapshot.id), [id("reservation", 0)]);
  assert.equal(holding(candidates).length, 1);
  assert.equal(store.calls.length, 2);
});
