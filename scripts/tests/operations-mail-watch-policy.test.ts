import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyOperationsMail, OPS_MAIL, OPS_MAIL_LABEL_NAMES, OPS_MAIL_WATCH_LABEL_NAMES,
  OPS_MAIL_WATCH_POLICY } from "../../firebase/kangsain-functions/functions/src/sync/operationsMailPolicy";

const ACTIVATED = "2026-10-24T00:00:00.000Z";

test("watch policy is exactly the four existing automation statuses, separate from domain classification", () => {
  assert.equal(OPS_MAIL_WATCH_POLICY, "automation_status_labels_v1");
  assert.deepEqual(OPS_MAIL_WATCH_LABEL_NAMES, ["자동화 성공", "자동화 실패", "자동화 긴급", "자동화 확인필요"]);
  assert.equal(Object.isFrozen(OPS_MAIL_WATCH_LABEL_NAMES), true);
  assert.equal(new Set(OPS_MAIL_WATCH_LABEL_NAMES).size, 4);
  assert.deepEqual(OPS_MAIL_LABEL_NAMES, [
    "알림톡 보고", "홀딩 안내 보고", "전자계약 보고", "시스템점검 보고", "동기화 보고", "배포 보고", "사이트 보고",
    "강사레슨 보고", "자동화 보고", "알림감지 보고", "주차등록 보고", "릴스 보고", "월말정산 보고", "인바디 API 보고",
    "유튜브 영상리스트 보고", "인바디 보고", "시스템검증 보고", "데이터정합성 보고", "로그인 보고", "친구초대 보고",
    "스텝 혜택 보고", "강사레슨영상 보고", "스텝 영상권한 보고",
  ]);
  assert.ok(OPS_MAIL_WATCH_LABEL_NAMES.every(name => !OPS_MAIL_LABEL_NAMES.includes(name)));
  assert.ok(!OPS_MAIL_WATCH_LABEL_NAMES.includes("SENT"));
});

for (const label of OPS_MAIL_LABEL_NAMES) {
  test(`${label} remains classifiable without any common status label; maintenance/history cover it`, () => {
    const area = label.slice(0, -3);
    const message = { id: "19ab000000000001", internalDate: String(Date.parse(ACTIVATED) + 1),
      labelIds: ["SENT", "Label_10"], payload: { headers: [
        { name: "From", value: OPS_MAIL.mailbox }, { name: "To", value: OPS_MAIL.mailbox },
        { name: "Subject", value: `[${area}][실패] SYNTHETIC_DOMAIN_REPORT` },
      ] } };
    const before = structuredClone(message);
    assert.equal(classifyOperationsMail(message, { Label_10: label }, ACTIVATED)?.areaLabel, area);
    assert.equal(classifyOperationsMail({ ...message, labelIds: ["SENT", "Label_20"] },
      { Label_10: label, Label_20: "자동화 실패" }, ACTIVATED), null);
    assert.deepEqual(message, before);
  });
}
