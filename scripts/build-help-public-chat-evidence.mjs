import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {promotionNov,regularNov} from '../help/chatbot/content.js';
import {novemberTimetable} from '../help/chatbot/timetable.js';

export function buildPublicChatEvidence({check=false}={}){
  const out=new URL('../firebase/kangsain-functions/functions/src/memberInquiries/public-chat-evidence.generated.json',import.meta.url);
  const data={
    validFrom:'2026-11-01',
    validThrough:novemberTimetable.endDate,
    rates:regularNov.map(({name,price,duration})=>({name,price,duration})),
    promotions:promotionNov,
    times:Object.values(novemberTimetable.byDay).map(slots=>slots.map(([time])=>time))
  };
  const expected=JSON.stringify(data,null,2)+'\n';
  if(check){
    if(readFileSync(out,'utf8')!==expected)throw Error('Help GPT evidence is stale; run node scripts/build-help-public-chat-evidence.mjs');
  }else writeFileSync(out,expected);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)buildPublicChatEvidence({check:process.argv.includes('--check')});
