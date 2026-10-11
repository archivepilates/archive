export const HEALTH_WEB_SURFACES = [
  ...[
    ['', '홈', '<title>ARCHIVE CORE</title>'],
    ['staff/', '강사', '<title>Staff · ARCHIVE CORE</title>'],
    ['private/', '프라이빗', '<title>프라이빗 · ARCHIVE CORE</title>'],
    ['sequence/', '시퀀스 노트', '<title>시퀀스 노트 · ARCHIVE CORE</title>'],
    ['instructor-lessons/', '강사레슨', '<title>강사레슨 · ARCHIVE CORE</title>'],
    ['member-registration/', '회원등록', '<title>회원등록 · ARCHIVE CORE</title>'],
    ['messages/', '알림톡', '<title>Messages · ARCHIVE CORE</title>'],
    ['recommended-meals/', '추천식단', '<title>추천식단 · ARCHIVE CORE</title>'],
    ['video-analytics/', '영상 시청', '<title>영상 시청 현황 · ARCHIVE CORE</title>'],
    ['refunds/', '환불', '<title>환불 · ARCHIVE CORE</title>'],
    ['business/', '경영', '<title>Business · ARCHIVE CORE</title>'],
    ['automation/', '자동화 관제', '<title>Automation · ARCHIVE CORE</title>'],
    ['rules/', '운영규칙', '<title>Rules · ARCHIVE CORE</title>'],
    ['imports/', '원본', '<title>Imports · ARCHIVE CORE</title>'],
    ['settings/', '설정', '<title>Settings · ARCHIVE CORE</title>'],
  ].map(([route, name, marker]) => ({ area: 'core', title: `ARCHIVE CORE ${name}`, url: `https://core.archivepilates.com/${route}`, marker })),
  { area: 'private', title: '회원 프라이빗 사전설문', url: 'https://in.archivepilates.com/privateSurvey/', marker: '<title>ARCHIVE PILATES 프라이빗 사전설문</title>' },
  { area: 'private', title: '강사 프라이빗 기록', url: 'https://in.archivepilates.com/private-chart/', marker: '<title>ARCHIVE PILATES Private Chart</title>' },
  { area: 'welcome', title: '기존 회원가입 계약 열람', url: 'https://in.archivepilates.com/memberSignup/', marker: '<title>ARCHIVE PILATES 회원가입서</title>' },
];

export async function probeWebSurface(target, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const started = Date.now();
  try {
    const response = await fetchImpl(target.url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    const statusOk = response.status >= 200 && response.status < 300;
    const markerOk = text.includes(target.marker);
    return { ...target, ok: statusOk && markerOk, status: response.status, markerOk,
      ms: Date.now() - started, verification: 'public_shell_only',
      ...(!statusOk ? { error: `HTTP ${response.status}` } : !markerOk ? { error: '예상 페이지 식별 문구 누락' } : {}) };
  } catch (error) {
    return { ...target, ok: false, status: 0, ms: Date.now() - started, verification: 'public_shell_only', error: error instanceof Error ? error.message : String(error) };
  }
}
