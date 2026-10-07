import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  approveHoldingNotice, dispatchHoldingNotice, holdingApprovalSnapshot, holdingAutomationEnabled, holdingClaimIssue, holdingMemberFingerprint,
  holdingSourceId, isHoldingNoticeCandidate, queueHoldingNotice,
  HOLDING_NOTICE_TEMPLATE_CODE, HOLDING_NOTICE_SETTINGS,
  type HoldingNoticeDependencies,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/holdingNoticeQueue";

type Data = Record<string, any>;
type Ref = { path: string; get(): Promise<{ exists: boolean; data(): Data | undefined }> };
const NOW = Date.parse("2026-10-07T03:00:00.000Z");
const iso = (offset = 0) => new Date(NOW + offset).toISOString();
const stamp = (at = NOW) => ({ seconds: Math.floor(at / 1000), nanoseconds: (at % 1000) * 1e6 });
const sha = (value: any) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = { studioId: "5330", memberId: "100", ticketId: "200" };
const sourceId = holdingSourceId(identity);
const sourcePath = `memberTicketHolds/${sourceId}`;
const memberPath = "memberProfiles/100";
const candidateId = `holding_notice_${sha(["5330", "100", "200", "new"])}`;
const candidatePath = `alimtalkCandidates/${candidateId}`;
const sendPath = `alimtalkSends/${candidateId}`;
const claimPath = `holdingNoticeClaims/${candidateId}`;

class Store {
  docs = new Map<string, Data>();
  versions = new Map<string, number>();
  reads: string[] = [];
  writes = 0;
  commits = 0;
  retries = 0;
  failCommits = new Set<number>();
  beforeCommit?: () => void;
  read(path: string) { return structuredClone(this.docs.get(path)); }
  seed(path: string, data: Data) {
    this.docs.set(path, structuredClone(data));
    this.versions.set(path, (this.versions.get(path) || 0) + 1);
  }
  patch(path: string, data: Data) { this.seed(path, { ...this.read(path), ...data }); }
  doc(path: string): Ref {
    assert.match(path, /^(settings\/holdingNotice|memberTicketHolds\/holding_ticket_[a-f0-9]{64}|memberProfiles\/[1-9]\d*|staffs\/fixture|alimtalkCandidates\/holding_notice_[a-f0-9]{64}|alimtalkSends\/holding_notice_[a-f0-9]{64}|holdingNoticeClaims\/holding_notice_[a-f0-9]{64})$/);
    return { path, get: async () => {
      this.reads.push(path);
      return { exists: this.docs.has(path), data: () => this.read(path) };
    } };
  }
  async runTransaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    for (let retry = 0; retry < 32; retry++) {
      const snapshot = new Map([...this.docs].map(([path, data]) => [path, structuredClone(data)]));
      const versions = new Map(this.versions);
      const reads = new Set<string>();
      const writes: Array<{ kind: string; ref: Ref; data: Data }> = [];
      const result = await callback({
        get: async (ref: Ref) => {
          assert.equal(writes.length, 0, "All atomic reads must precede writes");
          reads.add(ref.path); this.reads.push(ref.path);
          return { exists: snapshot.has(ref.path), data: () => structuredClone(snapshot.get(ref.path)) };
        },
        create: (ref: Ref, data: Data) => writes.push({ kind: "create", ref, data: structuredClone(data) }),
        update: (ref: Ref, data: Data) => writes.push({ kind: "update", ref, data: structuredClone(data) }),
      });
      const hook = this.beforeCommit; this.beforeCommit = undefined; hook?.();
      if ([...reads].some((path) => versions.get(path) !== this.versions.get(path))) { this.retries++; continue; }
      this.commits++;
      if (this.failCommits.has(this.commits)) throw new Error("fixture_commit_failure");
      for (const write of writes) {
        assert.equal(this.docs.has(write.ref.path), write.kind === "update", "Firestore write precondition");
      }
      for (const write of writes) {
        this.seed(write.ref.path, write.kind === "create" ? write.data : { ...this.read(write.ref.path), ...write.data });
      }
      this.writes += writes.length;
      return result;
    }
    throw new Error("fixture_retry_limit");
  }
}

function fixture() {
  const db = new Store();
  const config = { mode: "live", autoSendEnabled: true, canonicalSourcePromoted: true,
    nativeE2eVerified: true, cutoverAt: iso(-30 * 60_000), templateId: HOLDING_NOTICE_TEMPLATE_CODE, studioId: "5330" };
  const source = {
    ...identity, sourceId, schemaVersion: 1, source: "studiomate_ticket_history_dom",
    memberName: "Synthetic Member", ticketName: "Synthetic Ticket", sourceVersion: "a".repeat(64),
    observationFingerprint: "b".repeat(64), observedAt: iso(-60_000), identityVerified: true, holdsComplete: true,
    historyFingerprints: ["c".repeat(64), "d".repeat(64), "f".repeat(64)], issuanceFingerprint: "f".repeat(64),
    originalPeriod: { days: 100, source: "issuance_record", evidenceRef: "fixture:issuance" },
    holds: [
      { id: "old", status: "registered", kind: "member", start: "2026-09-01", end: "2026-09-02",
        evidenceRef: "fixture:old", creationEvidenceFingerprint: "c".repeat(64), registeredAt: iso(-7_200_000) },
      { id: "new", status: "registered", kind: "member", start: "2026-10-08", end: "2026-10-10",
        evidenceRef: "fixture:new", creationEvidenceFingerprint: "d".repeat(64), registeredAt: iso(-300_000) },
    ],
    baselineAt: iso(-3_600_000), baselineHoldIds: ["old"], noticeEligibleHoldIds: ["new"],
    identityReview: { reviewedBy: "fixture:operator", reviewedAt: iso(-30_000), observationFingerprint: "b".repeat(64) },
  };
  const member = { memberId: "100", studioId: "5330", name: "Synthetic Member", phone: "01000000001", memberGrade: "일반" };
  db.seed(HOLDING_NOTICE_SETTINGS, config); db.seed(sourcePath, source); db.seed(memberPath, member);
  db.seed("staffs/fixture", { phones: [] });
  let posts = 0, evidenceCalls = 0;
  let evidenceHook: (() => void) | undefined;
  let evidencePatch: Data = {};
  let clock = NOW;
  const deps: HoldingNoticeDependencies = {
    db: db as unknown as HoldingNoticeDependencies["db"], now: () => new Date(clock), timestamp: () => stamp(clock),
    verifyRecipientInTransaction: async (tx, _source, currentMember) => {
      const staff = (await (tx as any).get(db.doc("staffs/fixture"))).data();
      return staff?.phones.includes(currentMember.phone) ? "holding_active_staff_phone" : "";
    },
    loadEvidence: async () => {
      evidenceCalls++;
      const memberFingerprint = holdingMemberFingerprint(db.read(memberPath)!);
      evidenceHook?.();
      return { recipientIssue: "", templateIssue: "", providerHistoryComplete: true, providerDuplicate: false,
        memberFingerprint, ...evidencePatch };
    },
  };
  const queue = () => queueHoldingNotice(deps, sourceId, "new");
  const refresh = () => {
    clock += 1;
    db.patch(sourcePath, { observedAt: new Date(clock).toISOString() });
  };
  const approve = () => {
    db.patch(candidatePath, { status: "processing", queuedBy: "operator", reviewedByUid: "fixture:operator", reviewedAt: stamp(clock) });
    db.patch(candidatePath, { holdingApprovalSnapshot: holdingApprovalSnapshot(db.read(candidatePath)!) });
    refresh();
    return db.read(candidatePath)!;
  };
  const transport = async (variables: Record<string, string>) => {
    posts++;
    assert.equal(db.read(claimPath)?.status, "attempting");
    assert.equal(db.read(sendPath)?.providerOutcome, "attempting");
    assert.equal(db.read(candidatePath)?.attempts, 1);
    assert.deepEqual(variables, { "#{이름}": "Synthetic Member", "#{수강권명}": "Synthetic Ticket",
      "#{홀딩시작일}": "2026-10-08", "#{홀딩종료일}": "2026-10-10", "#{이번홀딩일수}": "3",
      "#{전체홀딩일수}": "20", "#{사용홀딩일수}": "5", "#{잔여홀딩일수}": "15" });
    return { messageId: "fixture-message", groupId: "fixture-group" };
  };
  return { db, config, source, deps, queue, refresh, approve, transport,
    posts: () => posts, evidenceCalls: () => evidenceCalls,
    setEvidence: (patch: Data) => { evidencePatch = patch; },
    onEvidence: (hook: () => void) => { evidenceHook = hook; },
    setClock: (now: number) => { clock = now; },
  };
}

test("source and event identities match the canonical array hash contract", async () => {
  assert.equal(sourceId, `holding_ticket_${sha(["5330", "100", "200"])}`);
  const h = fixture(); const result = await h.queue();
  assert.equal(result.candidateId, candidateId);
  assert.throws(() => holdingSourceId({ ...identity, ticketId: "excel_200" }));
});

test("discriminator catches exact template OR source/marker payload, even malformed markers", () => {
  for (const candidate of [{ templateCode: HOLDING_NOTICE_TEMPLATE_CODE }, { payload: { holdingNotice: false } },
    { payload: { holdingSourceId: null } }, { payload: { holdingNotice: true }, templateCode: "wrong" }])
    assert.equal(isHoldingNoticeCandidate(candidate), true);
  for (const candidate of [null, [], {}, { templateCode: "wrong" }, { payload: {} }])
    assert.equal(isHoldingNoticeCandidate(candidate), false);
});

test("queue creates only a reviewed manual candidate, not an approved send or claim", async () => {
  const h = fixture(); const result = await h.queue();
  assert.equal(result.status, "reviewed"); assert.equal(h.db.writes, 1);
  const candidate = h.db.read(candidatePath)!;
  assert.equal(candidate.type, "manual_review"); assert.equal(candidate.status, "reviewed");
  assert.equal(candidate.attempts, 0); assert.equal(candidate.maxAttempts, 1);
  assert.equal(candidate.payload.holdingNotice, true);
  assert.equal(candidate.payload.holdingSourceVersion, h.source.sourceVersion);
  assert.equal(candidate.reviewedByUid, undefined); assert.equal(h.db.read(claimPath), undefined);
  assert.equal(candidate.holdingApprovalSnapshot, undefined);
  assert.equal(h.db.read(sendPath), undefined); assert.notEqual(holdingClaimIssue(candidate), "");
  assert.equal(h.posts(), 0);
  assert.equal((await h.queue()).status, "existing"); assert.equal(h.db.writes, 1);
});

test("concurrent queue attempts create exactly one candidate", async () => {
  const h = fixture(); const results = await Promise.all([h.queue(), h.queue()]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["existing", "reviewed"]);
  assert.equal(h.db.writes, 1); assert.ok(h.db.retries > 0);
});

for (const key of ["mode", "autoSendEnabled", "canonicalSourcePromoted", "nativeE2eVerified", "cutoverAt"]) {
  test(`activation requires explicit valid ${key} and does no evidence/member/source scan when disabled`, async () => {
    const h = fixture(); const config: Data = { ...h.config }; delete config[key];
    assert.equal(holdingAutomationEnabled(config), false); h.db.seed(HOLDING_NOTICE_SETTINGS, config);
    assert.equal((await h.queue()).status, "blocked"); assert.equal(h.evidenceCalls(), 0);
    assert.deepEqual(h.db.reads, [HOLDING_NOTICE_SETTINGS]); assert.equal(h.db.writes, 0);
  });
}

test("first baseline and existing baseline holds never become automatic notices", async () => {
  for (const patch of [{ noticeEligibleHoldIds: [] }, { baselineHoldIds: ["old", "new"] },
    { baselineAt: undefined }, { baselineHoldIds: undefined }, { baselineAt: iso(1) }]) {
    const h = fixture(); h.db.patch(sourcePath, patch);
    assert.equal((await h.queue()).status, "blocked"); assert.equal(h.db.writes, 0);
  }
});

for (const [label, value, allowed] of [
  ["before baseline", iso(-3_600_001), false], ["exact baseline", iso(-3_600_000), false],
  ["before cutover", iso(-1_800_001), false], ["exact cutover", iso(-1_800_000), true],
  ["future", iso(1), false], ["now", iso(), true], ["missing", undefined, false],
  ["malformed", "2026-02-30T03:00:00.000Z", false],
] as const) {
  test(`immutable registeredAt: ${label}`, async () => {
    const h = fixture(); const source = h.db.read(sourcePath)!; source.holds[1].registeredAt = value;
    h.db.seed(sourcePath, source);
    assert.equal((await h.queue()).status, allowed ? "reviewed" : "blocked");
  });
}

for (const patch of [
  { sourceId: "wrong" }, { source: "workLanes" }, { memberId: "excel_100" }, { ticketId: "excel_200" },
  { schemaVersion: 2 }, { sourceVersion: "not-a-hash" }, { observationFingerprint: "invalid" },
  { identityVerified: false }, { holdsComplete: false }, { identityReview: {} },
  { originalPeriod: { days: 100, source: "current_expiry", evidenceRef: "fixture" } },
  { originalPeriod: { days: 100.5, source: "issuance_record", evidenceRef: "fixture" } },
  { originalPeriod: { days: 100, source: "issuance_record", evidenceRef: "" } },
  { holds: null }, { observedAt: iso(-900_001) }, { observedAt: iso(1) }, { observedAt: "bad" },
  { observedAt: "2026-02-30T03:00:00.000Z" },
  { historyFingerprints: undefined }, { historyFingerprints: [] }, { historyFingerprints: ["invalid"] },
  { historyFingerprints: ["c".repeat(64), "f".repeat(64)] }, { issuanceFingerprint: "wrong" },
  { historyFingerprints: ["c".repeat(64), "d".repeat(64)] },
]) {
  test(`reject incomplete/noncanonical source ${JSON.stringify(patch)}`, async () => {
    const h = fixture(); h.db.patch(sourcePath, patch);
    assert.equal((await h.queue()).status, "blocked"); assert.equal(h.db.writes, 0);
  });
}

test("freshness is inclusive at fifteen minutes and invalid clocks fail closed", async () => {
  const h = fixture(); h.db.patch(sourcePath, { observedAt: iso(-900_000) });
  assert.equal((await h.queue()).status, "reviewed");
  const bad = fixture(); bad.setClock(NaN); assert.equal((await bad.queue()).status, "blocked");
});

for (const grade of ["스텝", "직원", "강사회원", "staff", "instructor"]) {
  test(`canonical staff grade ${grade} is excluded`, async () => {
    const h = fixture(); h.db.patch(memberPath, { memberGrade: grade });
    assert.equal((await h.queue()).status, "blocked"); assert.equal(h.evidenceCalls(), 0);
  });
}

test("canonical member identity and current external staff exclusion cannot be bypassed", async () => {
  for (const patch of [{ studioId: "9" }, { memberId: "9" }, { name: "Other" }, { phone: "bad" },
    { active: false }, { classification: "unknown" }]) {
    const h = fixture(); h.db.patch(memberPath, patch);
    assert.equal((await h.queue()).status, "blocked"); assert.equal(h.db.writes, 0);
  }
  const h = fixture(); h.setEvidence({ recipientIssue: "active_staff_phone" });
  assert.equal((await h.queue()).reason, "active_staff_phone");
});

test("registered test member IDs remain excluded regardless of operator intent", async () => {
  const h = fixture(); const source = { ...h.source, memberId: "1982133" };
  const id = holdingSourceId(source); source.sourceId = id;
  h.db.seed(`memberTicketHolds/${id}`, source);
  h.db.seed("memberProfiles/1982133", { ...h.db.read(memberPath), memberId: "1982133" });
  assert.equal((await queueHoldingNotice(h.deps, id, "new")).status, "blocked");
});

for (const patch of [{ templateIssue: "template_not_approved" }, { providerHistoryComplete: false },
  { providerDuplicate: true }, { memberFingerprint: "wrong" }, { recipientIssue: undefined },
  { templateIssue: undefined }, { providerDuplicate: undefined }, { providerHistoryComplete: "true" }]) {
  test(`provider/template/evidence must explicitly pass ${JSON.stringify(patch)}`, async () => {
    const h = fixture(); h.setEvidence(patch);
    assert.equal((await h.queue()).status, "blocked"); assert.equal(h.db.writes, 0);
  });
}

test("allowance overage, malformed ranges, overlaps and conflicting IDs block", async () => {
  for (const change of ["overage", "invalid", "overlap", "conflict", "creation", "cancelled"]) {
    const h = fixture(); const source = h.db.read(sourcePath)!;
    if (change === "overage") source.originalPeriod.days = 20;
    if (change === "invalid") source.holds[1].end = "2026-02-30";
    if (change === "overlap") source.holds.push({ ...source.holds[1], id: "other" });
    if (change === "conflict") source.holds.push({ ...source.holds[1], end: "2026-10-11" });
    if (change === "creation") delete source.holds[1].creationEvidenceFingerprint;
    if (change === "cancelled") source.holds[1].status = "cancelled";
    h.db.seed(sourcePath, source);
    assert.equal((await h.queue()).status, "blocked", change); assert.equal(h.db.writes, 0);
  }
});

test("center closures/cancelled history are excluded and exact duplicate rows count once", async () => {
  const h = fixture(); const source = h.db.read(sourcePath)!;
  source.holds.push({ ...source.holds[0] }, { ...source.holds[0], id: "closure", kind: "center_closure" },
    { ...source.holds[0], id: "cancelled", status: "cancelled" });
  h.db.seed(sourcePath, source); await h.queue();
  assert.equal(h.db.read(candidatePath)?.payload.variables["#{사용홀딩일수}"], "5");
});

for (const phase of ["evidence", "transaction retry"]) {
  for (const change of ["cancellation", "revision", "settings", "member", "original", "eligibility"]) {
    for (const operation of ["queue", "dispatch"]) {
      test(`${operation} blocks ${change} during ${phase}`, async () => {
        const h = fixture(); let candidate: Data | undefined;
        if (operation === "dispatch") { await h.queue(); candidate = h.approve(); }
        const before = h.db.writes;
        const mutate = () => {
          if (change === "settings") h.db.patch(HOLDING_NOTICE_SETTINGS, { autoSendEnabled: false });
          else if (change === "member") h.db.patch(memberPath, { phone: "01000000002" });
          else {
            const source = h.db.read(sourcePath)!;
            if (change === "cancellation") source.holds[1].status = "cancelled";
            if (change === "revision") source.sourceVersion = "e".repeat(64);
            if (change === "original") source.originalPeriod.days = 110;
            if (change === "eligibility") source.noticeEligibleHoldIds = [];
            h.db.seed(sourcePath, source);
          }
        };
        if (phase === "evidence") h.onEvidence(mutate); else h.db.beforeCommit = mutate;
        if (operation === "queue") assert.equal((await h.queue()).status, "blocked");
        else await assert.rejects(dispatchHoldingNotice(h.deps, candidate!, h.transport));
        assert.equal(h.posts(), 0); assert.equal(h.db.writes, before); assert.equal(h.db.read(claimPath), undefined);
      });
    }
  }
}

test("send requires postcandidate readback but accepts refreshed same-version source", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve();
  h.db.patch(sourcePath, { observedAt: iso(-1) });
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport), /post_candidate/);
  assert.equal(h.posts(), 0); h.refresh();
  await dispatchHoldingNotice(h.deps, candidate, h.transport);
  assert.equal(h.posts(), 1); assert.equal(h.db.read(claimPath)?.status, "accepted");
});

test("readback exactly at candidate creation is not postcandidate evidence", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve();
  h.db.patch(sourcePath, { observedAt: iso() });
  const before = h.db.writes;
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport), /post_candidate/);
  assert.equal(h.posts(), 0); assert.equal(h.db.writes, before);
  assert.equal(h.db.read(claimPath), undefined); assert.equal(h.db.read(sendPath), undefined);
  h.refresh();
  await dispatchHoldingNotice(h.deps, candidate, h.transport);
  assert.equal(h.posts(), 1);
});

test("dispatch rejects tampered payload variables even if their approval hash was recomputed", async () => {
  const h = fixture(); await h.queue(); h.approve();
  const candidate = h.db.read(candidatePath)!; candidate.payload.variables = { "#{이름}": "Injected" };
  candidate.holdingApprovalSnapshot = holdingApprovalSnapshot(candidate);
  h.db.seed(candidatePath, candidate);
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport), /approved_variables_mismatch/);
  assert.equal(h.posts(), 0); assert.equal(h.db.read(claimPath), undefined);
});

for (const [key, value] of [
  ["attempts", undefined], ["attempts", 1], ["maxAttempts", 2], ["maxAttempts", undefined],
  ["status", "reviewed"], ["queuedBy", "auto"], ["reviewedByUid", "system:auto"],
  ["reviewedByUid", "system"],
  ["reviewedAt", {}], ["createdAt", { seconds: "1", nanoseconds: 0 }],
  ["createdAt", { seconds: 1, nanoseconds: 1e9 }], ["createdAt", { toMillis: () => NaN }],
  ["providerAttemptedAt", stamp()], ["solapiMessageId", "prior"], ["isTest", false], ["testOverride", false],
  ["type", "pricing_info"], ["templateCode", "v1"], ["dedupeKey", "other"],
  ["holdingApprovalSnapshot", undefined], ["holdingApprovalSnapshot", "e".repeat(64)],
] as const) {
  test(`claim refuses malformed, overridden or attempted ${key}=${String(value)}`, async () => {
    const h = fixture(); await h.queue(); const candidate = { ...h.approve(), [key]: value };
    assert.notEqual(holdingClaimIssue(candidate), "");
    await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport)); assert.equal(h.posts(), 0);
  });
}

test("payload overrides and invalid candidate clocks cannot pass the claim/send boundary", async () => {
  for (const patch of [{ holdingNotice: false }, { holdingSourceVersion: "wrong" },
    { testRecipientOverride: false }, { override: false }, { providerReceipt: "prior" }]) {
    const h = fixture(); await h.queue(); const candidate = h.approve(); Object.assign(candidate.payload, patch);
    await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport)); assert.equal(h.posts(), 0);
  }
  for (const patch of [{ createdAt: stamp(NOW + 2) }, { reviewedAt: stamp(NOW + 2) }, { reviewedAt: stamp(NOW - 1) }]) {
    const h = fixture(); await h.queue(); const candidate = { ...h.approve(), ...patch };
    h.db.seed(candidatePath, candidate);
    await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport)); assert.equal(h.posts(), 0);
  }
});

test("mutated live candidate cannot be sent using an older inspected copy", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve();
  h.onEvidence(() => h.db.patch(candidatePath, { memberPhone: "01000000002" }));
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport), /candidate_changed/);
  assert.equal(h.posts(), 0);
});

test("concurrent dispatches claim once and only one transport executes", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve();
  const results = await Promise.allSettled([
    dispatchHoldingNotice(h.deps, candidate, h.transport), dispatchHoldingNotice(h.deps, candidate, h.transport),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(h.posts(), 1);
  assert.equal(h.db.read(claimPath)?.status, "accepted"); assert.equal(h.db.read(sendPath)?.providerOutcome, "accepted");
  assert.equal(h.db.read(candidatePath)?.maxAttempts, 1);
});

for (const priorPath of [sendPath, claimPath]) {
  for (const status of ["processing", "failed", "unknown", "accepted", "done", "cancelled"]) {
    test(`existing ${priorPath.split("/")[0]} ${status} permanently blocks send and queue`, async () => {
      const h = fixture(); await h.queue(); const candidate = h.approve(); h.db.seed(priorPath, { status });
      await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport), /prior_send_or_claim/);
      assert.equal((await h.queue()).status, "blocked"); assert.equal(h.posts(), 0);
    });
  }
}

for (const [label, reply] of [
  ["timeout", () => { throw new Error("fixture_timeout"); }],
  ["missing ID", () => ({ messageId: "" })], ["whitespace ID", () => ({ messageId: " " })],
  ["group only", () => ({ groupId: "fixture-group" })],
] as const) {
  test(`${label} retains unknown one-shot claim; reset attempts still cannot replay`, async () => {
    const h = fixture(); await h.queue(); const candidate = h.approve(); let posts = 0;
    await assert.rejects(dispatchHoldingNotice(h.deps, candidate, async () => { posts++; return reply() as any; }));
    assert.equal(h.db.read(claimPath)?.status, "unknown"); assert.equal(h.db.read(sendPath)?.providerOutcome, "unknown");
    assert.equal(h.db.read(candidatePath)?.attempts, 1); assert.equal(h.db.read(candidatePath)?.maxAttempts, 1);
    h.db.seed(candidatePath, candidate);
    await assert.rejects(dispatchHoldingNotice(h.deps, candidate, async () => { posts++; return { messageId: "retry" }; }));
    assert.equal(posts, 1);
  });
}

test("accepted transport plus outcome persistence failure preserves receipt and forbids replay", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve();
  h.db.failCommits.add(h.db.commits + 2);
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport), /commit_failure/);
  assert.equal(h.posts(), 1); assert.equal(h.db.read(claimPath)?.status, "accepted");
  assert.equal(h.db.read(sendPath)?.providerOutcome, "accepted_ledger_error");
  assert.equal(h.db.read(sendPath)?.solapiMessageId, "fixture-message");
  h.db.seed(candidatePath, candidate);
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport)); assert.equal(h.posts(), 1);
});

test("crash-like failure of both outcome writes leaves durable attempting claim and no replay", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve();
  h.db.failCommits.add(h.db.commits + 2); h.db.failCommits.add(h.db.commits + 3);
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport), /commit_failure/);
  assert.equal(h.db.read(claimPath)?.status, "attempting"); assert.equal(h.db.read(candidatePath)?.attempts, 1);
  h.db.seed(candidatePath, candidate);
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport)); assert.equal(h.posts(), 1);
});

test("failed pre-POST claim transaction has no transport or partial writes", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve(); const before = h.db.writes;
  h.db.failCommits.add(h.db.commits + 1);
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport), /commit_failure/);
  assert.equal(h.posts(), 0); assert.equal(h.db.writes, before); assert.equal(h.db.read(claimPath), undefined);
});

test("source/claim identity stays stable across template/date changes; different holds remain independent", async () => {
  const h = fixture(); await h.queue();
  const source = h.db.read(sourcePath)!;
  source.holds[1].end = "2026-10-11"; source.sourceVersion = "e".repeat(64);
  h.db.seed(sourcePath, source);
  const refreshed = await h.queue();
  assert.equal(refreshed.candidateId, candidateId); assert.equal(refreshed.status, "reviewed");
  assert.equal((await h.queue()).status, "existing");
  source.holds.push({ ...source.holds[1], id: "next", start: "2026-11-01", end: "2026-11-02" });
  source.noticeEligibleHoldIds.push("next"); h.db.seed(sourcePath, source);
  const result = await queueHoldingNotice(h.deps, sourceId, "next");
  assert.equal(result.status, "reviewed"); assert.notEqual(result.candidateId, candidateId);
  h.db.patch(HOLDING_NOTICE_SETTINGS, { templateId: "v1" });
  assert.equal((await h.queue()).reason, "holding_template_configuration_mismatch");
});

test("fresh unchanged readback may reuse an older fingerprint-bound identity review", async () => {
  const h = fixture(); await h.queue(); const reviewedAt = h.db.read(sourcePath)!.identityReview.reviewedAt;
  const candidate = h.approve();
  assert.ok(Date.parse(reviewedAt) < Date.parse(h.db.read(sourcePath)!.observedAt));
  assert.equal(h.db.read(sourcePath)!.sourceVersion, candidate.payload.holdingSourceVersion);
  await dispatchHoldingNotice(h.deps, candidate, h.transport); assert.equal(h.posts(), 1);
});

test("feature approval hash is independent of variable property ordering and binds version/hold/phone/variables", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve();
  assert.equal(holdingClaimIssue(candidate), "");
  const reordered = structuredClone(candidate);
  reordered.payload.variables = Object.fromEntries(Object.entries(candidate.payload.variables).reverse());
  assert.equal(holdingApprovalSnapshot(candidate), holdingApprovalSnapshot(reordered));
  for (const mutate of [
    (item: Data) => { item.payload.holdingSourceVersion = "e".repeat(64); },
    (item: Data) => { item.payload.holdId = "different"; },
    (item: Data) => { item.memberPhone = "01000000002"; },
    (item: Data) => { item.payload.variables["#{사용홀딩일수}"] = "6"; },
    (item: Data) => { item.payload.variables.extra = "unapproved"; },
  ]) {
    const changed = structuredClone(candidate); mutate(changed);
    assert.notEqual(holdingClaimIssue(changed), "");
  }
});

test("existing generic UI approval without the feature snapshot cannot authorize transport", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve(); delete candidate.holdingApprovalSnapshot;
  h.db.seed(candidatePath, candidate);
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport)); assert.equal(h.posts(), 0);
});

test("exact variable comparison rejects extra undefined keys and nonstring values", async () => {
  for (const change of ["extra", "numeric"]) {
    const h = fixture(); await h.queue(); const candidate = h.approve();
    if (change === "extra") candidate.payload.variables.extra = undefined;
    else candidate.payload.variables["#{이번홀딩일수}"] = 3;
    candidate.holdingApprovalSnapshot = holdingApprovalSnapshot(candidate); h.db.seed(candidatePath, candidate);
    await assert.rejects(dispatchHoldingNotice(h.deps, candidate, h.transport), /approved_variables_mismatch/);
    assert.equal(h.posts(), 0);
  }
});

for (const operation of ["queue", "dispatch"]) {
  test(`${operation} rechecks active staff within the transaction and retries on roster mutation`, async () => {
    const h = fixture(); let candidate: Data | undefined;
    if (operation === "dispatch") { await h.queue(); candidate = h.approve(); }
    const before = h.db.writes;
    h.db.beforeCommit = () => h.db.patch("staffs/fixture", { phones: ["01000000001"] });
    if (operation === "queue") assert.equal((await h.queue()).reason, "holding_active_staff_phone");
    else await assert.rejects(dispatchHoldingNotice(h.deps, candidate!, h.transport), /active_staff_phone/);
    assert.equal(h.posts(), 0); assert.equal(h.db.writes, before); assert.ok(h.db.retries > 0);
  });
}

for (const change of ["version", "variables", "phone"]) {
  test(`unattempted ${change} revision refreshes the same candidate and revokes all approval metadata`, async () => {
    const h = fixture(); await h.queue(); const previous = h.approve();
    const before = h.db.writes;
    if (change === "version") h.db.patch(sourcePath, { sourceVersion: "e".repeat(64) });
    if (change === "variables") {
      const source = h.db.read(sourcePath)!; source.holds[1].end = "2026-10-11";
      h.db.seed(sourcePath, source);
    }
    if (change === "phone") h.db.patch(memberPath, { phone: "01000000002" });
    assert.deepEqual(await h.queue(), { status: "reviewed", reason: "holding_content_changed_review_required", candidateId });
    const current = h.db.read(candidatePath)!;
    assert.equal(current.candidateId, previous.candidateId); assert.deepEqual(current.createdAt, previous.createdAt);
    for (const field of ["queuedBy", "reviewedByUid", "reviewedAt", "holdingApprovalSnapshot"]) assert.equal(current[field], null);
    assert.equal(current.status, "reviewed"); assert.equal(current.attempts, 0); assert.equal(current.maxAttempts, 1);
    assert.equal(current.payload.holdingSourceVersion, h.db.read(sourcePath)!.sourceVersion);
    assert.equal(current.payload.variables["#{이번홀딩일수}"], change === "variables" ? "4" : "3");
    assert.equal(current.memberPhone, change === "phone" ? "01000000002" : "01000000001");
    assert.notEqual(holdingClaimIssue(current), ""); assert.equal(h.db.writes, before + 1);
    assert.equal(h.db.read(sendPath), undefined); assert.equal(h.db.read(claimPath), undefined);
    assert.equal((await h.queue()).status, "existing"); assert.equal(h.db.writes, before + 1);
    await assert.rejects(dispatchHoldingNotice(h.deps, previous, h.transport)); assert.equal(h.posts(), 0);
  });
}

test("refreshed candidate can send only after a new operator approval without replacing createdAt", async () => {
  const h = fixture(); await h.queue(); const originalCreatedAt = h.db.read(candidatePath)!.createdAt;
  h.approve(); h.db.patch(sourcePath, { sourceVersion: "e".repeat(64) });
  assert.equal((await h.queue()).status, "reviewed");
  await assert.rejects(dispatchHoldingNotice(h.deps, h.db.read(candidatePath)!, h.transport));
  const candidate = h.approve(); assert.deepEqual(candidate.createdAt, originalCreatedAt);
  await dispatchHoldingNotice(h.deps, candidate, h.transport); assert.equal(h.posts(), 1);
});

test("unchanged approved candidate is idempotent and keeps its human approval", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve(); const before = h.db.writes;
  assert.equal((await h.queue()).status, "existing");
  assert.deepEqual(h.db.read(candidatePath), candidate); assert.equal(h.db.writes, before);
});

for (const patch of [{ attempts: 1 }, { attempts: undefined }, { status: "sent" },
  { providerAttemptedAt: stamp() }, { solapiMessageId: "prior" }, { attempted: true },
  { payload: { providerReceipt: "legacy-attempt" } }]) {
  test(`changed source cannot overwrite attempted/sent/unknown candidate ${JSON.stringify(patch)}`, async () => {
    const h = fixture(); await h.queue(); h.approve(); h.db.patch(candidatePath, patch);
    h.db.patch(sourcePath, { sourceVersion: "e".repeat(64) });
    const before = h.db.read(candidatePath), writes = h.db.writes;
    assert.equal((await h.queue()).status, "blocked");
    assert.deepEqual(h.db.read(candidatePath), before); assert.equal(h.db.writes, writes);
  });
}

for (const path of [sendPath, claimPath]) {
  test(`changed source cannot overwrite candidate with an existing ${path.split("/")[0]}`, async () => {
    const h = fixture(); await h.queue(); const candidate = h.approve();
    h.db.patch(sourcePath, { sourceVersion: "e".repeat(64) }); h.db.seed(path, { status: "unknown" });
    const before = h.db.writes;
    assert.equal((await h.queue()).reason, "holding_prior_send_or_claim");
    assert.deepEqual(h.db.read(candidatePath), candidate); assert.equal(h.db.writes, before);
  });
}

test("refresh transaction retries and cannot overwrite a concurrently created provider claim", async () => {
  const h = fixture(); await h.queue(); h.approve(); h.db.patch(sourcePath, { sourceVersion: "e".repeat(64) });
  h.db.beforeCommit = () => {
    h.db.patch(candidatePath, { attempts: 1, providerAttemptedAt: stamp() });
    h.db.seed(claimPath, { status: "attempting" });
  };
  const before = h.db.writes;
  assert.equal((await h.queue()).status, "blocked"); assert.ok(h.db.retries > 0);
  assert.equal(h.db.read(candidatePath)?.attempts, 1); assert.equal(h.db.writes, before);
});

test("concurrent refreshes update once and leave the revised candidate waiting for review", async () => {
  const h = fixture(); await h.queue(); h.approve(); h.db.patch(sourcePath, { sourceVersion: "e".repeat(64) });
  const before = h.db.writes;
  const results = await Promise.all([h.queue(), h.queue()]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["existing", "reviewed"]);
  assert.equal(h.db.writes, before + 1); assert.equal(h.db.read(candidatePath)?.holdingApprovalSnapshot, null);
});

test("transport identity-readback error preserves provisional receipt as unknown and cannot replay", async () => {
  const h = fixture(); await h.queue(); const candidate = h.approve(); let posts = 0;
  const error = Object.assign(new Error("fixture_identity_lookup_timeout"), {
    holdingReceipt: { messageId: "fixture-provisional-message", groupId: "fixture-provisional-group" },
  });
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, async () => {
    posts++; assert.equal(h.db.read(claimPath)?.status, "attempting"); throw error;
  }), (actual) => actual === error);
  const claim = h.db.read(claimPath)!, send = h.db.read(sendPath)!;
  assert.equal(claim.status, "unknown"); assert.equal(claim.messageId, "fixture-provisional-message");
  assert.equal(claim.groupId, "fixture-provisional-group");
  assert.equal(send.providerOutcome, "unknown"); assert.equal(send.solapiMessageId, "fixture-provisional-message");
  assert.equal(send.solapiGroupId, "fixture-provisional-group");
  assert.equal(h.db.read(candidatePath)?.attempts, 1); assert.equal(send.maxAttempts, 1);
  h.db.seed(candidatePath, candidate);
  await assert.rejects(dispatchHoldingNotice(h.deps, candidate, async () => { posts++; return { messageId: "retry" }; }));
  assert.equal((await h.queue()).status, "blocked"); assert.equal(posts, 1);
});

const approvalInput = (h: ReturnType<typeof fixture>) => ({ candidateId,
  expectedSnapshot: holdingApprovalSnapshot(h.db.read(candidatePath)!), reviewedByUid: "fixture:operator", studioId: "5330" });

test("authenticated approval queues the exact displayed snapshot without provider work or POST", async () => {
  const h = fixture(); await h.queue(); const input = approvalInput(h);
  const before = h.db.writes, evidenceCalls = h.evidenceCalls();
  assert.deepEqual(await approveHoldingNotice(h.deps, input), { status: "queued", candidateId });
  const current = h.db.read(candidatePath)!;
  assert.equal(current.status, "queued"); assert.equal(current.queuedBy, "operator");
  assert.equal(current.reviewedByUid, input.reviewedByUid); assert.deepEqual(current.reviewedAt, stamp());
  assert.equal(current.holdingApprovalSnapshot, input.expectedSnapshot);
  assert.equal(holdingClaimIssue({ ...current, status: "processing" }), "");
  assert.equal(h.db.writes, before + 1); assert.equal(h.evidenceCalls(), evidenceCalls); assert.equal(h.posts(), 0);
  assert.equal(h.db.read(sendPath), undefined); assert.equal(h.db.read(claimPath), undefined);
  h.db.patch(candidatePath, { status: "processing" });
  await assert.rejects(dispatchHoldingNotice(h.deps, h.db.read(candidatePath)!, h.transport), /post_candidate/);
  h.refresh();
  await dispatchHoldingNotice(h.deps, h.db.read(candidatePath)!, h.transport); assert.equal(h.posts(), 1);
});

test("stale display A cannot approve server-refreshed B under the same permanent candidate id", async () => {
  const h = fixture(); await h.queue(); const displayA = approvalInput(h);
  h.db.patch(sourcePath, { sourceVersion: "e".repeat(64) });
  assert.equal((await h.queue()).status, "reviewed"); const before = h.db.writes;
  await assert.rejects(approveHoldingNotice(h.deps, displayA), /snapshot_changed/);
  assert.equal(h.db.writes, before); assert.equal(h.db.read(candidatePath)!.holdingApprovalSnapshot, null);
  assert.equal(h.db.read(candidatePath)!.status, "reviewed");
  assert.equal((await approveHoldingNotice(h.deps, approvalInput(h))).status, "queued");
});

test("concurrent identical approvals queue once and preserve the same reviewer binding on replay", async () => {
  const h = fixture(); await h.queue(); const input = approvalInput(h), before = h.db.writes;
  const results = await Promise.all([approveHoldingNotice(h.deps, input), approveHoldingNotice(h.deps, input)]);
  assert.deepEqual(results.map(r => r.status).sort(), ["existing", "queued"]);
  const approved = h.db.read(candidatePath); h.setClock(NOW + 60_000);
  assert.equal((await approveHoldingNotice(h.deps, input)).status, "existing");
  assert.deepEqual(h.db.read(candidatePath), approved); assert.equal(h.db.writes, before + 1); assert.equal(h.posts(), 0);
  for (const patch of [{ expectedSnapshot: "e".repeat(64) }, { expectedSnapshot: "" }, { reviewedByUid: "fixture:other" }])
    await assert.rejects(approveHoldingNotice(h.deps, { ...input, ...patch }));
  assert.equal(h.db.writes, before + 1);
});

for (const patch of [{ studioId: "5331" }, { studioId: "excel_5330" }, { reviewedByUid: "system" },
  { reviewedByUid: "system:auto" }, { reviewedByUid: "" }, { expectedSnapshot: "" },
  { expectedSnapshot: "e".repeat(64) }, { candidateId: "../other" }]) {
  test(`approval rejects wrong scope, reviewer or expected binding ${JSON.stringify(patch)}`, async () => {
    const h = fixture(); await h.queue(); const before = h.db.writes;
    await assert.rejects(approveHoldingNotice(h.deps, { ...approvalInput(h), ...patch }));
    assert.equal(h.db.writes, before); assert.equal(h.posts(), 0);
  });
}

for (const key of ["mode", "autoSendEnabled", "canonicalSourcePromoted", "nativeE2eVerified", "cutoverAt"]) {
  test(`approval is disabled without activation gate ${key}`, async () => {
    const h = fixture(); await h.queue(); const input = approvalInput(h), config = { ...h.config };
    delete (config as Data)[key]; h.db.seed(HOLDING_NOTICE_SETTINGS, config); const before = h.db.writes;
    await assert.rejects(approveHoldingNotice(h.deps, input), /automation_disabled/);
    assert.equal(h.db.writes, before); assert.equal(h.posts(), 0);
  });
}

for (const path of [sendPath, claimPath]) {
  test(`approval cannot replay with any durable record in ${path.split("/")[0]}`, async () => {
    const h = fixture(); await h.queue(); const input = approvalInput(h); h.db.seed(path, { status: "unknown" });
    const before = h.db.writes;
    await assert.rejects(approveHoldingNotice(h.deps, input), /prior_send_or_claim/);
    assert.equal(h.db.writes, before); assert.equal(h.posts(), 0);
  });
}

for (const patch of [{ attempts: 1 }, { attempts: undefined }, { maxAttempts: 2 }, { status: "processing" },
  { status: "sent" }, { type: "pricing_info" }, { templateCode: "v1" }, { solapiMessageId: "prior" },
  { testOverride: false }, { dedupeKey: "wrong" }]) {
  test(`approval rejects malformed or attempted candidate ${JSON.stringify(patch)}`, async () => {
    const h = fixture(); await h.queue(); h.db.patch(candidatePath, patch); const before = h.db.writes;
    await assert.rejects(approveHoldingNotice(h.deps, approvalInput(h)));
    assert.equal(h.db.writes, before); assert.equal(h.posts(), 0);
  });
}

test("queued approval replay requires an existing valid binding, never fabricates one", async () => {
  const h = fixture(); await h.queue(); const input = approvalInput(h);
  h.db.patch(candidatePath, { status: "queued", reviewedByUid: input.reviewedByUid, reviewedAt: stamp() });
  const before = h.db.writes;
  await assert.rejects(approveHoldingNotice(h.deps, input), /binding_invalid/);
  assert.equal(h.db.writes, before); assert.equal(h.db.read(candidatePath)!.holdingApprovalSnapshot, undefined);
});

for (const patch of [{ sourceVersion: "e".repeat(64) }, { identityVerified: false }, { observedAt: iso(-900_001) }]) {
  test(`approval checks the current canonical source ${JSON.stringify(patch)}`, async () => {
    const h = fixture(); await h.queue(); const input = approvalInput(h); h.db.patch(sourcePath, patch);
    const before = h.db.writes; await assert.rejects(approveHoldingNotice(h.deps, input));
    assert.equal(h.db.writes, before); assert.equal(h.posts(), 0);
  });
}

test("approval rejects recalculation mismatch even with an expected hash of the altered payload", async () => {
  const h = fixture(); await h.queue(); const candidate = h.db.read(candidatePath)!;
  candidate.payload.variables["#{사용홀딩일수}"] = "999"; h.db.seed(candidatePath, candidate);
  const before = h.db.writes;
  await assert.rejects(approveHoldingNotice(h.deps, approvalInput(h)), /source_changed/);
  assert.equal(h.db.writes, before);
});

for (const change of ["candidate", "source", "settings", "send", "claim"]) {
  test(`approval transaction retries and rejects a concurrent ${change} mutation`, async () => {
    const h = fixture(); await h.queue(); const input = approvalInput(h), before = h.db.writes;
    h.db.beforeCommit = () => {
      if (change === "candidate") {
        const candidate = h.db.read(candidatePath)!; candidate.payload.holdingSourceVersion = "e".repeat(64);
        h.db.seed(candidatePath, candidate);
      } else if (change === "source") h.db.patch(sourcePath, { sourceVersion: "e".repeat(64) });
      else if (change === "settings") h.db.patch(HOLDING_NOTICE_SETTINGS, { autoSendEnabled: false });
      else h.db.seed(change === "send" ? sendPath : claimPath, { status: "unknown" });
    };
    await assert.rejects(approveHoldingNotice(h.deps, input));
    assert.ok(h.db.retries > 0); assert.equal(h.db.writes, before); assert.equal(h.posts(), 0);
    assert.equal(h.db.read(candidatePath)!.status, "reviewed");
  });
}

test("approval rejects malformed, future or pre-creation review clocks without writes", async () => {
  for (const at of [{}, stamp(NOW + 1), stamp(NOW - 1)]) {
    const h = fixture(); await h.queue(); const before = h.db.writes;
    await assert.rejects(approveHoldingNotice({ ...h.deps, timestamp: () => at }, approvalInput(h)), /binding_invalid/);
    assert.equal(h.db.writes, before);
  }
});

for (const change of ["disabled", "attempted", "send", "claim"]) {
  test(`queued approval replay still rejects ${change} state`, async () => {
    const h = fixture(); await h.queue(); const input = approvalInput(h);
    await approveHoldingNotice(h.deps, input);
    if (change === "disabled") h.db.patch(HOLDING_NOTICE_SETTINGS, { autoSendEnabled: false });
    else if (change === "attempted") h.db.patch(candidatePath, { attempts: 1 });
    else h.db.seed(change === "send" ? sendPath : claimPath, { status: "unknown" });
    const before = h.db.writes, candidate = h.db.read(candidatePath);
    await assert.rejects(approveHoldingNotice(h.deps, input));
    assert.equal(h.db.writes, before); assert.deepEqual(h.db.read(candidatePath), candidate); assert.equal(h.posts(), 0);
  });
}

test("approval clock is read after creating its timestamp across a real millisecond boundary", async () => {
  const h = fixture(); await h.queue();
  const deps = { ...h.deps, timestamp: () => { h.setClock(NOW + 1); return stamp(NOW + 1); } };
  assert.equal((await approveHoldingNotice(deps, approvalInput(h))).status, "queued");
  assert.deepEqual(h.db.read(candidatePath)!.reviewedAt, stamp(NOW + 1));
});
