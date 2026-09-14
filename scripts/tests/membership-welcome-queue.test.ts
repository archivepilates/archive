import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  dispatchMembershipWelcome,
  inspectMembershipWelcome,
  queueMembershipWelcome,
  MEMBERSHIP_AUTOMATION_SETTINGS,
  MEMBERSHIP_CONTRACT_COLLECTION,
  MEMBERSHIP_READBACK_REQUESTS,
  MEMBERSHIP_WELCOME_CLAIMS,
  type MembershipWelcomeDependencies,
} from "../../firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomeQueue";
import {
  MEMBERSHIP_WELCOME_TEMPLATE,
  membershipWelcomeKey,
  planMembershipContractWelcome,
} from "../../firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomePolicy";
import { membershipContractJobKey } from "../../firebase/kangsain-functions/functions/src/memberSignup/membershipContractPolicy";

type Data = Record<string, unknown>;
type Ref = { path: string; id: string; get(): Promise<Snapshot> };
type Snapshot = {
  ref: Ref;
  id: string;
  exists: boolean;
  data(): Data | undefined;
};
type Write = { kind: "create" | "update"; path: string; data: Data };
const SOURCE_ID = "a".repeat(64);
const SOURCE_PATH = `${MEMBERSHIP_CONTRACT_COLLECTION}/${SOURCE_ID}`;
const STUDIO = "studio-synthetic-1";
const PHONE = "01000000001";
const MEMBER = "100";
const CANDIDATE_ID = membershipWelcomeKey(STUDIO, PHONE);
const CANDIDATE_PATH = `alimtalkCandidates/${CANDIDATE_ID}`;
const READBACK_REQUEST_PATH = `${MEMBERSHIP_READBACK_REQUESTS}/membership_contract_readback_${SOURCE_ID}`;
const memberClaim = (memberId: string): string =>
  `member_${createHash("sha256")
    .update(JSON.stringify({ studio: STUDIO, id: memberId }))
    .digest("hex")}`;
const claimPath = (id: string): string => `${MEMBERSHIP_WELCOME_CLAIMS}/${id}`;
const data = (value: unknown): Data => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Data;
};

/** Shape reused from scripts/lib/studiomate-membership-welcome.test.mjs; no real records. */
function fixture() {
  const observed = "2026-09-14T03:00:00.000Z";
  const selection = {
    now: observed,
    member: {
      memberId: MEMBER,
      identityVerified: true,
      classification: "member",
    },
    ticket: {
      memberId: MEMBER,
      userTicketId: "200",
      productId: "300",
      identityVerified: true,
      classification: "regular",
      status: "active",
      refunded: false,
      cancelled: false,
      issuedAt: "2026-09-14T02:30:00.000Z",
      source: {
        kind: "studiomate_member_excel",
        verified: true,
        complete: true,
        capturedAt: "2026-09-14T02:50:00.000Z",
      },
      payment: {
        verified: true,
        complete: true,
        status: "paid",
        totalAmount: 100000,
        paidAmount: 100000,
        outstandingAmount: 0,
        refundedAmount: 0,
        transactions: [
          {
            paymentId: "synthetic-payment",
            method: "card",
            status: "paid",
            amount: 100000,
            paidAt: "2026-09-14T02:31:00.000Z",
          },
        ],
      },
    },
    policy: {
      regularProductIds: ["300"],
      termsVersion: "v1",
      cutoverAt: "2026-09-14T00:00:00.000Z",
      maxSourceAgeMs: 3600000,
      maxIssuanceAgeMs: 3600000,
    },
    history: {
      previousIssuanceIds: [],
      currentIssuanceIds: ["200"],
      baselineCapturedAt: "2026-09-14T02:00:00.000Z",
      purchases: {
        memberId: MEMBER,
        authoritative: true,
        complete: true,
        asOf: observed,
        priorRegularIssuanceIds: [],
      },
      contracts: {
        memberId: MEMBER,
        authoritative: true,
        complete: true,
        asOf: observed,
        records: [],
      },
    },
  };
  const completion = {
    source: "studiomate_native_contract",
    authoritative: true,
    contractId: SOURCE_ID,
    studioId: STUDIO,
    memberPhone: PHONE,
    currentPhone: PHONE,
    memberId: MEMBER,
    userTicketId: "200",
    productId: "300",
    contractAction: "first_purchase_contract",
    selectionJobKey: membershipContractJobKey(MEMBER, "200"),
    checkedAt: "2026-09-14T03:55:00.000Z",
    signedAt: "2026-09-14T03:50:00.000Z",
    memberClassification: "member",
    ticketClassification: "regular",
    currentRecipientEligible: true,
    identityVerified: true,
    nativePhoneMatchCount: 1,
    refunded: false,
    cancelled: false,
    ticketStatus: "active",
    paymentStatus: "paid",
    paidAmount: 100000,
    outstandingAmount: 0,
    status: "signed",
    memberSigned: true,
    centerSigned: true,
  };
  return {
    now: "2026-09-14T04:00:00.000Z",
    source: {
      schemaVersion: 1,
      source: "studiomate_native_contract",
      bindingVerified: true,
      contractId: SOURCE_ID,
      studioId: STUDIO,
      memberName: "SYNTHETIC MEMBER",
      status: "signed",
      selection,
      completion,
      nativeReadback: {
        member: {
          source: "studiomate_native_member",
          verified: true,
          complete: true,
          checkedAt: "2026-09-14T04:00:00.000Z",
          studioId: STUDIO,
          memberId: MEMBER,
          phone: PHONE,
          phoneMatchCount: 1,
          classification: "member",
          currentRecipientEligible: true,
        },
        ticket: {
          source: "studiomate_native_ticket",
          verified: true,
          complete: true,
          checkedAt: "2026-09-14T04:00:00.000Z",
          studioId: STUDIO,
          memberId: MEMBER,
          userTicketId: "200",
          productId: "300",
          classification: "regular",
          status: "active",
          refunded: false,
          cancelled: false,
        },
        payment: {
          source: "studiomate_native_payment",
          verified: true,
          complete: true,
          checkedAt: "2026-09-14T04:00:00.000Z",
          studioId: STUDIO,
          memberId: MEMBER,
          userTicketId: "200",
          productId: "300",
          status: "paid",
          totalAmount: 100000,
          paidAmount: 100000,
          outstandingAmount: 0,
          refundedAmount: 0,
        },
        providerSignature: {
          source: "studiomate_native_contract",
          verified: true,
          complete: true,
          checkedAt: "2026-09-14T04:00:00.000Z",
          studioId: STUDIO,
          memberId: MEMBER,
          userTicketId: "200",
          productId: "300",
          contractId: SOURCE_ID,
          signedAt: completion.signedAt,
        },
      },
    },
    config: {
      enabled: true,
      mode: "live",
      sourcePromoted: true,
      nativeE2eVerified: true,
      studioId: STUDIO,
      cutoverAt: "2026-09-14T00:00:00.000Z",
    },
    evidence: {
      template: {
        ...structuredClone(MEMBERSHIP_WELCOME_TEMPLATE),
        status: "APPROVED",
      },
      history: {
        authoritative: true,
        complete: true,
        allVersions: true,
        allTime: true,
        memberAliasesComplete: true,
        providerComplete: true,
        studioId: STUDIO,
        phone: PHONE,
        checkedAt: "2026-09-14T03:56:00.000Z",
        records: [] as Data[],
        memberIds: [MEMBER, "101"],
      },
      recipientIssue: "",
    },
  };
}

/** Serialized transactions model Firestore's successful retry outcome. Writes are staged
 * atomically; failed callbacks/commits leave no partial data. No Firebase runtime is loaded. */
class FakeFirestore {
  private readonly rows = new Map<string, Data>();
  readonly writes: Write[] = [];
  readonly reads: string[] = [];
  transactionCalls = 0;
  batchCalls = 0;
  failBatch = false;
  failTransactionCommit = false;
  beforeTransaction?: () => void | Promise<void>;
  private tail: Promise<void> = Promise.resolve();
  put(path: string, value: Data): void {
    this.rows.set(path, structuredClone(value));
  }
  remove(path: string): void {
    this.rows.delete(path);
  }
  row(path: string): Data | undefined {
    const row = this.rows.get(path);
    return row ? structuredClone(row) : undefined;
  }
  entries(prefix: string): Array<[string, Data]> {
    return [...this.rows.entries()]
      .filter(([path]) => path.startsWith(`${prefix}/`))
      .map(([path, value]) => [path, structuredClone(value)]);
  }
  doc(path: string): Ref {
    assert.equal(path.split("/").length, 2, "only canonical document paths");
    const ref: Ref = {
      path,
      id: path.split("/")[1],
      get: async () => this.snapshot(ref),
    };
    return ref;
  }
  collection(path: string): { doc(id: string): Ref } {
    return { doc: (id) => this.doc(`${path}/${id}`) };
  }
  private snapshot(ref: Ref): Snapshot {
    this.reads.push(ref.path);
    const value = this.row(ref.path);
    return {
      ref,
      id: ref.id,
      exists: value !== undefined,
      data: () => (value === undefined ? undefined : structuredClone(value)),
    };
  }
  private commit(writes: Write[]): void {
    const next = new Map(this.rows);
    for (const write of writes) {
      if (write.kind === "create")
        assert.equal(next.has(write.path), false, "create precondition");
      else assert.equal(next.has(write.path), true, "update precondition");
      next.set(
        write.path,
        write.kind === "create"
          ? structuredClone(write.data)
          : { ...next.get(write.path), ...structuredClone(write.data) },
      );
    }
    for (const [path, value] of next) this.rows.set(path, value);
    this.writes.push(...structuredClone(writes));
  }
  async runTransaction<T>(
    body: (tx: {
      get(ref: Ref): Promise<Snapshot>;
      getAll(...refs: Ref[]): Promise<Snapshot[]>;
      create(ref: Ref, value: Data): void;
      update(ref: Ref, value: Data): void;
    }) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    const before = this.beforeTransaction;
    this.beforeTransaction = undefined;
    await before?.();
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const writes: Write[] = [];
    const read = (ref: Ref): Snapshot => {
      assert.equal(writes.length, 0, "transaction reads must precede writes");
      return this.snapshot(ref);
    };
    try {
      const result = await body({
        get: async (ref) => read(ref),
        getAll: async (...refs) => refs.map(read),
        create: (ref, value) => {
          writes.push({
            kind: "create",
            path: ref.path,
            data: structuredClone(value),
          });
        },
        update: (ref, value) => {
          writes.push({
            kind: "update",
            path: ref.path,
            data: structuredClone(value),
          });
        },
      });
      if (this.failTransactionCommit)
        throw new Error("synthetic_transaction_commit_failure");
      this.commit(writes);
      return result;
    } finally {
      release();
    }
  }
  batch() {
    const writes: Write[] = [];
    return {
      update: (ref: Ref, value: Data): void => {
        writes.push({
          kind: "update",
          path: ref.path,
          data: structuredClone(value),
        });
      },
      commit: async (): Promise<void> => {
        this.batchCalls += 1;
        if (this.failBatch) throw new Error("synthetic_batch_commit_failure");
        this.commit(writes);
      },
    };
  }
}

function harness() {
  const input = fixture();
  const db = new FakeFirestore();
  db.put(SOURCE_PATH, input.source);
  db.put(MEMBERSHIP_AUTOMATION_SETTINGS, input.config);
  let now = new Date(input.now);
  const calls = {
    evidence: 0,
    transport: 0,
    ignored: [] as Array<string | undefined>,
  };
  const deps: MembershipWelcomeDependencies = {
    db: db as unknown as MembershipWelcomeDependencies["db"],
    now: () => new Date(now),
    timestamp: () =>
      ({
        seconds: Math.floor(now.getTime() / 1000),
        nanoseconds: 0,
      }) as ReturnType<MembershipWelcomeDependencies["timestamp"]>,
    loadEvidence: async (_source, ignoreCandidateId) => {
      calls.evidence += 1;
      calls.ignored.push(ignoreCandidateId);
      return structuredClone(input.evidence);
    },
  };
  const candidate: Data = {
    candidateId: CANDIDATE_ID,
    studioId: STUDIO,
    memberId: MEMBER,
    memberName: input.source.memberName,
    memberPhone: PHONE,
    type: "membership_welcome",
    templateCode: MEMBERSHIP_WELCOME_TEMPLATE.templateId,
    status: "processing",
    attempts: 0,
    maxAttempts: 1,
    payload: { sourceContractId: SOURCE_ID },
    createdAt: { seconds: Date.parse(input.now) / 1000, nanoseconds: 0 },
  };
  const transport = async () => {
    calls.transport += 1;
    return { messageId: "synthetic-provider-message" };
  };
  const prime = (patch: Data = {}): Data => {
    const value = { ...structuredClone(candidate), ...patch };
    db.put(CANDIDATE_PATH, value);
    return value;
  };
  return {
    input,
    db,
    deps,
    calls,
    candidate,
    prime,
    transport,
    advance: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}
type Harness = ReturnType<typeof harness>;
const noActions = (h: Harness): void => {
  assert.equal(h.db.writes.length, 0);
  assert.equal(h.calls.transport, 0);
};
const rejectsWithoutActions = async (
  h: Harness,
  candidate = h.candidate,
  reason?: RegExp,
): Promise<void> => {
  const dispatch = dispatchMembershipWelcome(h.deps, candidate, h.transport);
  if (reason) await assert.rejects(dispatch, reason);
  else await assert.rejects(dispatch);
  noActions(h);
};

test("synthetic fixture remains eligible under the actual policy", () => {
  const { source, now, evidence } = fixture();
  assert.equal(
    planMembershipContractWelcome({
      selection: source.selection,
      completion: source.completion,
      now,
      ...evidence,
    }).eligibleForCandidate,
    true,
  );
});

for (const patch of [
  undefined,
  {},
  { enabled: false },
  { mode: "shadow" },
  { sourcePromoted: false },
  { nativeE2eVerified: false },
]) {
  test(`default/off configuration ${JSON.stringify(patch)} does zero writes/evidence/provider calls`, async () => {
    const h = harness();
    if (patch === undefined) h.db.remove(MEMBERSHIP_AUTOMATION_SETTINGS);
    else
      h.db.put(
        MEMBERSHIP_AUTOMATION_SETTINGS,
        Object.keys(patch).length ? { ...h.input.config, ...patch } : {},
      );
    h.prime();
    assert.deepEqual(await queueMembershipWelcome(h.deps, SOURCE_ID), {
      status: "blocked",
      reason: "membership_automation_disabled",
    });
    await rejectsWithoutActions(
      h,
      h.candidate,
      /membership_automation_disabled/,
    );
    assert.equal(h.calls.evidence, 0);
    assert.equal(h.db.transactionCalls, 0);
  });
}

test("valid queue is idempotent and binds exactly one canonical candidate", async () => {
  const h = harness();
  assert.deepEqual(await queueMembershipWelcome(h.deps, SOURCE_ID), {
    status: "queued",
    reason: "",
  });
  const stored = data(h.db.row(CANDIDATE_PATH));
  assert.equal(stored.status, "queued");
  assert.equal(stored.templateCode, MEMBERSHIP_WELCOME_TEMPLATE.templateId);
  assert.equal(stored.candidateId, CANDIDATE_ID);
  assert.equal(stored.attempts, 0);
  assert.equal(stored.maxAttempts, 1);
  assert.deepEqual(stored.payload, { sourceContractId: SOURCE_ID });
  assert.equal(h.db.row(SOURCE_PATH)?.welcomeCandidateId, CANDIDATE_ID);
  assert.equal(h.db.row(SOURCE_PATH)?.welcomeStatus, "queued");
  assert.ok(h.db.row(SOURCE_PATH)?.nextObservationAt);
  assert.deepEqual(
    {
      requestMode: h.db.row(READBACK_REQUEST_PATH)?.requestMode,
      status: h.db.row(READBACK_REQUEST_PATH)?.status,
      contractId: h.db.row(READBACK_REQUEST_PATH)?.contractId,
      candidateId: h.db.row(READBACK_REQUEST_PATH)?.candidateId,
    },
    {
      requestMode: "membership_contract_readback",
      status: "pending",
      contractId: SOURCE_ID,
      candidateId: CANDIDATE_ID,
    },
  );
  assert.equal(h.db.writes.length, 3);
  assert.deepEqual(await queueMembershipWelcome(h.deps, SOURCE_ID), {
    status: "existing",
    reason: "candidate_already_exists",
  });
  assert.equal(h.db.writes.length, 3);
  assert.equal(h.db.entries("alimtalkCandidates").length, 1);
  assert.equal(h.calls.transport, 0);
});

test("two concurrent queue attempts create one candidate", async () => {
  const h = harness();
  const results = await Promise.all([
    queueMembershipWelcome(h.deps, SOURCE_ID),
    queueMembershipWelcome(h.deps, SOURCE_ID),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [
    "existing",
    "queued",
  ]);
  assert.equal(h.db.writes.length, 3);
});

for (const target of ["source", "config", "clock"]) {
  test(`queue rechecks ${target} immediately before transaction writes`, async () => {
    const h = harness();
    h.db.beforeTransaction = () => {
      if (target === "source")
        h.db.put(SOURCE_PATH, { ...h.input.source, status: "cancelled" });
      if (target === "config")
        h.db.put(MEMBERSHIP_AUTOMATION_SETTINGS, {
          ...h.input.config,
          enabled: false,
        });
      if (target === "clock") h.advance(31 * 60_000);
    };
    assert.deepEqual(await queueMembershipWelcome(h.deps, SOURCE_ID), {
      status: "blocked",
      reason: "source_changed",
    });
    noActions(h);
  });
  test(`dispatch rechecks ${target} immediately before acquiring durable claims`, async () => {
    const h = harness();
    h.prime();
    h.db.beforeTransaction = () => {
      if (target === "source")
        h.db.put(SOURCE_PATH, {
          ...h.input.source,
          completion: { ...h.input.source.completion, refunded: true },
        });
      if (target === "config")
        h.db.put(MEMBERSHIP_AUTOMATION_SETTINGS, {
          ...h.input.config,
          nativeE2eVerified: false,
        });
      if (target === "clock") h.advance(31 * 60_000);
    };
    await rejectsWithoutActions(
      h,
      h.candidate,
      /welcome_source_changed_before_send/,
    );
  });
}

const invalidCandidates: Array<[string, Data]> = [
  ["ID", { candidateId: "wrong" }],
  ["type", { type: "onsite_welcome" }],
  [
    "legacy template",
    { templateCode: MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId },
  ],
  ["unknown template", { templateCode: "synthetic-unapproved" }],
  ["studio", { studioId: "other" }],
  ["member", { memberId: "999" }],
  ["name", { memberName: "OTHER SYNTHETIC MEMBER" }],
  ["phone", { memberPhone: "01000000002" }],
  ["retry count", { maxAttempts: 2 }],
  ["source", { payload: { sourceContractId: "b".repeat(64) } }],
  [
    "payload test override",
    { payload: { sourceContractId: SOURCE_ID, testRecipientOverride: true } },
  ],
  [
    "payload test mode",
    { payload: { sourceContractId: SOURCE_ID, testMode: true } },
  ],
];
for (const [name, patch] of invalidCandidates)
  test(`rejects wrong candidate ${name}`, async () => {
    const h = harness();
    h.prime();
    await rejectsWithoutActions(h, { ...h.candidate, ...patch });
  });

for (const id of [CANDIDATE_ID, memberClaim(MEMBER), memberClaim("101")]) {
  for (const status of ["attempting", "unknown", "accepted", "failed"]) {
    test(`existing permanent ${id === CANDIDATE_ID ? "phone" : "member"} claim in ${status} prevents transport`, async () => {
      const h = harness();
      h.prime();
      const existing = {
        candidateId: "older-synthetic-candidate",
        status,
        attemptedAt: "2001-01-01",
      };
      h.db.put(claimPath(id), existing);
      await rejectsWithoutActions(
        h,
        h.candidate,
        /welcome_already_attempted_or_not_claimed/,
      );
      assert.deepEqual(h.db.row(claimPath(id)), existing);
    });
  }
}

test("dispatch persists phone and every alias claim before transport, then accepts all atomically", async () => {
  const h = harness();
  h.prime();
  const result = await dispatchMembershipWelcome(
    h.deps,
    h.candidate,
    async () => {
      assert.equal(h.db.row(CANDIDATE_PATH)?.attempts, 1);
      assert.ok(h.db.row(CANDIDATE_PATH)?.providerAttemptedAt);
      for (const id of [CANDIDATE_ID, memberClaim(MEMBER), memberClaim("101")])
        assert.equal(h.db.row(claimPath(id))?.status, "attempting");
      return h.transport();
    },
  );
  assert.equal(result.messageId, "synthetic-provider-message");
  assert.equal(h.calls.transport, 1);
  assert.equal(h.db.entries(MEMBERSHIP_WELCOME_CLAIMS).length, 3);
  assert.ok(
    h.db
      .entries(MEMBERSHIP_WELCOME_CLAIMS)
      .every(([, claim]) => claim.status === "accepted"),
  );
  assert.equal(h.db.row(SOURCE_PATH)?.welcomeStatus, "accepted");
  assert.equal(h.calls.ignored[0], CANDIDATE_ID);
});

test("two concurrent dispatches perform exactly one transport", async () => {
  const h = harness();
  h.prime();
  const results = await Promise.allSettled([
    dispatchMembershipWelcome(h.deps, h.candidate, h.transport),
    dispatchMembershipWelcome(
      h.deps,
      structuredClone(h.candidate),
      h.transport,
    ),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.equal(h.calls.transport, 1);
  assert.equal(h.db.row(CANDIDATE_PATH)?.attempts, 1);
  assert.equal(h.db.entries(MEMBERSHIP_WELCOME_CLAIMS).length, 3);
});

test("provider timeout retains unknown claims and retry never calls transport", async () => {
  const h = harness();
  h.prime();
  const timeout = new Error("synthetic_provider_timeout");
  await assert.rejects(
    dispatchMembershipWelcome(h.deps, h.candidate, async () => {
      h.calls.transport += 1;
      throw timeout;
    }),
    (error) => error === timeout,
  );
  assert.ok(
    h.db
      .entries(MEMBERSHIP_WELCOME_CLAIMS)
      .every(([, claim]) => claim.status === "unknown"),
  );
  assert.equal(h.db.row(SOURCE_PATH)?.welcomeStatus, "review");
  assert.equal(h.db.row(CANDIDATE_PATH)?.attempts, 1);
  await assert.rejects(
    dispatchMembershipWelcome(h.deps, h.candidate, h.transport),
    /welcome_already_attempted_or_not_claimed/,
  );
  assert.equal(h.calls.transport, 1);
  assert.equal(h.db.entries(MEMBERSHIP_WELCOME_CLAIMS).length, 3);
});

test("timeout still retains attempting claims when ambiguity batch also fails", async () => {
  const h = harness();
  h.prime();
  h.db.failBatch = true;
  const timeout = new Error("original_timeout");
  await assert.rejects(
    dispatchMembershipWelcome(h.deps, h.candidate, async () => {
      h.calls.transport += 1;
      throw timeout;
    }),
    (error) => error === timeout,
  );
  assert.ok(
    h.db
      .entries(MEMBERSHIP_WELCOME_CLAIMS)
      .every(([, claim]) => claim.status === "attempting"),
  );
  await assert.rejects(
    dispatchMembershipWelcome(h.deps, h.candidate, h.transport),
  );
  assert.equal(h.calls.transport, 1);
});

test("missing provider acceptance ID is ambiguous and cannot retry", async () => {
  const h = harness();
  h.prime();
  await assert.rejects(
    dispatchMembershipWelcome(h.deps, h.candidate, async () => {
      h.calls.transport += 1;
      return { messageId: "" };
    }),
    /provider_acceptance_unknown/,
  );
  assert.ok(
    h.db
      .entries(MEMBERSHIP_WELCOME_CLAIMS)
      .every(([, claim]) => claim.status === "unknown"),
  );
  await assert.rejects(
    dispatchMembershipWelcome(h.deps, h.candidate, h.transport),
  );
  assert.equal(h.calls.transport, 1);
});

test("provider acceptance followed by a failed outcome batch retains claims and cannot retry", async () => {
  const h = harness();
  h.prime();
  h.db.failBatch = true;
  await assert.rejects(
    dispatchMembershipWelcome(h.deps, h.candidate, h.transport),
    /synthetic_batch_commit_failure/,
  );
  assert.equal(h.calls.transport, 1);
  assert.equal(h.db.entries(MEMBERSHIP_WELCOME_CLAIMS).length, 3);
  assert.ok(
    h.db
      .entries(MEMBERSHIP_WELCOME_CLAIMS)
      .every(([, claim]) => claim.status === "attempting"),
  );
  await assert.rejects(
    dispatchMembershipWelcome(h.deps, h.candidate, h.transport),
  );
  assert.equal(h.calls.transport, 1);
});

test("failed transaction commit never reaches provider and rolls back every staged write", async () => {
  const h = harness();
  h.prime();
  h.db.failTransactionCommit = true;
  await rejectsWithoutActions(
    h,
    h.candidate,
    /synthetic_transaction_commit_failure/,
  );
  assert.equal(h.db.row(CANDIDATE_PATH)?.attempts, 0);
  assert.equal(h.db.entries(MEMBERSHIP_WELCOME_CLAIMS).length, 0);
});

for (const patch of [
  { checkedAt: "2026-09-14T03:00:00.000Z" },
  { refunded: true },
  { cancelled: true },
  { memberClassification: "staff" },
  { ticketClassification: "trial" },
  { currentRecipientEligible: false },
  { paymentStatus: "refunded" },
  { outstandingAmount: 1 },
  { memberSigned: false },
])
  test(`sender excludes stale/refunded/ineligible completion ${JSON.stringify(patch)}`, async () => {
    const h = harness();
    h.prime();
    h.db.put(SOURCE_PATH, {
      ...h.input.source,
      completion: { ...h.input.source.completion, ...patch },
    });
    await rejectsWithoutActions(h);
  });

test("fresh trusted recipient exclusion blocks both queue and dispatch", async () => {
  const h = harness();
  h.prime();
  h.input.evidence.recipientIssue = "synthetic_staff_recipient_excluded";
  assert.deepEqual(await queueMembershipWelcome(h.deps, SOURCE_ID), {
    status: "blocked",
    reason: "synthetic_staff_recipient_excluded",
  });
  await rejectsWithoutActions(
    h,
    h.candidate,
    /synthetic_staff_recipient_excluded/,
  );
});

for (const patch of [
  { providerComplete: false },
  { complete: false },
  { memberAliasesComplete: false },
]) {
  test(`incomplete trusted history ${JSON.stringify(patch)} cannot queue or dispatch`, async () => {
    const h = harness();
    h.prime();
    Object.assign(h.input.evidence.history, patch);
    assert.equal(
      (await queueMembershipWelcome(h.deps, SOURCE_ID)).status,
      "blocked",
    );
    await rejectsWithoutActions(
      h,
      h.candidate,
      /complete_welcome_history_required/,
    );
  });
}

for (const status of ["accepted", "queued", "sending", "unknown", "failed"])
  test(`legacy ${status} evidence blocks send`, async () => {
    const h = harness();
    h.prime();
    h.input.evidence.history.records = [
      {
        id: "synthetic-old",
        family: "new_member_welcome",
        templateId: MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId,
        status,
        attempted: true,
      },
    ];
    await rejectsWithoutActions(h);
  });

for (const patch of [
  { status: "queued" },
  { status: "sent" },
  { attempts: 1 },
  { attempts: undefined },
  { attempts: "0" },
  { providerAttemptedAt: "2001-01-01" },
]) {
  test(`live candidate must be an unattempted processing claim ${JSON.stringify(patch)}`, async () => {
    const h = harness();
    h.prime(patch);
    await rejectsWithoutActions(
      h,
      h.candidate,
      /welcome_already_attempted_or_not_claimed/,
    );
  });
}

// These regression assertions intentionally stay strict: controller bugs must not be blessed.
for (const field of ["testOverride", "testRecipientOverride"])
  test(`rejects top-level ${field} flags`, async () => {
    const h = harness();
    const candidate = h.prime({ [field]: true });
    await rejectsWithoutActions(h, candidate);
  });

test("live candidate maxAttempts change cannot be overwritten into a sendable value", async () => {
  const h = harness();
  h.prime({ maxAttempts: 2 });
  await rejectsWithoutActions(h);
});

for (const patch of [
  { solapiMessageId: "previous-provider-message" },
  { sentAt: "2001-01-01" },
  { outboundStartedAt: "2001-01-01" },
]) {
  test(`legacy live outbound marker blocks even when attempts is zero: ${JSON.stringify(patch)}`, async () => {
    const h = harness();
    h.prime(patch);
    await rejectsWithoutActions(h);
  });
}

test("trusted history alias set must include the source member before locking member claims", async () => {
  const h = harness();
  h.prime();
  h.input.evidence.history.memberIds = ["unrelated-alias"];
  h.db.put(claimPath(memberClaim(MEMBER)), {
    status: "accepted",
    candidateId: "older-phone-candidate",
  });
  await rejectsWithoutActions(h);
});

test("inspect is read-only and cannot send a template still under review", async () => {
  const h = harness();
  h.input.evidence.template.status = "INSPECTING";
  assert.equal(
    (await inspectMembershipWelcome(h.deps, SOURCE_ID)).issue,
    "template_not_approved",
  );
  noActions(h);
  assert.equal(h.db.transactionCalls, 0);
});

for (const operation of ["queue", "dispatch"] as const) {
  for (const phase of ["evidence", "transaction"] as const) {
    for (const delay of [720_000, 720_001]) {
      test(`${operation} rechecks native 12-minute boundary after ${phase}: ${delay}ms`, async () => {
        const h = harness();
        if (operation === "dispatch") h.prime();
        if (phase === "evidence") {
          const load = h.deps.loadEvidence;
          h.deps.loadEvidence = async (...args) => {
            const evidence = await load(...args);
            h.advance(delay);
            return evidence;
          };
        } else h.db.beforeTransaction = () => h.advance(delay);
        if (operation === "queue") {
          assert.deepEqual(
            await queueMembershipWelcome(h.deps, SOURCE_ID),
            delay === 720_000
              ? { status: "queued", reason: "" }
              : {
                  status: "blocked",
                  reason:
                    phase === "evidence"
                      ? "fresh_native_readback_required"
                      : "source_changed",
                },
          );
        } else if (delay === 720_000) {
          assert.equal(
            (await dispatchMembershipWelcome(h.deps, h.candidate, h.transport))
              .messageId,
            "synthetic-provider-message",
          );
        } else {
          await rejectsWithoutActions(
            h,
            h.candidate,
            phase === "evidence"
              ? /fresh_native_readback_required/
              : /welcome_source_changed_before_send/,
          );
        }
        if (delay > 720_000) {
          noActions(h);
          assert.equal(h.db.entries(MEMBERSHIP_WELCOME_CLAIMS).length, 0);
          assert.equal(h.db.transactionCalls, phase === "evidence" ? 0 : 1);
        } else
          assert.equal(h.calls.transport, operation === "dispatch" ? 1 : 0);
      });
    }
    for (const change of [
      "missing",
      "refund",
      "partial",
      "staff",
      "identity",
      "checkedAt",
    ] as const) {
      test(`${operation} blocks persisted native ${change} change during ${phase}`, async () => {
        const h = harness();
        if (operation === "dispatch") h.prime();
        const mutate = (): void => {
          const source = data(h.db.row(SOURCE_PATH));
          const readback = data(source.nativeReadback);
          if (change === "missing") delete source.nativeReadback;
          if (change === "refund") data(readback.ticket).refunded = true;
          if (change === "partial")
            data(readback.payment).outstandingAmount = 1;
          if (change === "staff")
            data(readback.member).classification = "staff";
          if (change === "identity") data(readback.ticket).userTicketId = "999";
          if (change === "checkedAt")
            data(readback.payment).checkedAt = "2026-09-14T03:59:59.999Z";
          h.db.put(SOURCE_PATH, source);
        };
        if (phase === "evidence") {
          const load = h.deps.loadEvidence;
          h.deps.loadEvidence = async (...args) => {
            const evidence = await load(...args);
            mutate();
            return evidence;
          };
        } else h.db.beforeTransaction = mutate;
        if (operation === "queue") {
          assert.deepEqual(await queueMembershipWelcome(h.deps, SOURCE_ID), {
            status: "blocked",
            reason: "source_changed",
          });
        } else {
          await rejectsWithoutActions(
            h,
            h.candidate,
            /welcome_source_changed_before_send/,
          );
          assert.equal(h.db.row(CANDIDATE_PATH)?.attempts, 0);
        }
        noActions(h);
        assert.equal(h.db.entries(MEMBERSHIP_WELCOME_CLAIMS).length, 0);
      });
    }
  }
}

for (const phase of ["evidence", "transaction"] as const) {
  for (const createdAt of [
    undefined,
    { seconds: Date.parse("2026-09-14T04:00:01.000Z") / 1000, nanoseconds: 0 },
  ]) {
    test(`dispatch uses persisted createdAt changed during ${phase}: ${JSON.stringify(createdAt)}`, async () => {
      const h = harness();
      h.prime();
      const mutate = (): void =>
        h.db.put(CANDIDATE_PATH, { ...h.candidate, createdAt });
      if (phase === "evidence") {
        const load = h.deps.loadEvidence;
        h.deps.loadEvidence = async (...args) => {
          const evidence = await load(...args);
          mutate();
          return evidence;
        };
      } else h.db.beforeTransaction = mutate;
      await rejectsWithoutActions(
        h,
        h.candidate,
        /welcome_source_changed_before_send/,
      );
      assert.equal(h.db.row(CANDIDATE_PATH)?.attempts, 0);
      assert.equal(h.db.entries(MEMBERSHIP_WELCOME_CLAIMS).length, 0);
    });
  }
}

test("dispatch cannot reuse a pre-candidate readback even inside the freshness window", async () => {
  const h = harness();
  const candidate = h.prime({
    createdAt: {
      seconds: Date.parse(h.input.now) / 1000,
      nanoseconds: 1_000_000,
    },
  });
  h.advance(1);
  await rejectsWithoutActions(h, candidate, /fresh_native_readback_required/);
  assert.equal(h.db.transactionCalls, 0);
});

for (const patch of [
  { attempted: true },
  { alimtalkSendId: "synthetic-previous-send" },
  { lastAttemptAt: "2026-09-14T03:59:00.000Z" },
  {
    payload: {
      sourceContractId: SOURCE_ID,
      messageId: "synthetic-previous-message",
    },
  },
]) {
  test(`dispatch must not send despite legacy own-candidate outbound evidence ${JSON.stringify(patch)}`, async () => {
    const h = harness();
    const candidate = h.prime(patch);
    await rejectsWithoutActions(h, candidate);
    assert.equal(h.db.entries(MEMBERSHIP_WELCOME_CLAIMS).length, 0);
  });
}
