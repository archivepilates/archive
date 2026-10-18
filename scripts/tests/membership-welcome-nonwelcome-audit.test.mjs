import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  AUDIT_FIELD, AUDIT_SETTINGS, AUDIT_PROJECT, AUDIT_OPERATOR,
  NONWELCOME_CONTRACT, NONWELCOME_CONTRACT_HASH, NONWELCOME_AUDIT_ID,
  auditHash, buildNonWelcomeAllowlist, auditMembershipWelcomeNonWelcome,
} from "../lib/membership-welcome-nonwelcome-audit.mjs";
import { parseAuditArgs, validateAuditCredential, createTemplateGetter } from "../audit-membership-welcome-nonwelcome-templates.mjs";

const clone = (value) => structuredClone(value);
const at = "2026-10-19T01:00:00.000Z";
const welcomeId = "KA01TP260914091233543JoFDsn7KfCr";
const source = { groupSurveyId: "KA01TP2605210729364330NbhZVAu9zA", welcomeIds: [welcomeId], sourceHash: "a".repeat(64) };
const fixture = () => ({
  templateId: "KA01TP2605210729364330NbhZVAu9zA", status: "APPROVED",
  name: "아카이브 그룹 첫 수업 사전확인 안내 v1", channelId: "KA01PF260511123220162lk0NUjstpVl",
  messageType: "BA", emphasizeType: "IMAGE", imageId: "ST01FZ2605210807341668tVH8tDXSj8",
  content: "#{이름}님,\n\n예약하신 아카이브에서의\n첫 그룹수업을\n편안하게 시작하실 수 있도록\n사전 확인 설문을 부탁드립니다.\n\n수업 전 통증, 질환,\n운동 경험 등 강사가 확인할\n내용을 간단히 작성해 주세요.\n\n해당 안내는 #{이름}님이 예약하신\n첫 그룹수업 준비를 위해\n1회 발송됩니다.",
  buttons: [{ buttonType: "WL", buttonName: "사전확인 작성", targetOut: true,
    linkMo: "https://in.archivepilates.com/groupSurvey?id=#{설문ID}&token=#{접근토큰}",
    linkPc: "https://in.archivepilates.com/groupSurvey?id=#{설문ID}&token=#{접근토큰}" }],
  quickReplies: [],
});
const config = () => ({
  enabled: true, mode: "live", sourcePromoted: true, nativeE2eVerified: true,
  cutoverAt: "2026-09-14T00:00:00.000Z", historyStart: "2026-01-01T00:00:00.000Z",
  activationScope: "all", baseline: { initializedAt: "untouched", members: ["synthetic-only"] },
  unrelated: { nested: true },
  providerHistoryCoverage: { verified: true, allWelcomeVersions: true, noRetentionGap: true,
    auditId: "independent-general-coverage", startAt: "2026-01-01T00:00:00.000Z", unrelatedProof: [1, 2] },
});
const existing = () => ({ independentlyAudited: true, auditId: "previous-independent-audit",
  templateIds: ["synthetic-previous-audited-id"], operatorNote: "preserve", scopedAudits: { other: { proof: "retain" } } });
const build = (overrides = {}) => buildNonWelcomeAllowlist({ config: config(), template: fixture(), source, auditedAt: at, ...overrides });

function memoryDb(initial = config()) {
  let data = clone(initial), version = 1, writes = [], transactions = 0;
  const snapshot = () => {
    const captured = clone(data);
    return { exists: true, updateTime: { seconds: version, nanoseconds: 1 }, data: () => clone(captured) };
  };
  const ref = { get: async () => snapshot() };
  return {
    doc(path) { assert.equal(path, AUDIT_SETTINGS); return ref; },
    async runTransaction(fn) {
      transactions++;
      const pending = [];
      await fn({ get: async (target) => { assert.equal(target, ref); return snapshot(); },
        update(target, patch) { assert.equal(target, ref); pending.push(clone(patch)); } });
      for (const patch of pending) {
        assert.deepEqual(Object.keys(patch), [AUDIT_FIELD]);
        data.providerHistoryCoverage.nonWelcomeTemplateAllowlist = clone(patch[AUDIT_FIELD]);
        writes.push(patch);
        version++;
      }
    },
    change(fn, bump = true) { fn(data); if (bump) version++; },
    bump() { version++; },
    state: () => ({ data: clone(data), writes: clone(writes), transactions }),
  };
}
const run = (db, overrides = {}) => auditMembershipWelcomeNonWelcome({ db, providerGet: async () => fixture(),
  readSource: () => clone(source), now: () => at, ...overrides });

test("exact independent contract creates stable scoped audit, without mutating inputs", () => {
  assert.deepEqual({ ...fixture(), quickReplies: undefined }, { ...clone(NONWELCOME_CONTRACT), quickReplies: undefined });
  const input = config(), original = clone(input);
  const a = build({ config: input }), b = build({ auditedAt: "2026-10-20T01:00:00.000Z" });
  assert.equal(a.auditId, NONWELCOME_AUDIT_ID);
  assert.equal(a.scopedAudits.group_survey.auditId, b.scopedAudits.group_survey.auditId);
  assert.equal(a.scopedAudits.group_survey.contractHash, NONWELCOME_CONTRACT_HASH);
  assert.equal(a.scopedAudits.group_survey.auditedAt, at);
  assert.deepEqual(a.templateIds, [source.groupSurveyId]);
  assert.deepEqual(input, original);
  assert.equal(auditHash({ b: 2, a: 1 }), auditHash({ a: 1, b: 2 }));
});

for (const field of ["templateId", "status", "name", "channelId", "messageType", "emphasizeType", "imageId", "content"]) {
  test(`fails closed on exact provider field tampering: ${field}`, () => {
    const template = fixture(); template[field] += " ";
    assert.throws(() => build({ template }), /mismatch/);
  });
}
for (const field of ["buttonType", "buttonName", "linkMo", "linkPc", "targetOut"]) {
  test(`fails closed on button field tampering: ${field}`, () => {
    const template = fixture(); template.buttons[0][field] = field === "targetOut" ? false : "altered";
    assert.throws(() => build({ template }), /buttons_mismatch/);
  });
}
for (const buttons of [undefined, null, {}, [], [null], [fixture().buttons[0], fixture().buttons[0]]])
  test(`rejects malformed or non-single button ${JSON.stringify(buttons)}`, () => {
    assert.throws(() => build({ template: { ...fixture(), buttons } }), /buttons_mismatch/);
  });
for (const field of ["linkAnd", "linkIos", "chatExtra"]) {
  for (const value of [undefined, null, ""])
    test(`accepts empty optional button ${field}: ${String(value)}`, () => {
      const template = fixture(); template.buttons[0][field] = value;
      assert.ok(build({ template }));
    });
  for (const location of ["template", "button"])
    test(`rejects nonempty optional ${location} ${field}`, () => {
      const template = fixture(); (location === "button" ? template.buttons[0] : template)[field] = "https://unexpected.invalid";
      assert.throws(() => build({ template }), /mismatch/);
    });
}
for (const value of [[{}], {}, "", false])
  test(`rejects nonempty/malformed quickReplies ${JSON.stringify(value)}`, () => {
    assert.throws(() => build({ template: { ...fixture(), quickReplies: value } }), /quick_replies_mismatch/);
  });
test("extra button actions, welcome IDs and unknown IDs cannot be classified by body", () => {
  const template = fixture(); template.buttons[0].unexpectedAction = "go";
  assert.throws(() => build({ template }), /buttons_mismatch/);
  assert.throws(() => build({ template: { ...fixture(), templateId: welcomeId } }), /welcome_template_forbidden/);
  assert.throws(() => build({ template: { ...fixture(), templateId: "unknown" } }), /templateId_mismatch/);
});

test("retains every existing independently audited ID, umbrella attestation and unrelated metadata", () => {
  const input = config(); input.providerHistoryCoverage.nonWelcomeTemplateAllowlist = existing();
  const result = build({ config: input });
  assert.deepEqual(result.templateIds, ["synthetic-previous-audited-id", source.groupSurveyId]);
  assert.equal(result.auditId, existing().auditId);
  assert.equal(result.operatorNote, "preserve");
  assert.deepEqual(result.scopedAudits.other, existing().scopedAudits.other);
  input.providerHistoryCoverage.nonWelcomeTemplateAllowlist = result;
  assert.deepEqual(build({ config: input }), result);
});
for (const value of [null, [], {}, { ...existing(), independentlyAudited: false }, { ...existing(), auditId: " padded " },
  { ...existing(), auditId: "" }, { ...existing(), templateIds: "invalid" }, { ...existing(), templateIds: [null] },
  { ...existing(), templateIds: ["bad/id"] }, { ...existing(), templateIds: [welcomeId] },
  { ...existing(), templateIds: ["dup", "dup"] }, { ...existing(), scopedAudits: [] },
  { ...existing(), auditId: NONWELCOME_AUDIT_ID },
]) {
  test(`malformed existing audit fails closed: ${JSON.stringify(value)}`, () => {
    const input = config(); input.providerHistoryCoverage.nonWelcomeTemplateAllowlist = value;
    assert.throws(() => build({ config: input }), /invalid_existing/);
  });
}
for (const field of ["auditId", "contractHash", "templateId", "auditedAt", "sourceHash"]) {
  test(`scoped metadata tamper rejected: ${field}`, () => {
    const input = config(), prior = build(); prior.scopedAudits.group_survey[field] = "tampered";
    input.providerHistoryCoverage.nonWelcomeTemplateAllowlist = prior;
    assert.throws(() => build({ config: input }), /invalid_existing_nonwelcome_audit_metadata/);
  });
}
for (const field of ["enabled", "mode", "sourcePromoted", "nativeE2eVerified"])
  test(`requires promoted live E2e gate: ${field}`, async () => {
    const input = config(); input[field] = field === "mode" ? "shadow" : "true";
    let reads = 0; const db = memoryDb(input);
    await assert.rejects(run(db, { apply: true, providerGet: async () => { reads++; return fixture(); } }), /enabled_live_promoted_e2e_required/);
    assert.equal(reads, 0); assert.equal(db.state().writes.length, 0);
  });
for (const field of ["verified", "allWelcomeVersions", "noRetentionGap", "auditId"])
  test(`requires independent general coverage before provider GET: ${field}`, async () => {
    const input = config(); input.providerHistoryCoverage[field] = field === "auditId" ? " " : 1;
    let reads = 0; const db = memoryDb(input);
    await assert.rejects(run(db, { providerGet: async () => { reads++; return fixture(); } }), /general_history_coverage_required/);
    assert.equal(reads, 0); assert.equal(db.state().writes.length, 0);
  });
for (const changedSource of [{ ...source, groupSurveyId: "unknown" }, { ...source, welcomeIds: [source.groupSurveyId] },
  { ...source, welcomeIds: [] }, { ...source, sourceHash: "invalid" }])
  test(`rejects invalid source attestation ${JSON.stringify(changedSource)}`, () => {
    assert.throws(() => build({ source: changedSource }), /source_attestation_invalid/);
  });

test("default dry-run never opens a transaction or writes; output contains metadata and IDs only", async () => {
  const db = memoryDb(), before = db.state().data;
  const result = await run(db, { providerGet: async (url) => {
    assert.equal(url, `https://api.solapi.com/kakao/v2/templates/${source.groupSurveyId}`); return fixture();
  } });
  assert.equal(result.applied, false);
  assert.deepEqual(Object.keys(result).sort(), ["applied", "audit", "templateIds"]);
  assert.deepEqual(db.state(), { data: before, writes: [], transactions: 0 });
  assert.equal(JSON.stringify(result).includes(fixture().content), false);
});
test("apply atomically patches only the nested allowlist; preserves every other setting and general proof", async () => {
  const initial = config(); initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = existing();
  const db = memoryDb(initial), result = await run(db, { apply: true }), state = db.state();
  assert.equal(result.applied, true);
  assert.equal(state.transactions, 1);
  assert.equal(state.writes.length, 1);
  assert.deepEqual(Object.keys(state.writes[0]), [AUDIT_FIELD]);
  const expected = clone(initial); expected.providerHistoryCoverage.nonWelcomeTemplateAllowlist = state.writes[0][AUDIT_FIELD];
  assert.deepEqual(state.data, expected);
});
for (const mode of ["updateTime", "content-without-version", "source"]) {
  test(`concurrent ${mode} change aborts before nested write`, async () => {
    const db = memoryDb(); let changed = false;
    await assert.rejects(run(db, { apply: true, readSource: () => ({ ...clone(source), ...(changed && mode === "source" ? { sourceHash: "b".repeat(64) } : {}) }),
      providerGet: async () => {
        if (mode === "updateTime") db.bump();
        if (mode === "content-without-version") db.change((data) => { data.unrelated.nested = false; }, false);
        changed = true; return fixture();
      } }), /changed_retry_read_only/);
    assert.equal(db.state().writes.length, 0);
  });
}
test("provider failure or invalid contract never writes", async () => {
  for (const providerGet of [async () => { throw new Error("offline"); }, async () => ({ ...fixture(), status: "PENDING" })]) {
    const db = memoryDb(); await assert.rejects(run(db, { apply: true, providerGet }));
    assert.equal(db.state().writes.length, 0); assert.equal(db.state().transactions, 0);
  }
});
test("dry-run also detects changed configuration", async () => {
  const db = memoryDb();
  await assert.rejects(run(db, { providerGet: async () => { db.bump(); return fixture(); } }), /settings_changed/);
  assert.equal(db.state().writes.length, 0);
});
test("operator CLI flags are opt-in and reject ambiguous extras", () => {
  assert.deepEqual(parseAuditArgs([]), { apply: false });
  assert.deepEqual(parseAuditArgs(["--dry-run"]), { apply: false });
  assert.deepEqual(parseAuditArgs(["--apply"]), { apply: true });
  for (const args of [["--apply=false"], ["--apply", "--dry-run"], ["--project=other"], ["--apply", "--apply"]])
    assert.throws(() => parseAuditArgs(args));
});
const key = () => ({ type: "service_account", project_id: AUDIT_PROJECT, client_email: AUDIT_OPERATOR,
  private_key: "-----BEGIN PRIVATE KEY-----synthetic-only", token_uri: "https://oauth2.googleapis.com/token" });
test("ADC validation is local and binds operator, project, token endpoint and no emulators", () => {
  validateAuditCredential(key());
  for (const field of ["type", "project_id", "client_email", "private_key", "token_uri"])
    assert.throws(() => validateAuditCredential({ ...key(), [field]: "wrong" }));
  for (const name of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "GOOGLE_APPLICATION_CREDENTIALS_JSON"])
    assert.throws(() => validateAuditCredential(key(), { [name]: "wrong" }));
});
test("provider adapter permits only the fixed template GET, with redirects blocked and no secret output", async () => {
  const reads = [], calls = [];
  const get = createTemplateGetter({ readSecret: (name) => { reads.push(name); return "synthetic"; },
    now: () => at, salt: () => "fixed-test-salt", fetchImpl: async (url, options) => {
      calls.push({ url, options }); return { ok: true, json: async () => fixture() };
    } });
  await assert.rejects(get("https://api.solapi.com/messages/v4/send"));
  assert.equal(reads.length, 0); assert.equal(calls.length, 0);
  assert.deepEqual(await get(`https://api.solapi.com/kakao/v2/templates/${source.groupSurveyId}`), fixture());
  assert.deepEqual(reads, ["SOLAPI_API_KEY", "SOLAPI_API_SECRET"]);
  assert.equal(calls[0].options.method, "GET"); assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.body, undefined);
});
test("invalid CLI flags exit without credentials or requests and suppress sensitive error text", () => {
  const result = spawnSync(process.execPath, ["scripts/audit-membership-welcome-nonwelcome-templates.mjs", "--invalid"], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), { status: "failed_or_unconfirmed", error: "nonwelcome_audit_failed_no_secrets_logged" });
});

test("malformed prior allowlist blocks provider requests and transactions", async () => {
  const input = config(); input.providerHistoryCoverage.nonWelcomeTemplateAllowlist = { ...existing(), templateIds: [welcomeId] };
  const db = memoryDb(input); let reads = 0;
  await assert.rejects(run(db, { apply: true, providerGet: async () => { reads++; return fixture(); } }), /invalid_existing/);
  assert.equal(reads, 0); assert.equal(db.state().transactions, 0);
});
test("missing settings or updateTime cannot bootstrap or reset configuration", async () => {
  for (const snap of [{ exists: false, data: () => undefined }, { exists: true, data: config }]) {
    let reads = 0;
    const db = { doc: () => ({ get: async () => snap }), runTransaction: () => assert.fail("must not write") };
    await assert.rejects(run(db, { apply: true, providerGet: async () => { reads++; return fixture(); } }), /existing_settings_update_time_required/);
    assert.equal(reads, 0);
  }
});
test("strict audit timestamp and apply flag reject coercion", async () => {
  for (const auditedAt of [undefined, null, "2026-02-30T01:00:00.000Z", "2026-10-19", at.replace("Z", "")])
    assert.throws(() => build({ auditedAt }), /invalid_nonwelcome_audit_timestamp/);
  await assert.rejects(run(memoryDb(), { apply: "true" }), /invalid_apply_flag/);
});
test("failed transaction commit never returns a successful apply result", async () => {
  const db = memoryDb();
  db.runTransaction = async () => { throw new Error("unconfirmed_commit"); };
  await assert.rejects(run(db, { apply: true }), /unconfirmed_commit/);
});
test("empty/null quick replies remain valid, but empty fields never rescue a wrong button", () => {
  for (const quickReplies of [undefined, null, []]) assert.ok(build({ template: { ...fixture(), quickReplies } }));
  const template = fixture(); template.buttons[0].linkMo += "&extra=true";
  template.buttons[0].linkAnd = null;
  assert.throws(() => build({ template }), /buttons_mismatch/);
});
