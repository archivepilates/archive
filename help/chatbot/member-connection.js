const path='/api/member-access/';
const guide='https://archivepilates.notion.site/studiomate';
const $=tag=>document.createElement(tag);
const text=(tag,value)=>{const el=$(tag);el.textContent=value;return el;};
const button=(label,action)=>{const b=text('button',label);b.type='button';b.addEventListener('click',action);return b;};
const codeNotice='직접 요청한 인증번호만 등록된 휴대전화에 보내드려요.';
const unavailable='지금은 수강권 정보를 확인할 수 없어요. 잠시 후 다시 확인하거나 회원 앱을 이용해 주세요.';

function newConversation(){
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function normalizePhone(value){
  return value.normalize('NFKC').replace(/[\s()-]/g,'').replace(/^\+82(?=10\d{8}$)/,'0');
}

export function createMemberConnection({onPrivate,onClear,onAuthChange,allowPilot=false}){
  if(/^#member-invite(?:=|$)/.test(location.hash)){
    history.replaceState(history.state,'',location.pathname+location.search);
  }
  let conversation=newConversation(),capability,otpUsed=false,connected=false;
  let dialog,status,actions,returnFocus,working=false,cardRead=0,lease,dataExpiresAt=0,lastActivity=0;
  let authQueue=Promise.resolve();

  async function request(op,body={},key=conversation){
    const response=await fetch(path+op,{method:'POST',mode:'same-origin',credentials:'same-origin',
      cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/json','X-Archive-Conversation':key},
      body:JSON.stringify(body),signal:AbortSignal.timeout(45_000)});
    const data=response.ok&&/^application\/json\b/i.test(response.headers.get('content-type')??'')?
      await response.json():null;
    return {status:response.status,data};
  }
  function enabled(){
    return capability??=(request('availability').then(({data})=>
      data?.ok===true&&data.remoteOtp===true&&data.method==='otp'
        &&(allowPilot||data.audience==='verified-members')).catch(()=>false));
  }
  function queueAuth(task){
    // Cookie-changing requests must finish in order, including across chat resets.
    const next=authQueue.then(task);
    authQueue=next.catch(()=>{});
    return next;
  }
  function clearPrivate(){
    clearTimeout(lease);
    dataExpiresAt=0;
    onClear();
  }
  function expirePrivate(){
    clearTimeout(lease);
    if(!dataExpiresAt)return;
    const remaining=dataExpiresAt-Date.now();
    if(remaining<=0)clearPrivate();
    else lease=setTimeout(expirePrivate,Math.min(remaining,2_147_483_647));
  }
  function updateLookupButton(control){
    control.textContent=connected?'수강권 다시 확인':'회원 인증 후 확인';
    if(connected)control.removeAttribute('aria-haspopup');
    else control.setAttribute('aria-haspopup','dialog');
  }
  function setConnected(value){
    if(value===connected)return;
    connected=value;
    lastActivity=value?Date.now():0;
    document.querySelectorAll('[data-member-cards]').forEach(updateLookupButton);
    document.querySelectorAll('[data-member-status]').forEach(node=>{node.textContent='';});
    onAuthChange(value);
  }
  function close(){
    if(dialog?.open)dialog.close();
    actions?.replaceChildren();
    if(status)status.textContent='';
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
    returnFocus=null;
  }
  function end(){
    const old=conversation;
    if(otpUsed)void queueAuth(()=>request('logout',{},old)).catch(()=>{});
    conversation=newConversation();
    capability=undefined;
    otpUsed=false;
    working=false;
    cardRead++;
    clearPrivate();
    setConnected(false);
    close();
  }
  function cancel(){
    if(working)end();
    else close();
  }
  function panel(){
    if(dialog)return;
    dialog=$('dialog');dialog.id='member-access';dialog.setAttribute('aria-labelledby','member-access-title');
    const heading=text('h2','휴대전화 번호로 회원 인증');heading.id='member-access-title';
    const notice=text('p',codeNotice);notice.id='member-access-notice';
    status=text('p','');status.id='member-access-status';status.setAttribute('role','status');
    status.className='member-access-status';
    const docs=text('a','공식 회원 앱 이용 안내');docs.href=guide;
    actions=$('div');actions.className='member-access-actions';
    dialog.append(heading,notice,status,actions,docs);document.body.append(dialog);
    dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  }
  function showForm(lookup,step='phone'){
    const phoneStep=step==='phone';
    const form=$('form');form.method='post';form.autocomplete='off';
    const input=$('input');input.id='member-access-input';input.required=true;
    input.type=phoneStep?'tel':'text';input.inputMode=phoneStep?'tel':'numeric';
    input.autocomplete=phoneStep?'off':'one-time-code';
    input.maxLength=phoneStep?24:6;
    if(!phoneStep)input.pattern='[0-9]{6}';
    const label=text('label',phoneStep?'등록된 휴대전화 번호':'알림톡 인증번호');label.htmlFor=input.id;
    const hint=text('p',phoneStep?'회원 앱에 등록한 010 번호를 입력해 주세요.':'알림톡으로 받은 숫자 6자리를 입력해 주세요.');
    hint.id='member-access-hint';
    input.setAttribute('aria-describedby',hint.id+' member-access-notice '+status.id);
    const submit=text('button',phoneStep?'인증번호 요청':'인증하기');submit.type='submit';
    form.append(label,hint,input,submit);
    const controls=[input,submit];
    const switchPhone=phoneStep?null:button('번호 다시 입력',()=>{
      end();
      returnFocus=lookup;
      showForm(lookup);
    });
    if(switchPhone)controls.push(switchPhone);

    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(working)return;
      const value=phoneStep?normalizePhone(input.value):input.value;
      if(phoneStep?!/^010\d{8}$/.test(value):!/^\d{6}$/.test(value)){
        input.setAttribute('aria-invalid','true');
        status.textContent=phoneStep?'010으로 시작하는 휴대전화 번호 11자리를 입력해 주세요.':'인증번호 숫자 6자리를 입력해 주세요.';
        input.focus();
        return;
      }
      input.value='';
      input.removeAttribute('aria-invalid');
      const key=conversation;
      working=true;
      otpUsed=true;
      for(const control of controls)control.disabled=true;
      status.textContent=phoneStep?'인증번호를 요청하고 있어요.':'인증번호를 확인하고 있어요.';
      try{
        const result=await queueAuth(()=>key===conversation&&request(phoneStep?'otp-start':'otp-verify',
          phoneStep?{phone:value}:{code:value},key));
        if(key!==conversation)return;
        if(result?.data?.ok!==true)throw Error();
        if(phoneStep){
          status.textContent='알림톡이 오지 않으면 회원 앱에 등록한 번호인지 확인해 주세요.';
          showForm(lookup,'code');
        }else{
          setConnected(true);
          close();
          void reveal(lookup);
        }
      }catch{
        if(key===conversation){
          status.textContent=phoneStep?'지금은 인증번호 요청을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.':
            '인증을 완료하지 못했어요. 코드를 확인하거나 번호를 다시 입력해 주세요.';
        }
      }finally{
        if(key===conversation){
          working=false;
          for(const control of controls)control.disabled=false;
          if(dialog.open&&input.isConnected)input.focus({preventScroll:true});
        }
      }
    });
    input.addEventListener('input',()=>{
      if(input.hasAttribute('aria-invalid')){input.removeAttribute('aria-invalid');status.textContent='';}
    });
    actions.replaceChildren(form,...(switchPhone?[switchPhone]:[]),button('닫기',cancel));
    if(!dialog.open)dialog.showModal();
    input.focus();
  }
  async function reveal(lookup){
    if(lookup.control.getAttribute('aria-disabled')==='true')return;
    const key=conversation,read=++cardRead;
    lookup.control.setAttribute('aria-disabled','true');
    lookup.feedback.textContent='수강권 정보를 확인하고 있어요.';
    try{
      const {status:code,data}=await request('cards');
      if(key!==conversation||read!==cardRead)return;
      if(code===403){
        clearPrivate();
        setConnected(false);
        lookup.feedback.textContent='회원 인증을 확인할 수 없어요. 다시 인증하거나 회원 앱에서 확인해 주세요.';
      }else if(data?.ok===true&&Array.isArray(data.cards)&&Number.isSafeInteger(data.dataExpiresAt)
        &&data.dataExpiresAt>Date.now()){
        clearPrivate();
        lookup.feedback.textContent='';
        dataExpiresAt=data.dataExpiresAt;
        lastActivity=Date.now();
        onPrivate(data.cards,data.checkedAt);
        expirePrivate();
      }else{
        clearPrivate();
        lookup.feedback.textContent=code===503?'회원 인증은 유지돼요. '+unavailable:unavailable;
      }
    }catch{
      if(key===conversation&&read===cardRead){
        clearPrivate();
        lookup.feedback.textContent=unavailable;
      }
    }finally{
      lookup.control.removeAttribute('aria-disabled');
      if(key===conversation&&read!==cardRead)lookup.feedback.textContent='';
    }
  }
  window.addEventListener('pagehide',()=>{
    cardRead++;
    clearPrivate();
    const field=dialog?.querySelector('input');
    if(field)field.value='';
  });
  document.addEventListener('visibilitychange',expirePrivate);
  return Object.freeze({
    noteActivity(){
      if(!connected||Date.now()-lastActivity<60*60_000)return;
      const key=conversation;
      lastActivity=Date.now();
      void request('touch',{},key).then(({status})=>{
        if(key!==conversation||status!==403)return;
        clearPrivate();
        setConnected(false);
      }).catch(()=>{});
    },
    async offer(container){
      const key=conversation;
      if(!await enabled()||key!==conversation||!container.isConnected)return;
      const feedback=text('div','');feedback.className='chat-pending';
      feedback.setAttribute('role','status');feedback.dataset.memberStatus='';
      const control=button('',()=>{
        if(control.getAttribute('aria-disabled')==='true')return;
        if(connected)void reveal(lookup);
        else{
          panel();
          returnFocus=control;
          status.textContent='';
          showForm(lookup);
        }
      });
      const lookup={control,feedback};
      control.dataset.memberCards='';
      updateLookupButton(control);
      container.append(control);
      container.after(feedback);
      if(connected)await reveal(lookup);
    },
    end
  });
}
