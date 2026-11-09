/** Local synthetic integration fixture only. Never deploy or use against production data/auth. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createInquiryService } from "../firebase/kangsain-functions/functions/src/memberInquiries/service";
import { InquiryError, type Actor } from "../firebase/kangsain-functions/functions/src/memberInquiries/policy";
import { memberInquiryContract as contract, memberInquirySchema } from "../firebase/packages/contracts/lib/member-inquiries";

const clone = <T>(value: T): T => value === undefined ? value : structuredClone(value);
type Filter = [string, string, unknown];
class Ref {
  readonly id: string;
  constructor(readonly db: FixtureDb, readonly path: string) { this.id = path.split("/").at(-1)!; }
  collection(name: string) { return new Query(this.db, `${this.path}/${name}`); }
  get() { return this.db.read(this); }
}
class Query {
  constructor(readonly db: FixtureDb, readonly path: string, readonly filters: Filter[] = [], readonly order: [string, string] | null = null,
    readonly after: string | null = null, readonly max: number | null = null) {}
  doc(id: string) { return new Ref(this.db, `${this.path}/${id}`); }
  where(field: string, op: string, value: unknown) { return new Query(this.db, this.path, [...this.filters, [field, op, value]], this.order, this.after, this.max); }
  orderBy(field: string, direction = "asc") { return new Query(this.db, this.path, this.filters, [field, direction], this.after, this.max); }
  startAfter(snap: { id: string }) { return new Query(this.db, this.path, this.filters, this.order, snap.id, this.max); }
  limit(max: number) { return new Query(this.db, this.path, this.filters, this.order, this.after, max); }
  get() { return this.db.read(this); }
}
class FixtureDb {
  readonly rows = new Map<string, any>();
  private serial: Promise<unknown> = Promise.resolve();
  doc(path: string) { return new Ref(this, path); }
  collection(path: string) { return new Query(this, path); }
  snapshot(path: string, source = this.rows) {
    const value = clone(source.get(path));
    return { id: path.split("/").at(-1)!, exists: source.has(path), data: () => clone(value) };
  }
  async read(ref: Ref | Query, source = this.rows): Promise<any> {
    if (ref instanceof Ref) return this.snapshot(ref.path, source);
    let docs = [...source.keys()].filter(path => path.startsWith(`${ref.path}/`) && path.slice(ref.path.length + 1).split("/").length === 1)
      .map(path => this.snapshot(path, source));
    docs = docs.filter(doc => ref.filters.every(([key, op, value]) => {
      if (op !== "==") throw new Error("Unsupported synthetic query");
      return doc.data()?.[key] === value;
    }));
    if (ref.order) {
      const [key, direction] = ref.order;
      docs.sort((a, b) => { const av = a.data()?.[key], bv = b.data()?.[key];
        const delta = av < bv ? -1 : av > bv ? 1 : a.id.localeCompare(b.id); return direction === "desc" ? -delta : delta; });
    }
    if (ref.after) { const index = docs.findIndex(doc => doc.id === ref.after); if (index < 0) throw new Error("Synthetic cursor missing"); docs = docs.slice(index + 1); }
    if (ref.max !== null) docs = docs.slice(0, ref.max);
    return { docs, size: docs.length };
  }
  runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const result = this.serial.then(async () => {
      const before = new Map([...this.rows].map(([path, row]) => [path, clone(row)]));
      const writes: Array<{ kind: string; path: string; data: any }> = [];
      const stage = (kind: string, ref: Ref, data: any) => writes.push({ kind, path: ref.path, data: clone(data) });
      const value = await fn({
        get: async (ref: Ref | Query) => { if (writes.length) throw new Error("Synthetic read after write"); return this.read(ref, before); },
        create: (ref: Ref, data: any) => stage("create", ref, data), update: (ref: Ref, data: any) => stage("update", ref, data),
        set: (ref: Ref, data: any) => stage("set", ref, data),
      });
      const after = new Map(before);
      for (const write of writes) {
        if (write.kind === "create" && after.has(write.path)) throw new Error("Synthetic create conflict");
        if (write.kind === "update" && !after.has(write.path)) throw new Error("Synthetic update missing");
        after.set(write.path, write.kind === "update" ? { ...after.get(write.path), ...write.data } : write.data);
      }
      this.rows.clear(); for (const [path, row] of after) this.rows.set(path, clone(row));
      return value;
    });
    this.serial = result.then(() => undefined, () => undefined); return result;
  }
}

const staff: Actor = { staffId: "test_staff", name: "테스트직원", studioId: "5330", role: "instructor", active: true, memberInquiryAccess: true };
const manager: Actor = { staffId: "test_manager", name: "테스트관리자", studioId: "5330", role: "manager", active: true };
const files: Record<string, string> = {
  "/": "help/index.html", "/help/": "help/index.html", "/privacy.html": "help/privacy.html",
  "/assets/app.js": "help/assets/app.js", "/assets/styles.css": "help/assets/styles.css", "/assets/categories.svg": "help/assets/categories.svg",
  "/assets/inquiry-schema.json": "help/assets/inquiry-schema.json", "/manifest.webmanifest": "help/manifest.webmanifest",
  "/favicon.png": "help/favicon.png", "/apple-touch-icon.png": "help/apple-touch-icon.png", "/robots.txt": "help/robots.txt",
  "/icons/icon-192.png": "help/icons/icon-192.png", "/icons/icon-512.png": "help/icons/icon-512.png",
  "/staff/": "core/inquiries/index.html", "/assets/member-inquiries.js": "core/assets/member-inquiries.js",
  "/assets/member-inquiries.css": "core/assets/member-inquiries.css", "/assets/member-inquiry-schema.json": "core/assets/member-inquiry-schema.json",
  "/assets/core-navigation.js": "core/assets/core-navigation.js", "/assets/core-navigation.css": "core/assets/core-navigation.css",
  "/icons/favicon-32.png": "core/icons/favicon-32.png", "/icons/archive-pilates-icon-192.png": "core/icons/archive-pilates-icon-192.png",
};
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8" };

export function syntheticStaffRuntime(source: string): string {
  const start = source.indexOf('  const version = window.ARCHIVE_CORE_FIREBASE_VERSION');
  const tail = '  runtime.auth.onAuthStateChanged(runtime.authClient, authenticate);';
  const end = source.indexOf(tail, start);
  if (start < 0 || end < 0) throw new Error("Staff initialize fixture marker changed; inspect source before previewing");
  return source.slice(0, start) + `
  // Synthetic local fixture: no Firebase SDK, credentials, authentication or production network.
  const actorRole = new URL(location.href).searchParams.get('role') === 'staff' ? 'staff' : 'manager';
  const currentUser = {uid:'synthetic-' + actorRole};
  const listeners = new Set();
  runtime = {
    authClient:{currentUser}, functionsClient:{synthetic:true},
    auth:{onAuthStateChanged(client,callback){listeners.add(callback);queueMicrotask(()=>callback(client.currentUser));return()=>listeners.delete(callback)},
      async signOut(client){client.currentUser=null;listeners.forEach(callback=>callback(null))}},
    httpsCallable(_client,name){return async data=>{
      if(name==='getCoreAccessSession') return {data:{role:actorRole==='manager'?'manager':'instructor',staffId:actorRole==='manager'?'test_manager':'test_staff',mustChangePassword:false}};
      if(name!=='memberInquiryStaff') throw new Error('Synthetic callable not allowed');
      const response=await fetch('/__test/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actorRole,data})});
      const result=await response.json();if(!response.ok||result.ok!==true)throw new Error(result.message||'Synthetic inquiry failure');return{data:result};
    }}};
  runtime.auth.onAuthStateChanged(runtime.authClient, authenticate);` + source.slice(end + tail.length);
}
function banner(path: string) {
  return `<aside style="padding:7px 14px;background:#fff3cc;color:#3b3320;font:12px/1.5 system-ui;text-align:center;overflow-wrap:anywhere" role="note">로컬 합성 테스트 · 실제 접수·인증·발송 없음 · 테스트회원001 / 01000000000만 사용 · <a href="/">회원 화면</a> · <a href="/staff/?role=staff">직원</a> · <a href="/staff/?role=manager">관리자</a>${path.startsWith("/staff") ? " · 역할은 테스트 픽스처입니다" : ""}</aside>`;
}
async function input(request: IncomingMessage): Promise<any> {
  if (!/^application\/json(?:;|$)/i.test(String(request.headers["content-type"] || ""))) throw new InquiryError(400, "JSON test request required");
  const chunks: Buffer[] = []; let size = 0;
  for await (const value of request) { const chunk = Buffer.from(value); size += chunk.length; if (size > 16384) throw new InquiryError(413, "Test request too large"); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new InquiryError(400, "Test JSON invalid"); }
}
function json(response: ServerResponse, status: number, body: unknown) { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify(body)); }

export function createMemberInquiryPreview(root = process.cwd()) {
  const db = new FixtureDb();
  const reset = () => {
    db.rows.clear(); db.rows.set(`staffs/${staff.staffId}`, clone(staff)); db.rows.set(`staffs/${manager.staffId}`, clone(manager));
    db.rows.set(contract.settingsPath, { enabled: true, promotionApproved: true, privacyApproved: true, retentionReady: true, studioId: contract.studioId,
      policyVersion: contract.policyVersion, privacyVersion: contract.privacyVersion, retentionDays: contract.retentionDays,
      defaultAssignees: Object.fromEntries(Object.keys(memberInquirySchema).map(key => [key, staff.staffId])) });
  };
  reset(); const service = createInquiryService({ db }); let origin = "";
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Robots-Tag", "noindex, nofollow"); response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      if (!["127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress || "")) throw new InquiryError(403, "Local synthetic preview only");
      if (request.headers.origin && request.headers.origin !== origin) throw new InquiryError(403, "Test origin rejected");
      const url = new URL(request.url || "/", origin || "http://127.0.0.1"), path = decodeURIComponent(url.pathname);
      if (path.split("/").some(part => part === ".." || part.includes("\\")) || /%2e|%2f|%5c/i.test(path)) throw new InquiryError(400, "Invalid test path");
      if (request.method === "POST" && path === "/api/inquiries") {
        const body = await input(request);
        if (body.action === "lookup") json(response, 200, await service.lookup(body, "synthetic-browser"));
        else if (body.action) throw new InquiryError(400, "Unknown public test action");
        else json(response, 200, await service.submit(body, "synthetic-browser"));
        return;
      }
      if (request.method === "POST" && path === "/__test/staff") {
        const body = await input(request);
        if (!["manager", "staff"].includes(body.actorRole)) throw new InquiryError(403, "Synthetic actor required");
        json(response, 200, await service.staff(body.actorRole === "manager" ? manager : staff, body.data)); return;
      }
      if (request.method === "POST" && path === "/__test/reset") { await input(request); reset(); json(response, 200, { ok: true, synthetic: true }); return; }
      if (request.method === "GET" && path === "/__test/state") {
        json(response, 200, { ok: true, synthetic: true, records: [...db.rows].filter(([key]) => key.startsWith(contract.requests + "/")).map(([path, value]) => ({ path, value })) }); return;
      }
      if (request.method !== "GET") throw new InquiryError(405, "Test method rejected");
      if (path === "/staff") { response.writeHead(302, { Location: "/staff/" }); response.end(); return; }
      if (path === "/firebase-config.js") { response.setHeader("Content-Type", types[".js"]); response.end("window.KANGSAIN_FIREBASE_CONFIG={synthetic:true};"); return; }
      if (!Object.hasOwn(files, path)) throw new InquiryError(404, "Test fixture file not allowed");
      const file = resolve(root, files[path]);
      const content = await readFile(file);
      response.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
      if (path === "/assets/member-inquiries.js") response.end(syntheticStaffRuntime(content.toString("utf8")));
      else if (extname(file) === ".html") response.end(content.toString("utf8").replace(/<body([^>]*)>/, `<body$1>${banner(path)}`));
      else response.end(content);
    } catch (error) {
      const known = error instanceof InquiryError;
      if (!known) console.error("Synthetic preview request failed:", error instanceof Error ? error.message : "unknown");
      json(response, known ? error.status : 503, { ok: false, synthetic: true, message: known ? error.message : "합성 테스트 연결을 확인해 주세요.", notAccepted: known });
    }
  });
  return { server, db, reset, async listen() {
    await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Synthetic local port unavailable");
    origin = `http://127.0.0.1:${address.port}`; return { origin, helpUrl: origin + "/", staffUrl: origin + "/staff/?role=staff", managerUrl: origin + "/staff/?role=manager" };
  } };
}

if (process.argv[1]?.endsWith("preview-member-inquiries.ts")) {
  const preview = createMemberInquiryPreview();
  preview.listen().then(urls => {
    console.log("SYNTHETIC LOCAL TEST ONLY — memory DB, no production auth, no external writes or sends.");
    console.log(JSON.stringify(urls));
  }).catch(error => { console.error(error instanceof Error ? error.message : "Synthetic preview failed"); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => preview.server.close(() => process.exit(0)));
}
