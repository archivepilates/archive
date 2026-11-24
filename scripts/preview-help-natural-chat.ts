import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {createServer,type ServerResponse} from "node:http";
import {extname,resolve} from "node:path";
import {generatePublicNaturalChat,parsePublicNaturalChat} from "../firebase/kangsain-functions/functions/src/memberInquiries/publicNaturalChat";

const port=Number(process.argv[2]??57392);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error("Invalid preview port");
const host="127.0.0.1:"+port, origin="http://"+host;
const root=resolve(__dirname,"../help");
const key=execFileSync("gcloud",["secrets","versions","access","latest","--secret=HELP_PUBLIC_OPENAI_API_KEY",
  "--project=archive-pilates","--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com"],
  {encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:15000});
const mime:Record<string,string>={".html":"text/html",".css":"text/css",".js":"text/javascript",
  ".json":"application/json",".png":"image/png",".svg":"image/svg+xml",".jpg":"image/jpeg",".webmanifest":"application/manifest+json"};
let slots:number[]=[];
function send(res:ServerResponse,status:number,data:object){
  res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(JSON.stringify(data));
}
createServer(async(req,res)=>{
  try{
    if(req.headers.host!==host){send(res,403,{ok:false});return;}
    const url=new URL(req.url??"/",origin);
    if(url.pathname==="/api/public-chat-intent"){
      if(req.method==="GET"&&url.searchParams.get("capabilities")==="natural"){send(res,200,{natural:true});return;}
      if(req.method!=="POST"||req.headers.origin!==origin||req.headers["content-type"]!=="application/json"){
        send(res,403,{ok:false});return;
      }
      const chunks:Buffer[]=[];
      let bytes=0;
      for await(const chunk of req){
        bytes+=chunk.length;
        if(bytes>3600){send(res,400,{ok:false});return;}
        chunks.push(chunk);
      }
      const turn=parsePublicNaturalChat(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if(!turn){send(res,400,{ok:false});return;}
      const now=Date.now();
      slots=slots.filter(time=>now-time<86_400_000);
      if(slots.length>=20||slots.filter(time=>now-time<60_000).length>=4){send(res,429,{ok:false});return;}
      slots.push(now);
      const answer=await generatePublicNaturalChat(turn,key);
      send(res,answer?200:503,answer?{ok:true,...answer}:{ok:false});
      return;
    }
    if(req.method!=="GET"||!/^[\/\w.\-]+$/.test(url.pathname)){send(res,404,{ok:false});return;}
    const file=resolve(root,"."+url.pathname+(url.pathname.endsWith("/")?"index.html":""));
    if(!file.startsWith(root+"/")){send(res,404,{ok:false});return;}
    const body=await readFile(file);
    res.writeHead(200,{"Content-Type":mime[extname(file)]??"application/octet-stream","Cache-Control":"no-store"});
    res.end(body);
  }catch{send(res,404,{ok:false});}
}).listen(port,"127.0.0.1",()=>console.log(origin));
