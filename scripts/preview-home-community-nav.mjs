import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const changed=new Set(['index.html','instructor-lessons/index.html','teams/index.html',...['minjin','eunyoung','chorim','kihyo','yuri'].map(n=>`teams/${n}/index.html`)]);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'');
  if(name.split('/').some(p=>p==='..')||name.includes('\\')){res.writeHead(400);res.end();return;}
  if(!path.extname(name))name=name.replace(/\/$/,'')+'/index.html';if(name==='/index.html')name='index.html';
  try{
    const bytes=changed.has(name)?fs.readFileSync(path.join(root,'official-home',name)):execFileSync('git',['show',`e2b8001b:official-home/${name}`],{cwd:root,stdio:['ignore','pipe','pipe'],maxBuffer:20*1024*1024});
    res.writeHead(200,{'Content-Type':mime[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||4577),'127.0.0.1',()=>console.log(`Preview http://127.0.0.1:${server.address().port}`));
process.on('SIGINT',()=>server.close());
