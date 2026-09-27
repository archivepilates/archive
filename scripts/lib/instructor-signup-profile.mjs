import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID, normalizeInstructorLessonName, normalizeInstructorLessonPhone } from './instructor-lesson-registration-contract.mjs';

export const SIGNUP_PROFILE_VERSION = 1;
export const SIGNUP_PROFILE_FIELDS = Object.freeze({
  memberName: 'ozinput_26', birthDate: 'ozinput_27', memberPhone: 'ozinput_28',
  affiliation: 'ozinput_29', career: 'ozinput_30', address: 'ozinput_31',
});
const text = value => String(value || '').trim();
export function normalizeSignupBirthDate(value, now = new Date()) {
  let raw = text(value);
  if (!raw) return '';
  if (/^\d{6}$/.test(raw)) {
    // YYMMDD uses the most recent non-future century; never guess other formats.
    const yy = Number(raw.slice(0, 2));
    const year = yy <= now.getUTCFullYear() % 100 ? 2000 + yy : 1900 + yy;
    raw = `${year}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
  } else if (/^\d{8}$/.test(raw)) raw = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  else {
    const match = raw.match(/^(\d{4})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})\s*일?$/);
    if (match) raw = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== raw || parsed > now
    || Number(raw.slice(0, 4)) < now.getUTCFullYear() - 100) {
    throw new Error('가입서 생년월일 형식·유효 날짜 확인필요');
  }
  return raw;
}

export function parseSignupProfile(fields, job, documentId, now = new Date()) {
  const name = normalizeInstructorLessonName(fields.memberName);
  const phone = normalizeInstructorLessonPhone(fields.memberPhone);
  if (!/^[a-f0-9]{32}$/i.test(documentId) || documentId !== job.documentId
    || !/^\d+$/.test(String(job.studiomateMemberId || '')) || job.studioId !== '5330'
    || !/^010\d{8}$/.test(phone) || phone !== normalizeInstructorLessonPhone(job.memberPhone)
    || !name || name !== normalizeInstructorLessonName(job.memberName)) {
    throw new Error('완료 가입서 문서·회원 ID·이름·연락처 불일치: 정보 반영 중단');
  }
  const profile = { version: SIGNUP_PROFILE_VERSION, documentId, templateId: INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID,
    memberName: name, memberPhone: phone, birthDate: normalizeSignupBirthDate(fields.birthDate, now) };
  for (const key of ['affiliation', 'career', 'address']) {
    const value = text(fields[key]);
    if (value.length > 1000) throw new Error('가입서 작성내용 길이 확인필요');
    profile[key] = value;
  }
  return profile;
}

export async function readCompletedSignupProfile(page, job, evidence) {
  const url = new URL(evidence.href, 'https://www.eformsign.com');
  if (!evidence.found || !/^(?:완료|Completed)\s/i.test(evidence.text) || evidence.documentId !== job.documentId
    || url.origin !== 'https://www.eformsign.com' || url.pathname !== '/eform/document/view_service.html'
    || url.searchParams.get('document_id') !== job.documentId
    || url.searchParams.get('form_id') !== INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID) {
    throw new Error('완료 가입서 문서·템플릿 원본 확인필요');
  }
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#viewer_frame').waitFor({ state: 'attached', timeout: 30000 });
  const frame = page.frameLocator('#viewer_frame');
  await frame.locator(`#${SIGNUP_PROFILE_FIELDS.memberName}`).waitFor({ state: 'visible', timeout: 30000 });
  const viewer = await (await page.locator('#viewer_frame').elementHandle()).contentFrame();
  await viewer.waitForFunction(({ ids, name, phone }) => {
    const normalize = value => String(value || '').replace(/[\s-]/g, '');
    return normalize(document.getElementById(ids.memberName)?.value) === normalize(name)
      && normalize(document.getElementById(ids.memberPhone)?.value) === normalize(phone);
  }, { ids: SIGNUP_PROFILE_FIELDS, name: job.memberName, phone: job.memberPhone }, { timeout: 20000 });
  const fields = {};
  for (const [key, id] of Object.entries(SIGNUP_PROFILE_FIELDS)) {
    const field = frame.locator(`#${id}`);
    await field.waitFor({ state: 'visible', timeout: 30000 });
    if (await field.count() !== 1) throw new Error('가입서 입력 항목 중복 확인필요');
    fields[key] = await field.inputValue();
  }
  return parseSignupProfile(fields, job, evidence.documentId);
}

export function signupProfileMemo(profile) {
  return ['[ARCHIVE PILATES 강사회원 가입서 정보]',
    `강사 경력: ${profile.career || '미기재'}`, `소속: ${profile.affiliation || '미기재'}`,
    `주소: ${profile.address || '미기재'}`, `이폼싸인 문서: ${profile.documentId}`].join('\n');
}

export function signupProfileMemoPresent(body, content) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  return Boolean(normalize(content) && normalize(body).includes(normalize(content)));
}

export function birthDateWriteDecision(current, expected) {
  if (!expected) return 'not_provided';
  if (!text(current)) return 'write';
  if (text(current) === expected) return 'already_equal';
  throw new Error('StudioMate 기존 생년월일과 가입서가 다릅니다. 덮어쓰지 않고 확인필요');
}

export function assertSignupProfileSource(job, source, registration) {
  const profile = source?.submittedProfile;
  if (!profile || source.status !== 'done' || profile.version !== SIGNUP_PROFILE_VERSION
    || profile.documentId !== source.documentId
    || profile.templateId !== INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID
    || source.profileMemoJobId !== job.jobId || job.jobId !== `instructor_member_profile_${source.documentId}`
    || job.source !== 'instructor_member_eformsign' || job.studioId !== '5330'
    || source.studioId !== job.studioId || registration?.studioId !== job.studioId
    || job.registrationId !== source.registrationId
    || job.profileUpdate?.documentId !== source.documentId || job.profileUpdate?.version !== profile.version
    || job.profileUpdate?.birthDate !== profile.birthDate
    || String(job.memberId) !== String(source.studiomateMemberId)
    || String(job.studiomateMemberId) !== String(source.studiomateMemberId)
    || String(registration?.studiomateMemberId || registration?.evidence?.studiomateMemberId || '') !== String(source.studiomateMemberId)
    || normalizeInstructorLessonPhone(job.memberPhone) !== normalizeInstructorLessonPhone(source.memberPhone)
    || normalizeInstructorLessonPhone(registration?.memberPhone) !== profile.memberPhone
    || normalizeInstructorLessonName(job.memberName) !== normalizeInstructorLessonName(source.memberName)
    || normalizeInstructorLessonName(registration?.memberName) !== profile.memberName
    || !job.content?.endsWith(signupProfileMemo(profile))) throw new Error('가입서 정보 반영 원천 불일치: 확인필요');
  parseSignupProfile(profile, source, source.documentId);
  return profile;
}

export async function applySignupBirthDate(page, job, memberId, baseUrl) {
  const expected = job.profileUpdate;
  if (!expected) return 'not_requested';
  if (job.source !== 'instructor_member_eformsign' || job.studioId !== '5330'
    || !/^\d+$/.test(memberId) || memberId !== String(job.studiomateMemberId || '')
    || normalizeSignupBirthDate(expected.birthDate) !== expected.birthDate) throw new Error('가입서 생년월일 반영 원천 확인필요');
  const detailUrl = new URL(`/users/detail?id=${encodeURIComponent(memberId)}`, baseUrl).href;
  if (new URL(detailUrl).origin !== 'https://arcpilates.studiomate.kr') throw new Error('StudioMate 대상 센터 불일치');
  const openEditor = async () => {
    await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.getByRole('heading', { name: job.memberName, exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '회원정보 수정', exact: true }).click();
    const textbox = placeholder => page.getByRole('textbox').and(page.getByPlaceholder(placeholder, { exact: true })).filter({ visible: true });
    const phone = textbox('휴대폰 번호');
    await phone.waitFor({ state: 'visible' });
    await page.waitForFunction(({ expectedPhone }) => {
      const input = [...document.querySelectorAll('input[placeholder="휴대폰 번호"]')].find(element => element.getClientRects().length > 0);
      return String(input?.value || '').replace(/\D/g, '') === expectedPhone;
    }, { expectedPhone: normalizeInstructorLessonPhone(job.memberPhone) }, { timeout: 20000 });
    if (normalizeInstructorLessonPhone(await phone.inputValue()) !== normalizeInstructorLessonPhone(job.memberPhone)
      || normalizeInstructorLessonName(await textbox('이름을 입력해주세요').inputValue()) !== normalizeInstructorLessonName(job.memberName)
      || new URL(page.url()).searchParams.get('id') !== memberId) throw new Error('StudioMate 회원 이름·연락처·ID 불일치: 반영 중단');
    return textbox('생년월일 (YYYY-MM-DD)');
  };
  const field = await openEditor();
  const decision = birthDateWriteDecision(await field.inputValue(), expected.birthDate);
  if (decision !== 'write') return decision;
  await field.fill(expected.birthDate);
  await field.press('Tab');
  await page.getByRole('button', { name: '회원 수정 완료', exact: true }).click();
  await page.waitForURL(detailUrl, { timeout: 30000 });
  const verified = await openEditor();
  if (await verified.inputValue() !== expected.birthDate) throw new Error('StudioMate 생년월일 저장 후 재조회 불일치: 확인필요');
  return 'verified';
}
