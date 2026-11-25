const project='vrmtkewdqgcrhpbeijhr';
const direct='db.'+project+'.supabase.co';
const accounts=Object.freeze({
  auth:'archive_help_member_auth_app',
  issuer:'archive_help_pass_issuer_app',
  reader:'archive_help_pass_reader_app',
});
const exact=(row,fields)=>row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).sort().join(',')===fields;
const invalid=()=>Error('Help private deployment configuration invalid');
const secret=value=>{
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))throw invalid();
  return Buffer.from(value,'hex');
};

export function readCloudConfig(env){
  if(!env.HELP_MEMBER_MODE||env.HELP_MEMBER_MODE==='disabled')return {enabled:false};
  if(env.HELP_MEMBER_MODE!=='pilot')throw invalid();
  let blob;
  try{blob=JSON.parse(env.HELP_MEMBER_POSTGRES);}catch{throw invalid();}
  if(!exact(blob,'ca,host,logins,project')||blob.project!==project
    ||!(blob.host===direct||typeof blob.host==='string'&&/^aws-[0-9]+-ap-northeast-2\.pooler\.supabase\.com$/u.test(blob.host))
    ||typeof blob.ca!=='string'||!blob.ca.startsWith('-----BEGIN CERTIFICATE-----')||blob.ca.length>12000
    ||!exact(blob.logins,'auth,issuer,reader'))throw invalid();
  const keys=[env.HELP_MEMBER_CONTACT_KEY,env.HELP_MEMBER_SNAPSHOT_KEY,env.HELP_MEMBER_OTP_KEY];
  if(new Set(keys).size!==3)throw invalid();
  const [contactKey,memberKeySecret,otpSecret]=keys.map(secret);
  const pools=Object.fromEntries(Object.entries(accounts).map(([kind,role])=>{
    const login=blob.logins[kind];
    if(!exact(login,'password,role')||login.role!==role||typeof login.password!=='string'
      ||!/^[A-Za-z0-9_-]{32,128}$/u.test(login.password))throw invalid();
    return [kind,{host:blob.host,port:5432,user:blob.host===direct?role:role+'.'+project,password:login.password,
      database:'postgres',ssl:{ca:blob.ca,rejectUnauthorized:true},max:3,connectionTimeoutMillis:3500,
      query_timeout:5000,idleTimeoutMillis:10000,application_name:'archive-help-member-'+kind}];
  }));
  if(new Set(Object.values(pools).map(x=>x.password)).size!==3)throw invalid();
  const pilotMemberKey=secret(env.HELP_MEMBER_PILOT_KEY);
  if(keys.includes(env.HELP_MEMBER_PILOT_KEY))throw invalid();
  return {enabled:true,pools,contactKey,memberKeySecret,otpSecret,pilotMemberKey,provider:{apiKey:env.SOLAPI_API_KEY,apiSecret:env.SOLAPI_API_SECRET,
    channelId:env.SOLAPI_PFID,templateId:env.HELP_MEMBER_SOLAPI_TEMPLATE}};
}
