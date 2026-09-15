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
    :focus-visible{outline:3px solid #b3392d;outline-offset:3px}h2,p{margin:0}.wrap{max-width:660px;margin:auto;padding:28px 0}
    .heading{display:flex;gap:14px;align-items:center;margin-bottom:28px}.logo{width:48px;height:48px;object-fit:contain;flex:none}
    h2{font-size:26px;line-height:1.3}.sub{color:#686868;font-size:14px;margin-top:4px}.offer{border-top:1px solid #252525;border-bottom:1px solid #dedede;padding:24px 0}
    .amount{font-size:40px;line-height:1.15;font-weight:750;color:#b3392d;margin:8px 0 14px}.amount span{font-size:18px;color:#252525;margin-left:6px}
    .limit{display:flex;justify-content:space-between;gap:12px;margin-top:20px;padding-top:14px;border-top:1px solid #eee;font-size:14px}
    .share{padding-top:24px}.link{width:100%;min-width:0;min-height:48px;border:1px solid #c9c9c9;border-radius:4px;background:#fff;padding:10px 12px;font-size:14px;color:#535353}
    .actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.actions button,.request{min-height:48px;border:1px solid #252525;border-radius:4px;padding:10px 14px;background:#fff;color:#252525;font-weight:650}
    .actions button:last-child{background:#252525;color:#fff}.request{width:100%}.message{min-height:25px;margin-top:8px;color:#586448;font-size:14px}
    details{border-top:1px solid #dedede;margin-top:20px;padding-top:14px;font-size:14px;color:#686868}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:space-between;color:#252525}summary::after{content:'+'}details[open] summary::after{content:'−'}
    ul{margin:8px 0 0;padding-left:20px}li+li{margin-top:8px}.preview{color:#686868;font-size:13px;margin-bottom:12px}[hidden]{display:none!important}
    button:hover{filter:brightness(.94)}@media(max-width:400px){.wrap{padding:20px 0}h2{font-size:23px}.limit{flex-wrap:wrap}.actions{gap:8px}.actions button{padding:10px 8px}}
    @media(prefers-reduced-motion:no-preference){button{transition:background-color .15s,color .15s}}
    </style><div class="wrap">
      <p class="preview" ${preview ? '' : 'hidden'}>테스트 화면 · 실제 적립금은 지급되지 않습니다.</p>
      <header class="heading"><img class="logo" alt="ARCHIVE PILATES" width="48" height="48"><div><h2>친구 초대</h2><p class="sub">좋은 수업을 함께 나눠요.</p></div></header>
      <div class="offer"><p>초대한 친구가 처음 가입하면</p><p class="amount">3,000<span>원 적립</span></p><p>구매하지 않아도 초대자에게 적립됩니다.</p><div class="limit"><span>한 달 최대 10명</span><strong>최대 30,000원</strong></div></div>
      <div class="share"><button class="request" type="button">내 초대코드 확인</button>
        <div class="ready" hidden><label class="sub" for="ap-share-link">내 초대 링크</label><input class="link" id="ap-share-link" readonly><div class="actions"><button type="button" data-copy>링크 복사</button><button type="button" data-share>공유하기</button></div></div>
        <p class="message" role="status" aria-live="polite"></p>
      </div><details><summary>참여 안내</summary><ul>
      <li>초대 링크로 가입한 신규 회원 1명당 초대자에게 한 번 지급됩니다. 신규 회원에게 별도 적립금은 지급되지 않습니다.</li>
      <li>매월 1일 한국시간 기준으로 한도가 시작됩니다. 월 10명을 넘는 가입 건은 다음 달로 이월되지 않습니다.</li>
      <li>본인 초대와 중복 가입은 제외됩니다. 가입 내역 확인 후 적립되며, 확인이 필요한 경우 지급이 보류될 수 있습니다.</li>
      </ul></details></div>`;
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
      if (!setCode(next)) message.textContent = '정보 수정에서 추천인 코드를 생성한 뒤 다시 확인해 주세요.';
    } catch { message.textContent = '초대코드를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
    finally { request.disabled = false; }
  });
  root.querySelector('[data-copy]').addEventListener('click', async () => {
    try {
      await doc.defaultView.navigator.clipboard.writeText(input.value);
      message.textContent = '초대 링크를 복사했습니다.';
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
