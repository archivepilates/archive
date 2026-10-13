export function youtubeReelApprovalPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <title>YouTube 릴스 공개 승인 | ARCHIVE PILATES</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #fafafa; color: #222; font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
    main { width: min(100%, 42rem); margin: 0 auto; padding: 2rem 1rem 3rem; }
    header { padding-bottom: 1.25rem; border-bottom: 1px solid #dedede; }
    .brand { margin: 0 0 .75rem; font-size: .875rem; font-weight: 700; color: #b5232a; }
    h1 { margin: 0; font-size: 1.5rem; line-height: 1.4; }
    h2 { margin: 0 0 1rem; font-size: 1.125rem; line-height: 1.5; }
    p { margin: 0; }
    h1, h2, p, dd, a, button { overflow-wrap: anywhere; word-break: normal; }
    [hidden] { display: none !important; }
    section { min-width: 0; margin-top: 1.5rem; }
    .notice { padding: 1rem; border-left: 3px solid #777; background: #f0f0f0; }
    .notice[data-tone="success"] { border-color: #267148; background: #edf5f0; }
    .notice[data-tone="error"] { border-color: #b5232a; background: #fbeeee; }
    #state { font-weight: 700; }
    #message { margin-top: .375rem; color: #505050; }
    .test { display: inline-block; margin-bottom: .75rem; color: #b5232a; font-size: .875rem; font-weight: 700; }
    .preview { display: block; color: #222; text-decoration: none; }
    .preview img { display: block; width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: contain; background: #eee; }
    .preview span { display: block; min-height: 44px; padding: .625rem 0; text-decoration: underline; text-underline-offset: .2em; }
    dl { margin: 1rem 0 0; }
    dt { color: #666; font-size: .875rem; }
    dd { margin: .125rem 0 0; }
    .actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1.5rem; }
    button { min-width: 0; min-height: 48px; width: 100%; padding: .75rem 1rem; border: 1px solid #222; border-radius: 4px; background: #222; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    button.secondary { background: transparent; color: #222; }
    button:disabled { background: #e5e5e5; color: #666; border-color: #ccc; cursor: default; }
    button:focus-visible, a:focus-visible { outline: 3px solid #b5232a; outline-offset: 4px; }
    footer { margin-top: 2rem; color: #666; font-size: .875rem; }
    @media (min-width: 40rem) { main { padding: 3rem 2rem; } button { width: auto; min-width: 10rem; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="brand">ARCHIVE PILATES</p>
      <h1>YouTube 릴스 공개 승인</h1>
    </header>
    <section id="notice" class="notice" role="status" aria-live="polite" aria-atomic="true">
      <p id="state">승인 정보를 확인하고 있습니다.</p>
      <p id="message"></p>
    </section>
    <section id="details" aria-label="승인 대상 영상" hidden>
      <p id="test" class="test" hidden>테스트 승인 요청</p>
      <h2 id="title"></h2>
      <a id="preview" class="preview" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" hidden>
        <img id="thumbnail" width="480" height="360" alt="승인 대상 영상 미리보기" referrerpolicy="no-referrer">
        <span>YouTube에서 영상 확인</span>
      </a>
      <dl id="expiry" hidden><dt>승인 링크 유효 기한</dt><dd id="expiresAt"></dd></dl>
    </section>
    <div class="actions" id="actions" aria-busy="false">
      <button id="approve" type="button" disabled>공개 승인</button>
      <button id="retry" class="secondary" type="button" hidden>다시 확인</button>
    </div>
    <footer>ARCHIVE PILATES</footer>
    <noscript><p>승인 정보를 확인하려면 JavaScript를 활성화해 주세요. 공개 승인은 처리되지 않았습니다.</p></noscript>
  </main>
  <script>
    (function () {
      'use strict';
      window.addEventListener('hashchange', function () {
        if (location.hash) location.reload();
      });
      var params = new URLSearchParams(location.hash.slice(1));
      var id = params.get('id');
      var token = params.get('token');
      params = null;
      var approve = document.getElementById('approve');
      var retry = document.getElementById('retry');
      var actions = document.getElementById('actions');
      var currentStatus = null;
      var busy = false;
      var canApprove = false;
      var statuses = ['pending', 'approved', 'published', 'expired', 'cancelled', 'failed'];

      function notice(state, message, tone) {
        document.getElementById('state').textContent = state;
        document.getElementById('message').textContent = message || '';
        document.getElementById('notice').dataset.tone = tone || '';
      }

      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (_) {
        notice('승인 링크를 안전하게 열 수 없습니다.', '이 창을 닫고 이메일의 승인 링크를 다시 열어 주세요.', 'error');
        return;
      }

      function validCredential(value, maxLength) {
        return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\\s\\u0000-\\u001f\\u007f]/.test(value);
      }

      if (!validCredential(id, 256) || !validCredential(token, 4096)) {
        notice('승인 링크가 올바르지 않습니다.', '이메일의 승인 링크를 다시 열어 주세요.', 'error');
        return;
      }

      function validResponse(data) {
        return data && typeof data === 'object' && typeof data.ok === 'boolean' &&
          statuses.indexOf(data.status) !== -1 && typeof data.title === 'string' &&
          typeof data.videoId === 'string' && typeof data.expiresAt === 'number' &&
          Number.isFinite(data.expiresAt) &&
          (data.message === undefined || typeof data.message === 'string') &&
          (data.isTest === undefined || typeof data.isTest === 'boolean');
      }

      function render(data, action) {
        currentStatus = data.status;
        document.getElementById('details').hidden = false;
        document.getElementById('title').textContent = data.title || '제목 없는 영상';
        document.getElementById('test').hidden = data.isTest !== true;
        var preview = document.getElementById('preview');
        var thumbnail = document.getElementById('thumbnail');
        preview.hidden = true;
        preview.removeAttribute('href');
        thumbnail.removeAttribute('src');
        if (/^[A-Za-z0-9_-]{11}$/.test(data.videoId)) {
          preview.href = 'https://www.youtube.com/shorts/' + data.videoId;
          thumbnail.referrerPolicy = 'no-referrer';
          thumbnail.src = 'https://i.ytimg.com/vi/' + data.videoId + '/hqdefault.jpg';
          preview.hidden = false;
        }
        var expiryDate = new Date(data.expiresAt);
        document.getElementById('expiry').hidden = data.expiresAt <= 0 || !Number.isFinite(expiryDate.getTime());
        document.getElementById('expiresAt').textContent = Number.isFinite(expiryDate.getTime()) && data.expiresAt > 0
          ? expiryDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' (한국 시간)' : '';
        canApprove = data.ok && data.status === 'pending';
        var states = {
          pending: ['공개 승인 대기', ''],
          approved: ['공개 승인이 접수되었습니다.', '영상 공개 완료 여부는 아직 확인되지 않았습니다.'],
          published: ['영상 공개가 완료되었습니다.', ''],
          expired: ['승인 링크가 만료되었습니다.', '새 승인 링크를 요청해 주세요.'],
          cancelled: ['승인 요청이 취소되었습니다.', '이 링크로는 공개 승인할 수 없습니다.'],
          failed: ['승인 요청을 처리할 수 없습니다.', '담당자에게 승인 요청 상태를 확인해 주세요.']
        };
        var state = states[data.status];
        if (!data.ok) {
          canApprove = false;
          notice('승인 요청을 처리할 수 없습니다.', data.message || state[1] || '담당자에게 승인 요청 상태를 확인해 주세요.', 'error');
        } else if (action === 'approve' && data.status === 'pending') {
          canApprove = false;
          notice('공개 승인 접수 여부를 확인해 주세요.', '아래에서 상태를 다시 확인해 주세요.', 'error');
          retry.hidden = false;
        } else {
          notice(state[0], state[1], data.status === 'approved' || data.status === 'published' ? 'success' : data.status === 'pending' ? '' : 'error');
        }
      }

      async function request(action) {
        if (busy || (action === 'approve' && (!canApprove || currentStatus !== 'pending'))) return;
        var previouslyPending = canApprove && currentStatus === 'pending';
        busy = true;
        canApprove = false;
        approve.disabled = true;
        retry.hidden = true;
        retry.disabled = true;
        actions.setAttribute('aria-busy', 'true');
        approve.textContent = action === 'approve' ? '승인 요청 중' : '공개 승인';
        notice(action === 'approve' ? '공개 승인을 요청하고 있습니다.' : '승인 정보를 확인하고 있습니다.', '', '');
        var controller = new AbortController();
        var timeout = setTimeout(function () { controller.abort(); }, 15000);
        var retriable = true;
        try {
          var response = await fetch(location.pathname, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
            body: JSON.stringify({ id: id, token: token, action: action })
          });
          retriable = response.status === 408 || response.status === 429 || response.status >= 500;
          if (!response.ok) throw new Error('request-failed');
          retriable = false;
          var data = await response.json();
          if (!validResponse(data)) throw new Error('invalid-response');
          render(data, action);
        } catch (_) {
          canApprove = retriable && previouslyPending;
          retry.hidden = !retriable;
          notice(action === 'approve' ? '공개 승인 접수 여부를 확인하지 못했습니다.' : '승인 정보를 확인하지 못했습니다.',
            retriable ? '연결이 원활하지 않습니다. 상태를 다시 확인해 주세요.' : '이메일의 링크를 다시 열거나 담당자에게 확인해 주세요.', 'error');
        } finally {
          clearTimeout(timeout);
          busy = false;
          approve.disabled = !canApprove;
          approve.textContent = '공개 승인';
          retry.disabled = false;
          actions.setAttribute('aria-busy', 'false');
        }
      }

      approve.addEventListener('click', function () { void request('approve'); });
      retry.addEventListener('click', function () { void request('inspect'); });
      void request('inspect');
    }());
  </script>
</body>
</html>`;
}
