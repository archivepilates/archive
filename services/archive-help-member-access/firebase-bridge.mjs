import {ORIGIN} from './accounts.mjs';
import {CONVERSATION_HEADER} from './consultation-http.mjs';

export function createFirebaseMemberBridge({getHandler,origin=ORIGIN}){
  return async (req,res)=>{
    const response=(status)=>res.status(status).set('Cache-Control','private, no-store').json({ok:false});
    if(!/^\/api\/member-access\/[a-z-]+$/u.test(req.originalUrl??'')&&
      !/^\/api\/member-access\/[a-z-]+$/u.test(req.url??''))return response(404);
    const path=req.originalUrl?.startsWith('/api/member-access/')?req.originalUrl:req.url;
    if(req.method!=='POST'||req.get('origin')!==origin)return response(403);
    if(!Buffer.isBuffer(req.rawBody)||req.rawBody.length>8192)return response(400);
    const headers=new Headers();
    for(const name of ['origin','cookie','content-type',CONVERSATION_HEADER]){
      const value=req.get(name);
      if(typeof value==='string')headers.set(name,value);
    }
    try{
      const handle=await getHandler(), payload=await handle(new Request(origin+path,
        {method:'POST',headers,body:req.rawBody}));
      for(const [key,value] of payload.headers)if(key!=='set-cookie')res.set(key,value);
      const cookies=payload.headers.getSetCookie();
      if(cookies.length)res.set('Set-Cookie',cookies);
      return res.status(payload.status).send(Buffer.from(await payload.arrayBuffer()));
    }catch{return response(503);}
  };
}
