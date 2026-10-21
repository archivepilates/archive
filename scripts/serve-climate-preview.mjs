import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../core");
const port = Number(process.env.PORT || 4193);
const demoBoot = `
document.documentElement.dataset.coreAccess = "manager";
document.querySelector("#coreAccessLoading")?.remove();
document.title = "에어컨 로컬 미리보기 · 가상 기기";
const qaBanner = document.createElement("p");
qaBanner.textContent = "로컬 미리보기 · 가상 기기 · 실제 에어컨과 연결되지 않습니다";
qaBanner.style.cssText = "margin:0 0 16px;color:#9c2626;font-size:13px";
document.querySelector("[data-climate-dashboard]").prepend(qaBanner);
const qaTime = () => new Date().toISOString();
const qaRooms = ["QA 회의실", "QA 리포머", "QA 프라이빗", "QA 체어", "QA 상담실", "QA 바렐", "QA 데스크", "QA 샤워실"];
const qaUnits = qaRooms.map((name,i)=>({deviceId:"qa-"+i,name,model:"LG ThinQ · 가상 기기",checkedAt:qaTime(),version:"a".repeat(64),
available:true,errorCode:null,pendingCommand:null,values:{power:i%2?"POWER_OFF":"POWER_ON",mode:"COOL",targetTemperature:24,currentTemperature:25+i*.5,humidity:50+i,
fan:"LOW",swingVertical:false,swingHorizontal:null,powerSave:false},controls:[
{field:"power",kind:"enum",values:["POWER_ON","POWER_OFF"]},{field:"mode",kind:"enum",values:["COOL","HEAT","AUTO","AIR_DRY","FAN"]},
{field:"targetTemperature",kind:"range",min:16,max:30,step:.5},{field:"fan",kind:"enum",values:["LOW","MID","HIGH","AUTO"]},
{field:"swingVertical",kind:"boolean",values:[true,false]},{field:"powerSave",kind:"boolean",values:[true,false]}]}));
const qaUser={uid:"local-preview-only"};
const qaRuntime={authClient:{currentUser:qaUser},functionsClient:{},httpsCallable(_client,name){return async data=>{
if(name==="getCoreAirConditioners")return {data:{checkedAt:qaTime(),devices:structuredClone(qaUnits)}};
if(name==="operatorControlCoreAirConditioner"){
const d=qaUnits.find(d=>d.deviceId===data.deviceId);d.values[data.field]=data.value;d.checkedAt=qaTime();
return {data:{commandId:data.commandId,status:"verified",device:structuredClone(d)}};}
throw new Error("Preview supports synthetic operations only");};}};
const {mountClimate}=await import("./climate.js");
mountClimate(document.querySelector("[data-climate-dashboard]"),()=>qaRuntime);
`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    let relative = decodeURIComponent(url.pathname);
    if (relative === "/") { res.writeHead(302, { Location: "/climate/" }).end(); return; }
    if (!relative.startsWith("/climate/") && !relative.startsWith("/assets/") && !relative.startsWith("/icons/")
      && !["/favicon.ico", "/firebase-config.js", "/site.webmanifest"].includes(relative)) { res.writeHead(404).end(); return; }
    if (relative.endsWith("/")) relative += "index.html";
    const file = path.resolve(root, `.${relative}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    let content = await fs.readFile(file);
    if (relative === "/assets/app.js") {
      const source = content.toString();
      if (!source.endsWith("refresh();\n")) throw new Error("Unrecognized production bootstrap; preview disabled");
      content = Buffer.from(source.slice(0, -"refresh();\n".length) + demoBoot);
    } else if (relative === "/firebase-config.js") content = Buffer.from("// No Firebase credentials or endpoints in preview.\n");
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
    res.writeHead(200, { "Content-Type": `${mime[path.extname(file)] || "application/octet-stream"}; charset=utf-8`,
      "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'" });
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
server.listen(port, "127.0.0.1", () => console.log(`Synthetic climate preview: http://127.0.0.1:${port}/climate/`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
});
