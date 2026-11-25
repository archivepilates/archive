import {createHmac,randomBytes} from 'node:crypto';

export function createHostedSolapiTransport({apiKey,apiSecret,fetcher=fetch,now=Date.now}={}){
  if(typeof apiKey!=='string'||!/^[A-Za-z0-9_-]{10,128}$/u.test(apiKey)
    ||typeof apiSecret!=='string'||apiSecret.length<16||apiSecret.length>512)throw Error('SOLAPI configuration unavailable');
  return async (resource,method,body,{signal}={})=>{
    if(!(method==='GET'&&(/^\/kakao\/v2\/templates\/KA01TP[A-Za-z0-9]+$/u.test(resource??'')
      ||/^\/messages\/v4\/groups\/G[A-Za-z0-9]{20,80}\/messages$/u.test(resource??''))
      ||method==='POST'&&resource==='/messages/v4/send-many/detail'))throw Error('Invalid SOLAPI member route');
    const date=new Date(now()).toISOString(), salt=randomBytes(16).toString('hex');
    const signature=createHmac('sha256',apiSecret).update(date+salt).digest('hex');
    const timeout=AbortSignal.timeout(7000);
    try{
      const res=await fetcher(new URL(resource,'https://api.solapi.com'),{method,redirect:'error',
        headers:{Authorization:'HMAC-SHA256 apiKey='+apiKey+', date='+date+', salt='+salt+', signature='+signature,
          'Content-Type':'application/json'},
        body:method==='POST'?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,timeout]):timeout});
      if(!res.ok)throw Error('SOLAPI transport unavailable');
      return await res.json();
    }catch{throw Error('SOLAPI transport unavailable');}
  };
}
