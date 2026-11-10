import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildInquiryGuidance({check=false}={}) {
  const bytes=fs.readFileSync(path.join(root,'firebase/kangsain-functions/functions/src/memberInquiries/guidance.json'));
  const value=JSON.parse(bytes),ids=new Set();
  const categories=JSON.parse(fs.readFileSync(path.join(root,'help/assets/inquiry-schema.json'))).categories;
  if(value.version!=='2026-11-10.1'||!Array.isArray(value.rules))throw Error('Invalid guidance');
  for(const rule of value.rules){
    if(ids.has(rule.id)||!['renewal','booking','holding','conversion','fixed','other'].includes(rule.category)||!rule.text||!rule.title)throw Error('Invalid guidance rule');
    ids.add(rule.id);
    if(rule.sourceId&&!value.sources[rule.sourceId])throw Error('Unknown source');
    for(const [question,choice] of Object.entries(rule.when||{}))if(!categories[rule.category].questions.some(item=>item.id===question&&item.options?.includes(choice)))throw Error('Rule choice is not in the inquiry schema');
  }
  for(const source of Object.values(value.sources)){const url=new URL(source.url);if(url.origin!=='https://app.notion.com'||!/^\/p\/[a-f0-9]{32}$/.test(url.pathname))throw Error('Invalid public rule source');}
  const paths=['help/assets/member-inquiry-guidance.json','core/assets/member-inquiry-guidance.json'];
  for(const target of paths){const file=path.join(root,target);if(check){if(!fs.existsSync(file)||!fs.readFileSync(file).equals(bytes))throw Error('Guidance copy drift: '+target);}else fs.writeFileSync(file,bytes);}
  return paths;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify({paths:buildInquiryGuidance({check:process.argv.includes('--check')})}));
