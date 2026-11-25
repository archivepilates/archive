import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemberCodeSender,MEMBER_CODE_TEMPLATE as spec} from './solapi-code.mjs';
import {createLessonVideoSolapiTransport} from '../../scripts/lib/lesson-video-notice-solapi.mjs';

const channelId='KA01PFFixture',templateId='KA01TPFixture';
const template={...spec,channelId,templateId,status:'APPROVED',securityFlag:true,messageType:'BA',emphasizeType:'NONE',
  isHidden:false,buttons:[],variables:[{name:spec.variable}]};
const to='01000000001', code='482621',dispatchKey='a'.repeat(64),messageId='M'+'m'.repeat(22),groupId='G'+'g'.repeat(22);
const args={to,code,dispatchKey,mayDispatch:()=>true};
const receipt={groupInfo:{groupId},failedMessageList:[],messageList:[{to,type:'ATA',messageId,kakaoOptions:{pfId:channelId,templateId}}]};

test('only a matching approved security template can submit one Alimtalk with no SMS fallback',async()=>{
  for(const row of [{...template,status:'INSPECTING'},{...template,securityFlag:false},{...template,channelId:'other'},
    {...template,content:'unverified'},{...template,buttons:[{}]},{...template,isDeleted:true}]){
    let writes=0;
    const send=createMemberCodeSender({channelId,templateId,request:async(_,method)=>{
      if(method!=='GET')writes++;
      return row;
    }});
    assert.deepEqual(await send(args),{accepted:false});
    assert.equal(writes,0);
  }
  const send=createMemberCodeSender({channelId,templateId,request:async(path,method,body)=>{
    if(method==='GET')return template;
    assert.equal(path,'/messages/v4/send-many/detail');
    assert.equal(method,'POST');
    assert.equal(body.allowDuplicates,false);
    assert.deepEqual(body.messages,[{to,type:'ATA',kakaoOptions:{pfId:channelId,templateId,disableSms:true,variables:{[spec.variable]:code}},
      customFields:{archiveActionKey:dispatchKey,purpose:'help_member_code'}}]);
    return receipt;
  }});
  assert.deepEqual(await send(args),{accepted:true,messageId,groupId});
});

test('window is rechecked after reading the template, and a mismatched receipt is not called accepted',async()=>{
  let permitted=true, writes=0;
  const send=createMemberCodeSender({channelId,templateId,request:async(_,method)=>{
    if(method==='GET'){permitted=false;return template;}
    writes++;
    return {...receipt,messageList:[{...receipt.messageList[0],to:'01000000002'}]};
  }});
  assert.deepEqual(await send({...args,mayDispatch:()=>permitted}),{accepted:false});
  assert.equal(writes,0);
  assert.deepEqual(await send(args),{accepted:false});
  assert.equal(writes,1);
});

test('a compact SOLAPI receipt uses one group readback and cannot acknowledge a different request',async()=>{
  const good={...receipt.messageList[0],groupId,statusCode:'4000',
    customFields:{archiveActionKey:dispatchKey,purpose:'help_member_code'}};
  for(const [row,expected] of [[good,true],[{...good,statusCode:'3107'},false],
    [{...good,customFields:{...good.customFields,archiveActionKey:'b'.repeat(64)}},false],
    [{...good,to:'01000000002'},false]]){
    const requests=[];
    const send=createMemberCodeSender({channelId,templateId,request:async(path,method)=>{
      requests.push([path,method]);
      if(path==='/kakao/v2/templates/'+templateId)return template;
      if(path==='/messages/v4/send-many/detail')return {...receipt,messageList:[{messageId,statusCode:'2000'}]};
      return {messageList:{[messageId]:row}};
    }});
    const actual=await send(args);
    assert.equal(actual.accepted,expected);
    assert.deepEqual(requests,[['/kakao/v2/templates/'+templateId,'GET'],
      ['/messages/v4/send-many/detail','POST'],['/messages/v4/groups/'+groupId+'/messages','GET']]);
  }
});

test('member dispatch abort reaches the official HTTP transport and is not retried',async()=>{
  const controller=new AbortController(), methods=[];
  const request=createLessonVideoSolapiTransport({key:'test',apiSecret:'test',fetcher:async(_url,options)=>{
    methods.push(options.method);
    if(options.method==='GET')return Response.json(template);
    controller.abort();
    assert.equal(options.signal.aborted,true);
    throw options.signal.reason;
  }});
  const send=createMemberCodeSender({channelId,templateId,request});
  await assert.rejects(send({...args,signal:controller.signal}),{name:'AbortError'});
  assert.deepEqual(methods,['GET','POST']);
});
