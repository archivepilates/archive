export const MEMBER_CODE_TEMPLATE=Object.freeze({
  name:'아카이브 헬프 회원 인증번호',categoryCode:'001002',
  content:'[ARCHIVE PILATES] 아카이브 헬프 회원 인증번호입니다.\n\n인증번호: #{인증번호}\n\n요청하신 인증 화면에 5분 이내 입력해 주세요. 인증번호는 다른 사람에게 알려주지 마세요.',
  variable:'#{인증번호}'
});

export function sameMemberCodeTemplate(row,channelId){
  const spec=MEMBER_CODE_TEMPLATE;
  return row?.name===spec.name&&row.channelId===channelId&&row.categoryCode===spec.categoryCode
    &&row.content===spec.content&&row.securityFlag===true&&row.messageType==='BA'&&row.emphasizeType==='NONE'
    &&(row.isDeleted===undefined||row.isDeleted===false)&&row.isHidden===false&&Array.isArray(row.buttons)&&row.buttons.length===0
    &&row.variables?.length===1&&row.variables[0]?.name===spec.variable;
}

export function createMemberCodeSender({request,channelId,templateId}){
  if(typeof request!=='function'||!/^KA01PF[A-Za-z0-9]+$/.test(channelId??'')||!/^KA01TP[A-Za-z0-9]+$/.test(templateId??'')){
    throw Error('An explicit SOLAPI security template is required');
  }
  return async ({to,code,dispatchKey,mayDispatch,signal})=>{
    if(!/^010\d{8}$/.test(to??'')||!/^\d{6}$/.test(code??'')||!/^[a-f\d]{64}$/.test(dispatchKey??'')
      ||typeof mayDispatch!=='function'||!mayDispatch()||signal?.aborted)return {accepted:false};
    const template=await request('/kakao/v2/templates/'+templateId,'GET',undefined,{signal,retryRead:false});
    if(template?.templateId!==templateId||template.status!=='APPROVED'||!sameMemberCodeTemplate(template,channelId)
      ||signal?.aborted||!mayDispatch())return {accepted:false};
    const receipt=await request('/messages/v4/send-many/detail','POST',{
      messages:[{to,type:'ATA',kakaoOptions:{pfId:channelId,templateId,disableSms:true,
        variables:{[MEMBER_CODE_TEMPLATE.variable]:code}},customFields:{archiveActionKey:dispatchKey,purpose:'help_member_code'}}],
      strict:true,allowDuplicates:false,showMessageList:true
    },{signal,retryRead:false});
    const rows=Object.values(receipt?.messageList??{}), row=rows[0], groupId=receipt?.groupInfo?.groupId;
    if(Object.keys(receipt?.failedMessageList??{}).length||rows.length!==1||!/^M[A-Za-z0-9]{20,80}$/.test(row?.messageId??'')
      ||!/^G[A-Za-z0-9]{20,80}$/.test(groupId??'')||row.to!==to||row.type!=='ATA'
      ||row.kakaoOptions?.templateId!==templateId||row.kakaoOptions?.pfId!==channelId)return {accepted:false};
    return {accepted:true,messageId:row.messageId,groupId};
  };
}
