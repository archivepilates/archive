import pg from 'pg';
import {readCloudConfig} from './cloud-config.mjs';
import {createHostedHelpMemberRuntime} from './hosted-runtime.mjs';
import {createHelpCloudServer} from './node-http.mjs';
import {createPostgresEnrollmentLoaders} from './postgres-enrollment-loader.mjs';
import {createMemberCodeSender} from './solapi-code.mjs';
import {createHostedSolapiTransport} from './solapi-http.mjs';

let pools={},server;
async function start(){
  const cfg=readCloudConfig(process.env);
  let options={enabled:false};
  let loaders;
  if(cfg.enabled){
    pools=Object.fromEntries(Object.entries(cfg.pools).map(([name,value])=>{
      const pool=new pg.Pool(value);
      pool.on('error',()=>console.error('Help database idle connection failed'));
      return [name,pool];
    }));
    loaders=createPostgresEnrollmentLoaders({pool:pools.auth,key:cfg.contactKey,
      memberKeySecret:cfg.memberKeySecret,pilotMemberKey:cfg.pilotMemberKey});
    const sendCode=createMemberCodeSender({...cfg.provider,request:createHostedSolapiTransport(cfg.provider)});
    options={enabled:true,pools,...loaders,sendCode,otpSecret:cfg.otpSecret,memberKeySecret:cfg.memberKeySecret};
  }
  const service=await createHostedHelpMemberRuntime(options);
  // The empty probe uses a non-issued approval key and never selects a member.
  if(loaders&&await loaders.loadEnrollment({referenceDigest:'0'.repeat(64)})!==null)
    throw Error('Enrollment source validation failed');
  const port=Number(process.env.PORT??8080);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid server port');
  server=createHelpCloudServer({handle:service.handle,ready:cfg.enabled});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',resolve);});
  console.log(cfg.enabled?'Help member pilot ready':'Help member pilot disabled');
}

try{
  await start();
}catch{
  console.error('Help member service startup failed');
  await Promise.allSettled(Object.values(pools).map(pool=>pool.end()));
  process.exitCode=1;
}
if(server?.listening){
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(async()=>{
    await Promise.allSettled(Object.values(pools).map(pool=>pool.end()));
  }));
}
