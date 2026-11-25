const path='/api/member-access/';
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const guide='https://archivepilates.notion.site/studiomate';
const $=tag=>document.createElement(tag);
const text=(tag,value)=>{const el=$(tag);el.textContent=value;return el;};
const errorText='등록이나 인증을 마치지 못했어요. 잠시 후 다시 시도하거나 직원에게 문의해 주세요.';

export function createMemberConnection({onPrivate,onClear}){
  let invitation='',epoch=0,dialog,status,pendingScope=null,lease=0,working=false,connected=false;
  let capability;
  const resetFragment=()=>{
    const m=/^#member-invite=([A-Za-z0-9_-]{43})$/.exec(location.hash);
    if(!m)return false;
    invitation=m[1];history.replaceState(null,'',location.pathname+location.search);
    return true;
  };
  const request=async (op,body={})=>{
    const r=await fetch(path+op,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45_000)});
    if(!r.ok||!/^application\/json/i.test(r.headers.get('content-type')??''))return {ok:false};
    return await r.json();
  };
  const enabled=()=>capability??=(request('availability').then(r=>r.ok===true&&r.remoteOtp===true).catch(()=>false));
  const support=()=>typeof window.PublicKeyCredential?.parseCreationOptionsFromJSON==='function'&&
    typeof window.PublicKeyCredential?.parseRequestOptionsFromJSON==='function';
  const button=(label,action)=>{const b=text('button',label);b.type='button';b.addEventListener('click',action);return b;};
  let receipt='',returnFocus=null;
  function clear(){
    epoch++;clearTimeout(lease);connected=false;pendingScope=null;receipt='';onClear();
  }
  function close(){
    if(dialog?.open)dialog.close();
    returnFocus?.focus({preventScroll:true});returnFocus=null;
  }
  function end(){
    const shouldLogOut=connected||!!dialog?.open;
    clear();close();
    if(shouldLogOut)void request('logout').catch(()=>{});
  }
  function panel(){
    if(dialog)return dialog;
    dialog=$('dialog');dialog.id='member-access';dialog.setAttribute('aria-labelledby','member-access-title');
    const heading=text('h2','회원 챗봇 연결');heading.id='member-access-title';
    status=text('p','');status.setAttribute('role','status');status.className='member-access-status';
    const docs=text('a','공식 회원 앱 이용 안내');docs.href=guide;
    const actions=$('div');actions.className='member-access-actions';actions.dataset.section='actions';
    dialog.append(heading,status,actions,docs);document.body.append(dialog);
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(!working)close();});
    return dialog;
  }
  function show(trigger){
    returnFocus=trigger??document.activeElement;
    panel().querySelector('[data-section="actions"]').replaceChildren();
    receipt='';status.textContent='';
    const actions=dialog.querySelector('[data-section="actions"]');
    if(support()){
      actions.append(button('패스키로 로그인',()=>void authenticate('login')));
      if(token(invitation))actions.append(button('인증번호 받기',()=>void otpStart(actions)));
      else status.textContent='처음 등록하는 회원은 웰컴 알림톡의 패스키 등록 버튼을 열어 주세요.';
    }else status.textContent='이 브라우저에서는 패스키 기능을 확인하지 못했어요. 휴대폰 기본 브라우저에서 열거나 회원 앱을 이용해 주세요.';
    actions.append(button('닫기',()=>{if(!working)close();}));
    if(!dialog.open)dialog.showModal();
  }
  function lock(value){
    working=value;
    if(!dialog)return;
    for(const item of dialog.querySelectorAll('button,input'))item.disabled=value;
  }
  async function otpStart(actions){
    if(working||!token(invitation))return;
    lock(true);
    try{
      const r=await request('otp-start',{invitation});
      if(!r.ok)throw Error();
      status.textContent='등록된 번호로 받은 별도 알림톡의 숫자 6자리를 입력해 주세요. 발송은 오전 9시부터 밤 11시 전까지 가능합니다.';
      const form=$('form');form.autocomplete='off';
      const label=text('label','알림톡 인증번호'),input=$('input');
      input.inputMode='numeric';input.autocomplete='one-time-code';input.pattern='[0-9]{6}';input.maxLength=6;input.required=true;
      label.append(input);
      const confirm=text('button','번호 확인');confirm.type='submit';form.append(label,confirm);
      form.addEventListener('submit',event=>{event.preventDefault();void verifyCode(input);});
      actions.replaceChildren(form,button('닫기',()=>{if(!working)close();}));
      input.focus();
    }catch{status.textContent=errorText;}finally{lock(false);}
  }
  async function verifyCode(input){
    if(working||!/^\d{6}$/.test(input.value))return;
    const code=input.value;input.value='';lock(true);
    try{
      const r=await request('otp-verify',{invitation,code});
      if(!r.ok||!token(r.enrollmentReceipt))throw Error();
      receipt=r.enrollmentReceipt;
      status.textContent='번호를 확인했어요. 이 기기에서 패스키 등록을 마쳐 주세요.';
      dialog.querySelector('[data-section="actions"]').replaceChildren(button('패스키 등록',()=>void authenticate('register')),
        button('닫기',()=>{if(!working)close();}));
    }catch{status.textContent=errorText;}finally{lock(false);}
  }
  async function authenticate(mode){
    if(working||!support())return;
    if(mode==='register'&&(!token(receipt)||!token(invitation)))return;
    const snapshot=epoch;
    lock(true);
    try{
      const options=await request(mode==='register'?'registration-options':'login-options',mode==='register'?
        {invitation,enrollmentReceipt:receipt}:{});
      if(!options.ok||snapshot!==epoch)throw Error();
      const C=window.PublicKeyCredential;
      const result=await (mode==='register'?navigator.credentials.create({publicKey:C.parseCreationOptionsFromJSON(options.options)}):
        navigator.credentials.get({publicKey:C.parseRequestOptionsFromJSON(options.options)}));
      if(!result||typeof result.toJSON!=='function'||snapshot!==epoch)throw Error();
      const authenticated=await request(mode,{response:result.toJSON()});
      if(!authenticated.ok||snapshot!==epoch)throw Error();
      connected=true;receipt='';invitation='';close();
      if(pendingScope)await reveal(pendingScope);
    }catch{if(snapshot===epoch&&dialog?.open)status.textContent=errorText;}
    finally{lock(false);}
  }
  async function reveal(scope){
    const snapshot=epoch;
    try{
      const r=await request(scope);
      if(snapshot!==epoch)return false;
      if(!r.ok||!Array.isArray(r[scope])||!Number.isSafeInteger(r.expiresAt)||Date.now()>=r.expiresAt){
        connected=false;clearTimeout(lease);onClear();return false;
      }
      pendingScope=null;connected=true;clearTimeout(lease);
      lease=setTimeout(clear,Math.min(r.expiresAt-Date.now(),20*60_000));
      onPrivate(scope,r[scope],r.checkedAt,end);
      return true;
    }catch{return false;}
  }
  window.addEventListener('pageshow',event=>{if(event.persisted)end();});
  return Object.freeze({
    async offer(scope,container){
      const generation=epoch;
      if(!['cards','history'].includes(scope)||!await enabled()||generation!==epoch||!container.isConnected)return;
      pendingScope=scope;
      if(connected&&await reveal(scope))return;
      if(generation!==epoch||!container.isConnected)return;
      const b=button('회원 인증 후 확인',event=>{
        pendingScope=scope;show(event.currentTarget);
      });
      container.append(b);
    },
    openInvitation(){if(resetFragment())void enabled().then(ok=>{if(ok)show();});},
    end
  });
}
