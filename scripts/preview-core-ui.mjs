#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../core/", import.meta.url));
const requestedPort = Number(process.env.PORT || 4180);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };

// Local, inert presentation fixtures. The production HTML and auth remain untouched.
const client = `
import "/assets/app.js";
document.getElementById("coreLoginGate")?.remove();
const put = (id, html) => { const node = document.getElementById(id); if (node) node.innerHTML = html; };
put("connectionLabel", "미리보기");
put("connectionDetail", "예시 데이터");
put("commandQueueStatus", "확인할 업무 2건");
const row = (title, note, status = "확인필요") => '<article class="status-row"><div><strong>' + title + '</strong><p>' + note + '</p></div><span class="pill warn">' + status + '</span></article>';
put("homeDecisionList", row("회원등록", "가입서 작성 대기 1건") + row("프라이빗 리포트", "발송 전 검토 1건"));
put("renewalPipelineList", row("예시 회원", "그룹 30회 · 잔여 3회 · 재등록 상담"));
put("memberRegistrationList", row("예시 회원", "일반회원 · 10주 주2회 · 가입서 작성 대기"));
put("instructorLessonRegistrationList", row("예시 강사", "10월 24일 · 강사레슨 (2T) · 수강권 발급 완료", "가입서 대기"));
put("privateInstructorPendingList", row("예시 강사", "오늘 기록 2건"));
put("privateProgressList", '<section class="stage-column stage-recording"><div class="stage-column-header"><strong>기록 대기</strong><span>1건</span></div><article class="stage-card"><strong>예시 회원</strong><p>10.08 20:00 · 프라이빗 8회차</p><span class="pill">기록 대기</span></article></section><section class="stage-column stage-review"><div class="stage-column-header"><strong>확인 후 발송</strong><span>1건</span></div><article class="stage-card"><strong>예시 회원</strong><p>10.08 21:00 · 프라이빗 12회차</p><span class="pill warn">리포트 검토</span></article></section>');
put("instructorLessonScheduleSummary", "2개 일정 · 잔여 6석");
put("instructorLessonScheduleList", [24,25].map(day => '<article class="instructor-seat-item"><div class="instructor-seat-item-head"><div><strong>10월 ' + day + '일</strong><span>13:00 - 15:10</span></div><span class="pill good">잔여 3석</span></div><div class="instructor-seat-counts"><span><small>접수</small><strong>7</strong></span><span><small>정원</small><strong>10</strong></span><span><small>남은 좌석</small><strong>3</strong></span></div><div class="instructor-seat-progress"><span style="width:70%"></span></div></article>').join(""));
document.querySelectorAll(".metric-value,.private-metric strong").forEach(node => node.textContent = "2");
document.querySelectorAll(".empty-state").forEach(node => { if (/불러|확인 중|연결/.test(node.textContent)) node.textContent = "예시 내역 없음"; });
document.querySelectorAll("a[href]").forEach(link => {
  if (new URL(link.href).origin !== location.origin) {
    link.removeAttribute("href"); link.removeAttribute("target");
    link.title = "미리보기에서는 외부 연결을 열지 않습니다";
  }
});
document.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
document.addEventListener("click", event => {
  const link = event.target.closest("a");
  if (link && new URL(link.href).origin !== location.origin) { event.preventDefault(); event.stopImmediatePropagation(); }
  const button = event.target.closest("button");
  if (button && !button.matches("#commandPaletteOpen,.mobile-nav-toggle,.nav-more-button,.command-palette-close")) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
`;

const server = http.createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'");
  try {
    if (!["GET", "HEAD"].includes(request.method) || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host || "")) {
      response.writeHead(403); response.end(); return;
    }
    const pathname = path.posix.normalize(decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname));
    let data;
    let contentType;
    if (pathname === "/firebase-config.js") {
      data = "window.KANGSAIN_FIREBASE_CONFIG = {};";
      contentType = types[".js"];
    } else if (pathname === "/__preview.js") {
      data = client;
      contentType = types[".js"];
    } else {
      const file = path.resolve(root, `.${pathname}`, pathname.endsWith("/") ? "index.html" : "");
      if (!file.startsWith(root)) throw Error("Outside preview root");
      data = await fs.readFile(file);
      contentType = types[path.extname(file)] || "application/octet-stream";
      if (file.endsWith(".html")) {
        data = data.toString().replace(/\sdata-firestore-dashboard\b/, "")
          .replace("</head>", '<script type="module" src="/__preview.js"></script></head>')
          .replace(/(<body\b[^>]*>)/, '$1<aside style="padding:8px 16px;background:#eef4fa;color:#35658f;font:13px/1.5 sans-serif">디자인 미리보기 · 예시 데이터 · 저장 및 발송 차단</aside>');
      }
    }
    response.writeHead(200, { "Content-Type": contentType });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch { response.writeHead(404); response.end("Not found"); }
});
server.on("error", error => {
  if (error.code === "EADDRINUSE") server.listen(0, "127.0.0.1");
  else { console.error(error); process.exitCode = 1; }
});
server.listen(requestedPort, "127.0.0.1", () => console.log(`ARCHIVE CORE UI preview: http://127.0.0.1:${server.address().port}/`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
