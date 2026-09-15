import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.ARCHIVE_BUILD_PACKAGE || resolve(root, 'package.json'));
const { buildSync } = require('esbuild');
const logo = `data:image/png;base64,${readFileSync(resolve(root, 'core/icons/archive-pilates-icon-192.png')).toString('base64')}`;
const script = buildSync({ bundle: true, write: false, format: 'iife', target: 'es2020',
  stdin: { resolveDir: root, contents: `
    import { mountReferralWidget } from './scripts/imweb-referral-widget.mjs';
    import { applyReferralToField } from './scripts/lib/imweb-referral-links.mjs';
    const widget = mountReferralWidget(document.querySelector('#widget'), {
      logoUrl: ${JSON.stringify(logo)}, preview: true, onRequestCode: async () => 'DEMO2026'
    });
    document.querySelector('#fill-referral').addEventListener('click', () => {
      const filled = applyReferralToField(document.querySelector('#native-code'), 'DEMO2026');
      document.querySelector('#form-status').textContent = filled
        ? '추천인 코드가 입력되었습니다. 이 화면은 실제 가입을 진행하지 않습니다.'
        : '이미 입력한 추천인 코드를 유지합니다.';
    });
  ` }, minify: true }).outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCHIVE PILATES 친구 초대 테스트</title><style>
  *{box-sizing:border-box}body{margin:0;color:#252525;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:16px;line-height:1.6;letter-spacing:0}main{max-width:760px;margin:auto;padding:24px}header.top{border-bottom:1px solid #dedede;padding:12px 0;color:#686868;font-size:13px}section.fixture{border-top:1px solid #252525;margin-top:32px;padding:24px 0}h2{font-size:20px;margin:0 0 16px}p{margin:0 0 16px}label{display:block}input,button{font:inherit;min-height:48px;border:1px solid #bdbdbd;border-radius:4px;padding:10px 12px;background:#fff;max-width:100%}input{width:100%;margin:8px 0 12px}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #b3392d;outline-offset:3px}.note{color:#686868;font-size:14px}.fixture p[role=status]{margin-top:12px;min-height:48px}@media(max-width:400px){main{padding:16px}}img{max-width:100%}
  </style></head><body><main><header class="top">ARCHIVE PILATES / 친구 초대 검증용</header><div id="widget"></div><section class="fixture"><h2>가입 폼 연결 테스트</h2><p class="note">가입 폼의 입력 동작을 재현한 테스트입니다. 실제 회원가입이나 적립은 진행하지 않습니다.</p><label for="native-code">추천인 코드 (선택)</label><input id="native-code" autocomplete="off"><button id="fill-referral" type="button">초대 링크로 들어온 상태 확인</button><p id="form-status" role="status"></p></section></main><script>${script}</script></body></html>`;
const output = resolve(root, 'docs/previews/2026-09-15-imweb-referral.html');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html);
console.log(output);
