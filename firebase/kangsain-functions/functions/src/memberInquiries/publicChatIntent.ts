import type {Request} from "firebase-functions/v2/https";
import {db} from "../config/firebase";
import {defineSecret,projectID} from "firebase-functions/params";

export const helpPublicOpenAiApiKey = defineSecret("HELP_PUBLIC_OPENAI_API_KEY");
const allowedOrigins = new Set(["https://help.archivepilates.com", "https://archive-pilates-help.web.app"]);
const tags = ["schedule","price","hold","book","recommend","beginner","weekday","weekend","morning","afternoon","evening","frequency","followup"];
const topics = ["","schedule","pricing","holding","booking","plan"];
const intents = ["schedule","price","hold","book","recommend","unknown"] as const;
type Intent = typeof intents[number];
type Signals = {tags:string[]; context:string; day:number; time:number; frequency:number};
const model = "gpt-6-luna";
const dailyLimit = 20, minuteLimit = 4;
let cooldownUntil = 0;

export function parsePublicSignals(value:unknown):Signals|null {
  if(!value || typeof value!=="object" || Array.isArray(value)) return null;
  const raw=value as Record<string,unknown>;
  const index=(s:unknown,max:number):s is number=>typeof s==="number"&&Number.isInteger(s)&&s>=0&&s<=max;
  if(Object.keys(raw).sort().join(",")!=="context,day,frequency,tags,time"
    || !Array.isArray(raw.tags) || raw.tags.length<1 || raw.tags.length>tags.length
    || new Set(raw.tags).size!==raw.tags.length || !raw.tags.every(tag=>typeof tag==="string"&&tags.includes(tag))
    || typeof raw.context!=="string"||!topics.includes(raw.context)
    || !index(raw.day,7)||!index(raw.time,3)||!index(raw.frequency,7)) return null;
  return {tags:raw.tags,context:raw.context,day:raw.day,time:raw.time,frequency:raw.frequency};
}

async function reserveModelCall():Promise<boolean> {
  const now=Date.now();
  if(now<cooldownUntil)return false;
  const date=new Date(now).toISOString().slice(0,10),minute=Math.floor(now/60_000);
  const ref=db.doc("systemSettings/helpPublicChatUsage");
  return db.runTransaction(async tx=>{
    const previous=(await tx.get(ref)).data();
    const daily=previous?.date===date?previous.daily:0, recent=previous?.minute===minute?previous.recent:0;
    if(!Number.isSafeInteger(daily)||daily<0||!Number.isSafeInteger(recent)||recent<0)return false;
    if(daily>=dailyLimit||recent>=minuteLimit){
      cooldownUntil=daily>=dailyLimit?Date.parse(date+"T00:00:00Z")+86_400_000:(minute+1)*60_000;
      return false;
    }
    tx.set(ref,{date,dayLimit:dailyLimit,daily:daily+1,minute,recent:recent+1});
    return true;
  },{maxAttempts:3});
}

export async function classifyPublicIntent(signals:Signals,apiKey:string,fetcher:typeof fetch=fetch):Promise<Intent|null> {
  const safeSignals = parsePublicSignals(signals);
  if(!safeSignals||!apiKey.trim())return null;
  const result=await fetcher("https://api.openai.com/v1/responses",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${apiKey.trim()}`},
    redirect:"error",signal:AbortSignal.timeout(3500),
    body:JSON.stringify({
      model,store:false,reasoning:{effort:"none"},max_output_tokens:64,
      instructions:"Classify public Korean Pilates help cues. Choose one intent according to the cues and the last topic. Prefer an explicit new topic. For bare weekday/time/frequency or followup cues, prefer the last topic when it helps. Beginner may indicate recommend. Unknown if ambiguous. Never return facts, prose, or private data.",
      input:JSON.stringify(safeSignals),
      text:{format:{type:"json_schema",name:"help_public_intent",strict:true,
        schema:{type:"object",properties:{intent:{type:"string",enum:intents}},required:["intent"],additionalProperties:false}}}
    })
  });
  if(!result.ok)return null;
  const body=await result.json();
  if(body?.status!=="completed"||!Array.isArray(body.output)||body.output.length!==1)return null;
  const message=body.output[0];
  if(message?.type!=="message"||message.role!=="assistant"||message.status!=="completed"
    || !Array.isArray(message.content)||message.content.length!==1)return null;
  const part=message.content[0];
  if(part?.type!=="output_text"||typeof part.text!=="string"||part.text.length>80)return null;
  try{
    const parsed=JSON.parse(part.text);
    return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)
      &&Object.keys(parsed).join(",")==="intent"&&intents.includes(parsed.intent)?parsed.intent:null;
  }catch{return null;}
}

export function isHelpPublicAiEnabled(project:string,override:string|undefined):boolean {
  return project==="archive-pilates"&&override!=="false";
}

export function createHelpPublicChatHandler(deps={
  enabled:()=>isHelpPublicAiEnabled(projectID.value(),process.env.HELP_PUBLIC_AI_ENABLED),
  key:()=>helpPublicOpenAiApiKey.value(),reserve:reserveModelCall,classify:classifyPublicIntent
}) {
  return async (req:Request,response:any):Promise<void>=>{
    response.set("Cache-Control","private, no-store");
    response.set("X-Content-Type-Options","nosniff");
    if(req.method!=="POST"){response.status(405).json({ok:false});return;}
    if(!allowedOrigins.has(req.get("origin")??"")){response.status(403).json({ok:false});return;}
    if(!req.is("application/json")||!req.rawBody||req.rawBody.length>1024){response.status(400).json({ok:false});return;}
    const signals=parsePublicSignals(req.body);
    if(!signals){response.status(400).json({ok:false});return;}
    try{
      if(!deps.enabled()){response.status(503).json({ok:false});return;}
      const key=deps.key();
      if(!key?.trim()||!await deps.reserve()){response.status(503).json({ok:false});return;}
      const intent=await deps.classify(signals,key);
      response.status(intent?200:503).json(intent?{ok:true,intent}:{ok:false});
    }catch{response.status(503).json({ok:false});}
  };
}
