#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "docs/tasks/2026-10-22-method9-content.json"), "utf8"));
const revision = createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
const checkOnly = process.argv.includes("--check");
const escape = (text = "") => text.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
const write = (file, text) => {
  const expected = `${text}\n`;
  if (checkOnly) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expected) {
      throw new Error(`Generated cue card is out of sync: ${path.relative(root, file)}. Run npm run build:method9-cuecards.`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, expected);
};
const section = (number, id, title, body) => `<section aria-labelledby="${id}"><div class="section-head"><span class="section-num">${number}</span><h2 class="section-title" id="${id}">${title}</h2></div>${body}</section>`;
const phase = (item) => `<article class="phase-card"><div class="phase-head"><div class="phase-mark">${item.mark}</div><div class="phase-title"><h3>${item.title}</h3><p>${item.focus}</p></div></div><ol class="move-list">${item.moves.map((move) => `<li><h4 class="move-name">${escape(move.title)}</h4>${move.setup ? `<p class="move-setup">${escape(move.setup)}</p>` : ""}${move.steps.length ? `<div class="move-steps">${move.steps.map((step) => `<p>${escape(step)}</p>`).join("")}</div>` : ""}<p class="move-focus">${escape(move.focus)}</p></li>`).join("")}</ol></article>`;

function page(lesson, standalone = false) {
  const assets = path.join(root, "archivein/method/assets");
  const styles = ["method-access.css", "support-movement-card.css", "external-feedback-card.css"];
  const css = standalone ? `<style>${styles.map((name) => fs.readFileSync(path.join(assets, name), "utf8")).join("\n")}</style>` : styles.map((name) => `<link rel="stylesheet" href="../assets/${name}">`).join("\n");
  const symbol = standalone ? `data:image/png;base64,${fs.readFileSync(path.join(root, "archivein/logo120.png")).toString("base64")}` : "../../logo120.png";
  const sequence = `<div class="tabs" role="tablist" aria-label="강사별 시퀀스">${data.instructors.map((teacher, i) => `<button id="tab-${teacher.id}" class="tab${i === 0 ? " active" : ""}" type="button" role="tab" aria-controls="pane-${teacher.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-method-tab="${teacher.id}">${teacher.name}<span>${teacher.apparatus}</span></button>`).join("")}</div>${data.instructors.map((teacher, i) => `<div id="pane-${teacher.id}" class="pane${i === 0 ? " on" : ""}" role="tabpanel" aria-labelledby="tab-${teacher.id}" data-method-pane="${teacher.id}" tabindex="0"${i === 0 ? "" : " hidden"}><p class="teacher-intro">${teacher.intro}</p><p class="practice-note">${teacher.safety}</p><div class="phase-list">${teacher.phases.map(phase).join("\n")}</div></div>`).join("\n")}`;
  const concepts = `<p class="section-lead">${data.series.lead}</p><div class="lesson-contrast"><p>${data.series.previous}</p><p>${data.series.current}</p></div><div class="concept-grid">${data.concepts.map((item) => `<article class="concept"><b>${item.title}</b><p>${item.body}</p></article>`).join("")}</div><p class="theory-note">${data.loadNote}</p><p class="theory-note">${data.distinction}</p>`;
  const flow = `<div class="flow">${data.flow.map((item) => `<div class="flow-step"><b>${item.title}</b><span>${item.body}</span></div>`).join("")}</div><div class="lesson-contrast">${data.instructors.map((teacher) => `<p><b>${teacher.name} · ${teacher.apparatus}</b><br>${teacher.connection}</p>`).join("")}</div><p class="theory-note">설명을 덜고 같은 동작을 다시 해보는 것은 수업 설계 제안입니다. 원본에 없는 동작을 추가하거나 안전을 위한 지지를 없애라는 뜻은 아닙니다.</p>`;
  const remember = `<div class="takeaways">${data.remember.map((item) => `<div class="take">${item}</div>`).join("")}</div><details class="references"><summary data-testid="references-toggle">참고 연구</summary><p>시리즈 이론 원본: <a href="https://www.notion.so/${data.series.sourceId.replaceAll("-", "")}" target="_blank" rel="noopener">${data.series.sourceTitle}</a></p><p>${data.series.note}</p><p>아래 연구는 수업 설계의 근거입니다. 이번 바렐·스틱·리포머·블럭 시퀀스의 효과를 직접 검증한 연구는 아니며, 동작별 해석은 원본 시퀀스에 연결한 적용 제안입니다.</p><ul>${data.references.map((ref) => `<li><a href="${ref.url}" target="_blank" rel="noopener">${escape(ref.label)}</a><p>${escape(ref.finding)}</p><p>${escape(ref.application)}</p></li>`).join("")}</ul></details>`;
  const script = standalone ? `<script>${fs.readFileSync(path.join(assets, "support-movement-card.js"), "utf8")}</script>` : `<script src="../assets/method-access.js"></script><script src="../assets/support-movement-card.js"></script>`;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>외부 피드백2 큐카드 | ARCHIVE METHOD #9</title><meta name="method-content-revision" content="${revision}">${standalone ? '<meta name="robots" content="noindex, nofollow, noarchive">' : ""}<meta name="theme-color" content="#f8faf9"><meta name="description" content="ARCHIVE METHOD #9 외부 피드백2. 바렐과 스틱, 리포머와 블럭으로 찾는 움직임의 기준.">${standalone ? "" : '<link rel="icon" href="../../logo120.png"><link rel="apple-touch-icon" href="../../apple-touch-icon.png">'}${css}</head>
<body${standalone ? ' data-method-access-state="preview"' : ` data-method-date="${lesson.date}" data-method-preview-code="${lesson.preview}" class="method-locked"`}>
${standalone ? "" : '<div class="method-gate" data-method-gate aria-live="polite"><p data-method-gate-message>수업자료는 수업 당일 12시에 공개됩니다.</p></div>'}
<div class="method-content" data-method-content><div class="progress" id="progress" aria-hidden="true"></div><button class="topbtn" id="topbtn" type="button" aria-label="맨 위로" title="맨 위로">↑</button><main class="page">
<header class="top"><img class="brand-symbol" src="${symbol}" width="44" height="44" alt="ARCHIVE PILATES"><div class="kicker">ARCHIVE METHOD #9${standalone ? " · STAFF PREVIEW" : ""}</div><h1 class="title">${data.topic}</h1><p class="sub">${data.subtitle}</p><p class="lesson-meta">${standalone ? "2026. 10. 24. (토) / 25. (일)" : lesson.label} · 13:00~15:10</p><p class="apparatus">민진T 바렐 + 스틱 · 은영T 리포머 + 블럭<br>두 세션 모두 수강 · 팀별 수강 순서 교차</p><div class="hero-note"><strong>오늘의 핵심</strong><p>${data.core}</p></div></header>
${section("01", "sequence-title", "수업 시퀀스", sequence)}
${section("02", "concept-title", "도구가 알려주는 것", concepts)}
${section("03", "flow-title", "느낌을 내 움직임으로", flow)}
${section("04", "remember-title", "수업 후 기억할 것", remember)}
<section class="video-cta"><div class="tag">ARCHIVE METHOD VIDEO</div><h2>수업 후 영상으로 다시 만나세요</h2><p>ARCHIVE PILATES 홈페이지 가입 후 시청 권한이 연결되면 내 강의실에서 수업촬영영상을 볼 수 있습니다.</p><div class="join-actions"><a class="join-button" href="https://archivepilates.imweb.me/?mode=join&amp;back_url=LzQ4" target="_blank" rel="noopener">ARCHIVE PILATES 홈페이지 가입하기</a><p class="join-note">가입 후 스태프가 수업 영상 시청 권한을 연결합니다.</p></div></section>
<footer>ARCHIVE PILATES · ARCHIVE METHOD #9 · ${standalone ? "2610 STAFF PREVIEW" : lesson.code}</footer>
</main></div>${script}</body></html>`;
}

for (const lesson of data.dates) write(path.join(root, `archivein/method/${lesson.code}/index.html`), page(lesson));
const staffPreview = page(data.dates[0], true);
write(path.join(root, "docs/reports/2026-10-22-method9-cuecard.html"), staffPreview);
write(path.join(root, "archivein/method/external-feedback-2610-preview/index.html"), staffPreview);

const mention = (id) => `<mention url="https://www.notion.so/${id.replaceAll("-", "")}" />`;
const theory = `## 오늘의 핵심
**${data.core}**

${data.subtitle}

## 수업 이론
### #8에서 이어지는 시리즈
이론 원본: ${mention(data.series.sourceId)}

${data.series.lead}

- ${data.series.previous}
- ${data.series.current}

${data.series.note}

도구로 동작을 더 어렵게 만드는 것이 아니라, 조절할 기준을 분명하게 만드는 수업입니다. #8의 공통 기준인 ‘잘 멈춰 있는가보다 변화를 알아차리고 필요한 만큼 조절할 수 있는가’를 그대로 유지합니다.

${data.concepts.map((item, i) => `### ${i + 1}. ${item.title}\n${item.body}`).join("\n\n")}

${data.loadNote}

### 구분해서 이해하기
${data.distinction}

## 두 시퀀스에 연결하기
### 민진T · 바렐 + 스틱
원본: ${mention("3e4d49ea-e4bf-80f7-91f3-d309f17fd972")}
${data.instructors[0].connection}

stick-Supported Side Bend와 Classical Side Sit-Up은 서로 다른 과제입니다. 차이를 스틱 유무만의 효과로 단정하지 않습니다. 스틱 Roll이 명시된 동작에서는 경로를 기준으로 삼되, 모든 동작에 스틱을 추가하지 않습니다.

### 은영T · 리포머 + 블럭
원본: ${mention("3e4d49ea-e4bf-8021-894b-e07d65403118")}
${data.instructors[1].connection}

Scooter는 발바닥 아래, Four-Point 두 동작은 무릎 아래, Prone Arm Pull은 얼굴 아래, Tendon Stretch는 캐리지와 발 접지면 사이에 블럭을 둔다는 원본을 반영했습니다. 명시되지 않은 동작의 블럭 위치는 정하지 않았습니다.

블럭 위치·높이를 바꾸면 접촉감뿐 아니라 지지 높이와 하중 조건도 바뀝니다. 비교할 때는 감각 효과와 기계적 도움을 구분합니다.

## 수업 적용 흐름
${data.flow.map((item, i) => `${i + 1}. **${item.title}**: ${item.body}`).join("\n")}

설명 없이 같은 안전한 과제를 다시 해보는 것은 이론에서 제안하는 학습 확인 방법입니다. 원본 시퀀스의 추가 동작이나 소도구 제거 지시가 아닙니다. 바로 잘된 것만으로 학습이 완성됐다고 보지 않고, 쉬었다가 또는 다음 수업에서 같은 기준을 다시 찾는지도 봅니다.

## 진행 시 확인
- ${data.instructors[0].safety}
- ${data.instructors[1].safety}
- Hanging Leg Raise는 원본 Cool Down에 그대로 두되 부하가 있는 동작으로 구분합니다. 통증·어지럼·조절 상실이 있으면 중단하고 담당 강사가 세팅과 범위를 조정합니다.
- 스프링, 블럭 높이, 스틱 세부 세팅, 반복 횟수는 원본에 없어 임의로 처방하지 않았습니다.

## 수업 후 기억할 것
${data.remember.map((item) => `- ${item}`).join("\n")}

## 참고 연구
이번 소도구 시퀀스를 직접 검증한 연구가 아니라 수업 설계에 참고한 근거입니다. 아래 연구 결과와 위 동작별 적용 제안은 구분합니다.

${data.references.map((ref) => `### ${ref.label}\n[${ref.title}](${ref.url})\n\n${ref.finding}\n\n**수업 연결**: ${ref.application}`).join("\n\n")}

## 큐카드 제작 상태
민진T 11개 동작군·21개 세부 단계, 은영T 14개 동작을 원본 순서대로 반영했습니다. 시퀀스 상단 배치, 강사별 탭, 간결한 이론, 참고 연구, 영상 시청용 홈페이지 가입 버튼으로 구성했습니다.

24일·25일 자료는 각 수업일 정오 공개 안내를 적용한 배포용 파일로 제작했습니다. 스태프 프리뷰는 공개시간과 무관하게 검토할 수 있습니다. 프리뷰·수업일별 HTML·로컬 검토본은 공통 원본에서 함께 생성하고 동일한 내용 버전을 검사합니다. 수강생용 운영 주소 공개와 알림톡 연결·발송은 별도 승인 후 진행합니다.
`;
if (!checkOnly) write(path.join(root, "artifacts/method9-2610/notion-theory.txt"), theory);
console.log(`${checkOnly ? "Verified" : "Built"} 2 dated cue cards and 2 identical staff previews; content revision ${revision}.`);
