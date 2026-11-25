import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {ORIGIN} from './accounts.mjs';

function writeJson(res,status,value){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(JSON.stringify(value));
}

export function createHelpCloudServer({handle,ready=false}){
  return createServer({requestTimeout:20000,headersTimeout:5000,maxHeaderSize:8192},async(req,res)=>{
    try{
      if(req.method==='GET'&&req.url==='/healthz')return writeJson(res,200,{ok:true,enabled:ready});
      if(!/^\/api\/member-access\/[a-z-]+$/u.test(req.url??''))return writeJson(res,404,{ok:false});
      if(req.method!=='POST'||req.headers.origin!==ORIGIN)return writeJson(res,403,{ok:false});
      if(Number(req.headers['content-length'])>8192)return writeJson(res,413,{ok:false});
      const headers=new Headers();
      for(const name of ['origin','cookie','content-type','content-length']){
        if(typeof req.headers[name]==='string')headers.set(name,req.headers[name]);
      }
      const request=new Request(ORIGIN+req.url,{method:'POST',headers,body:Readable.toWeb(req),duplex:'half'});
      const result=await handle(request), replyHeaders=Object.fromEntries(result.headers);
      delete replyHeaders['set-cookie'];
      const cookies=result.headers.getSetCookie();
      if(cookies.length)replyHeaders['set-cookie']=cookies;
      res.writeHead(result.status,replyHeaders);
      res.end(Buffer.from(await result.arrayBuffer()));
    }catch{
      if(!res.headersSent)writeJson(res,403,{ok:false});
      else res.destroy();
    }
  });
}
