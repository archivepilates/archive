import {closeSync,constants,fstatSync,openSync,readFileSync} from 'node:fs';
import {archiveAutomationPath} from './archive-automation-paths.mjs';

export function helpMemberSyncEnabled(env=process.env, activationPath){
  if(env.HELP_MEMBER_ROSTER_SYNC!==undefined)return env.HELP_MEMBER_ROSTER_SYNC==='enabled';
  let fd;
  try {
    fd=openSync(activationPath??archiveAutomationPath('automation','state','help-member-roster-sync.json'),
      constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const info=fstatSync(fd);
    if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o077)||info.size>256)return false;
    const entry=JSON.parse(readFileSync(fd,'utf8'));
    return Object.keys(entry).sort().join(',')==='policy,state'
      &&entry.policy==='native_registration_v1'&&entry.state==='enabled';
  } catch { return false; }
  finally { if(fd!==undefined)closeSync(fd); }
}
