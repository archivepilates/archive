import { connectReferralSession } from './lib/imweb-referral-session.mjs';
import { incomingReferral } from './lib/imweb-referral-links.mjs';
import { nativeSignupField, nativeOwnCode, nativeProfileLink, isReferralSite, waitForNative } from './lib/imweb-referral-native.mjs';
import { mountReferralWidget } from './imweb-referral-widget.mjs';

function start() {
  if (!isReferralSite(location) || document.getElementById('ap-referral-dialog')) return;
  connectReferralSession({ window, resolveSignupField: () => nativeSignupField(document),
    readOwnCode: () => nativeOwnCode(document) });

  const style = document.createElement('style');
  style.textContent = `#ap-referral-dialog{box-sizing:border-box;width:min(440px,calc(100% - 32px));max-height:calc(100dvh - 32px);margin:auto;padding:24px;border:1px solid #d5d5d5;border-radius:8px;background:#fff;color:#252525;overflow:auto;overscroll-behavior:contain}
  #ap-referral-dialog::backdrop{background:rgba(0,0,0,.36)}#ap-referral-dialog [data-referral-close]{position:absolute;top:10px;right:10px;display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:4px;background:white;font:28px/1 sans-serif;color:#535353;cursor:pointer}
  #ap-referral-dialog [data-referral-close]:focus-visible,.ap-referral-entry:focus-visible{outline:3px solid #b3392d;outline-offset:3px}
  .ap-referral-entry{font:inherit;letter-spacing:0;cursor:pointer}.ap-referral-footer{display:block;margin:20px auto;min-height:44px;padding:8px 20px;border:1px solid #c9c9c9;border-radius:4px;background:#fff;color:#252525}
  #mobile_slide_menu .ap-referral-side{display:block;width:100%;min-height:52px;border:0;border-top:1px solid #b3392d;border-bottom:1px solid #b3392d;border-radius:0;background:#b3392d;text-align:center;padding:14px 34px;color:#fff;font-size:18px;font-weight:700;line-height:1.5}
  #mobile_slide_menu .ap-referral-side:hover{background:#922f25}#mobile_slide_menu .ap-referral-side:focus-visible{outline:3px solid #fff;outline-offset:-6px}
  #ap-referral-dialog .ap-invite-note{font-family:inherit;font-size:14px;margin:32px 0 12px;line-height:1.65;overflow-wrap:anywhere}#ap-referral-dialog .ap-invite-join{min-height:48px;width:100%;font:inherit;background:#252525;color:#fff;border:0;border-radius:4px;padding:12px;margin-bottom:20px;cursor:pointer}@media(max-width:600px){#ap-referral-dialog{width:100%;max-height:92dvh;margin:auto auto 0;padding:22px 20px calc(20px + env(safe-area-inset-bottom));border-bottom:0;border-radius:8px 8px 0 0}}`;
  document.head.append(style);
  const dialog = document.createElement('dialog');
  dialog.id = 'ap-referral-dialog'; dialog.setAttribute('aria-label', '친구 초대');
  const close = document.createElement('button');
  close.type = 'button'; close.dataset.referralClose = ''; close.textContent = '×'; close.setAttribute('aria-label', '닫기');
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
    addEntry(document.querySelector('#mobile_slide_menu ._menu_wrap'), 'ap-referral-side');
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
    if (!memberLink()) {
      const note = document.createElement('p'); note.className = 'ap-invite-note';
      note.textContent = '친구의 초대로 오셨군요. 이메일로 처음 가입하면 초대한 친구에게 3,000원이 적립됩니다.';
      content.prepend(note);
      const join = document.createElement('button'); join.type = 'button'; join.className = 'ap-invite-join';
      join.textContent = '이메일로 회원가입'; join.addEventListener('click', async () => {
        const link = nativeJoin();
        if (link) {
          dialog.close(); link.click();
          try {
            const emailJoin = await waitForNative(window, () => [...document.querySelectorAll('#cocoaModal a')]
              .find(item => item.textContent.trim() === 'ID/PW 회원가입'));
            emailJoin.click();
          } catch { /* The native signup screen remains available for manual continuation. */ }
        }
        else note.textContent = '사이트 메뉴에서 회원가입을 선택해 주세요. 추천인 코드는 가입 화면에 적용됩니다.';
      });
      note.after(join);
    }
    open();
  } else if (new URL(location.href).searchParams.get('ap_referral') === '1') open();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
