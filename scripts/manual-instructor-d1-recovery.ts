// Operator-only local entry point. Never invoke a scheduled endpoint or write a provider POST directly.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { db } from "../firebase/kangsain-functions/functions/src/config/firebase";
import type { AlimtalkCandidateDoc, BookingDoc, LectureDoc, MemberProfileDoc } from "../firebase/kangsain-functions/functions/src/types/models";
import { canonicalizeBookings } from "../firebase/kangsain-functions/functions/src/utils/canonicalBooking";
import { stableHash } from "../firebase/kangsain-functions/functions/src/utils/hash";
import { todayKst } from "../firebase/kangsain-functions/functions/src/utils/date";
import { instructorLessonMaterialCandidatesForDate } from "../firebase/kangsain-functions/functions/src/alimtalk/rebuildAlimtalkCandidates";
import { instructorLessonManagementNumberFor } from "../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonManagement";
import { isInstructorLessonBooking, isTeamInstructorLessonBooking } from "../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonBookingPolicy";
import { isAlimtalkTestRecipient, primaryAlimtalkTestRecipient } from "../firebase/kangsain-functions/functions/src/alimtalk/testRecipients";
import { alimtalkDedupeKey, normalizePhone } from "../firebase/kangsain-functions/functions/src/alimtalk/dedupe";
import { cancellationBlocksRegistration } from "../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonCancellationPolicy";
import { attachInstructorLessonParkingPayload, upsertInstructorLessonParkingPreRegistration } from "../firebase/kangsain-functions/functions/src/parking/instructorLessonParkingPreRegistration";
import { ensureShortLink } from "../firebase/kangsain-functions/functions/src/utils/shortLinks";
import { refs } from "../firebase/kangsain-functions/functions/src/firestore/refs";
import { INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID as channel, INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE as template } from "../firebase/kangsain-functions/functions/src/alimtalk/templates";
import {
  dispatchManualInstructorD1, getManualInstructorD1Approval, instructorLessonApprovedCandidatesIssue,
  instructorLessonCancellationRegistrationId, instructorLessonCandidateSourceIssue, instructorLessonReservationSnapshotIssue,
  manualInstructorD1ApprovalProof, manualInstructorD1TimeIssue, prepareManualInstructorD1Sample,
} from "../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonSampleApproval";
import { makeLessonVideoSolapiRequest } from "./lib/lesson-video-notice-solapi.mjs";

const studioId = "5330";
const [mode, lessonDate, managementNumber, ...args] = process.argv.slice(2);
const sourceDate = todayKst();
const maximum = 30;
const origin = "https://in.archivepilates.com";
type Row = { to?: string; messageId?: string; status?: string; statusCode?: string; type?: string; kakaoOptions?: { templateId?: string; pfId?: string }; templateId?: string };
type Template = { status: string; channelId: string; messageType: string; emphasizeType: string; imageId: string; content: string;
  buttons: {buttonName: string; linkMo: string; linkPc: string}[] };
const [proof = "", marker = "", who = ""] = args;
const withMaterial = (a: AlimtalkCandidateDoc) => ({
  ...a, dedupeKey: alimtalkDedupeKey(a),
});
const expectedButtons = [
  ["수업자료 보기", origin + "/method/#{관리번호}"],
  ["수업배정 안내", origin + "/method/#{관리번호}/assignment"],
  ["방문안내 보기", "https://archivepilates.notion.site/visitin"],
  ["주차 사전등록", origin + "/s/#{주차링크ID}/"],
];
function checkTime() { const issue = manualInstructorD1TimeIssue(sourceDate, lessonDate); assert(!issue, issue); }
function loadSecret(name: string) {
  return execFileSync("gcloud", ["secrets", "versions", "access", "latest", "--secret=" + name, "--project=archive-pilates",
    "--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com", "--quiet"],
    {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000}).trim();
}
async function scope() {
  checkTime();
  const [snapshot, allBookings, allLectures] = await Promise.all([
    db.doc("opsState/studiomateReservationExcelEmergency").get(),
    refs.bookings().where("studioId", "==", studioId).where("lectureDate", "==", lessonDate).limit(701).get(),
    db.collection("lectures").where("studioId", "==", studioId).where("date", "==", lessonDate).limit(201).get(),
  ]);
  assert(allBookings.size <= 700 && allLectures.size <= 200, "원본 조회 제한 초과");
  const snapshotIssue = instructorLessonReservationSnapshotIssue(snapshot.data(), lessonDate);
  assert(!snapshotIssue, snapshotIssue);
  const lectures = new Map(allLectures.docs.map(doc => { const l = doc.data() as LectureDoc; return [l.lectureId, l]; }));
  const selected = canonicalizeBookings(allBookings.docs.map(doc => doc.data() as BookingDoc))
    .filter(b => {
      const l = lectures.get(b.lectureId);
      return l?.status === "open" && b.appStatus === "reserved" && !b.supersededByBookingId && !b.sessionOrder?.supersededByBookingId
        && isInstructorLessonBooking(b) && instructorLessonManagementNumberFor({ title:l.title, lessonDate, teamLesson:isTeamInstructorLessonBooking(b) }) === managementNumber;
    });
  const groups = new Map<string, BookingDoc[]>();
  for (const b of selected) groups.set(b.memberId, [...(groups.get(b.memberId) || []), b]);
  assert(groups.size > 0 && groups.size <= maximum, "확정 명단이 없거나 최대 처리 건수를 초과했습니다.");
  const profiles = await db.getAll(...[...groups.keys()].map(id => refs.memberProfile(id)));
  const rows: AlimtalkCandidateDoc[] = [];
  for (const doc of profiles) {
    const p = doc.data() as MemberProfileDoc | undefined;
    assert(p?.memberId === doc.id && p.studioId === studioId && normalizePhone(p.phone || ""), "회원 원본 연락처를 확인할 수 없습니다.");
    if (isAlimtalkTestRecipient({ memberId:p.memberId, memberName:p.name, memberPhone:p.phone })) continue;
    const own = groups.get(p.memberId)!;
    assert(own.every(b => normalizePhone(b.memberPhone) === normalizePhone(p.phone || "")), "예약과 회원 연락처가 다릅니다.");
    const candidates = instructorLessonMaterialCandidatesForDate(p, sourceDate, groups, lectures);
    assert(candidates.length === 1, "한 회차에 대한 고유 후보를 생성할 수 없습니다.");
    const c = candidates[0];
    assert(c.payload?.managementNumber === managementNumber, "회차가 달라졌습니다.");
    const cancellation = await db.doc("instructorLessonRegistrations/" + instructorLessonCancellationRegistrationId(c)).get();
    if (cancellationBlocksRegistration(cancellation.data())) continue;
    const booking = own.find(b => b.bookingId === c.payload?.bookingId);
    const issue = instructorLessonCandidateSourceIssue(c, booking, booking ? lectures.get(booking.lectureId) : undefined);
    assert(!issue, issue);
    rows.push(withMaterial(c));
  }
  assert(rows.length && new Set(rows.map(row => normalizePhone(row.memberPhone))).size === rows.length, "빈 명단 또는 중복 연락처");
  return rows.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
}

async function main() {
  assert(["preview","sample","send"].includes(mode) && /^\d{4}-\d{2}-\d{2}$/.test(lessonDate)
    && /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{6}$/.test(managementNumber)
    && managementNumber.endsWith(lessonDate.slice(2).replace(/-/g,"")), "명령과 한 회차의 날짜·관리번호만 지정하세요.");
  assert((mode === "preview" && !args.length) || (mode === "sample" && args.length === 1 && /^[a-f0-9]{64}$/.test(proof)) ||
    (mode === "send" && args.length === 3 && /^[a-f0-9]{64}$/.test(proof) && marker === "confirm-delivered-sample" && /^operator:[^\s]{2,40}$/.test(who)),
    "직접 검토한 계획 또는 샘플의 승인 확인값이 필요합니다.");
  checkTime();
  const provider = makeLessonVideoSolapiRequest();
  const material = origin + "/method/" + managementNumber;
  const [rows, t, old, page, assignment, visit] = await Promise.all([
    scope(), provider("/kakao/v2/templates/"+template) as Promise<Template>, getManualInstructorD1Approval(studioId, sourceDate, managementNumber),
    fetch(material,{signal:AbortSignal.timeout(10000)}),fetch(material+"/assignment",{signal:AbortSignal.timeout(10000)}),
    fetch(expectedButtons[2][1],{signal:AbortSignal.timeout(10000)}),
  ]);
  assert(t.status === "APPROVED" && t.channelId === channel && t.messageType === "BA" && t.emphasizeType === "IMAGE"
    && t.imageId && t.content.includes("#{이름}") && t.buttons.length === 4
    && t.buttons.every((b,i)=>b.buttonName===expectedButtons[i][0]&&b.linkMo===expectedButtons[i][1]&&b.linkPc===b.linkMo), "승인 V3 템플릿 계약 불일치");
  assert(page.ok && assignment.ok && visit.ok && new URL(page.url).origin === origin && new URL(assignment.url).origin === origin, "안내 버튼 오류");
  const [html, teamHtml, visitHtml] = await Promise.all([page.text(), assignment.text(), visit.text()]);
  assert(html.includes('data-method-date="' + lessonDate + '"') && html.includes("수업자료는 수업 당일 12시에 공개됩니다.") &&
    teamHtml.includes(lessonDate), "자료/배정 날짜 또는 정오 공개 문구 오류");
  assert(visitHtml.trim().length > 500, "방문 안내 내용 확인 실패");
  const plan = stableHash({ sourceDate, lessonDate, managementNumber, template, content:t.content, image:t.imageId, buttons:t.buttons,
    material:stableHash(html), assignment:stableHash(teamHtml),
    recipients:rows.map(r => [r.candidateId, r.memberId, normalizePhone(r.memberPhone), r.payload?.parkingBookingIds, r.payload?.lessonStartAt]) });
  async function providerRows(params: URLSearchParams): Promise<Row[]> {
    const res = await provider("/messages/v4/list?" + params) as {messageList: Record<string, Row>; nextKey?: string; errorCode?: string};
    assert(res && typeof res.messageList === "object" && res.messageList !== null && !res.nextKey && !res.errorCode, "SOLAPI 완전한 이력 확인 필요");
    return Object.values(res.messageList);
  }
  async function existingProviderHistory(phone: string) {
    return (await providerRows(new URLSearchParams({to:phone,type:"ATA",dateType:"CREATED",limit:"500",
      startDate:sourceDate+"T00:00:00+09:00",endDate:sourceDate+"T23:59:59+09:00"})))
      .filter(r=>(r.kakaoOptions?.templateId||r.templateId)===template);
  }
  async function confirmSample(msgId: string) {
    if (!msgId) return false;
    const result = await providerRows(new URLSearchParams({messageIds:JSON.stringify([msgId])}));
    return result.length === 1 && result[0].messageId === msgId
      && normalizePhone(result[0].to || "") === normalizePhone(primaryAlimtalkTestRecipient().phone)
      && result[0].type === "ATA" && (result[0].kakaoOptions?.templateId || result[0].templateId) === template
      && String(result[0].statusCode) === "4000" && result[0].status === "COMPLETE";
  }
  const prior = await db.getAll(...rows.map(r => refs.alimtalkSend(r.candidateId)));
  assert(!prior.some(doc=>doc.exists), "이미 발송 원장이 존재합니다. 재발송하지 않습니다.");
  for (const r of rows) assert(!(await existingProviderHistory(normalizePhone(r.memberPhone))).length,
    "같은 D-1 날짜에 기존 V3 업체 이력이 있어 추가 확인이 필요합니다.");
  const preview = { lessonDate,managementNumber,recipients:rows.length,template: t.content, buttons:expectedButtons.map(b=>b[0]),plan,
    sampleState:old?.status || "absent" };
  if (mode === "preview") {
    const sampleDelivered = await confirmSample(old?.sampleSolapiMessageId || "");
    const boundApproval = old && sampleDelivered && !instructorLessonApprovedCandidatesIssue(old, rows)
      ? stableHash({ plan, approval:manualInstructorD1ApprovalProof(old) }) : null;
    console.log(JSON.stringify({...preview,sampleDelivered,approvalProof:boundApproval,customerSends:0},null,2));
    return;
  }
  checkTime();
  for (const name of ["SOLAPI_API_KEY", "SOLAPI_API_SECRET"]) {
    process.env[name] ||= loadSecret(name);
    assert(process.env[name], "SOLAPI 자격 확인 실패");
  }
  if (mode === "sample") {
    assert(primaryAlimtalkTestRecipient().name === "김기효", "요청한 테스트 수신자가 일치하지 않습니다.");
    assert(plan === proof, "검토 이후 대상과 안내 내용이 바뀌었습니다.");
    if (old?.sampleSolapiMessageId) {
      assert(await confirmSample(old.sampleSolapiMessageId) && !instructorLessonApprovedCandidatesIssue(old, rows), "기존 샘플 결과 또는 현재 대상 불일치");
      console.log(JSON.stringify({...preview,sample:"already_delivered_no_retry",customerSends:0})); return;
    }
    const sampleHistory = await existingProviderHistory(normalizePhone(primaryAlimtalkTestRecipient().phone));
    assert(!sampleHistory.length, "테스트 수신자의 기존 당일 V3 이력 대조가 필요합니다.");
    const secret = (process.env.PRIVATE_SURVEY_WEBHOOK_SECRET ||= loadSecret("PRIVATE_SURVEY_WEBHOOK_SECRET"));
    assert(secret, "주차 사전등록 키 확인 실패");
    const prepared = rows.map(r=>attachInstructorLessonParkingPayload(r,secret));
    assert(prepared.every(r=>r.payload?.parkingLinkId&&r.payload?.parkingShortUrl), "개인별 주차 등록 링크를 만들 수 없습니다.");
    const result = await prepareManualInstructorD1Sample({studioId,sourceDate,lessonDate,managementNumber,candidates:prepared});
    console.log(JSON.stringify({...preview,sample:result,customerSends:0,note:"SOLAPI 샘플 전달 확인 전에는 본 발송할 수 없습니다."}));
    return;
  }
  assert(old && proof === stableHash({ plan, approval:manualInstructorD1ApprovalProof(old) })
    && !instructorLessonApprovedCandidatesIssue(old, rows), "검토 대상, 본문 또는 샘플이 달라졌습니다.");
  // Re-read the current audience after provider checks, before passing the final exact-batch claim.
  const currentRows=await scope();
  assert(stableHash(currentRows.map(r=>[r.candidateId, r.payload?.parkingBookingIds, normalizePhone(r.memberPhone)]))
    ===stableHash(rows.map(r=>[r.candidateId, r.payload?.parkingBookingIds, normalizePhone(r.memberPhone)])), "발송 직전 명단이 바뀌었습니다.");
  assert(await confirmSample(old.sampleSolapiMessageId || ""), "SOLAPI 샘플 전달이 아직 확인되지 않았습니다.");
  const secret = (process.env.PRIVATE_SURVEY_WEBHOOK_SECRET ||= loadSecret("PRIVATE_SURVEY_WEBHOOK_SECRET"));
  assert(secret, "주차 사전등록 키 확인 실패");
  const prepared = currentRows.map(r=>attachInstructorLessonParkingPayload(r,secret));
  assert(prepared.every(r=>r.payload?.parkingLinkId&&r.payload?.parkingShortUrl), "개인별 주차 등록 링크를 만들 수 없습니다.");
  await db.runTransaction(async tx => {
    const features = await tx.getAll(...prepared.map(r=>refs.alimtalkCandidate(r.candidateId)));
    const logs = await tx.getAll(...prepared.map(r=>refs.alimtalkSend(r.candidateId)));
    assert(!logs.some(d=>d.exists), "이미 발송 원장이 존재합니다.");
    checkTime();
    for (const [i,r] of prepared.entries()) {
      const saved=features[i].data();
      if (saved) {
        assert(["candidate","reviewed"].includes(saved.status) && !saved.attempts && !saved.sentAt
          && saved.memberId===r.memberId && normalizePhone(saved.memberPhone)===normalizePhone(r.memberPhone)
          && saved.payload?.managementNumber===managementNumber && saved.payload?.parkingLinkId===r.payload?.parkingLinkId, "기존 후보가 변경됐습니다.");
        continue;
      }
      tx.create(refs.alimtalkCandidate(r.candidateId), r);
    }
  });
  for (const r of prepared) {
    checkTime();
    const link = await ensureShortLink({type:"method_material",targetUrl:material,sourceId:r.candidateId});
    assert(link.linkId === r.payload?.shortLinkId,"수업자료 링크 ID 불일치");
    await upsertInstructorLessonParkingPreRegistration(r);
  }
  const result = await dispatchManualInstructorD1({ approval:old,proof:manualInstructorD1ApprovalProof(old),confirmedBy:who,
    proveDeliveredSample: a=>confirmSample(a.sampleSolapiMessageId||"") });
  console.log(JSON.stringify({lessonDate,managementNumber,...result,note:"sent는 제공사 접수 기준이며 최종 전달은 별도로 확인하세요."}));
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : "수동 발송 보류"); process.exitCode=1; });
