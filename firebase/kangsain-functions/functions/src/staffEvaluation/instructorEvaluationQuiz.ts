import { createHash, randomBytes } from "node:crypto";
import type { CallableRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { getActiveStaffs, getStaffById } from "../firestore/staffRepository";
import type { StaffDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { AppError } from "../utils/errors";
import { stableHash } from "../utils/hash";
import { assertOwnStaff, isManagerRole, requireManager } from "../security/authGuards";

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
      description: "서술형 10점 문항입니다. 1차 자동 루브릭 채점 후 운영자가 점수를 조정할 수 있습니다.",
      points: 10,
      required: false,
    },
    {
      questionId: "q20_spine_extension",
      type: "fill_blank",
      area: "anatomy",
      title: "Q20. Spine extension 동작에서 요추 대신 흉추에서 움직임을 유도하기 위해서는 우선적으로 (    ) 의 가동성을 확보해야 한다.",
      acceptedAnswers: ["흉추", "thoracic spine", "t spine", "t-spine", "thoracic"],
      points: 6,
      required: false,
    },
    {
      questionId: "q21_core_stabilization",
      type: "fill_blank",
      area: "anatomy",
      title: "Q21. 필라테스에서 코어 안정화는 횡격막, 복횡근, 다열근, (    )의 협응으로 이루어진다.",
      acceptedAnswers: ["골반저근", "골반저", "골반저근육", "pelvic floor", "pelvic floor muscles"],
      points: 6,
      required: false,
    },
    {
      questionId: "q22_psis",
      type: "fill_blank",
      area: "anatomy",
      title: "Q22. 중립 척추에서 골반 정렬은 ASIS와 (    )이 동일한 수평면에 위치하는 상태를 의미한다.",
      acceptedAnswers: ["psis", "PSIS", "후상장골극", "posterior superior iliac spine"],
      points: 6,
      required: false,
    },
  ] satisfies QuizQuestion[],
};

const APPLICANT_TIME_LIMIT_SECONDS = 20 * 60;
const APPLICANT_LATE_GRACE_SECONDS = 5 * 60;

export async function instructorApplicantEvaluationApiHandler(request: any, response: any): Promise<void> {
  setCors(response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  try {
    if (request.method === "GET") {
      response.set("Cache-Control", "no-store");
      response.status(200).json({
        ok: true,
        quiz: publicQuiz(),
        timeLimitSeconds: APPLICANT_TIME_LIMIT_SECONDS,
      });
      return;
    }

    if (request.method !== "POST") {
      response.set("Allow", "GET, POST, OPTIONS").status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const body = request.body || {};
    const action = String(body.action || "");
    if (action === "start") {
      const result = await startApplicantEvaluation(body);
      response.status(200).json({ ok: true, ...result });
      return;
    }
    if (action === "submit") {
      const result = await submitApplicantEvaluation(body);
      response.status(200).json({ ok: true, ...result });
      return;
    }
    throw new AppError("INVALID_ARGUMENT", "지원하지 않는 요청입니다.");
  } catch (err) {
    const status = err instanceof AppError && err.code === "INVALID_ARGUMENT" ? 400 : 500;
    response.status(status).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

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

export async function adjustInstructorEvaluationEssayScoreHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  requireManager(staff);
  const data = (request.data || {}) as Record<string, unknown>;
  const submissionId = cleanId(String(data.submissionId || ""));
  const questionId = cleanId(String(data.questionId || "q19_imprint_description"));
  const note = cleanAnswer(String(data.note || ""));
  const earnedPoints = normalizeManualScore(data.earnedPoints ?? data.score);
  if (!submissionId) throw new AppError("INVALID_ARGUMENT", "제출 기록을 선택하세요.");
  if (!questionId) throw new AppError("INVALID_ARGUMENT", "문항을 선택하세요.");

  const submissionRef = db.collection("staffEvaluationSubmissions").doc(submissionId);
  const submissionSnap = await submissionRef.get();
  if (!submissionSnap.exists) throw new AppError("NOT_FOUND", "제출 기록을 찾을 수 없습니다.");
  const submission = submissionSnap.data() || {};
  const question = QUIZ.questions.find((item) => item.questionId === questionId);
  if (!question || question.type !== "short_text") throw new AppError("INVALID_ARGUMENT", "서술형 문항만 수정할 수 있습니다.");
  const maxPoints = Number(question.points || 0);
  if (!Number.isFinite(earnedPoints) || earnedPoints < 0 || earnedPoints > maxPoints) {
    throw new AppError("INVALID_ARGUMENT", `점수는 0~${maxPoints}점 사이로 입력하세요.`);
  }

  const now = nowTimestamp();
  const adjusted = recalculateSubmissionWithEssayScore(submission, {
    question,
    earnedPoints,
    adjustedByStaffId: staff.staffId,
    adjustedByName: staff.name,
    adjustedAt: now,
    note,
  });
  const staffId = cleanId(String(submission.staffId || ""));
  const cardRef = db.collection("staffHrCards").doc(staffId);
  const cardResultRef = cardRef.collection("quizResults").doc(submissionId);
  const applicantSubmissionRef = db.collection("staffApplicantEvaluationSubmissions").doc(submissionId);
  const [cardSnap, resultSnap, applicantSubmissionSnap, cardResultsSnap] = await Promise.all([
    cardRef.get(),
    cardResultRef.get(),
    applicantSubmissionRef.get(),
    cardRef.collection("quizResults").get(),
  ]);
  const card = cardSnap.data() || {};
  const bestScorePercent = Math.max(
    adjusted.scorePercent,
    ...cardResultsSnap.docs.map((doc) =>
      doc.id === submissionId ? adjusted.scorePercent : Number(doc.data().scorePercent || 0),
    ),
  );
  const latestQuizPatch =
    card.latestQuiz?.submissionId === submissionId
      ? {
          latestQuiz: {
            ...card.latestQuiz,
            scorePercent: adjusted.scorePercent,
            earnedPointTotal: adjusted.earnedPointTotal,
            scoredPointTotal: adjusted.scoredPointTotal,
            correctCount: adjusted.correctCount,
            scoredQuestionCount: adjusted.scoredQuestionCount,
            status: adjusted.status,
            reasonCodes: adjusted.reasonCodes,
            adjustedAt: now,
            adjustedByName: staff.name,
          },
        }
      : {};
  const quizSummaryPatch = {
    quizSummary: {
      ...(card.quizSummary || {}),
      bestScorePercent,
      ...(card.latestQuiz?.submissionId === submissionId
        ? {
            lastScorePercent: adjusted.scorePercent,
            lastStatus: adjusted.status,
            lastSubmittedAt: submission.submittedAt || card.quizSummary?.lastSubmittedAt || now,
          }
        : {}),
    },
  };

  const writes: Promise<unknown>[] = [
    submissionRef.set(adjusted.patch, { merge: true }),
    cardRef.set(
      {
        ...latestQuizPatch,
        ...quizSummaryPatch,
        updatedAt: now,
      },
      { merge: true },
    ),
    db.collection("auditLogs").doc(`staff_eval_score_adjust_${submissionId}_${questionId}`).set(
      {
        auditId: `staff_eval_score_adjust_${submissionId}_${questionId}`,
        studioId: submission.studioId || DEFAULT_STUDIO_ID,
        type: "staff_evaluation_essay_score_adjusted",
        staffId,
        staffName: submission.staffName || "",
        submissionId,
        questionId,
        earnedPoints,
        maxPoints,
        adjustedByStaffId: staff.staffId,
        adjustedByName: staff.name,
        note,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    ),
  ];
  if (resultSnap.exists) writes.push(cardResultRef.set(adjusted.patch, { merge: true }));
  if (applicantSubmissionSnap.exists) writes.push(applicantSubmissionRef.set(adjusted.patch, { merge: true }));
  await Promise.all(writes);

  return {
    ok: true,
    submissionId,
    questionId,
    earnedPoints,
    maxPoints,
    scorePercent: adjusted.scorePercent,
    earnedPointTotal: adjusted.earnedPointTotal,
    scoredPointTotal: adjusted.scoredPointTotal,
    status: adjusted.status,
  };
}

async function startApplicantEvaluation(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const applicantName = cleanDisplayName(data.name || data.applicantName);
  const applicantPhone = cleanPhone(data.phone || data.applicantPhone);
  if (!applicantName) throw new AppError("INVALID_ARGUMENT", "이름을 입력해 주세요.");
  if (!/^01\d{8,9}$/.test(applicantPhone)) throw new AppError("INVALID_ARGUMENT", "휴대폰 번호를 정확히 입력해 주세요.");

  const now = nowTimestamp();
  const sessionToken = randomBytes(24).toString("base64url");
  const applicantId = applicantCardId(applicantPhone);
  const sessionId = `staff_applicant_eval_${Date.now()}_${stableHash({
    applicantName,
    applicantPhone,
    nonce: randomBytes(8).toString("hex"),
  }).slice(0, 12)}`;
  const expiresAt = Timestamp.fromMillis(now.toMillis() + (APPLICANT_TIME_LIMIT_SECONDS + APPLICANT_LATE_GRACE_SECONDS) * 1000);

  const session = {
    sessionId,
    studioId: DEFAULT_STUDIO_ID,
    applicantId,
    applicantName,
    applicantPhone,
    phoneLast4: applicantPhone.slice(-4),
    quizId: QUIZ.quizId,
    quizVersion: QUIZ.version,
    quizTitle: QUIZ.title,
    status: "started",
    source: "public_applicant_evaluation_site",
    timeLimitSeconds: APPLICANT_TIME_LIMIT_SECONDS,
    accessTokenHash: sha256(sessionToken),
    startedAt: now,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection("staffApplicantEvaluationSessions").doc(sessionId).set(session, { merge: true });

  return {
    sessionId,
    sessionToken,
    applicantId,
    applicantName,
    phoneLast4: applicantPhone.slice(-4),
    startedAt: now.toDate().toISOString(),
    expiresAt: expiresAt.toDate().toISOString(),
    timeLimitSeconds: APPLICANT_TIME_LIMIT_SECONDS,
    quiz: publicQuiz(),
  };
}

async function submitApplicantEvaluation(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sessionId = cleanId(String(data.sessionId || ""));
  const sessionToken = cleanAnswer(String(data.sessionToken || data.token || ""));
  if (!sessionId || !sessionToken) throw new AppError("INVALID_ARGUMENT", "시험 세션이 올바르지 않습니다.");

  const sessionRef = db.collection("staffApplicantEvaluationSessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  const session = sessionSnap.data() || null;
  if (!session || session.accessTokenHash !== sha256(sessionToken)) {
    throw new AppError("INVALID_ARGUMENT", "시험 세션을 확인할 수 없습니다.");
  }
  if (session.status === "submitted" || session.submissionId) {
    throw new AppError("INVALID_ARGUMENT", "이미 제출된 시험입니다.");
  }

  const now = nowTimestamp();
  const startedAtMs = session.startedAt?.toMillis?.() || now.toMillis();
  const elapsedSeconds = Math.max(0, Math.round((now.toMillis() - startedAtMs) / 1000));
  const timeExpired = elapsedSeconds > APPLICANT_TIME_LIMIT_SECONDS;
  if (elapsedSeconds > APPLICANT_TIME_LIMIT_SECONDS + APPLICANT_LATE_GRACE_SECONDS) {
    throw new AppError("INVALID_ARGUMENT", "제한시간이 지나 제출할 수 없습니다.");
  }
  const rawAnswers = normalizeAnswers(data.answers);
  const graded = gradeAnswers(rawAnswers);
  const applicantId = String(session.applicantId || applicantCardId(session.applicantPhone || ""));
  const applicantName = cleanDisplayName(session.applicantName || data.name);
  const applicantPhone = cleanPhone(session.applicantPhone || data.phone);
  const submissionId = `staff_applicant_eval_${applicantId}_${Date.now()}_${stableHash({
    sessionId,
    answers: rawAnswers,
  }).slice(0, 10)}`;
  const status = graded.passed && !timeExpired ? "passed" : "review_needed";
  const reasonCodes = [
    ...(graded.passed ? [] : ["score_below_pass"]),
    ...(timeExpired ? ["time_expired"] : []),
    ...(graded.manualReviewQuestionIds.length ? ["manual_review_question"] : []),
  ];
  const submission = {
    submissionId,
    sessionId,
    studioId: DEFAULT_STUDIO_ID,
    staffId: applicantId,
    staffName: applicantName,
    staffRole: "applicant",
    applicantId,
    applicantName,
    applicantPhone,
    phoneLast4: applicantPhone.slice(-4),
    quizId: QUIZ.quizId,
    quizVersion: QUIZ.version,
    quizTitle: QUIZ.title,
    source: "public_applicant_evaluation_site",
    applicantEvaluation: true,
    status,
    reasonCodes,
    scorePercent: graded.scorePercent,
    earnedPointTotal: graded.earnedPointTotal,
    scoredPointTotal: graded.scoredPointTotal,
    correctCount: graded.correctCount,
    scoredQuestionCount: graded.scoredQuestionCount,
    manualReviewQuestionIds: graded.manualReviewQuestionIds,
    passScore: QUIZ.passScore,
    timeLimitSeconds: APPLICANT_TIME_LIMIT_SECONDS,
    elapsedSeconds,
    timeExpired,
    answers: graded.answers,
    openResponses: graded.openResponses,
    incorrectQuestionIds: graded.incorrectQuestionIds,
    submittedAt: now,
    updatedAt: now,
  };

  const cardRef = db.collection("staffHrCards").doc(applicantId);
  const submissionRef = db.collection("staffEvaluationSubmissions").doc(submissionId);
  const applicantSubmissionRef = db.collection("staffApplicantEvaluationSubmissions").doc(submissionId);
  const cardResultRef = cardRef.collection("quizResults").doc(submissionId);
  const cardSnap = await cardRef.get();
  const current = cardSnap.data() || {};
  const previousBest = Number(current.quizSummary?.bestScorePercent || 0);
  const attempts = Number(current.quizSummary?.attempts || 0) + 1;

  await db.runTransaction(async (transaction) => {
    transaction.set(submissionRef, submission);
    transaction.set(applicantSubmissionRef, submission);
    transaction.set(cardResultRef, submission);
    transaction.set(
      cardRef,
      {
        staffId: applicantId,
        staffName: applicantName,
        staffRole: "applicant",
        applicantId,
        applicantName,
        applicantPhone,
        phoneLast4: applicantPhone.slice(-4),
        studioId: DEFAULT_STUDIO_ID,
        active: false,
        source: "public_applicant_evaluation_site",
        applicantEvaluation: true,
        latestQuiz: {
          submissionId,
          quizId: QUIZ.quizId,
          quizVersion: QUIZ.version,
          source: "public_applicant_evaluation_site",
          scorePercent: graded.scorePercent,
          earnedPointTotal: graded.earnedPointTotal,
          scoredPointTotal: graded.scoredPointTotal,
          correctCount: graded.correctCount,
          scoredQuestionCount: graded.scoredQuestionCount,
          status,
          reasonCodes,
          elapsedSeconds,
          timeExpired,
          submittedAt: now,
          submittedByName: applicantName,
        },
        quizSummary: {
          attempts,
          bestScorePercent: Math.max(previousBest, graded.scorePercent),
          lastScorePercent: graded.scorePercent,
          lastStatus: status,
          lastSubmittedAt: now,
        },
        updatedAt: now,
        createdAt: current.createdAt || now,
      },
      { merge: true },
    );
    transaction.set(
      sessionRef,
      {
        status: "submitted",
        submissionId,
        scorePercent: graded.scorePercent,
        elapsedSeconds,
        timeExpired,
        submittedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.set(
      db.collection("auditLogs").doc(`staff_applicant_eval_${submissionId}`),
      {
        auditId: `staff_applicant_eval_${submissionId}`,
        studioId: DEFAULT_STUDIO_ID,
        type: "staff_applicant_evaluation_submitted",
        staffId: applicantId,
        staffName: applicantName,
        applicantPhone,
        scorePercent: graded.scorePercent,
        elapsedSeconds,
        timeExpired,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  return {
    submissionId,
    applicantId,
    applicantName,
    phoneLast4: applicantPhone.slice(-4),
    scorePercent: graded.scorePercent,
    earnedPointTotal: graded.earnedPointTotal,
    scoredPointTotal: graded.scoredPointTotal,
    correctCount: graded.correctCount,
    scoredQuestionCount: graded.scoredQuestionCount,
    passed: graded.passed && !timeExpired,
    status,
    elapsedSeconds,
    timeExpired,
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
      const questionPoints = Number(question.points || 0);
      const rubric = scoreShortTextAnswer(question, answer);
      if (answer) openResponses[question.questionId] = answer;
      manualReviewQuestionIds.push(question.questionId);
      scoredQuestionCount += 1;
      scoredPointTotal += questionPoints;
      earnedPointTotal += rubric.earnedPoints;
      const correct = rubric.earnedPoints >= Math.ceil(questionPoints * 0.7);
      if (correct) correctCount += 1;
      else incorrectQuestionIds.push(question.questionId);
      answers.push({
        questionId: question.questionId,
        type: question.type,
        title: question.title,
        area: question.area,
        answerText: answer,
        points: questionPoints,
        earnedPoints: rubric.earnedPoints,
        correct,
        scored: true,
        autoScored: true,
        rubricScore: rubric,
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

function scoreShortTextAnswer(question: QuizQuestion, answer: string): Record<string, unknown> & { earnedPoints: number } {
  const maxPoints = Number(question.points || 0);
  const normalized = normalizeRubricText(answer);
  if (!answer || !normalized || question.questionId !== "q19_imprint_description") {
    return {
      earnedPoints: 0,
      maxPoints,
      matchedCriteria: [],
      missingCriteria: ["정의", "정렬 변화", "코어 안정", "사용 상황", "주의점"],
      feedback: "서술형 답변이 없어 0점으로 1차 산정했습니다.",
      method: "rule_based_rubric_v1",
    };
  }
  const criteria = [
    {
      id: "pelvic_posterior_tilt",
      label: "골반 후방경사 또는 골반을 말아내는 정렬 변화",
      points: 3,
      terms: ["후방경사", "골반말", "골반을말", "골반을뒤", "posteriorpelvictilt", "posteriortilt"],
    },
    {
      id: "lumbar_imprint",
      label: "요추/허리 공간이 매트 쪽으로 가까워지는 설명",
      points: 2,
      terms: ["요추굴곡", "허리공간", "허리를바닥", "허리가바닥", "허리매트", "매트에붙", "lumbarflexion", "lowback"],
    },
    {
      id: "core_control",
      label: "복부·복횡근·코어 안정과 연결",
      points: 2,
      terms: ["복부", "복횡근", "코어", "복압", "abdominal", "transversus", "core"],
    },
    {
      id: "use_case",
      label: "초보자, 허리 부담, 누운 자세, 테이블탑 등 사용 상황",
      points: 2,
      terms: ["초보", "허리통증", "허리부담", "테이블탑", "상체말", "hundred", "백번", "누운", "supine", "안정", "중립유지"],
    },
    {
      id: "safety_nuance",
      label: "과도한 압박을 피하거나 중립과 구분하는 주의점",
      points: 1,
      terms: ["과도", "무리", "중립", "neutral", "억지", "필요시", "상황에따라", "장시간"],
    },
  ];
  const matchedCriteria: Array<{ id: string; label: string; points: number }> = [];
  const missingCriteria: string[] = [];
  let earnedPoints = 0;
  for (const criterion of criteria) {
    const matched = criterion.terms.some((term) => normalized.includes(normalizeRubricText(term)));
    if (matched) {
      earnedPoints += criterion.points;
      matchedCriteria.push({ id: criterion.id, label: criterion.label, points: criterion.points });
    } else {
      missingCriteria.push(criterion.label);
    }
  }
  return {
    earnedPoints: Math.min(maxPoints, earnedPoints),
    maxPoints,
    matchedCriteria,
    missingCriteria,
    feedback: missingCriteria.length
      ? `1차 자동채점: ${earnedPoints}/${maxPoints}점. 보완 필요: ${missingCriteria.join(", ")}`
      : `1차 자동채점: ${maxPoints}/${maxPoints}점. 핵심 기준을 모두 포함했습니다.`,
    method: "rule_based_rubric_v1",
  };
}

function recalculateSubmissionWithEssayScore(
  submission: Record<string, any>,
  adjustment: {
    question: QuizQuestion;
    earnedPoints: number;
    adjustedByStaffId: string;
    adjustedByName: string;
    adjustedAt: Timestamp;
    note: string;
  },
): any {
  const questionId = adjustment.question.questionId;
  const maxPoints = Number(adjustment.question.points || 0);
  const answers = Array.isArray(submission.answers) ? [...submission.answers] : [];
  const answerIndex = answers.findIndex((item) => item?.questionId === questionId);
  const previous = answerIndex >= 0 ? answers[answerIndex] || {} : {};
  const updatedAnswer = {
    ...previous,
    questionId,
    type: "short_text",
    title: previous.title || adjustment.question.title,
    area: previous.area || adjustment.question.area,
    answerText: previous.answerText || "",
    points: maxPoints,
    earnedPoints: adjustment.earnedPoints,
    correct: adjustment.earnedPoints >= Math.ceil(maxPoints * 0.7),
    scored: true,
    autoScored: previous.autoScored ?? true,
    manualOverride: {
      earnedPoints: adjustment.earnedPoints,
      maxPoints,
      previousEarnedPoints: Number(previous.earnedPoints || 0),
      adjustedByStaffId: adjustment.adjustedByStaffId,
      adjustedByName: adjustment.adjustedByName,
      adjustedAt: adjustment.adjustedAt,
      note: adjustment.note,
    },
  };
  if (answerIndex >= 0) answers[answerIndex] = updatedAnswer;
  else answers.push(updatedAnswer);

  let earnedPointTotal = 0;
  let scoredPointTotal = 0;
  let correctCount = 0;
  let scoredQuestionCount = 0;
  const incorrectQuestionIds: string[] = [];
  for (const answer of answers) {
    if (!answer?.scored) continue;
    const points = Number(answer.points || 0);
    const earned = Number(answer.earnedPoints || 0);
    scoredQuestionCount += 1;
    scoredPointTotal += points;
    earnedPointTotal += earned;
    if (answer.correct === true || earned >= Math.ceil(points * 0.7)) correctCount += 1;
    else incorrectQuestionIds.push(String(answer.questionId || ""));
  }
  const scorePercent = scoredPointTotal ? Math.round((earnedPointTotal / scoredPointTotal) * 100) : 0;
  const passScore = Number(submission.passScore || QUIZ.passScore);
  const timeExpired = Boolean(submission.timeExpired);
  const status = scorePercent >= passScore && !timeExpired ? "passed" : "review_needed";
  const reasonCodes = [
    ...(scorePercent >= passScore ? [] : ["score_below_pass"]),
    ...(timeExpired ? ["time_expired"] : []),
    "manual_score_override",
  ];
  const manualScoreOverrides = {
    ...(submission.manualScoreOverrides || {}),
    [questionId]: updatedAnswer.manualOverride,
  };
  return {
    scorePercent,
    earnedPointTotal,
    scoredPointTotal,
    correctCount,
    scoredQuestionCount,
    incorrectQuestionIds: incorrectQuestionIds.filter(Boolean),
    status,
    reasonCodes,
    patch: {
      answers,
      manualScoreOverrides,
      scoreAdjusted: true,
      adjustedAt: adjustment.adjustedAt,
      adjustedByStaffId: adjustment.adjustedByStaffId,
      adjustedByName: adjustment.adjustedByName,
      scorePercent,
      earnedPointTotal,
      scoredPointTotal,
      correctCount,
      scoredQuestionCount,
      incorrectQuestionIds: incorrectQuestionIds.filter(Boolean),
      status,
      reasonCodes,
      updatedAt: adjustment.adjustedAt,
    },
  };
}

function normalizeManualScore(value: unknown): number {
  if (value === null || value === undefined || value === "") return Number.NaN;
  const score = Number(value);
  return Number.isFinite(score) ? Math.round(score * 10) / 10 : Number.NaN;
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

function normalizeRubricText(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[()\[\]{}.,_\-·'"“”‘’\s]/g, "")
    .replace(/pelvicfloor/g, "골반저근");
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

function cleanDisplayName(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function cleanPhone(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(0, 20);
}

function applicantCardId(phone: string): string {
  return `applicant_${stableHash({ phone }).slice(0, 18)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function setCors(response: any): void {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
}
