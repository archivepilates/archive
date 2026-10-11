import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { renderOperationsEmail } from "../lib/operations-email-format.mjs";

const require = createRequire(import.meta.url);
const ts = require("../../firebase/kangsain-functions/functions/node_modules/typescript");
const sourceRoot = new URL("../../firebase/kangsain-functions/functions/src/", import.meta.url);

function compile(relativePath) {
  return ts.transpileModule(readFileSync(new URL(relativePath, sourceRoot), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const formatExports = {};
vm.runInNewContext(compile("google/operationsEmailFormat.ts"), { exports: formatExports });
const { formatOperationsEmail } = formatExports;
const mailerCode = compile("google/driveDocsMailer.ts");
const gmailRoot = "https://gmail.googleapis.com/gmail/v1/users/me";
const statusLabels = ["자동화 성공", "자동화 실패", "자동화 긴급", "자동화 확인필요"];

// Compile real modules, but supply only in-memory clients. No credentials or network are loaded.
function fixture(options = {}) {
  const state = { requests: [], sends: 0, warnings: [], scopes: [] };
  const existingLabels = options.existingLabels ?? ["알림톡 보고", "주차등록 보고", ...statusLabels];
  const context = {
    exports: {}, Buffer, Date, encodeURIComponent,
    require(name) {
      if (name === "./operationsEmailFormat") return formatExports;
      if (name === "firebase-functions") return {
        logger: { warn: (...args) => state.warnings.push(args) },
      };
      assert.equal(name, "./delegatedGoogleClient");
      return { DelegatedGoogleClient: class {
        constructor(scopes) { state.scopes.push(...scopes); }
        async request(url, init = {}) {
          state.requests.push({ url, ...init });
          if (url === `${gmailRoot}/messages/send`) {
            state.sends++;
            if (options.sendFailure) throw new Error("fixture send failed");
            return "sendResponse" in options ? options.sendResponse : { id: "fixture-message" };
          }
          if (url === `${gmailRoot}/labels` && !init.method) {
            if (options.labelFailure === "list") throw new Error("private token and recipient fixture");
            return { labels: existingLabels.map((name) => ({ id: `label:${name}`, name })) };
          }
          if (url === `${gmailRoot}/labels` && init.method === "POST") {
            if (options.labelFailure === "create") throw new Error("private token and recipient fixture");
            const { name } = JSON.parse(init.body);
            return { id: `label:${name}`, name };
          }
          assert.equal(url, `${gmailRoot}/messages/fixture-message/modify`);
          if (options.labelFailure === "modify") throw new Error("private token and recipient fixture");
          return { id: "fixture-message" };
        }
      } };
    },
  };
  vm.runInNewContext(mailerCode, context);
  return { state, ...context.exports };
}

const input = {
  subject: "[알림톡][성공] 발송 로그 · 10/11",
  body: "주체: ARCHIVE IN / 자동화\n결론: 완료",
  domainLabel: "알림톡 보고",
  status: "success",
};

function sentMime(state) {
  const request = state.requests.find(({ url }) => url === `${gmailRoot}/messages/send`);
  return Buffer.from(JSON.parse(request.body).raw, "base64url").toString("utf8");
}

function decodedMimeParts(mime) {
  const boundary = mime.match(/boundary="([^"]+)"/)[1];
  return mime.split(`--${boundary}`).slice(1, -1).map((part) => {
    const [headers, encoded] = part.replace(/^\r\n/, "").split("\r\n\r\n");
    assert.match(headers, /Content-Transfer-Encoding: base64/);
    const lines = encoded.trim().split("\r\n");
    for (const line of lines) assert.ok(line.length <= 76);
    return {
      type: headers.match(/Content-Type: ([^;]+)/)[1],
      body: Buffer.from(encoded, "base64").toString("utf8"),
    };
  });
}

test("default formatter produces quiet self-contained single-column HTML and plain text", () => {
  const formatted = formatOperationsEmail(input);
  assert.equal(formatted.body, "주체: ARCHIVE CORE / 자동화\n결론: 완료");
  assert.match(formatted.htmlBody, /^<!doctype html>/);
  assert.match(formatted.htmlBody, /name="viewport"/);
  assert.match(formatted.htmlBody, /max-width:640px/);
  assert.match(formatted.htmlBody, /font:16px\/1\.65/);
  assert.match(formatted.htmlBody, /<main style="max-width:640px;margin:auto;padding:24px;background:white"/);
  assert.match(formatted.htmlBody, /ARCHIVE PILATES · 운영 알림/);
  assert.match(formatted.htmlBody, /<h1 style="font-size:20px;line-height:1\.5;margin:0 0 20px/);
  assert.match(formatted.htmlBody, /word-break:keep-all;overflow-wrap:anywhere/);
  assert.equal((formatted.htmlBody.match(/<main\b/g) || []).length, 1);
  assert.doesNotMatch(formatted.htmlBody, /pre-wrap|<table|<div/);
  assert.doesNotMatch(formatted.htmlBody, /<script|<link|<img|gradient|@import|<style[^>]+src=/i);
});

test("cloud layout matches the actual Mac mini renderer with keep-all wrapping", () => {
  const body = "주체: ARCHIVE IN / 자동화\n결론: 확인 필요\n\n핵심:\n- 항목\n검증\nhttps://core.archivepilates.com/automation/\n주의:\n없음\n다음:\n상세:";
  const html = formatOperationsEmail({ subject: input.subject, body }).htmlBody;
  const layout = (value) => value
    .replace(/;word-break:keep-all(?=")/g, "")
    .replace(/word-break:keep-all;overflow-wrap:anywhere(?=">https?:)/g, "word-break:break-all")
    .replace(/word-break:keep-all;/g, "");
  assert.equal(layout(html), layout(renderOperationsEmail(input.subject, body)));
  assert.match(html, /margin:20px 0 6px;font-weight:700;/);
  assert.match(html, /margin:6px 0;word-break:keep-all;/);
});

test("HTTP links are escaped safely and member links retain their exact destination", () => {
  const body = 'https://in.archivepilates.com/private-chart/?id=a&mode=detail\nhttp://example.invalid/report?q=%22#detail\nhttps://example.invalid/?x=1" onclick="bad\n<script>bad</script>\njavascript:bad data:bad file:///private';
  const html = formatOperationsEmail({ subject: "links", body }).htmlBody;
  assert.match(html, /href="https:\/\/in\.archivepilates\.com\/private-chart\/\?id=a&amp;mode=detail"/);
  assert.match(html, /href="http:\/\/example\.invalid\/report\?q=%22#detail"/);
  assert.match(html, /href="https:\/\/example\.invalid\/\?x=1" style=/);
  assert.match(html, /&quot; onclick=&quot;bad/);
  assert.doesNotMatch(html, /<script|onclick="|href="(?:javascript|data|file):/);
  assert.equal((html.match(/<a /g) || []).length, 3);
  assert.equal(formatOperationsEmail({ subject: "links", body }).body, body);
});

test("only the human sender line changes; paths, endpoints, IDs and other text survive", () => {
  const untouched = [
    "/archivein/ARCHIVE IN/report", "https://example.invalid/archivein/?id=ARCHIVE%20IN",
    "ID: ARCHIVE IN_123", "ARCHIVE IN details", "주체: ARCHIVE INNER / keep",
    "본문 주체: ARCHIVE IN / quoted", "주체: ARCHIVE IN/path-id",
  ];
  const body = `주체: ARCHIVE IN / worker\r\n${untouched.join("\r\n")}\r\n\t주체: ARCHIVE IN\r\n`;
  const formatted = formatOperationsEmail({ subject: "unchanged", body });
  assert.ok(formatted.body.startsWith("주체: ARCHIVE CORE / worker\r\n"));
  assert.ok(formatted.body.endsWith("\t주체: ARCHIVE CORE\r\n"));
  for (const line of untouched) assert.ok(formatted.body.includes(line), line);
});

test("subject and plain text are escaped instead of interpreted as markup", () => {
  const formatted = formatOperationsEmail({
    subject: '<script>alert("subject")</script>',
    body: '<button onclick="send()">approve & \'detail\'</button>',
  });
  assert.doesNotMatch(formatted.htmlBody, /<script|<button|onclick="/);
  assert.match(formatted.htmlBody, /&lt;script&gt;alert\(&quot;subject&quot;\)/);
  assert.match(formatted.htmlBody, /approve &amp; &#39;detail&#39;/);
});

test("supplied HTML including approval buttons and detail links is preserved byte-for-byte", () => {
  const htmlBody = '<html><a id="approve" href="https://example.invalid/approve?id=archivein_1">승인</a>\n<button>상세</button></html>';
  const formatted = formatOperationsEmail({ ...input, htmlBody });
  assert.equal(formatted.htmlBody, htmlBody);
  assert.equal(formatted.body, "주체: ARCHIVE CORE / 자동화\n결론: 완료");
  assert.equal(formatOperationsEmail({ ...input, htmlBody: "" }).htmlBody, "");
});

test("sender is ARCHIVE CORE and every status keeps both domain and status Gmail labels", async () => {
  for (const [status, statusLabel] of [
    ["success", "자동화 성공"], ["failure", "자동화 실패"],
    ["urgent", "자동화 긴급"], ["attention", "자동화 확인필요"],
  ]) {
    const { state, sendOperationsEmail } = fixture();
    await sendOperationsEmail({ ...input, status });
    const mime = sentMime(state);
    assert.match(mime, /^From: ARCHIVE CORE <home@archivepilates.com>\r\n/);
    assert.match(mime, /Content-Type: multipart\/alternative/);
    assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
    assert.match(mime, /Content-Type: text\/html; charset=UTF-8/);
    assert.deepEqual(decodedMimeParts(mime), [
      { type: "text/plain", body: formatOperationsEmail(input).body },
      { type: "text/html", body: formatOperationsEmail(input).htmlBody },
    ]);
    const encodedSubject = mime.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1];
    assert.equal(Buffer.from(encodedSubject, "base64").toString("utf8"), input.subject);
    const boundary = mime.match(/boundary="([^"]+)"/)[1];
    assert.equal(mime.split(`--${boundary}`).length - 1, 3);
    const modify = state.requests.find(({ url }) => url.endsWith("/modify"));
    assert.deepEqual(JSON.parse(modify.body).addLabelIds, ["label:알림톡 보고", `label:${statusLabel}`]);
    assert.equal(state.sends, 1);
    assert.equal(state.warnings.length, 0);
  }
});

test("supplied approval HTML also survives MIME assembly and explicit recipients", async () => {
  const { state, sendOperationsEmail } = fixture();
  const htmlBody = '<a href="https://example.invalid/approve?approvalId=archivein_1">승인</a><button>상세</button>';
  await sendOperationsEmail({ ...input, to: "fixture@example.invalid", htmlBody });
  const mime = sentMime(state);
  assert.equal(decodedMimeParts(mime)[1].body, htmlBody);
  assert.match(mime, /To: fixture@example.invalid\r\n/);
});

test("both Unicode MIME bodies wrap at 76 columns and decode without changing content", async () => {
  const { state, sendOperationsEmail } = fixture();
  const body = "주체: ARCHIVE IN / 자동화\r\n" + "긴 내용 & 상세 경로 /archivein/ ".repeat(1000);
  const htmlBody = '<button data-id="archivein_1">승인</button><p>' + "상세 &amp; 내용".repeat(1000) + "</p>";
  await sendOperationsEmail({ ...input, body, htmlBody });
  const mime = sentMime(state);
  assert.deepEqual(decodedMimeParts(mime), [
    { type: "text/plain", body: formatOperationsEmail({ ...input, body }).body },
    { type: "text/html", body: htmlBody },
  ]);
  for (const line of mime.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") < 998);
});

test("CR or LF in a header rejects before constructing a Google client or making requests", async () => {
  for (const field of ["subject", "to"]) {
    for (const separator of ["\r", "\n", "\r\n"]) {
      const { state, sendOperationsEmail } = fixture();
      await assert.rejects(sendOperationsEmail({ ...input, [field]: `fixture${separator}Bcc: other@example.invalid` }), /Invalid operations email header/);
      assert.equal(state.requests.length, 0);
      assert.equal(state.scopes.length, 0);
      assert.equal(state.sends, 0);
    }
  }
});

test("extra labels are trimmed, deduplicated and created without dropping domain or status", async () => {
  const { state, sendOperationsEmail } = fixture({ existingLabels: [] });
  await sendOperationsEmail({ ...input, labelNames: [" 알림톡 보고 ", "자동화 성공", "추가", "추가", " "] });
  const created = state.requests.filter(({ url, method }) => url === `${gmailRoot}/labels` && method === "POST");
  assert.deepEqual(created.map(({ body }) => JSON.parse(body).name).sort(), ["알림톡 보고", "자동화 성공", "추가"].sort());
  const modify = state.requests.find(({ url }) => url.endsWith("/modify"));
  assert.equal(JSON.parse(modify.body).addLabelIds.length, 3);
});

test("label list/create/modify failures after confirmed send warn safely and cannot trigger retry", async () => {
  for (const labelFailure of ["list", "create", "modify"]) {
    const { state, sendOperationsEmail } = fixture({ labelFailure, existingLabels: labelFailure === "create" ? [] : undefined });
    await sendOperationsEmail(input).catch(() => sendOperationsEmail(input));
    assert.equal(state.sends, 1, labelFailure);
    assert.equal(state.warnings.length, 1);
    const warning = JSON.stringify(state.warnings[0]);
    assert.match(warning, /Do not resend/);
    assert.match(warning, /"sendConfirmed":true/);
    assert.doesNotMatch(warning, /private token|recipient fixture|home@|결론|fixture-message/);
  }
});

test("missing or invalid send ID rejects before labeling instead of claiming success", async () => {
  for (const sendResponse of [{}, { id: "" }, { id: " " }, { id: 123 }, null, undefined]) {
    const { state, sendOperationsEmail } = fixture({ sendResponse });
    await assert.rejects(sendOperationsEmail(input), /missing a message id/);
    assert.equal(state.sends, 1);
    assert.equal(state.requests.length, 1);
    assert.equal(state.warnings.length, 0);
  }
});

test("send failures still reject and never attempt Gmail labels", async () => {
  const { state, sendOperationsEmail } = fixture({ sendFailure: true });
  await assert.rejects(sendOperationsEmail(input), /fixture send failed/);
  assert.equal(state.requests.length, 1);
  assert.equal(state.warnings.length, 0);
});

test("Alimtalk wrapper retains its domain label and default formatting", async () => {
  const { state, sendAlimtalkLogEmail } = fixture();
  await sendAlimtalkLogEmail({ subject: input.subject, body: input.body, status: "attention" });
  const modify = state.requests.find(({ url }) => url.endsWith("/modify"));
  assert.deepEqual(JSON.parse(modify.body).addLabelIds, ["label:알림톡 보고", "label:자동화 확인필요"]);
  assert.match(sentMime(state), /ARCHIVE CORE/);
});

test("daily log titles and operator sender copy use ARCHIVE CORE", () => {
  const daily = readFileSync(new URL("alimtalk/sendDailyAlimtalkReport.ts", sourceRoot), "utf8");
  assert.match(daily, /const title = `ARCHIVE CORE 알림톡 발송 로그 \$\{date\}`/);
  assert.match(daily, /"ARCHIVE CORE 알림톡 발송 로그"/);
  for (const relativePath of ["alimtalk/providerLedgerAudit.ts", "parking/parkingOperatorAlerts.ts"]) {
    const source = readFileSync(new URL(relativePath, sourceRoot), "utf8");
    assert.match(source, /주체: ARCHIVE CORE \//);
    assert.doesNotMatch(source, /주체: ARCHIVE IN \//);
  }
});

test("parking sender copy changes without altering the threshold, masking, IDs or detail URL", () => {
  const context = {
    exports: {},
    require(name) {
      assert.equal(name, "../google/driveDocsMailer");
      return { sendOperationsEmail() { throw new Error("pure builder must not send"); } };
    },
  };
  vm.runInNewContext(compile("parking/parkingOperatorAlerts.ts"), context);
  const email = context.exports.buildParkingNoEntryAlertEmail({
    jobId: "parking_job_1", lessonDate: "2026-10-11",
    lectureStartAt: "2026-10-11T04:00:00.000Z", memberName: "fixture",
    carNumberLast4: "1234", requestedDiscountHours: 4,
  });
  assert.equal(email.subject, "[주차등록][확인필요] 입차기록 없음 · 2026-10-11");
  for (const text of [
    "주체: ARCHIVE CORE / 주차등록 자동화", "수업 시작 30분 후", "2026-10-11 13:00",
    "****1234", "4시간", "iParking 입차 조회: 1회", "manual_review / no_entry",
    "작업 ID: parking_job_1", "자동 재조회는 실행하지 않습니다",
    "https://core.archivepilates.com/#parkingTools",
  ]) assert.ok(email.body.includes(text), text);
  assert.doesNotMatch(email.body, /https:\/\/in\.archivepilates\.com\/core/);
});

test("daily report leads with counts and dated subject without changing report data or status policy", async () => {
  for (const failed of [0, 1]) {
    const documents = [], emails = [];
    const query = { where() { return this; }, limit() { return this; }, async get() { return { docs: [] }; } };
    const context = {
      exports: {},
      require(name) {
        if (name === "firebase-functions") return { logger: { info() {} } };
        if (name === "../config/firebase") return { db: { collection: () => query } };
        if (name === "../firestore/refs") return { refs: {
          alimtalkCandidates: () => query, privateSurveyResponses: () => query, alimtalkSends: () => query,
        } };
        if (name === "../utils/date") return { todayKst: () => "2026-10-11" };
        assert.equal(name, "../google/driveDocsMailer");
        return {
          async createAlimtalkLogDocument(input) { documents.push(input); return { url: "https://example.invalid/document" }; },
          async sendAlimtalkLogEmail(input) { emails.push(input); },
        };
      },
    };
    vm.runInNewContext(compile("alimtalk/sendDailyAlimtalkReport.ts"), context);
    await context.exports.sendDailyAlimtalkReport({
      date: "2026-10-11", queueSummary: { rebuilt: 8, queued: 7, blocked: 1 },
      processSummary: { processed: 7, sent: 6, failed, deferred: 1 },
    });
    assert.equal(emails[0].subject, `[알림톡][${failed ? "실패" : "성공"}] 발송 로그 · 2026-10-11`);
    assert.equal(emails[0].status, failed ? "failure" : "success");
    assert.ok(emails[0].body.startsWith(`주체: ARCHIVE CORE / 알림톡 발송 기록\n결론: 발송 성공 6건, 실패 ${failed}건, 처리 7건입니다.\n\n`));
    assert.equal(documents[0].title, "ARCHIVE CORE 알림톡 발송 로그 2026-10-11");
    assert.ok(emails[0].body.startsWith(documents[0].body));
    for (const text of ["후보 재계산: 8건", "자동 큐 전환: 7건", "자동 큐 제외/보류: 1건", "큐 처리: 7건", "발송 성공: 6건", `발송 실패: ${failed}건`, "템플릿 상태 재시도 대기: 1건"]) {
      assert.ok(documents[0].body.includes(text), text);
    }
  }
});
