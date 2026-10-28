import test from 'node:test';
import assert from 'node:assert/strict';
import {isKnownUnsentInstructorEformFailure} from '../lib/instructor-registration-recovery.mjs';
const prefix='[eformsign:send_transition] TimeoutError timeoutMs=30000 ';
const state={path:'/eform/document/view_service.html',framePresent:true,viewerStatus:'1',processText:'Next'};
test('exact pre-send Next timeout can be audited for an approved unsent recovery',()=>assert.equal(isKnownUnsentInstructorEformFailure(prefix+JSON.stringify(state)),true));
for(const patch of [{processText:'Send'},{path:'/eform/document/document_list.html'},{framePresent:false}])test('unknown or later-stage failure is not a no-send proof: '+JSON.stringify(patch),()=>assert.equal(isKnownUnsentInstructorEformFailure(prefix+JSON.stringify({...state,...patch})),false));
for(const error of [prefix+'{bad','[eformsign:send_dialog] TimeoutError timeoutMs=30000 '+JSON.stringify(state),'network timeout',null])test('generic errors cannot reopen failed sends: '+String(error).slice(0,60),()=>assert.equal(isKnownUnsentInstructorEformFailure(error),false));
