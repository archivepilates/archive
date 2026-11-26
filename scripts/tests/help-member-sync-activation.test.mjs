import assert from 'node:assert/strict';
import {chmodSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {helpMemberSyncEnabled} from '../lib/help-member-sync-activation.mjs';

test('the existing job may adopt a private activation without reloading its timer',t=>{
  const dir=mkdtempSync(join(tmpdir(),'help-member-sync-test-'));
  t.after(()=>rmSync(dir,{recursive:true}));
  const file=join(dir,'activation.json'),link=join(dir,'unsafe.json');
  assert.equal(helpMemberSyncEnabled({},file),false);
  writeFileSync(file,'{"state":"enabled","policy":"native_registration_v1"}',{mode:0o600});
  assert.equal(helpMemberSyncEnabled({},file),true);
  assert.equal(helpMemberSyncEnabled({HELP_MEMBER_ROSTER_SYNC:'disabled'},file),false);
  symlinkSync(file,link);
  assert.equal(helpMemberSyncEnabled({},link),false);
  chmodSync(file,0o644);
  assert.equal(helpMemberSyncEnabled({},file),false);
  chmodSync(file,0o600);
  writeFileSync(file,'{"state":"enabled","policy":"unrecognized"}');
  assert.equal(helpMemberSyncEnabled({},file),false);
});
