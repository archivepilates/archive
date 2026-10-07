import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = fs.readFileSync(path.join(root, "core/assets/app.js"), "utf8");
const startup = 'if (document.querySelector("[data-firestore-dashboard]")) refresh();';
const refreshBinding = 'qs("refreshButton")?.addEventListener("click", refresh);';
if (!source.includes(startup) || !source.includes(refreshBinding)) throw new Error("CORE preview startup contract changed");

// This localhost-only fixture never initializes Firebase or connects to production.
const fixture = `
function renderPrivatePreview() {
  const scenario = new URL(location.href).searchParams.get("scenario") || "populated";
  setText("connectionLabel", "로컬 테스트");
  setText("connectionDetail", "합성 데이터 · 외부 연결 없음");
  if (scenario === "loading") return;
  setReadState("privateLessonSessions", scenario === "error" ? "unavailable" : "success");
  const at = (days, hour) => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hour, 0, 0, 0); return date.toISOString(); };
  const session = (id, stage, extra = {}) => ({ id, sessionId: id, memberId: "fixture-member", memberName: "샘플회원", staffName: "샘플강사", sessionNumber: 12, roundVerified: true, lessonStartAt: at(0, 11), workflowStage: stage, ...extra });
  state.privateSessions = scenario === "empty" ? [] : [
    session("record", "recording"),
    session("processing", "report_review", { reportStatus: "processing" }),
    session("review", "report_review", { reportStatus: "ready", postStatus: "submitted" }),
    session("delivered", "delivered", { deliveryStatus: "sent" }),
    session("needs-review", "needs_review", { roundVerified: false, lastError: "fixture" }),
    session("long", "recording", { memberName: "아주긴이름의샘플회원명줄바꿈확인", staffName: "긴이름의샘플강사", sessionNumber: 123 }),
    session("overdue", "recording", { lessonStartAt: at(-1, 20), memberName: "미처리샘플회원" }),
    session("cancelled", "cancelled"),
  ];
  if (scenario === "many") state.privateSessions.push(...Array.from({ length: 25 }, (_, i) => session("extra-" + i, "recording")));
  renderPrivate([], [], [], [], [], state.privateSessions);
}
renderPrivatePreview();
`;

const assets = new Map([
  ["/private/private.css", "core/private/private.css"],
  ["/assets/styles.css", "core/assets/styles.css"],
]);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'");
  if (url.pathname === "/private/" || url.pathname === "/private/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const html = fs.readFileSync(path.join(root, "core/private/index.html"), "utf8")
      .replace('<script src="../firebase-config.js"></script>', "")
      .replace('src="../assets/app.js"', 'src="/preview-app.js"');
    res.end(html);
  } else if (url.pathname === "/preview-app.js") {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.end(source.replace(startup, "").replace(refreshBinding, 'qs("refreshButton")?.addEventListener("click", renderPrivatePreview);') + fixture);
  } else if (assets.has(url.pathname) || /^\/icons\/[a-z0-9.-]+\.png$/.test(url.pathname)) {
    const file = path.join(root, assets.get(url.pathname) || `core${url.pathname}`);
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", file.endsWith(".css") ? "text/css; charset=utf-8" : "image/png");
    res.end(fs.readFileSync(file));
  } else {
    res.writeHead(404).end("Preview route only");
  }
});
const port = Number(process.env.PORT || 4387);
server.listen(port, "127.0.0.1", () => console.log(`Private UI preview: http://127.0.0.1:${port}/private/`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
