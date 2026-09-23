import assert from "node:assert/strict";
import test from "node:test";
import {
  instructorObservationCanonicalKey,
  parseInstructorObservationPayload,
} from "../../firebase/kangsain-functions/functions/src/onboarding/instructorObservationSurvey";

function validPayload(): Record<string, unknown> {
  return {
    submissionId: "9d2e4f80-6b38-49ea-b7c6-f56860e3fa65",
    instructorName: "정유리",
    attendedOn: "2026-09-23",
    observedInstructor: "정은영",
    classNameEquipment: "흉추 가동성 / 체어",
    classType: "그룹",
    expectedLevel: "초중급",
    classGoal: "흉추 움직임을 확보한다.",
    classFlow: "워밍업에서 메인 동작으로 연결했다.",
    memorableCueing: "호흡을 먼저 확인한 큐잉이 효과적이었다.",
    understandingMethods: ["시범", "언어 큐잉", "시범"],
    understandingOther: "",
    levelAdjustment: "가동 범위로 쉬운 옵션과 도전 옵션을 나눴다.",
    memberResponseCheck: "호흡과 표정을 확인했다.",
    flowTimeScore: 4,
    transitionNote: "기구 전환이 매끄러웠다.",
    archiveStyle: "설명이 차분하고 회원별 수정이 구체적이었다.",
    keepChangeReason: "호흡 확인은 유지하고 전환 설명은 더 짧게 한다.",
    immediateApplication: "다음 수업에서 시범을 먼저 보여준다.",
    oneSentence: "회원이 움직임을 이해할 시간을 주는 수업",
  };
}

test("normalizes a complete observation payload", () => {
  const parsed = parseInstructorObservationPayload(validPayload());
  assert.equal(parsed.flowTimeScore, 4);
  assert.deepEqual(parsed.understandingMethods, ["시범", "언어 큐잉"]);
  assert.equal(parsed.classType, "그룹");
});

test("rejects missing priority answers", () => {
  const input = validPayload();
  input.immediateApplication = "";
  assert.throws(() => parseInstructorObservationPayload(input), /바로 적용할 한 가지/);
});

test("rejects scores outside the 1 to 5 range", () => {
  const input = validPayload();
  input.flowTimeScore = 6;
  assert.throws(() => parseInstructorObservationPayload(input), /점수를 선택/);
});

test("requires at least one understanding method", () => {
  const input = validPayload();
  input.understandingMethods = [];
  assert.throws(() => parseInstructorObservationPayload(input), /하나 이상 선택/);
});

test("requires details when the other understanding method is selected", () => {
  const input = validPayload();
  input.understandingMethods = ["기타"];
  input.understandingOther = "";
  assert.throws(() => parseInstructorObservationPayload(input), /기타 방법/);
});

test("canonical key stays stable for the same class observation", () => {
  const first = parseInstructorObservationPayload(validPayload());
  const second = parseInstructorObservationPayload({ ...validPayload(), submissionId: "b18e385c-e346-48fb-bcbf-dc7084da065d" });
  assert.equal(instructorObservationCanonicalKey(first), instructorObservationCanonicalKey(second));
});
