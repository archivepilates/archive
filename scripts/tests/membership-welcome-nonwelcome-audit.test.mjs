import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  AUDIT_FIELD, AUDIT_SETTINGS, AUDIT_PROJECT, AUDIT_OPERATOR,
  NONWELCOME_CONTRACT, NONWELCOME_CONTRACT_HASH, NONWELCOME_AUDIT_ID, NONWELCOME_SCOPES,
  auditHash, buildNonWelcomeAllowlist, auditMembershipWelcomeNonWelcome,
  readNonWelcomeAuditSource, nonWelcomeScopeTemplateId,
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
  assert.deepEqual(parseAuditArgs([]), { apply: false, scope: "group_survey" });
  assert.deepEqual(parseAuditArgs(["--dry-run"]), { apply: false, scope: "group_survey" });
  assert.deepEqual(parseAuditArgs(["--apply"]), { apply: true, scope: "group_survey" });
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

// Synthetic full contract for isolated tests, not a claim about the provider's actual body.
const reservationContract = () => ({
  templateId: "KA01TP26072806273194229P2ZesQwPp", status: "APPROVED",
  name: "아카이브 스튜디오메이트 예약 안내 v4", channelId: "KA01PF260511123220162lk0NUjstpVl",
  messageType: "BA", emphasizeType: "IMAGE", imageId: "ST01FZ260728062730347ZXJsa4lUJuP",
  content: "Synthetic static-source fixture: #{이름}, #{예약주차}.",
  buttons: [
    { buttonType: "WL", buttonName: "Synthetic notice", targetOut: false,
      linkMo: "https://archivepilates.notion.site/notice", linkPc: "https://archivepilates.notion.site/notice" },
    { buttonType: "WL", buttonName: "Synthetic method", targetOut: true,
      linkMo: "https://archivepilates.notion.site/studiomate", linkPc: "https://archivepilates.notion.site/studiomate" },
  ],
});
const reservationSource = () => ({ ...clone(source), reservationOpenContract: reservationContract() });
const reservationBuild = (overrides = {}) => build({ scope: "reservation_open", source: reservationSource(),
  template: reservationContract(), ...overrides });
const reservationRun = (db, overrides = {}) => run(db, { scope: "reservation_open",
  readSource: () => reservationSource(), providerGet: async () => reservationContract(), ...overrides });

function staticReader(contract = reservationContract()) {
  const symbols = [];
  return {
    symbols,
    constant(path, name) {
      symbols.push({ path, name });
      if (name === "ALIMTALK_TEMPLATES") return {
        group_survey: { code: source.groupSurveyId }, reservation_open: { code: reservationContract().templateId },
        membership_welcome: { code: welcomeId },
      };
      if (name === "MEMBERSHIP_WELCOME_HISTORY_TEMPLATE_IDS") return [welcomeId, "synthetic-legacy-welcome"];
      if (name === "MEMBERSHIP_WELCOME_TEMPLATE") return { templateId: welcomeId, referenceTemplateId: "synthetic-reference-welcome" };
      if (name === "RESERVATION_OPEN_ALIMTALK_TEMPLATE") {
        if (contract === undefined) throw new Error("Missing source constant");
        return clone(contract);
      }
      assert.fail(`Unexpected source symbol: ${name}`);
    },
    fingerprints: () => [{ path: "synthetic-static-source", sha256: "c".repeat(64) }],
  };
}

test("static source reader defaults to group survey and retains the original group contract hash", () => {
  assert.equal(NONWELCOME_CONTRACT_HASH, "f80ef17f6b46b3dbb24db79c3c3edfb16eb11785ec7c6e77f8676775cff0b433");
  const actual = readNonWelcomeAuditSource();
  assert.equal(actual.groupSurveyId, source.groupSurveyId);
  assert.ok(actual.welcomeIds.includes(welcomeId));
  const reader = staticReader();
  readNonWelcomeAuditSource("group_survey", reader);
  assert.equal(reader.symbols.some(({ name }) => name === "RESERVATION_OPEN_ALIMTALK_TEMPLATE"), false);
});

test("reservation source uses only the named full static contract and protects all welcome IDs", () => {
  const reader = staticReader(), actual = readNonWelcomeAuditSource("reservation_open", reader);
  assert.deepEqual(actual.reservationOpenContract, reservationContract());
  assert.ok(reader.symbols.some(({ path, name }) => path.endsWith("alimtalk/templates.ts") && name === "RESERVATION_OPEN_ALIMTALK_TEMPLATE"));
  for (const templateId of actual.welcomeIds)
    assert.throws(() => reservationBuild({ source: actual, template: { ...reservationContract(), templateId } }), /welcome_template_forbidden/);
});

test("reservation scope never falls back to template ID, catalog snippets or provider body as expected contract", async () => {
  const reader = staticReader();
  const read = reader.constant;
  reader.constant = (path, name) => {
    if (name === "RESERVATION_OPEN_ALIMTALK_TEMPLATE") throw new Error("Missing static full contract");
    return read(path, name);
  };
  assert.throws(() => readNonWelcomeAuditSource("reservation_open", reader), /reservation_open_static_contract_required/);
  await assert.rejects(reservationRun({ doc: () => assert.fail("no database access") }, {
    readSource: () => clone(source), providerGet: () => assert.fail("no provider access"),
  }), /reservation_open_static_contract_required/);
});

test("reservation audit matches the full contract and has a distinct stable audit ID", () => {
  const a = reservationBuild(), b = reservationBuild({ auditedAt: "2026-10-20T01:00:00.000Z" });
  assert.deepEqual(a.templateIds, [reservationContract().templateId]);
  assert.notEqual(a.auditId, NONWELCOME_AUDIT_ID);
  assert.equal(a.scopedAudits.reservation_open.contractHash, auditHash(reservationContract()));
  assert.equal(a.scopedAudits.reservation_open.auditId, b.scopedAudits.reservation_open.auditId);
  assert.equal(a.scopedAudits.group_survey, undefined);
});

for (const field of ["templateId", "status", "name", "channelId", "messageType", "emphasizeType", "imageId", "content"]) {
  test(`reservation provider contract rejects exact field drift: ${field}`, () => {
    const template = reservationContract(); template[field] += " ";
    assert.throws(() => reservationBuild({ template }), /mismatch/);
  });
}
for (const index of [0, 1]) {
  for (const field of ["buttonType", "buttonName", "linkMo", "linkPc", "targetOut"]) {
    test(`reservation button ${index} rejects exact field drift: ${field}`, () => {
      const template = reservationContract();
      template.buttons[index][field] = field === "targetOut" ? !template.buttons[index][field] : "altered";
      assert.throws(() => reservationBuild({ template }), /buttons_mismatch/);
    });
  }
  for (const field of ["linkAnd", "linkIos", "chatExtra", "unexpectedAction"]) {
    test(`reservation button ${index} rejects extra action: ${field}`, () => {
      const template = reservationContract(); template.buttons[index][field] = "https://unexpected.invalid";
      assert.throws(() => reservationBuild({ template }), /buttons_mismatch/);
    });
  }
}
for (const buttons of [null, [], [reservationContract().buttons[0]], [null, null], reservationContract().buttons.toReversed(),
  [...reservationContract().buttons, reservationContract().buttons[0]]]) {
  test(`reservation rejects missing, reordered or extra buttons: ${JSON.stringify(buttons)}`, () => {
    assert.throws(() => reservationBuild({ template: { ...reservationContract(), buttons } }), /buttons_mismatch/);
  });
}
test("reservation scope retains strict quick reply and top-level optional link guards", () => {
  for (const quickReplies of [[{}], {}, "", false])
    assert.throws(() => reservationBuild({ template: { ...reservationContract(), quickReplies } }), /quick_replies_mismatch/);
  for (const key of ["linkAnd", "linkIos", "chatExtra"])
    assert.throws(() => reservationBuild({ template: { ...reservationContract(), [key]: "unexpected" } }), /optional_links_mismatch/);
});

for (const patch of [
  { content: undefined }, { content: "#{이름} only" }, { content: "#{예약주차} only" },
  { imageId: "other" }, { templateId: welcomeId }, { status: "PENDING" },
  { buttons: [] }, { buttons: reservationContract().buttons.toReversed() }, { extraAction: "unexpected" },
]) {
  test(`reservation rejects incomplete or wrong static source contract: ${JSON.stringify(patch)}`, async () => {
    const changedSource = reservationSource(); Object.assign(changedSource.reservationOpenContract, patch);
    await assert.rejects(reservationRun({ doc: () => assert.fail("no database access") }, {
      readSource: () => changedSource, providerGet: () => assert.fail("no provider access"),
    }), /reservation_open_static_contract_required/);
  });
}

test("adding reservation scope preserves prior group audit, IDs, timestamp and umbrella audit verbatim", async () => {
  const initial = config(), groupAudit = build();
  initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = groupAudit;
  const db = memoryDb(initial), result = await reservationRun(db, { apply: true });
  const saved = db.state().data.providerHistoryCoverage.nonWelcomeTemplateAllowlist;
  assert.equal(result.applied, true);
  assert.equal(saved.auditId, groupAudit.auditId);
  assert.deepEqual(saved.scopedAudits.group_survey, groupAudit.scopedAudits.group_survey);
  assert.deepEqual(saved.templateIds, [source.groupSurveyId, reservationContract().templateId]);
  const expected = clone(initial); expected.providerHistoryCoverage.nonWelcomeTemplateAllowlist = saved;
  assert.deepEqual(db.state().data, expected);
  assert.deepEqual(Object.keys(db.state().writes[0]), [AUDIT_FIELD]);
  assert.deepEqual(reservationBuild({ config: db.state().data }), saved);
});

test("adding group scope preserves a prior reservation audit without re-certifying it", () => {
  const initial = config(), reservationAudit = reservationBuild();
  initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = reservationAudit;
  const saved = build({ config: initial });
  assert.equal(saved.auditId, reservationAudit.auditId);
  assert.deepEqual(saved.scopedAudits.reservation_open, reservationAudit.scopedAudits.reservation_open);
  assert.deepEqual(saved.templateIds, [reservationContract().templateId, source.groupSurveyId]);
});

for (const scope of ["group_survey", "reservation_open"]) {
  for (const field of ["auditId", "contractHash", "templateId", "auditedAt", "sourceHash"]) {
    test(`reservation audit rejects tampered prior ${scope} metadata: ${field}`, () => {
      const initial = config(), prior = scope === "group_survey" ? build() : reservationBuild();
      prior.scopedAudits[scope][field] = "tampered";
      initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = prior;
      assert.throws(() => reservationBuild({ config: initial }), /invalid_existing_nonwelcome_audit_metadata/);
    });
  }
}

test("reservation dry-run fetches only its exact template and never writes", async () => {
  const db = memoryDb(), before = db.state();
  const result = await reservationRun(db, { providerGet: async (url) => {
    assert.equal(url, `https://api.solapi.com/kakao/v2/templates/${reservationContract().templateId}`);
    return reservationContract();
  } });
  assert.equal(result.applied, false);
  assert.deepEqual(db.state(), before);
});

for (const mode of ["settings", "source"]) {
  test(`reservation audit aborts concurrent ${mode} change before writing`, async () => {
    const db = memoryDb(); let changed = false;
    await assert.rejects(reservationRun(db, { apply: true, readSource: () => {
      const current = reservationSource();
      if (changed && mode === "source") current.reservationOpenContract.content += " altered";
      return current;
    }, providerGet: async () => {
      if (mode === "settings") db.bump();
      changed = true; return reservationContract();
    } }), /changed_retry_read_only/);
    assert.equal(db.state().writes.length, 0);
  });
}

test("CLI scope is explicit, validated, single-use and defaults to group survey", () => {
  assert.deepEqual(parseAuditArgs(["--scope", "reservation_open"]), { apply: false, scope: "reservation_open" });
  assert.deepEqual(parseAuditArgs(["--apply", "--scope", "reservation_open"]), { apply: true, scope: "reservation_open" });
  assert.deepEqual(parseAuditArgs(["--scope", "group_survey", "--dry-run"]), { apply: false, scope: "group_survey" });
  for (const args of [["--scope"], ["--scope", "unknown"], ["--scope", "membership_welcome"],
    ["--scope=reservation_open"], ["--scope", "reservation_open", "--scope", "group_survey"],
    ["--scope", "reservation_open", "--apply", "--dry-run"]]) assert.throws(() => parseAuditArgs(args));
  for (const scope of ["membership_welcome", "unknown", null, {}, " group_survey"])
    assert.throws(() => nonWelcomeScopeTemplateId(scope), /invalid_nonwelcome_audit_scope/);
});

test("reservation provider getter rejects every non-scoped URL before any credential or network call", async () => {
  let secretReads = 0, networkCalls = 0;
  const get = createTemplateGetter({ scope: "reservation_open", readSecret: () => { secretReads++; return "synthetic"; },
    now: () => at, salt: () => "synthetic-salt", fetchImpl: async (url, options) => {
      networkCalls++; assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
      return { ok: true, json: async () => reservationContract() };
    } });
  for (const templateId of [source.groupSurveyId, welcomeId, "unknown"])
    await assert.rejects(get(`https://api.solapi.com/kakao/v2/templates/${templateId}`), /Only the scoped/);
  for (const url of ["https://api.solapi.com/messages/v4/send",
    `https://api.solapi.com/kakao/v2/templates/${reservationContract().templateId}?extra=1`])
    await assert.rejects(get(url), /Only the scoped/);
  assert.equal(secretReads, 0); assert.equal(networkCalls, 0);
  assert.deepEqual(await get(`https://api.solapi.com/kakao/v2/templates/${reservationContract().templateId}`), reservationContract());
  assert.equal(secretReads, 2); assert.equal(networkCalls, 1);
});

// Independent synthetic bodies exercise full comparison without contacting the provider.
const privateScopes = {
  private_survey: {
    symbol: "PRIVATE_SURVEY_NONWELCOME_CONTRACT", sourceKey: "privateSurveyContract",
    contract: {
      templateId: "KA01TP260729144645970fv13He8mfsK", status: "APPROVED",
      name: "프라이빗 사전설문 안내 v2", channelId: "KA01PF260511123220162lk0NUjstpVl",
      messageType: "BA", emphasizeType: "IMAGE", imageId: "ST01FZ2605141601264576AUwmK3Bqgl",
      content: "Synthetic private survey for #{이름}.",
      buttons: [{ buttonType: "WL", buttonName: "사전설문 작성", targetOut: true,
        linkMo: "https://in.archivepilates.com/s/#{링크ID}/", linkPc: "https://in.archivepilates.com/s/#{링크ID}/" }],
    },
  },
  private_lesson_report: {
    symbol: "PRIVATE_LESSON_REPORT_NONWELCOME_CONTRACT", sourceKey: "privateLessonReportContract",
    contract: {
      templateId: "KA01TP260528081225871Fr92FW901Vo", status: "APPROVED",
      name: "회원용_프라이빗 수업 리포트 안내 v1", channelId: "KA01PF260511123220162lk0NUjstpVl",
      messageType: "BA", emphasizeType: "IMAGE", imageId: "ST01FZ260528081542186AabecSODs8l",
      content: "Synthetic private report for #{회원명}: #{수업일시}, #{회차}.",
      buttons: [{ buttonType: "WL", buttonName: "리포트 확인하기", targetOut: true,
        linkMo: "https://in.archivepilates.com/s/#{리포트링크ID}/", linkPc: "https://in.archivepilates.com/s/#{리포트링크ID}/" }],
    },
  },
};
const privateContract = (scope) => clone(privateScopes[scope].contract);
const privateSource = (scope) => ({ ...clone(source), [privateScopes[scope].sourceKey]: privateContract(scope) });
const privateBuild = (scope, overrides = {}) => build({ scope, source: privateSource(scope), template: privateContract(scope), ...overrides });
const privateRun = (scope, db, overrides = {}) => run(db, { scope,
  readSource: () => privateSource(scope), providerGet: async () => privateContract(scope), ...overrides });

function privateStaticReader(scope, contract = privateContract(scope)) {
  const reader = staticReader(), read = reader.constant;
  reader.constant = (path, name) => {
    if (name === privateScopes[scope].symbol) {
      reader.symbols.push({ path, name });
      if (contract === null) throw new Error("Missing full static contract");
      return clone(contract);
    }
    const value = read(path, name);
    if (name === "ALIMTALK_TEMPLATES") value[scope] = { code: privateContract(scope).templateId };
    return value;
  };
  return reader;
}

for (const scope of Object.keys(privateScopes)) {
  const { symbol, sourceKey } = privateScopes[scope];
  test(`${scope} reads only its named static contract and the matching template type`, () => {
    const reader = privateStaticReader(scope), actual = readNonWelcomeAuditSource(scope, reader);
    assert.deepEqual(actual[sourceKey], privateContract(scope));
    assert.ok(reader.symbols.some(({ path, name }) => path.endsWith("alimtalk/templates.ts") && name === symbol));
    assert.equal(reader.symbols.some(({ name }) => name === "RESERVATION_OPEN_ALIMTALK_TEMPLATE"), false);
    const otherSymbol = Object.values(privateScopes).find((entry) => entry.symbol !== symbol).symbol;
    assert.equal(reader.symbols.some(({ name }) => name === otherSymbol), false);
    assert.equal(nonWelcomeScopeTemplateId(scope), privateContract(scope).templateId);
  });

  test(`${scope} canonical source parses locally and exactly matches its full contract`, () => {
    const actual = readNonWelcomeAuditSource(scope);
    const result = privateBuild(scope, { source: actual, template: clone(actual[sourceKey]) });
    assert.deepEqual(result.templateIds, [privateContract(scope).templateId]);
    assert.equal(result.scopedAudits[scope].contractHash, auditHash(actual[sourceKey]));
    for (const templateId of actual.welcomeIds)
      assert.throws(() => privateBuild(scope, { source: actual, template: { ...clone(actual[sourceKey]), templateId } }), /welcome_template_forbidden/);
  });

  test(`${scope} cannot use mismatched ALIMTALK_TEMPLATES, missing constants or partial snippets`, async () => {
    const reader = privateStaticReader(scope), read = reader.constant;
    reader.constant = (path, name) => {
      const value = read(path, name);
      if (name === "ALIMTALK_TEMPLATES") value[scope].code = welcomeId;
      return value;
    };
    assert.throws(() => readNonWelcomeAuditSource(scope, reader), /source_attestation_invalid/);
    assert.throws(() => readNonWelcomeAuditSource(scope, privateStaticReader(scope, null)), new RegExp(`${scope}_static_contract_required`));
    await assert.rejects(privateRun(scope, { doc: () => assert.fail("no database access") }, {
      readSource: () => clone(source), providerGet: () => assert.fail("no provider access"),
    }), new RegExp(`${scope}_static_contract_required`));
  });

  test(`${scope} creates a stable scoped audit without mutating inputs`, () => {
    const input = config(), original = clone(input), inputSource = privateSource(scope), originalSource = clone(inputSource);
    const a = privateBuild(scope, { config: input, source: inputSource });
    const b = privateBuild(scope, { auditedAt: "2026-10-20T01:00:00.000Z" });
    assert.equal(a.scopedAudits[scope].auditId, b.scopedAudits[scope].auditId);
    assert.equal(a.scopedAudits[scope].contractHash, auditHash(privateContract(scope)));
    assert.notEqual(a.auditId, NONWELCOME_AUDIT_ID);
    assert.deepEqual(a.templateIds, [privateContract(scope).templateId]);
    assert.deepEqual(input, original); assert.deepEqual(inputSource, originalSource);
    assert.equal(a.scopedAudits.group_survey, undefined);
  });

  for (const field of ["templateId", "status", "name", "channelId", "messageType", "emphasizeType", "imageId", "content"]) {
    test(`${scope} rejects provider field tamper: ${field}`, () => {
      const template = privateContract(scope); template[field] += " ";
      assert.throws(() => privateBuild(scope, { template }), /mismatch/);
    });
    test(`${scope} rejects missing static source field before any IO: ${field}`, async () => {
      const changed = privateSource(scope); delete changed[sourceKey][field];
      await assert.rejects(privateRun(scope, { doc: () => assert.fail("no database access") }, {
        readSource: () => changed, providerGet: () => assert.fail("no provider access"),
      }), new RegExp(`${scope}_static_contract_required`));
    });
  }
  for (const field of ["buttonType", "buttonName", "linkMo", "linkPc", "targetOut"]) {
    test(`${scope} rejects provider button tamper: ${field}`, () => {
      const template = privateContract(scope);
      template.buttons[0][field] = field === "targetOut" ? false : "altered";
      assert.throws(() => privateBuild(scope, { template }), /buttons_mismatch/);
    });
    test(`${scope} rejects static source button tamper: ${field}`, () => {
      const changed = privateSource(scope);
      changed[sourceKey].buttons[0][field] = field === "targetOut" ? false : "altered";
      assert.throws(() => privateBuild(scope, { source: changed }), new RegExp(`${scope}_static_contract_required`));
    });
  }
  for (const buttons of [undefined, null, {}, [], [null], [privateContract(scope).buttons[0], privateContract(scope).buttons[0]]]) {
    test(`${scope} rejects malformed or extra provider/source buttons: ${JSON.stringify(buttons)}`, () => {
      assert.throws(() => privateBuild(scope, { template: { ...privateContract(scope), buttons } }), /buttons_mismatch/);
      const changed = privateSource(scope); changed[sourceKey].buttons = buttons;
      assert.throws(() => privateBuild(scope, { source: changed }), new RegExp(`${scope}_static_contract_required`));
    });
  }
  for (const field of ["linkAnd", "linkIos", "chatExtra", "unexpectedAction"]) {
    test(`${scope} rejects additional provider button action: ${field}`, () => {
      const template = privateContract(scope); template.buttons[0][field] = "https://unexpected.invalid";
      assert.throws(() => privateBuild(scope, { template }), /buttons_mismatch/);
    });
  }
  test(`${scope} preserves optional-link and quick-reply guards`, () => {
    for (const quickReplies of [[{}], {}, "", false])
      assert.throws(() => privateBuild(scope, { template: { ...privateContract(scope), quickReplies } }), /quick_replies_mismatch/);
    for (const quickReplies of [undefined, null, []])
      assert.ok(privateBuild(scope, { template: { ...privateContract(scope), quickReplies } }));
    for (const field of ["linkAnd", "linkIos", "chatExtra"])
      assert.throws(() => privateBuild(scope, { template: { ...privateContract(scope), [field]: "unexpected" } }), /optional_links_mismatch/);
  });
  for (const patch of [{ content: "missing required variables" }, { templateId: welcomeId }, { imageId: "other" },
    { status: "PENDING" }, { extraAction: "unexpected" }]) {
    test(`${scope} rejects wrong/incomplete static contract: ${JSON.stringify(patch)}`, () => {
      const changed = privateSource(scope); Object.assign(changed[sourceKey], patch);
      assert.throws(() => privateBuild(scope, { source: changed }), new RegExp(`${scope}_static_contract_required`));
    });
  }
  test(`${scope} never approves a different scope, legacy template or arbitrary ID`, () => {
    for (const templateId of [welcomeId, source.groupSurveyId, reservationContract().templateId, "unknown",
      "KA01TP260514153632171uiWXYoeiOLS", ...Object.keys(privateScopes).filter((entry) => entry !== scope).map((entry) => privateContract(entry).templateId)])
      assert.throws(() => privateBuild(scope, { template: { ...privateContract(scope), templateId } }), /forbidden|mismatch/);
    assert.throws(() => privateBuild(scope, { source: { ...privateSource(scope), welcomeIds: [privateContract(scope).templateId] } }), /source_attestation_invalid/);
  });
  test(`${scope} dry-run GETs its exact template and never writes`, async () => {
    const db = memoryDb(), before = db.state();
    const result = await privateRun(scope, db, { providerGet: async (url) => {
      assert.equal(url, `https://api.solapi.com/kakao/v2/templates/${privateContract(scope).templateId}`);
      return privateContract(scope);
    } });
    assert.equal(result.applied, false); assert.deepEqual(db.state(), before);
  });
  for (const mode of ["settings", "source"]) {
    test(`${scope} aborts concurrent ${mode} change before a scoped write`, async () => {
      const db = memoryDb(); let changed = false;
      await assert.rejects(privateRun(scope, db, { apply: true, readSource: () => {
        const current = privateSource(scope);
        if (changed && mode === "source") current[sourceKey].content += " altered";
        return current;
      }, providerGet: async () => {
        if (mode === "settings") db.bump();
        changed = true; return privateContract(scope);
      } }), /changed_retry_read_only/);
      assert.equal(db.state().writes.length, 0);
    });
  }
  test(`${scope} provider failure or field drift cannot reach a write`, async () => {
    for (const providerGet of [async () => { throw new Error("offline"); }, async () => ({ ...privateContract(scope), content: "altered" })]) {
      const db = memoryDb();
      await assert.rejects(privateRun(scope, db, { apply: true, providerGet }));
      assert.equal(db.state().writes.length, 0); assert.equal(db.state().transactions, 0);
    }
  });
  test(`${scope} retains group, reservation and existing independent audit metadata verbatim`, async () => {
    const initial = config(); initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = existing();
    const group = build({ config: initial }); initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = group;
    const prior = reservationBuild({ config: initial }); initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = prior;
    const before = clone(initial), db = memoryDb(initial), result = await privateRun(scope, db, { apply: true });
    const saved = db.state().data.providerHistoryCoverage.nonWelcomeTemplateAllowlist;
    assert.equal(result.applied, true); assert.equal(saved.auditId, prior.auditId);
    for (const [key, audit] of Object.entries(prior.scopedAudits)) assert.deepEqual(saved.scopedAudits[key], audit);
    assert.equal(saved.operatorNote, prior.operatorNote);
    assert.deepEqual(saved.templateIds, [...prior.templateIds, privateContract(scope).templateId]);
    const expected = clone(before); expected.providerHistoryCoverage.nonWelcomeTemplateAllowlist = saved;
    assert.deepEqual(db.state().data, expected);
    assert.equal(db.state().writes.length, 1); assert.deepEqual(Object.keys(db.state().writes[0]), [AUDIT_FIELD]);
    assert.deepEqual(privateBuild(scope, { config: db.state().data }), saved);
  });
  for (const priorScope of NONWELCOME_SCOPES) {
    for (const field of ["auditId", "contractHash", "templateId", "auditedAt", "sourceHash"]) {
      test(`${scope} rejects tampered prior ${priorScope} metadata: ${field}`, () => {
        const initial = config(), prior = priorScope === "group_survey" ? build()
          : priorScope === "reservation_open" ? reservationBuild() : privateBuild(priorScope);
        prior.scopedAudits[priorScope][field] = "tampered";
        initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = prior;
        assert.throws(() => privateBuild(scope, { config: initial }), /invalid_existing_nonwelcome_audit_metadata/);
      });
    }
  }
  test(`${scope} rejects malformed prior allowlists before provider GET`, async () => {
    const initial = config(); initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = { ...existing(), templateIds: [welcomeId] };
    const db = memoryDb(initial);
    await assert.rejects(privateRun(scope, db, { apply: true, providerGet: () => assert.fail("no provider access") }), /invalid_existing/);
    assert.equal(db.state().transactions, 0);
  });
  test(`${scope} requires scoped metadata for its own umbrella audit`, () => {
    const initial = config(), prior = privateBuild(scope); delete prior.scopedAudits[scope];
    initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = prior;
    assert.throws(() => privateBuild(scope, { config: initial }), /invalid_existing_nonwelcome_audit_metadata/);
  });
  test(`${scope} prior audit survives group/reservation/other private audits without re-certification`, () => {
    const prior = privateBuild(scope), initial = config();
    for (const nextScope of NONWELCOME_SCOPES.filter((entry) => entry !== scope)) {
      initial.providerHistoryCoverage.nonWelcomeTemplateAllowlist = clone(prior);
      const saved = nextScope === "group_survey" ? build({ config: initial })
        : nextScope === "reservation_open" ? reservationBuild({ config: initial }) : privateBuild(nextScope, { config: initial });
      assert.deepEqual(saved.scopedAudits[scope], prior.scopedAudits[scope]);
      assert.equal(saved.auditId, prior.auditId);
      assert.deepEqual(saved.templateIds, [...prior.templateIds, nonWelcomeScopeTemplateId(nextScope)]);
    }
  });
  test(`${scope} CLI is explicit, single-use and cannot select an arbitrary template`, () => {
    assert.deepEqual(parseAuditArgs(["--scope", scope]), { apply: false, scope });
    assert.deepEqual(parseAuditArgs(["--apply", "--scope", scope]), { apply: true, scope });
    assert.deepEqual(parseAuditArgs(["--scope", scope, "--dry-run"]), { apply: false, scope });
    for (const args of [["--scope", scope, "--scope", scope], ["--scope", scope, "--apply", "--dry-run"],
      ["--scope", scope, "--template-id", privateContract(scope).templateId], ["--scope", privateContract(scope).templateId]])
      assert.throws(() => parseAuditArgs(args));
  });
  test(`${scope} getter rejects every other URL before secrets and performs GET only`, async () => {
    let secretReads = 0; const calls = [];
    const get = createTemplateGetter({ scope, readSecret: () => { secretReads++; return "synthetic"; },
      now: () => at, salt: () => "synthetic-salt", fetchImpl: async (url, options) => {
        calls.push({ url, options }); return { ok: true, json: async () => privateContract(scope) };
      } });
    const allowedUrl = `https://api.solapi.com/kakao/v2/templates/${privateContract(scope).templateId}`;
    for (const otherScope of NONWELCOME_SCOPES.filter((entry) => entry !== scope))
      await assert.rejects(get(`https://api.solapi.com/kakao/v2/templates/${nonWelcomeScopeTemplateId(otherScope)}`), /Only the scoped/);
    for (const url of [`https://api.solapi.com/kakao/v2/templates/${welcomeId}`, "https://api.solapi.com/messages/v4/send-many/detail",
      `${allowedUrl}?extra=1`, `${allowedUrl}#fragment`, allowedUrl.replace("api.solapi.com", "unexpected.invalid")])
      await assert.rejects(get(url), /Only the scoped/);
    assert.equal(secretReads, 0); assert.equal(calls.length, 0);
    assert.deepEqual(await get(allowedUrl), privateContract(scope));
    assert.equal(secretReads, 2); assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, "GET"); assert.equal(calls[0].options.redirect, "error");
    assert.equal(calls[0].options.body, undefined);
  });
}

test("scope extension preserves group default and exposes only four exact current scopes", () => {
  assert.deepEqual(NONWELCOME_SCOPES, ["group_survey", "reservation_open", "private_survey", "private_lesson_report"]);
  assert.deepEqual(parseAuditArgs([]), { apply: false, scope: "group_survey" });
  const ids = NONWELCOME_SCOPES.map((scope) => nonWelcomeScopeTemplateId(scope));
  assert.equal(new Set(ids).size, 4);
  for (const scope of ["private_survey_v1", "staff_private_survey", "inbody_report", "all", welcomeId])
    assert.throws(() => parseAuditArgs(["--scope", scope]), /invalid_nonwelcome_audit_scope/);
  const reader = staticReader(); readNonWelcomeAuditSource("group_survey", reader);
  for (const { symbol } of Object.values(privateScopes)) assert.equal(reader.symbols.some((entry) => entry.name === symbol), false);
});
