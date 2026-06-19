import type { CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { getActiveStaffs, getStaffById } from "../firestore/staffRepository";
import type { StaffDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { AppError } from "../utils/errors";
import { stableHash } from "../utils/hash";
import { assertOwnStaff, isManagerRole } from "../security/authGuards";

type QuizQuestionType = "single_choice" | "fill_blank" | "short_text";

interface QuizOption {
  optionId: string;
  label: string;
}

interface QuizQuestion {
  questionId: string;
  type: QuizQuestionType;
  title: string;
  description?: string;
  area: "principles" | "movement_analysis" | "anatomy" | "cueing" | "operations";
  options?: QuizOption[];
  correctOptionId?: string;
  acceptedAnswers?: string[];
  points?: number;
  required: boolean;
}

function choiceQuestion(
  questionId: string,
  area: QuizQuestion["area"],
  title: string,
  labels: string[],
  correctOptionId: string,
): QuizQuestion {
  return {
    questionId,
    type: "single_choice",
    area,
    title,
    options: labels.map((label, index) => ({
      optionId: String.fromCharCode(97 + index),
      label,
    })),
    correctOptionId,
    points: 4,
    required: true,
  };
}

const QUIZ = {
  quizId: "archive-instructor-evaluation-v1",
  version: "2026-06-19",
  title: "ARCHIVE 강사평가 퀴즈 A",
  description: "기존 Google Form 공개 문항을 Firebase 기반으로 옮긴 강사 평가 퀴즈입니다.",
  passScore: 80,
  questions: [
    choiceQuestion("q01_control", "principles", "Q1. 필라테스 원리 중 ‘Control’과 가장 직접적으로 연결되는 개념은?", [
      "A. 반복 횟수 증가",
      "B. 신경근 협응",
      "C. 최대 근력 발휘",
      "D. 심박수 상승",
    ], "b"),
    choiceQuestion("q02_flow", "principles", "Q2. ‘Flow’ 원리를 잘못 적용한 사례는?", [
      "A. 동작 간 자연스러운 연결",
      "B. 호흡과 움직임의 일치",
      "C. 속도를 유지하기 위해 정렬이 무너짐",
      "D. 리듬감 있는 수행",
    ], "c"),
    choiceQuestion("q03_precision", "principles", "Q3. Precision이 부족할 때 나타나는 가장 흔한 패턴은?", [
      "A. 움직임 지연",
      "B. 보상 움직임 증가",
      "C. 호흡 억제",
      "D. 근육 이완",
    ], "b"),
    choiceQuestion("q04_centering", "principles", "Q4. Centering이 제대로 이루어지지 않았을 때 가장 먼저 나타나는 것은?", [
      "A. 심박수 증가",
      "B. 사지 주도 움직임 증가",
      "C. 유연성 증가",
      "D. 움직임 속도 감소",
    ], "b"),
    choiceQuestion("q05_breathing", "principles", "Q5. 필라테스 호흡이 코어 안정화에 기여하는 이유로 가장 적절한 것은?", [
      "A. 폐활량 증가",
      "B. 횡격막과 복횡근의 협응",
      "C. 산소 공급 증가",
      "D. 갈비뼈 확장",
    ], "b"),
    choiceQuestion("q06_transversus", "anatomy", "Q6. 복횡근이 제대로 활성화되지 않을 때 나타나는 보상은?", [
      "A. 골반 후방경사 증가",
      "B. 외복사근 과활성",
      "C. 횡격막 이완",
      "D. 둔근 과활성",
    ], "b"),
    choiceQuestion("q07_multifidus", "anatomy", "Q7. Multifidus 약화 시 가장 흔한 문제는?", [
      "A. 고관절 가동성 감소",
      "B. 척추 분절 움직임 저하",
      "C. 어깨 안정성 감소",
      "D. 발 아치 붕괴",
    ], "b"),
    choiceQuestion("q08_serratus", "anatomy", "Q8. 전거근 약화 시 나타나는 패턴은?", [
      "A. scapular retraction 과도",
      "B. winging scapula",
      "C. 견갑 하강",
      "D. 상완 외회전 증가",
    ], "b"),
    choiceQuestion("q09_hamstring_lumbar", "movement_analysis", "Q9. 햄스트링 단축으로 인해 고관절 굴곡이 제한될 때, 이를 보상하기 위해 요추(허리)에서 일어나는 변화로 옳은 것은?", [
      "A. 요추 과신전",
      "B. 요추 굴곡 증가",
      "C. 요추 전만 증가",
      "D. 요추의 측굴",
    ], "b"),
    choiceQuestion("q10_rib_flare", "movement_analysis", "Q10. 호흡 시 rib flare가 나타나는 주요 원인은?", [
      "A. 복압 부족",
      "B. 횡격막 과활성",
      "C. 복횡근 과활성",
      "D. 골반 후방경사",
    ], "a"),
    choiceQuestion("q11_roll_up", "movement_analysis", "Q11. Roll-up에서 가장 흔한 실패 원인은?", [
      "A. 팔 힘 부족",
      "B. 고관절 굴곡 부족",
      "C. 척추 분절 조절 부족",
      "D. 햄스트링 약화",
    ], "c"),
    choiceQuestion("q12_bridge", "movement_analysis", "Q12. Bridge 수행 시 햄스트링이 과도하게 개입되는 이유는?", [
      "A. 둔근 과활성",
      "B. 복부 과활성",
      "C. 둔근 활성 부족",
      "D. 고관절 외회전 부족",
    ], "c"),
    choiceQuestion("q13_hundred", "movement_analysis", "Q13. Hundred에서 목 긴장이 생기는 주요 원인은?", [
      "A. 코어 안정 부족",
      "B. 호흡 과다",
      "C. 팔 속도 부족",
      "D. 다리 위치 낮음",
    ], "a"),
    choiceQuestion("q14_spine_twist", "movement_analysis", "Q14. Spine twist에서 회전이 제한될 때 우선적으로 의심할 것은?", [
      "A. 복부 약화",
      "B. 발 정렬 문제",
      "C. 고관절 제한",
      "D. 흉추 가동성 부족",
    ], "d"),
    choiceQuestion("q15_abdominal_cue", "cueing", "Q15. 회원이 복부를 과도하게 끌어당기는 cue의 문제점은?", [
      "A. 호흡 증가",
      "B. 복압 상승",
      "C. 횡격막 움직임 제한",
      "D. 둔근 활성 증가",
    ], "c"),
    choiceQuestion("q16_posterior_tilt", "cueing", "Q16. 과도한 posterior pelvic tilt를 유도했을 때 발생할 수 있는 문제는?", [
      "A. 요추 굴곡 과도",
      "B. 흉추 과신전",
      "C. 고관절 외회전",
      "D. 견갑 상승",
    ], "a"),
    choiceQuestion("q17_neutral_spine", "cueing", "Q17. 초보 회원에게 neutral spine을 유지시키기 어려운 이유는?", [
      "A. 유연성 부족",
      "B. 코어 인지 부족",
      "C. 근력 부족",
      "D. 심폐 지구력 부족",
    ], "b"),
    choiceQuestion("q18_group_instruction", "operations", "Q18. 그룹레슨에서 가장 이상적인 지도 방식은?", [
      "A. 모든 회원 동일 cue",
      "B. 가장 잘하는 회원 기준",
      "C. 공통 cue + 개별 수정 병행",
      "D. 프로그램 위주 진행",
    ], "c"),
    {
      questionId: "q19_imprint_description",
      type: "short_text",
      area: "principles",
      title: "Q19. \"imprint의 정의를 설명하고, 언제 사용하는지 서술하시오.\"",
      description: "서술형 10점 문항입니다. 현재 Firebase 자동 채점에서는 운영자 검토 참고값으로 저장합니다.",
      required: true,
    },
    {
      questionId: "q20_spine_extension",
      type: "fill_blank",
      area: "anatomy",
      title: "Q20. Spine extension 동작에서 요추 대신 흉추에서 움직임을 유도하기 위해서는 우선적으로 (    ) 의 가동성을 확보해야 한다.",
      acceptedAnswers: ["흉추", "thoracic spine", "t spine", "t-spine", "thoracic"],
      points: 6,
      required: true,
    },
    {
      questionId: "q21_core_stabilization",
      type: "fill_blank",
      area: "anatomy",
      title: "Q21. 필라테스에서 코어 안정화는 횡격막, 복횡근, 다열근, (    )의 협응으로 이루어진다.",
      acceptedAnswers: ["골반저근", "골반저", "골반저근육", "pelvic floor", "pelvic floor muscles"],
      points: 6,
      required: true,
    },
    {
      questionId: "q22_psis",
      type: "fill_blank",
      area: "anatomy",
      title: "Q22. 중립 척추에서 골반 정렬은 ASIS와 (    )이 동일한 수평면에 위치하는 상태를 의미한다.",
      acceptedAnswers: ["psis", "PSIS", "후상장골극", "posterior superior iliac spine"],
      points: 6,
      required: true,
    },
  ] satisfies QuizQuestion[],
};
export async function getInstructorEvaluationQuizHandler(
  _request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const isManager = isManagerRole(staff.role);
  const targetStaffs = isManager ? await getActiveStaffs(staff.studioId || DEFAULT_STUDIO_ID) : [staff];
  return {
    ok: true,
    quiz: publicQuiz(),
    targetStaffs: targetStaffs
      .filter((item) => item.active)
      .map((item) => ({
        staffId: item.staffId,
        name: item.name,
        role: item.role,
        active: item.active,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
  };
}

export async function submitInstructorEvaluationQuizHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const data = (request.data || {}) as Record<string, unknown>;
  const targetStaffId = cleanId(String(data.staffId || data.targetStaffId || staff.staffId));
  if (!targetStaffId) throw new AppError("INVALID_ARGUMENT", "강사를 선택하세요.");
  if (!isManagerRole(staff.role)) assertOwnStaff(staff, targetStaffId);
  const targetStaff = await getStaffById(targetStaffId);
  if (!targetStaff || !targetStaff.active) throw new AppError("NOT_FOUND", "사용 가능한 강사 정보를 찾을 수 없습니다.");

  const rawAnswers = normalizeAnswers(data.answers);
  const now = nowTimestamp();
  const graded = gradeAnswers(rawAnswers);
  const submissionId = `staff_eval_${targetStaffId}_${Date.now()}_${stableHash({
    quizId: QUIZ.quizId,
    targetStaffId,
    submittedByUid: staff.uid || "",
    answers: rawAnswers,
  }).slice(0, 10)}`;

  const submission = {
    submissionId,
    studioId: targetStaff.studioId || DEFAULT_STUDIO_ID,
    staffId: targetStaff.staffId,
    staffName: targetStaff.name,
    staffRole: targetStaff.role,
    quizId: QUIZ.quizId,
    quizVersion: QUIZ.version,
    quizTitle: QUIZ.title,
    status: graded.passed ? "passed" : "review_needed",
    scorePercent: graded.scorePercent,
    earnedPointTotal: graded.earnedPointTotal,
    scoredPointTotal: graded.scoredPointTotal,
    correctCount: graded.correctCount,
    scoredQuestionCount: graded.scoredQuestionCount,
    manualReviewQuestionIds: graded.manualReviewQuestionIds,
    passScore: QUIZ.passScore,
    answers: graded.answers,
    openResponses: graded.openResponses,
    incorrectQuestionIds: graded.incorrectQuestionIds,
    submittedByUid: staff.uid || "",
    submittedByStaffId: staff.staffId,
    submittedByName: staff.name,
    submittedAt: now,
    updatedAt: now,
  };

  const cardRef = db.collection("staffHrCards").doc(targetStaff.staffId);
  const submissionRef = db.collection("staffEvaluationSubmissions").doc(submissionId);
  const cardResultRef = cardRef.collection("quizResults").doc(submissionId);
  const cardSnap = await cardRef.get();
  const current = cardSnap.data() || {};
  const previousBest = Number(current.quizSummary?.bestScorePercent || 0);
  const attempts = Number(current.quizSummary?.attempts || 0) + 1;

  await db.runTransaction(async (transaction) => {
    transaction.set(submissionRef, submission);
    transaction.set(cardResultRef, submission);
    transaction.set(
      cardRef,
      {
        staffId: targetStaff.staffId,
        staffName: targetStaff.name,
        staffRole: targetStaff.role,
        studioId: targetStaff.studioId || DEFAULT_STUDIO_ID,
        active: targetStaff.active,
        source: "instructor_evaluation_quiz",
        latestQuiz: {
          submissionId,
          quizId: QUIZ.quizId,
          quizVersion: QUIZ.version,
          scorePercent: graded.scorePercent,
          earnedPointTotal: graded.earnedPointTotal,
          scoredPointTotal: graded.scoredPointTotal,
          correctCount: graded.correctCount,
          scoredQuestionCount: graded.scoredQuestionCount,
          status: submission.status,
          submittedAt: now,
          submittedByName: staff.name,
        },
        quizSummary: {
          attempts,
          bestScorePercent: Math.max(previousBest, graded.scorePercent),
          lastScorePercent: graded.scorePercent,
          lastStatus: submission.status,
          lastSubmittedAt: now,
        },
        updatedAt: now,
        createdAt: current.createdAt || now,
      },
      { merge: true },
    );
    transaction.set(
      db.collection("auditLogs").doc(`staff_eval_${submissionId}`),
      {
        auditId: `staff_eval_${submissionId}`,
        studioId: targetStaff.studioId || DEFAULT_STUDIO_ID,
        type: "staff_evaluation_quiz_submitted",
        staffId: targetStaff.staffId,
        staffName: targetStaff.name,
        submittedByStaffId: staff.staffId,
        submittedByName: staff.name,
    scorePercent: graded.scorePercent,
    earnedPointTotal: graded.earnedPointTotal,
    scoredPointTotal: graded.scoredPointTotal,
    createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  return {
    ok: true,
    submissionId,
    staffId: targetStaff.staffId,
    staffName: targetStaff.name,
    scorePercent: graded.scorePercent,
    earnedPointTotal: graded.earnedPointTotal,
    scoredPointTotal: graded.scoredPointTotal,
    correctCount: graded.correctCount,
    scoredQuestionCount: graded.scoredQuestionCount,
    passed: graded.passed,
    status: submission.status,
  };
}

function publicQuiz(): Record<string, unknown> {
  return {
    quizId: QUIZ.quizId,
    version: QUIZ.version,
    title: QUIZ.title,
    description: QUIZ.description,
    passScore: QUIZ.passScore,
    questions: QUIZ.questions.map((question) => ({
      questionId: question.questionId,
      type: question.type,
      title: question.title,
      description: question.description || "",
      area: question.area,
      required: question.required,
      points: question.points || 0,
      options: question.options || [],
    })),
  };
}

function normalizeAnswers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const questionId = cleanId(key);
    if (!questionId) continue;
    out[questionId] = cleanAnswer(String(raw || ""));
  }
  return out;
}

function gradeAnswers(rawAnswers: Record<string, string>) {
  const answers = [];
  const openResponses: Record<string, string> = {};
  const incorrectQuestionIds: string[] = [];
  const manualReviewQuestionIds: string[] = [];
  let correctCount = 0;
  let scoredQuestionCount = 0;
  let earnedPointTotal = 0;
  let scoredPointTotal = 0;

  for (const question of QUIZ.questions) {
    const answer = rawAnswers[question.questionId] || "";
    if (question.required && !answer) throw new AppError("INVALID_ARGUMENT", `${question.title} 문항을 입력하세요.`);
    if (question.type === "short_text") {
      if (answer) openResponses[question.questionId] = answer;
      manualReviewQuestionIds.push(question.questionId);
      answers.push({
        questionId: question.questionId,
        type: question.type,
        title: question.title,
        area: question.area,
        answerText: answer,
        points: 0,
        scored: false,
      });
      continue;
    }
    const questionPoints = Number(question.points || 0);
    scoredQuestionCount += 1;
    scoredPointTotal += questionPoints;
    const correct =
      question.type === "fill_blank"
        ? isAcceptedTextAnswer(answer, question.acceptedAnswers || [])
        : answer === question.correctOptionId;
    if (correct) {
      correctCount += 1;
      earnedPointTotal += questionPoints;
    } else {
      incorrectQuestionIds.push(question.questionId);
    }
    answers.push({
      questionId: question.questionId,
      type: question.type,
      title: question.title,
      area: question.area,
      points: questionPoints,
      earnedPoints: correct ? questionPoints : 0,
      ...(question.type === "fill_blank"
        ? { answerText: answer }
        : {
            selectedOptionId: answer,
            selectedLabel: question.options?.find((option) => option.optionId === answer)?.label || "",
          }),
      correct,
      scored: true,
    });
  }

  const scorePercent = scoredPointTotal ? Math.round((earnedPointTotal / scoredPointTotal) * 100) : 0;
  return {
    answers,
    openResponses,
    incorrectQuestionIds,
    manualReviewQuestionIds,
    correctCount,
    scoredQuestionCount,
    earnedPointTotal,
    scoredPointTotal,
    scorePercent,
    passed: scorePercent >= QUIZ.passScore,
  };
}

function isAcceptedTextAnswer(answer: string, acceptedAnswers: string[]): boolean {
  const normalizedAnswer = normalizeTextAnswer(answer);
  return Boolean(normalizedAnswer) && acceptedAnswers.some((accepted) => normalizeTextAnswer(accepted) === normalizedAnswer);
}

function normalizeTextAnswer(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[()\[\]{}.,_\-]/g, " ")
    .replace(/\s+/g, " ");
}

function cleanId(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function cleanAnswer(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 1000);
}
