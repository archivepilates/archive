import { makeReferralLink, validReferralCode } from './lib/imweb-referral-links.mjs';

export function mountReferralWidget(container, { code = null, logoUrl, onRequestCode, preview = false } = {}) {
  if (!container || container.querySelector('[data-ap-referral]')) return null;
  const doc = container.ownerDocument;
  const host = doc.createElement('section');
  host.dataset.apReferral = 'v1';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{display:block;color:#252525;font-family:inherit;font-size:16px;line-height:1.6;letter-spacing:0}
    *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.65}
    :focus-visible{outline:3px solid #b3392d;outline-offset:3px}h2,p{margin:0}.wrap{margin:auto;padding:0}
    .heading{display:flex;gap:10px;align-items:center;margin-bottom:20px;padding-right:34px;min-height:48px}.logo{width:36px;height:36px;object-fit:contain;flex:none}
    h2{font-size:20px;line-height:1.35}.sub{color:#686868;font-size:13px;margin-top:4px}.offer{background:#f7f7f7;text-align:center;padding:26px 18px 22px}
    .offer-title{font-size:19px;font-weight:700;line-height:1.45}.amount{font-size:44px;line-height:1.15;font-weight:750;color:#b3392d;margin:10px 0 12px}.amount span{font-size:20px;margin-left:4px}.offer-note{font-size:13px;color:#686868;line-height:1.65}
    .limit{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px 0;border-bottom:1px solid #e6e6e6;text-align:center;font-size:12px;color:#686868}.limit>div+div{border-left:1px solid #e6e6e6}.limit strong{display:block;font-size:17px;color:#252525;margin-top:3px}
    .share{padding-top:12px}.link{width:100%;min-width:0;min-height:44px;border:1px solid #d5d5d5;border-radius:4px;background:#fff;padding:10px 12px;font-size:12px;color:#535353}
    .actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.7fr);gap:8px;margin-top:10px}.actions button,.request{min-height:48px;border:1px solid #252525;border-radius:4px;padding:10px 8px;background:#fff;color:#252525;font-size:14px;font-weight:650}
    .actions button:last-child,.request{background:#252525;color:#fff}.request{width:100%}.message{margin-top:8px;color:#586448;font-size:12px;line-height:1.5}.message:empty{display:none}
    details{margin-top:4px;font-size:12px;color:#686868}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:space-between;color:#535353;font-size:13px}summary::after{content:'+'}details[open] summary::after{content:'−'}
    ul{margin:8px 0 0;padding-left:20px}li+li{margin-top:8px}.preview{color:#686868;font-size:13px;margin-bottom:12px}[hidden]{display:none!important}
    button:hover{filter:brightness(.94)}@media(max-width:350px){h2{font-size:18px}.heading{gap:8px}.offer{padding:22px 12px}.amount{font-size:40px}.actions button{font-size:13px}}
    @media(prefers-reduced-motion:no-preference){button{transition:background-color .15s,color .15s}}
    </style><div class="wrap">
      <p class="preview" ${preview ? '' : 'hidden'}>테스트 화면 · 실제 적립금은 지급되지 않습니다.</p>
      <header class="heading"><img class="logo" alt="ARCHIVE PILATES" width="36" height="36"><div><h2>친구 초대 이벤트</h2><p class="sub">좋은 수업, 친구와 함께 나눠요.</p></div></header>
      <div class="offer"><p class="offer-title">초대한 친구가 가입하면</p><p class="amount">3,000<span>원 적립</span></p><p class="offer-note">구매하지 않아도 괜찮아요.<br>적립금은 초대자에게만 지급돼요.</p></div>
      <div class="limit"><div>친구 1명 가입 시<strong>3,000원</strong></div><div>한 달 최대 10명<strong>30,000원</strong></div></div>
      <details><summary>참여 안내</summary><ul>
      <li>친구가 초대 링크로 이메일 회원가입을 완료하면 초대자에게 한 번 적립돼요. 가입 내역은 5분 간격으로 확인해요.</li>
      <li>처음 가입하는 친구만 참여할 수 있어요. 가입을 마칠 때까지 같은 브라우저에서 진행해 주세요.</li>
      <li>매월 1일 한국시간 기준으로 한도가 새로 시작돼요. 월 10명을 넘은 가입 건은 다음 달로 이월되지 않아요.</li>
      <li>본인 초대와 중복 가입은 제외돼요. 확인이 필요한 가입은 적립이 보류될 수 있어요.</li>
      </ul></details>
      <div class="share"><button class="request" type="button">내 초대 링크 만들기</button>
        <div class="ready" hidden><label class="sub" for="ap-share-link">내 초대 링크</label><input class="link" id="ap-share-link" readonly><div class="actions"><button type="button" data-copy>링크 복사</button><button type="button" data-share>친구에게 공유하기</button></div></div>
        <p class="message" role="status" aria-live="polite"></p>
      </div></div>`;
  const logo = root.querySelector('img');
  if (logoUrl) logo.src = logoUrl; else logo.hidden = true;
  const request = root.querySelector('.request');
  const ready = root.querySelector('.ready');
  const input = root.querySelector('input');
  const message = root.querySelector('.message');
  function setCode(next) {
    if (!validReferralCode(next)) return false;
    input.value = makeReferralLink(next);
    request.hidden = true;
    ready.hidden = false;
    return true;
  }
  request.addEventListener('click', async () => {
    request.disabled = true;
    try {
      const next = await onRequestCode?.();
      if (!setCode(next)) message.textContent = '정보 수정에서 추천인 코드를 만든 뒤 다시 시도해 주세요.';
    } catch { message.textContent = '초대 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.'; }
    finally { request.disabled = false; }
  });
  root.querySelector('[data-copy]').addEventListener('click', async () => {
    try {
      await doc.defaultView.navigator.clipboard.writeText(input.value);
      message.textContent = '링크를 복사했어요. 친구에게 보내 주세요!';
    } catch { input.focus(); input.select(); message.textContent = '선택된 링크를 복사해 주세요.'; }
  });
  root.querySelector('[data-share]').addEventListener('click', async () => {
    try {
      if (!doc.defaultView.navigator.share) {
        root.querySelector('[data-copy]').click();
        return;
      }
      await doc.defaultView.navigator.share({ title: '아카이브필라테스',
        text: '아카이브의 수업을 함께 만나보세요.', url: input.value });
    } catch (error) { if (error.name !== 'AbortError') message.textContent = '공유 창을 열지 못했습니다. 링크 복사를 이용해 주세요.'; }
  });
  setCode(code);
  container.append(host);
  return { host, setCode, destroy: () => host.remove() };
}
