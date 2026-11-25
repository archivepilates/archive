import {createCloudEnrollmentAuthority} from './cloud-enrollment-authority.mjs';
import {createHostedHelpMemberService} from './hosted-pass-service.mjs';
import {createPostgresAuthStore} from './postgres-auth-store.mjs';

const roles=Object.freeze({auth:'archive_help_member_auth_runtime',issuer:'archive_help_pass_session_issuer',
  reader:'archive_help_pass_reader'});
const preflight=`SELECT current_user::text AS name,
  NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
    AND r.rolcanlogin AND current_user = session_user AS restricted,
  pg_has_role(current_user, 'archive_help_member_auth_runtime', 'SET') AS auth,
  pg_has_role(current_user, 'archive_help_pass_session_issuer', 'USAGE') AS issuer,
  pg_has_role(current_user, 'archive_help_pass_reader', 'USAGE') AS reader,
  NOT EXISTS (SELECT 1 FROM pg_roles other WHERE
    other.rolname <> $1::text AND other.rolname <> current_user
    AND pg_has_role(current_user, other.rolname, 'MEMBER')) AS isolated
  FROM pg_roles r WHERE r.rolname=current_user`;

// Initialize with three separate, TLS-verified pools. Never substitute the
// database owner, Data API key, history credentials, or writer connection.
export async function createHostedHelpMemberRuntime({enabled=false,pools,loadEnrollment,loadCurrentBinding,
  sendCode,otpSecret,memberKeySecret,now=Date.now}={}){
  if(enabled!==true)return createHostedHelpMemberService();
  await assertMemberDatabasePools(pools);
  const authority=createCloudEnrollmentAuthority({loadEnrollment,loadCurrentBinding,now});
  return createHostedHelpMemberService({enabled:true,store:createPostgresAuthStore({pool:pools.auth}),authority,
    remoteOtp:{resolveRecipient:authority.resolveRecipient,sendCode,secret:otpSecret},
    issuerQuery:(sql,bindings)=>pools.issuer.query(sql,bindings),readerQuery:(sql,bindings)=>pools.reader.query(sql,bindings),
    memberKeySecret,now});
}

export async function assertMemberDatabasePools(pools){
  const capabilities=Object.keys(roles);
  if(capabilities.some(key=>typeof pools?.[key]?.query!=='function')
    ||new Set(capabilities.map(key=>pools[key])).size!==capabilities.length
    ||typeof pools.auth.connect!=='function')throw Error('Dedicated member database pools required');

  const identities=new Set();
  for(const key of capabilities){
    let row;
    try{({rows:[row]}=await pools[key].query(preflight,[roles[key]]));}catch{/* Never propagate transport configuration or SQL values. */}
    if(!row||typeof row.name!=='string'||row.restricted!==true||row.isolated!==true||identities.has(row.name)
      ||capabilities.some(current=>row[current]!== (current===key)))throw Error('Member database role preflight failed: '+key);
    identities.add(row.name);
  }

}
