import { connectReferralSession } from './lib/imweb-referral-session.mjs';
import { incomingReferral } from './lib/imweb-referral-links.mjs';
import { nativeSignupField, nativeOwnCode, nativeProfileLink, isReferralSite, waitForNative } from './lib/imweb-referral-native.mjs';
import { mountReferralWidget } from './imweb-referral-widget.mjs';

function start() {
  if (!isReferralSite(location) || document.getElementById('ap-referral-dialog')) return;
  connectReferralSession({ window, resolveSignupField: () => nativeSignupField(document),
    readOwnCode: () => nativeOwnCode(document) });

  const style = document.createElement('style');
  style.textContent = `#ap-referral-dialog{box-sizing:border-box;width:min(600px,calc(100% - 32px));max-height:calc(100dvh - 32px);margin:auto;padding:20px 24px;border:1px solid #d5d5d5;border-radius:8px;background:#fff;color:#252525;overflow:auto;overscroll-behavior:contain}
  #ap-referral-dialog::backdrop{background:rgba(0,0,0,.36)}#ap-referral-dialog [data-referral-close]{display:block;margin-left:auto;min-height:44px;padding:8px 16px;border:1px solid #c9c9c9;border-radius:4px;background:white;font:inherit;cursor:pointer}
  #ap-referral-dialog [data-referral-close]:focus-visible,.ap-referral-entry:focus-visible{outline:3px solid #b3392d;outline-offset:3px}
  .ap-referral-entry{font:inherit;letter-spacing:0;cursor:pointer}.ap-referral-footer{display:block;margin:20px auto;min-height:44px;padding:8px 20px;border:1px solid #c9c9c9;border-radius:4px;background:#fff;color:#252525}
  #mobile_slide_menu .ap-referral-side{display:block;width:100%;min-height:52px;border:0;border-top:1px solid #eee;border-bottom:1px solid #eee;border-radius:0;background:#fff;text-align:left;padding:14px 34px;color:#252525;font-size:18px;font-weight:700;line-height:1.5}
  #ap-referral-dialog .ap-invite-note{font:inherit;margin:20px 0 8px;line-height:1.65;overflow-wrap:anywhere}#ap-referral-dialog .ap-invite-join{min-height:48px;width:100%;font:inherit;background:#252525;color:#fff;border:0;border-radius:4px;padding:12px;cursor:pointer}@media(max-width:400px){#ap-referral-dialog{padding:12px 16px}}`;
  document.head.append(style);
  const dialog = document.createElement('dialog');
  dialog.id = 'ap-referral-dialog'; dialog.setAttribute('aria-label', '친구 초대');
  const close = document.createElement('button');
  close.type = 'button'; close.dataset.referralClose = ''; close.textContent = '닫기';
  close.addEventListener('click', () => dialog.close());
  const content = document.createElement('div');
  dialog.append(close, content); document.body.append(dialog);
  let opener;
  dialog.addEventListener('close', () => opener?.focus());

  function memberLink() { return nativeProfileLink(document); }
  function nativeJoin() {
    return [...document.querySelectorAll('a')].find(link => link.textContent.trim() === '회원가입');
  }
  function open() {
    opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
  }
  const widget = mountReferralWidget(content, { logoUrl: __ARCHIVE_REFERRAL_LOGO__, onRequestCode: async () => {
    const profile = memberLink();
    if (!profile) {
      const login = [...document.querySelectorAll('a')].find(link => link.textContent.trim() === '로그인');
      if (login) { dialog.close(); login.click(); }
      throw new Error('Login required');
    }
    dialog.close();
    try {
      profile.click();
      const first = await waitForNative(window, () => nativeOwnCode(document) ||
        document.querySelector('a[onclick^="createRecommendCode("]'));
      if (typeof first !== 'string') first.click();
      return await waitForNative(window, () => nativeOwnCode(document));
    } finally {
      document.querySelector('#cocoaModal button[data-dismiss="modal"]')?.click();
      open();
    }
  } });

  function addEntry(parent, className) {
    if (!parent || parent.querySelector('.' + className)) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ap-referral-entry ' + className;
    button.textContent = '친구 초대'; button.addEventListener('click', open); parent.append(button);
  }
  function entries() {
    addEntry(document.getElementById('doz_footer_wrap'), 'ap-referral-footer');
    addEntry(document.getElementById('mobile_slide_menu'), 'ap-referral-side');
    const code = nativeOwnCode(document);
    if (code) widget.setCode(code);
  }
  let frame;
  const observer = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = null; entries(); });
  });
  observer.observe(document.body, { childList: true, subtree: true }); entries();

  if (incomingReferral(location.href)) {
    const note = document.createElement('p'); note.className = 'ap-invite-note';
    note.textContent = memberLink() ? '초대 혜택은 처음 가입하는 친구에게만 적용됩니다. 내 초대 링크로 다른 친구를 초대할 수 있어요.' :
      '친구의 초대로 오셨군요. 이메일로 처음 가입하면 초대한 친구에게 3,000원이 적립됩니다.';
    content.prepend(note);
    if (!memberLink()) {
      const join = document.createElement('button'); join.type = 'button'; join.className = 'ap-invite-join';
      join.textContent = '이메일로 회원가입'; join.addEventListener('click', () => {
        const link = nativeJoin();
        if (link) { dialog.close(); link.click(); }
        else note.textContent = '사이트 메뉴에서 회원가입을 선택해 주세요. 추천인 코드는 가입 화면에 적용됩니다.';
      });
      note.after(join);
    }
    open();
  } else if (new URL(location.href).searchParams.get('ap_referral') === '1') open();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
