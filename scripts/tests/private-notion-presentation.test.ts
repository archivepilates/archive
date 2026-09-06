import assert from "node:assert/strict";
import test from "node:test";
import {
  compactPrivateNotionBlocks,
  type PrivateNotionPresentationInput,
} from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonNotionPresentation";

type Block = ReturnType<typeof compactPrivateNotionBlocks>[number];
type Body = {
  rich_text?: { type: string; text: { content: string } }[];
  caption?: { type: string; text: { content: string } }[];
  children?: Block[];
  color?: string;
  icon?: unknown;
  url?: string;
};

function input(overrides: Partial<PrivateNotionPresentationInput> = {}): PrivateNotionPresentationInput {
  return {
    memberName: "테스트 회원",
    sessionNumber: 7,
    lessonTime: "2026-09-06 14:00",
    staffName: "테스트 강사",
    stage: "수업 기록대기",
    intake: {},
    focusAreas: [],
    changes: [],
    nextDirection: "",
    cautions: [],
    homework: "",
    mediaCount: 0,
    reportUrl: "",
    ...overrides,
  };
}

function body(block: Block): Body {
  return block[String(block.type)] as Body;
}

function text(block: Block): string {
  return (body(block).rich_text || body(block).caption || []).map((part) => part.text.content).join("");
}

function allBlocks(blocks: Block[]): Block[] {
  return blocks.flatMap((block) => [block, ...allBlocks(body(block).children || [])]);
}

function allText(blocks: Block[]): string {
  return allBlocks(blocks).map(text).join("\n");
}

function section(blocks: Block[], title: string): string {
  const index = blocks.findIndex((block) => block.type === "heading_3" && text(block) === title);
  if (index < 0) return "";
  const values: string[] = [];
  for (const block of blocks.slice(index + 1)) {
    if (block.type !== "paragraph" && block.type !== "bulleted_list_item") break;
    values.push(text(block));
  }
  return values.join("");
}

function assertNativeBlocks(blocks: Block[]): void {
  for (const block of allBlocks(blocks)) {
    assert.equal(block.object, "block");
    assert.ok(
      ["callout", "paragraph", "heading_3", "bulleted_list_item", "toggle", "bookmark"].includes(String(block.type)),
    );
    const content = body(block);
    for (const items of [content.rich_text, content.caption]) {
      if (!items) continue;
      assert.ok(items.length > 0 && items.length <= 100);
      for (const item of items) {
        assert.equal(item.type, "text");
        assert.ok(item.text.content.length > 0 && item.text.content.length <= 1900);
        assert.doesNotMatch(item.text.content, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
      }
    }
    if (block.type === "callout") {
      assert.equal(content.icon, undefined);
      assert.ok(["gray_background", "blue_background"].includes(content.color || ""));
    }
    if (block.type === "toggle") assert.ok(content.children!.length > 0 && content.children!.length <= 100);
  }
}

test("blank fields have one empty-record message and no placeholders or repeated title", () => {
  const blocks = compactPrivateNotionBlocks(
    input({
      intake: { goal: " ", focusArea: "-", exerciseLevel: "\n", hasCaution: false },
      focusAreas: ["", " ", "-"],
      changes: ["\n", " - "],
      nextDirection: "\t",
      cautions: ["", "-"],
      homework: "-",
      reportUrl: "\n",
      summaryText: " ",
      nextPlanText: "-",
    }),
  );
  assert.deepEqual(blocks.map(text), [
    "수업 기록대기",
    "수업: 2026-09-06 14:00 / 담당: 테스트 강사",
    "오늘 기록",
    "아직 수업 기록이 없습니다.",
  ]);
  assert.doesNotMatch(
    allText(blocks),
    /테스트 회원|7회차|진행 부위|확인한 변화|다음 방향|홈워크|주의사항|첨부|리포트|제출/,
  );
  assert.equal(blocks.filter((block) => block.type === "toggle" || block.type === "bookmark").length, 0);
  assert.doesNotMatch(allText(blocks), /\p{Extended_Pictographic}/u);
  assertNativeBlocks(blocks);
});

test("today's record includes only supplied nonblank fields", () => {
  const blocks = compactPrivateNotionBlocks(
    input({ focusAreas: ["", "호흡", "골반 안정"], nextDirection: "가동 범위 유지" }),
  );
  assert.deepEqual(blocks.filter((block) => block.type === "bulleted_list_item").map(text), [
    "진행 부위: 호흡, 골반 안정",
    "다음 방향: 가동 범위 유지",
  ]);
  assert.doesNotMatch(allText(blocks), /확인한 변화|아직 수업 기록|수업 요약|다음 수업 계획/);
  assertNativeBlocks(blocks);
});

test("today's record heading appears exactly once even for empty or cancelled fixtures", () => {
  for (const overrides of [{}, { cancelled: true }, { summaryText: "수업 요약 원문" }, { homework: "호흡 연습" }]) {
    const blocks = compactPrivateNotionBlocks(input(overrides));
    assert.equal(blocks.filter((block) => block.type === "heading_3" && text(block) === "오늘 기록").length, 1);
  }
});

test("optional intake, homework, cautions and media appear only within titled toggles", () => {
  const blocks = compactPrivateNotionBlocks(
    input({
      intake: { goal: "일상 움직임 개선", focusArea: "어깨", exerciseLevel: "초급", hasCaution: true },
      homework: "호흡 연습\n무리하지 않기",
      cautions: ["", "통증 시 중단", "-", "가동 범위 확인"],
      mediaCount: 2,
    }),
  );
  const toggles = blocks.filter((block) => block.type === "toggle");
  assert.deepEqual(toggles.map(text), ["회원 사전설문 참고", "홈워크", "주의사항", "수업 자료"]);
  assert.deepEqual(
    toggles.map((block) => (body(block).children || []).map(text)),
    [
      ["목표: 일상 움직임 개선", "신경 부위: 어깨", "운동 수준: 초급", "사전설문 주의 내용 확인 필요"],
      ["호흡 연습\n무리하지 않기"],
      ["통증 시 중단", "가동 범위 확인"],
      ["첨부: 2개"],
    ],
  );
  assert.doesNotMatch(blocks.map(text).join("\n"), /통증 시 중단|일상 움직임 개선|호흡 연습|첨부:|아직 수업 기록/);
  assertNativeBlocks(blocks);
});

test("an isolated optional field opens only its own toggle; intake is not a lesson record", () => {
  const fixtures: [Partial<PrivateNotionPresentationInput>, string][] = [
    [{ intake: { hasCaution: true } }, "회원 사전설문 참고"],
    [{ homework: "호흡 연습" }, "홈워크"],
    [{ cautions: ["주의 내용"] }, "주의사항"],
    [{ mediaCount: 1 }, "수업 자료"],
  ];
  for (const [overrides, title] of fixtures) {
    const blocks = compactPrivateNotionBlocks(input(overrides));
    assert.deepEqual(blocks.filter((block) => block.type === "toggle").map(text), [title]);
    assert.equal(allText(blocks).includes("아직 수업 기록이 없습니다."), title === "회원 사전설문 참고");
  }
  for (const mediaCount of [0, -1, NaN, Infinity, 0.5]) {
    assert.doesNotMatch(allText(compactPrivateNotionBlocks(input({ mediaCount }))), /첨부|수업 자료/);
  }
});

test("submitted legacy record never claims no record or no submission without new keys", () => {
  const blocks = compactPrivateNotionBlocks(input({ submitted: true }));
  assert.equal(text(blocks[0]), "수업 기록 제출완료");
  assert.equal(section(blocks, "오늘 기록"), "수업 기록이 제출되었습니다.");
  assert.doesNotMatch(allText(blocks), /아직 수업 기록|미제출|기록대기|생성완료|생성중/);
  assertNativeBlocks(blocks);
});

test("a bookmark requires an actual report URL and no link is fabricated from identity", () => {
  for (const reportUrl of ["", " ", "-"]) {
    const blocks = compactPrivateNotionBlocks(input({ stage: "리포트 생성완료", submitted: true, reportUrl }));
    assert.equal(text(blocks[0]), "리포트 생성완료");
    assert.equal(
      blocks.some((block) => block.type === "bookmark"),
      false,
    );
    assert.doesNotMatch(JSON.stringify(blocks), /https?:|생성 대기|생성중/);
  }
  const reportUrl = "https://example.com/report?record=fixture&token=test";
  const blocks = compactPrivateNotionBlocks(input({ stage: "리포트 생성중", reportUrl }));
  assert.equal(text(blocks[0]), "리포트 생성완료");
  const bookmarks = blocks.filter((block) => block.type === "bookmark");
  assert.equal(bookmarks.length, 1);
  assert.equal(body(bookmarks[0]).url, reportUrl);
  assert.equal(text(bookmarks[0]), "회원 리포트 보기");
  assert.doesNotMatch(allText(blocks), /생성중|생성 대기|아직 수업 기록|발송완료/);
  assertNativeBlocks(blocks);
});

test("review state takes precedence over cancellation and retains the actual reason", () => {
  const reviewReason = "회차 연결 확인이 필요합니다.\n담당자가 원본을 확인합니다.";
  const blocks = compactPrivateNotionBlocks(input({ cancelled: true, stage: "취소", reviewReason }));
  assert.equal(text(blocks[0]), "확인 필요");
  assert.deepEqual(blocks.filter((block) => block.type === "callout").map(text), ["확인 필요", reviewReason]);
  assert.doesNotMatch(allText(blocks), /취소|cancelled/);
  assert.equal(text(compactPrivateNotionBlocks(input({ cancelled: true }))[0]), "취소");
  assert.equal(text(compactPrivateNotionBlocks(input({ cancelled: true, stage: "needs_review" }))[0]), "확인 필요");
  assertNativeBlocks(blocks);
});

test("generated summary and next plan use actual narrative, not keyword fallbacks", () => {
  const summaryText = "호흡 조절 후 골반의 흔들림이 줄었습니다.\n편안한 범위에서 진행했습니다.";
  const nextPlanText = "안정된 호흡을 유지하며 서서 하는 동작으로 이어갑니다.";
  const blocks = compactPrivateNotionBlocks(
    input({
      stage: "리포트 생성완료",
      submitted: true,
      focusAreas: ["호흡", "골반"],
      changes: ["흔들림 감소"],
      nextDirection: "서서 하는 동작",
      summaryText,
      nextPlanText,
    }),
  );
  assert.equal(section(blocks, "수업 요약"), summaryText);
  assert.equal(section(blocks, "다음 수업 계획"), nextPlanText);
  assert.doesNotMatch(allText(blocks), /생성 대기|아직 수업 기록/);
  assertNativeBlocks(blocks);

  const duplicates = compactPrivateNotionBlocks(
    input({
      focusAreas: ["호흡", "골반"],
      summaryText: "호흡, 골반",
      nextDirection: "안정성 유지",
      nextPlanText: "안정성 유지",
    }),
  );
  assert.equal(
    duplicates.some((block) => ["수업 요약", "다음 수업 계획"].includes(text(block))),
    false,
  );
  const narrativeOnly = compactPrivateNotionBlocks(input({ summaryText, nextPlanText }));
  assert.equal(section(narrativeOnly, "수업 요약"), summaryText);
  assert.doesNotMatch(allText(narrativeOnly), /아직 수업 기록/);
});

test("long Korean text and newlines survive chunking in every text-bearing input", () => {
  const long = "  첫 줄\n\n" + "호흡과 움직임의 변화를 기록합니다.".repeat(360) + "\r\n마지막 줄  ";
  const blocks = compactPrivateNotionBlocks(
    input({
      lessonTime: `시간 ${long}`,
      staffName: `강사 ${long}`,
      stage: `상태 ${long}`,
      intake: { goal: `목표 ${long}`, focusArea: `부위 ${long}`, exerciseLevel: `수준 ${long}` },
      focusAreas: [`진행 ${long}`],
      changes: [`변화 ${long}`],
      nextDirection: `방향 ${long}`,
      homework: `과제 ${long}`,
      cautions: [`주의 ${long}`],
      summaryText: `요약 ${long}`,
      nextPlanText: `계획 ${long}`,
    }),
  );
  const rendered = allText(blocks);
  for (const prefix of [
    "시간",
    "강사",
    "상태",
    "목표",
    "부위",
    "수준",
    "진행",
    "변화",
    "방향",
    "과제",
    "주의",
    "요약",
    "계획",
  ]) {
    assert.ok(rendered.includes(`${prefix} ${long}`), `${prefix} preserved verbatim`);
  }
  assert.equal(section(blocks, "수업 요약"), `요약 ${long}`);
  assert.equal(section(blocks, "다음 수업 계획"), `계획 ${long}`);
  const review = compactPrivateNotionBlocks(input({ reviewReason: long }));
  assert.equal(text(review.filter((block) => block.type === "callout")[1]), long);
  assertNativeBlocks(blocks);
  assertNativeBlocks(review);
});

test("chunk boundaries preserve supplementary characters and handle more than 100 rich-text parts", () => {
  const summaryText = "가".repeat(1899) + "\u{20000}" + "\n" + "나".repeat(1900 * 101) + "끝";
  const blocks = compactPrivateNotionBlocks(input({ summaryText }));
  assert.equal(section(blocks, "수업 요약"), summaryText);
  assertNativeBlocks(blocks);
  const cautions = Array.from({ length: 101 }, (_, index) => `확인 항목 ${index + 1}`);
  const toggles = compactPrivateNotionBlocks(input({ cautions })).filter((block) => block.type === "toggle");
  assert.deepEqual(
    toggles.flatMap((block) => (body(block).children || []).map(text)),
    cautions,
  );
  assertNativeBlocks(toggles);
});

test("native workflow labels and absent metadata do not invent lesson or staff values", () => {
  for (const [stage, expected] of [
    ["recording", "수업 기록대기"],
    ["report_review", "리포트 확인"],
    ["delivered", "리포트 발송완료"],
  ]) {
    const blocks = compactPrivateNotionBlocks(
      input({ stage, lessonTime: " ", staffName: "-", submitted: stage !== "recording" }),
    );
    assert.equal(text(blocks[0]), expected);
    assert.doesNotMatch(allText(blocks), /수업:|담당:|미정/);
  }
});

test("rendering is deterministic and leaves input and caller-owned arrays unchanged", () => {
  const value = input({
    focusAreas: ["호흡", ""],
    changes: ["안정"],
    cautions: ["주의"],
    intake: { goal: "일상 움직임" },
  });
  const original = structuredClone(value);
  Object.freeze(value.focusAreas);
  Object.freeze(value.changes);
  Object.freeze(value.cautions);
  Object.freeze(value.intake);
  Object.freeze(value);
  assert.deepEqual(compactPrivateNotionBlocks(value), compactPrivateNotionBlocks(value));
  assert.deepEqual(value, original);
});
