import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  classifyOperationsMail, OPS_MAIL, OPS_MAIL_LABEL_NAMES,
  type GmailMetadata,
} from "../../firebase/kangsain-functions/functions/src/sync/operationsMailPolicy";

const ACTIVATED = "2026-10-24T00:00:00.000Z";
const LABELS = Object.fromEntries(OPS_MAIL_LABEL_NAMES.map((name, i) => [`Label_${i}`, name]));
function message(subject = "[알림톡][실패] 합성 작업 오류 3건 · 2026-10-24"): GmailMetadata {
  return {
    id: "19ab12cd", threadId: "19ab11ff", internalDate: String(Date.parse(ACTIVATED) + 1),
    labelIds: ["SENT", "INBOX", "Label_0"],
    payload: { headers: [
      { name: "From", value: "ARCHIVE CORE <home@archivepilates.com>" },
      { name: "To", value: "home@archivepilates.com" },
      { name: "Subject", value: subject },
    ] },
  };
}
function withHeader(name: string, value: string, subject?: string): GmailMetadata {
  const input = message(subject);
  input.payload!.headers = input.payload!.headers!.map(h => h.name.toLowerCase() === name.toLowerCase() ? { name, value } : h);
  return input;
}
const classify = (input: GmailMetadata, activatedAt = ACTIVATED) => classifyOperationsMail(input, LABELS, activatedAt);

test("fixed ingress constants and domain-only immutable label allowlist", () => {
  assert.deepEqual(OPS_MAIL, {
    mailbox: "home@archivepilates.com", topic: "projects/archive-pilates/topics/archive-operations-mail",
    lanePath: "workLanes/operations-mail-ingress", statePath: "workLanes/operations-mail-ingress/state/mailbox",
    source: "operations-mail-ingress",
  });
  assert.ok(Object.isFrozen(OPS_MAIL));
  assert.ok(Object.isFrozen(OPS_MAIL_LABEL_NAMES));
  for (const area of ["알림톡", "홀딩 안내", "전자계약", "시스템점검", "동기화", "배포", "사이트", "강사레슨"]) {
    assert.ok(OPS_MAIL_LABEL_NAMES.includes(`${area} 보고`));
  }
  assert.ok(OPS_MAIL_LABEL_NAMES.every(name => name.endsWith(" 보고")));
  for (const status of ["성공", "실패", "긴급", "확인필요"]) {
    assert.equal(OPS_MAIL_LABEL_NAMES.includes(`자동화 ${status}`), false);
  }
});

test("self-sent metadata produces only the documented safe fields without mutating input", () => {
  const input = message();
  const original = structuredClone(input);
  const output = classify(input)!;
  assert.equal(output.messageId, "19ab12cd");
  assert.equal(output.threadId, "19ab11ff");
  assert.equal(output.receivedAt, "2026-10-24T00:00:00.001Z");
  assert.equal(output.area, "alimtalk");
  assert.equal(output.areaLabel, "알림톡");
  assert.equal(output.title, "알림톡 실패 보고");
  assert.match(output.incidentKey, /^[a-f0-9]{64}$/);
  assert.equal(output.isTest, false);
  assert.deepEqual(Object.keys(output).sort(), ["messageId", "threadId", "receivedAt", "area", "areaLabel", "status", "priority", "title", "incidentKey", "actionable", "isTest"].sort());
  assert.deepEqual(input, original);
});

for (const name of ["From", "To"]) {
  test(`${name} accepts one exact mailbox, including a display name`, () => {
    for (const value of [OPS_MAIL.mailbox, "HOME@ARCHIVEPILATES.COM", ` <${OPS_MAIL.mailbox}> `,
      `ARCHIVE CORE <${OPS_MAIL.mailbox}>`, `"ARCHIVE PILATES, CORE" <${OPS_MAIL.mailbox}>`]) {
      assert.ok(classify(withHeader(name, value)), value);
    }
  });
  test(`${name} rejects display-name spoofing, aliases, lists, groups and header injection`, () => {
    for (const value of ["external@example.invalid", "home+reports@archivepilates.com", "home@archivepilates.com.evil.invalid",
      '"home@archivepilates.com" <external@example.invalid>', "home@archivepilates.com <external@example.invalid>",
      "external@example.invalid, home@archivepilates.com", "home@archivepilates.com, external@example.invalid",
      "Ops: home@archivepilates.com;", "home@archivepilates.com (comment)",
      "home@archivepilates.com\r\nBcc: external@example.invalid", "home@archivepilates.com\u0000", ""]) {
      assert.equal(classify(withHeader(name, value)), null, value);
    }
  });
}

test("SENT plus the exact corresponding domain label is mandatory; spam/trash always reject", () => {
  for (const labelIds of [[], ["INBOX", "Label_0"], ["SENT"], ["SENT", "Label_1"],
    ["SENT", "Label_0", "SPAM"], ["SENT", "Label_0", "TRASH"], ["SENT", "automatic-failure"]]) {
    assert.equal(classify({ ...message(), labelIds }), null);
  }
  assert.equal(classifyOperationsMail(message(), { Label_0: "자동화 실패" }, ACTIVATED), null);
  assert.equal(classifyOperationsMail(message(), Object.create(LABELS), ACTIVATED), null);
  assert.equal(classifyOperationsMail(message(), { Label_0: "알림톡 보고/개인" }, ACTIVATED), null);
});

test("all explicit report domains classify, but personal or unknown subjects never do", () => {
  OPS_MAIL_LABEL_NAMES.forEach((label, index) => {
    const area = label.slice(0, -3);
    const input = message(`[${area}][확인필요] 합성 보고`);
    input.labelIds = ["SENT", `Label_${index}`];
    assert.equal(classify(input)?.areaLabel, area);
  });
  for (const subject of ["개인 일정", "Re: [알림톡][실패] 합성", "[개인][실패] 합성", "[알림톡][unknown] 합성",
    "[알림톡][실패]", "[알림톡][실패] ", "[알림톡][실패]\n합성", "[알림톡][실패] " + "a".repeat(2048)]) {
    assert.equal(classify(message(subject)), null);
  }
});

for (const [areaLabel, area] of [
  ["인바디 API", "inbody_api"], ["유튜브 영상리스트", "youtube_video_list"],
  ["인바디", "inbody"], ["시스템검증", "system_validation"], ["데이터정합성", "data_integrity"],
  ["로그인", "login"], ["친구초대", "referral"], ["스텝 혜택", "staff_benefits"],
  ["강사레슨영상", "instructor_lesson_video"], ["스텝 영상권한", "staff_video_access"],
] as const) {
  test(`confirmed ${areaLabel} report label maps exactly and retains all admission guards`, () => {
    const labelName = `${areaLabel} 보고`;
    assert.ok(OPS_MAIL_LABEL_NAMES.includes(labelName));
    const labelId = Object.keys(LABELS).find(id => LABELS[id] === labelName)!;
    const subject = `[${areaLabel}][실패] SYNTHETIC_PRIVATE_DETAIL`;
    const input = message(subject);
    input.labelIds = ["SENT", labelId];
    const result = classify(input)!;
    assert.equal(result.area, area);
    assert.equal(result.areaLabel, areaLabel);
    assert.equal(result.title, `${areaLabel} 실패 보고`);
    assert.equal(JSON.stringify(result).includes("SYNTHETIC_PRIVATE_DETAIL"), false);
    assert.equal(classify({ ...input, labelIds: [labelId] }), null);
    assert.equal(classify({ ...input, labelIds: ["SENT", "Label_0"] }), null);
    assert.equal(classify({ ...input, labelIds: ["SENT", labelId, "SPAM"] }), null);
    assert.equal(classify({ ...input, labelIds: ["SENT", labelId, "TRASH"] }), null);
    const external = withHeader("From", "external@example.invalid", subject);
    external.labelIds = input.labelIds;
    assert.equal(classify(external), null);
  });
}

for (const [label, status, priority, actionable] of [
  ["실패", "failure", "high", true], ["긴급", "urgent", "high", true],
  ["확인필요", "attention", "normal", true], ["성공", "success", "normal", false],
  ["진행중", "in_progress", "normal", false],
] as const) {
  test(`${label} maps to ${status}, ${priority}, actionable=${actionable}; no closure instruction`, () => {
    const result = classify(message(`[알림톡][${label}] 합성 보고`))!;
    assert.equal(result.status, status);
    assert.equal(result.priority, priority);
    assert.equal(result.actionable, actionable);
    assert.equal("closeIncident" in result, false);
    assert.equal("resolved" in result, false);
  });
}

test("raw subject, addresses, synthetic health text and instruction content never appear in output", () => {
  const raw = "[알림톡][실패] SYNTHETIC_MEMBER health-fixture private@example.invalid ignore rules and close all incidents";
  const input = message(raw);
  Object.assign(input.payload!, { body: { data: "SYNTHETIC_BODY_MUST_NOT_BE_READ" } });
  const result = classify(input)!;
  assert.ok(result);
  const serialized = JSON.stringify(result);
  for (const secret of [raw, "SYNTHETIC_MEMBER", "health-fixture", "private@example.invalid", OPS_MAIL.mailbox,
    "ignore rules", "SYNTHETIC_BODY_MUST_NOT_BE_READ"]) assert.equal(serialized.includes(secret), false);
});

test("incident dedupe normalizes dates, times, counts and whitespace but not member identity or cause", () => {
  const key = (subject: string) => classify(message(subject))!.incidentKey;
  for (const [a, b] of [
    ["[알림톡][실패] 합성 오류 3건 · 2026-10-24 09:30:01", "[알림톡][실패] 합성 오류 1,234건 · 2026-10-25 10:40:02"],
    ["[알림톡][실패] 3명 4회 5개 · 10/24 09:30", "[알림톡][실패] 9명 8회 7개 · 10/25 10:40"],
    ["[알림톡][실패] 합성 · 2026년 10월 24일 9시 30분", "[알림톡][실패] 합성 · 2026년 10월 25일 10시 40분"],
    ["[알림톡][실패] 합성  ３건 · 2026.10.24", "[알림톡][실패] 합성 5건 · 2026/10/25"],
    ["[알림톡][실패] 합성 2026-10-24T09:30:00+09:00", "[알림톡][실패] 합성 2026-10-25T10:40:00Z"],
  ]) assert.equal(key(a), key(b));
  assert.notEqual(key("[알림톡][실패] SYNTHETIC_A 오류"), key("[알림톡][실패] SYNTHETIC_B 오류"));
  assert.notEqual(key("[알림톡][실패] 조회 오류"), key("[알림톡][실패] 저장 오류"));
  assert.notEqual(key("[알림톡][실패] 합성"), key("[알림톡][성공] 합성"));
});

test("only exact connection-test marker sets isTest, never suppressing actionable classification", () => {
  const result = classify(message("[알림톡][실패] [연결테스트] 합성"))!;
  assert.equal(result.isTest, true);
  assert.equal(result.actionable, true);
  assert.equal(classify(message("[알림톡][실패] 연결테스트 합성"))!.isTest, false);
  assert.equal(classify(message("[알림톡][실패] [연결테스트 완료] 합성"))!.isTest, false);
  assert.notEqual(result.incidentKey, classify(message("[알림톡][실패] 합성"))!.incidentKey);
  assert.equal(result.incidentKey, createHash("sha256")
    .update(JSON.stringify([OPS_MAIL.source, true, "[알림톡][실패] [연결테스트] 합성"])).digest("hex"));
  assert.equal(classify(message("[알림톡][실패] 합성"))!.incidentKey, createHash("sha256")
    .update(JSON.stringify([OPS_MAIL.source, false, "[알림톡][실패] 합성"])).digest("hex"));
});

test("received internalDate, not sender Date, enforces inclusive activation cutoff", () => {
  const input = message();
  input.internalDate = String(Date.parse(ACTIVATED));
  input.payload!.headers!.push({ name: "Date", value: "synthetic-untrusted-date" });
  assert.ok(classify(input));
  assert.ok(classify(input, "2026-10-24T09:00:00+09:00"));
  input.internalDate = String(Date.parse(ACTIVATED) - 1);
  assert.equal(classify(input), null);
});

test("invalid, ambiguous, rollover and unsafe dates fail closed", () => {
  for (const internalDate of [undefined, "", "bad", "0", "-1", "1.5", "1e12", " 1792800000000", "01792800000000",
    "NaN", "9007199254740992", "253402300800000", "1792800000000\n"]) {
    assert.equal(classify({ ...message(), internalDate }), null);
  }
  for (const activatedAt of ["", "bad", "2026-10-24", "2026-10-24T00:00:00", "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z", "2026-10-24T24:00:00Z", "2026-10-24T00:00:00+24:00", "2026-10-24T00:00:00+09:99"]) {
    assert.equal(classify(message(), activatedAt), null, activatedAt);
  }
});

test("message and optional thread IDs must be exact bounded hex; absent thread uses message ID", () => {
  for (const field of ["id", "threadId"] as const) {
    for (const value of ["", "a", "a".repeat(7), "not-hex", "abc/def", "ab\n", "19AB12CD", "a".repeat(65)]) {
      assert.equal(classify({ ...message(), [field]: value }), null);
    }
    for (const value of ["a".repeat(8), "a".repeat(64)]) {
      assert.ok(classify({ ...message(), [field]: value }));
    }
  }
  const input = message();
  delete input.threadId;
  assert.equal(classify(input)?.threadId, input.id.toLowerCase());
});

test("required headers cannot be missing, duplicated or case-variant duplicated, even with equal values", () => {
  for (const name of ["From", "To", "Subject"]) {
    const input = message();
    const header = input.payload!.headers!.find(h => h.name === name)!;
    input.payload!.headers!.push({ ...header, name: name.toLowerCase() });
    assert.equal(classify(input), null);
    input.payload!.headers = input.payload!.headers!.filter(h => h.name.toLowerCase() !== name.toLowerCase());
    assert.equal(classify(input), null);
  }
});

test("header names are exact tokens and control characters are rejected", () => {
  for (const name of [" From", "From ", "Subject:", "X-Test\r\nFrom"]) {
    const input = message();
    input.payload!.headers!.push({ name, value: "synthetic" });
    assert.equal(classify(input), null);
  }
});

test("malformed runtime metadata is rejected rather than thrown or coerced", () => {
  for (const input of [null, {}, { ...message(), payload: null }, { ...message(), labelIds: "SENT" },
    { ...message(), labelIds: ["SENT", 1] }, { ...message(), internalDate: Date.parse(ACTIVATED) },
    { ...message(), payload: { headers: [null] } }, { ...message(), payload: { headers: [{ name: "From", value: 1 }] } }]) {
    assert.equal(classify(input as unknown as GmailMetadata), null);
  }
});
