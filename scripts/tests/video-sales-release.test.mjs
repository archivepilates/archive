import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  VIDEO_ROUTES, salesHostingConfig, salesManifest, salesSourceScope, assertRedirectResult,
} from '../release-video-sales-improvements.mjs';
import { productCopy, renderProduct } from '../video-sales-product-copy.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const baseline = name => execFileSync('git', ['show', `b4f52707:${name}`], { cwd: root, encoding: 'utf8' });
const beforeHome = baseline('official-home/index.html');
const afterHome = fs.readFileSync(new URL('../../official-home/index.html', import.meta.url), 'utf8');
const classroom = '/assets/imweb-my-classroom-20260723a.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const replacement = hash('synthetic-reviewed-home-only');
const unsupported = [undefined, '', 'rules', 'classroom', 'constructor', '__proto__', 'toString'];
const note = '          <div class="rule-note" id="video-sales-conversion-20261103"><strong>Video sales</strong><span>Verified home and product copy only.</span></div>\n';
const beforeCore = '<!doctype html>\n<body>\n  <main>\n    <h1>Existing rules</h1>\n  </main>\n</body>\n';
const afterCore = beforeCore.replace('  </main>\n', `${note}  </main>\n`);

function filesFixture(target = 'home') {
  const resource = target === 'home' ? '/index.html' : '/rules/index.html';
  return [{ path: resource, hash: hash('old-target') },
    { path: classroom, hash: hash('current-live-classroom-not-local-git') },
    ...Array.from({ length: 78 }, (_, i) => ({ path: `/preserved-${i}.css`, hash: hash(`live-${i}`) }))];
}

function configFixture() {
  return {
    redirects: [{ source: '/legacy/**', destination: '/kept', type: 302 }],
    headers: [{ glob: '**', headers: { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } }],
    rewrites: [{ glob: '**', path: '/index.html' }], cleanUrls: true, trailingSlash: false,
    i18n: { root: '/locales' }, custom: { nested: { preserve: ['all', { live: true }] } },
  };
}

test('routes are exactly the numeric detail and two fixed legacy path redirects to the official Imweb origin', () => {
  assert.deepEqual(VIDEO_ROUTES, [
    { regex: '^/shop_view/([0-9]+)/?$', location: 'https://archivepilates.imweb.me/17/?idx=:1', statusCode: 301 },
    { regex: '^/(17|shop_view)/?$', location: 'https://archivepilates.imweb.me/17', statusCode: 301 },
  ]);
  const resolve = pathname => VIDEO_ROUTES.flatMap(route => {
    const match = pathname.match(new RegExp(route.regex));
    return match ? [{ ...route, location: route.location.replace(/:(\d+)/g, (_, n) => match[Number(n)]) }] : [];
  });
  for (const pathname of ['/shop_view/88', '/shop_view/89/', '/shop_view/123456']) {
    const [route] = resolve(pathname);
    assert.equal(resolve(pathname).length, 1);
    assert.equal(new URL(route.location).searchParams.get('idx'), pathname.match(/[0-9]+/)[0]);
  }
  for (const pathname of ['/17', '/17/', '/shop_view', '/shop_view/']) assert.equal(resolve(pathname).length, 1);
  for (const pathname of ['/', '/shop_view/-1', '/shop_view/1.5', '/shop_view/abc', '/shop_view/88/extra',
    '/shop_view/%38%38', '/shop_view/88evil', '/17/88', '//evil.example/17',
    'https://evil.example/shop_view/88', '/teams', '/offline', '/community', '/archive-method-watch-ab11']) {
    assert.deepEqual(resolve(pathname), [], pathname);
  }
  for (const route of VIDEO_ROUTES) {
    const url = new URL(route.location);
    assert.equal(url.origin, 'https://archivepilates.imweb.me');
    assert.equal(url.username + url.password + url.hash, '');
  }
});

test('home config prepends only reviewed routes and deeply preserves every live config field', () => {
  const config = configFixture(), original = structuredClone(config);
  const result = salesHostingConfig(config, 'home');
  assert.deepEqual(config, original);
  assert.deepEqual(result, { ...original, redirects: [...VIDEO_ROUTES, ...original.redirects] });
  result.headers[0].headers['Cache-Control'] = 'mutated-test-copy';
  result.custom.nested.preserve[1].live = false;
  result.redirects[2].destination = '/mutated-test-copy';
  assert.deepEqual(config, original);
});

test('CORE config is an independent deep clone with no route or config changes', () => {
  const config = configFixture(), result = salesHostingConfig(config, 'core-rules');
  assert.deepEqual(result, config);
  assert.notEqual(result, config);
  result.custom.nested.preserve.push('test-only');
  assert.equal(config.custom.nested.preserve.length, 2);
  assert.deepEqual(salesHostingConfig({ headers: [] }, 'core-rules'), { headers: [] });
});

test('config rejects unknown targets, missing redirect arrays and existing same-regex routes', () => {
  for (const target of unsupported) assert.throws(() => salesHostingConfig(configFixture(), target));
  for (const redirects of [undefined, null, {}, 'not-an-array']) {
    assert.throws(() => salesHostingConfig({ redirects }, 'home'));
  }
  for (const route of VIDEO_ROUTES) {
    const config = configFixture(); config.redirects.push({ ...route });
    assert.throws(() => salesHostingConfig(config, 'home'));
  }
});

test('all 80 live hashes survive, with only index replaced and current classroom bytes untouched', () => {
  const files = filesFixture(), original = structuredClone(files);
  const manifest = salesManifest(files, replacement, 'home');
  assert.equal(Object.keys(manifest).length, 80);
  assert.deepEqual(files, original);
  assert.deepEqual(Object.entries(manifest), files.map(file => [file.path, file.path === '/index.html' ? replacement : file.hash]));
  assert.equal(manifest[classroom], original.find(file => file.path === classroom).hash);
  assert.equal(files.filter(file => manifest[file.path] !== file.hash).length, 1);
});

test('manifest rejects incomplete 80-file home baselines before publication', () => {
  const files = filesFixture();
  assert.throws(() => salesManifest(files.slice(0, -1), replacement, 'home'), 'Missing unrelated live file must stop release');
});

test('manifest rejects expanded 80-file home baselines before publication', () => {
  const files = filesFixture();
  assert.throws(() => salesManifest([...files, { path: '/unexpected.css', hash: hash('extra') }], replacement, 'home'));
});

test('manifest rejects unknown targets, missing classroom/target, malformed hashes and duplicate paths', () => {
  const files = filesFixture();
  for (const target of unsupported) assert.throws(() => salesManifest(files, replacement, target));
  for (const invalid of [files.map(file => file.path === classroom ? { ...file, path: '/missing-classroom.js' } : file),
    files.map((file, i) => i === 0 ? { ...file, path: '/missing-index.html' } : file),
    files.map((file, i) => i === 2 ? { ...files[0] } : file),
    files.map((file, i) => i === 2 ? { ...file, hash: 'invalid' } : file),
    files.map((file, i) => i === 2 ? { ...file, path: 'relative.css' } : file)]) {
    assert.throws(() => salesManifest(invalid, replacement, 'home'));
  }
  for (const invalid of ['', '0'.repeat(63), 'g'.repeat(64), null]) {
    assert.throws(() => salesManifest(files, invalid, 'home'));
  }
});

test('CORE manifest replaces only the named rules resource without changing index or classroom hashes', () => {
  const files = [...filesFixture('core-rules'), { path: '/index.html', hash: hash('core-home') }];
  const manifest = salesManifest(files, replacement, 'core-rules');
  assert.deepEqual(files.filter(file => manifest[file.path] !== file.hash).map(file => file.path), ['/rules/index.html']);
  assert.equal(manifest[classroom], files[1].hash);
  assert.equal(manifest['/index.html'], hash('core-home'));
});

test('source guard accepts the actual bounded home patch but rejects no-op and unrelated body/nav/community changes', () => {
  assert.doesNotThrow(() => salesSourceScope(beforeHome, afterHome, 'home'));
  assert.throws(() => salesSourceScope(beforeHome, beforeHome, 'home'));
  for (const candidate of [afterHome + '\n', afterHome.replace('<body class="public-home">', '<body class="changed">'),
    afterHome.replace('href="/shop"', 'href="/changed"'), afterHome.replace('스튜디오 기록</h2>', 'Changed community</h2>'),
    afterHome.replace('<h1>ARCHIVE PILATES</h1>', '<h1>Changed brand</h1>'),
    afterHome.replace('부산 명지, 팀아카이브', 'Changed team content')]) {
    assert.notEqual(candidate, afterHome);
    assert.throws(() => salesSourceScope(beforeHome, candidate, 'home'));
  }
});

test('source guard rejects unapproved offline content and links inside the retained classes section', () => {
  for (const [from, to] of [['5:1 오프라인 강사레슨', 'Unapproved offline copy'],
    ['href="/instructor-lessons"', 'href="https://evil.example/"']]) {
    const candidate = afterHome.replace(from, to);
    assert.notEqual(candidate, afterHome);
    assert.throws(() => salesSourceScope(beforeHome, candidate, 'home'), `Must preserve ${from}`);
  }
});

test('source guard rejects unrelated body CSS hidden inside the new normalized style block', () => {
  const candidate = afterHome.replace('    .public-home .classes-learning {', '    body { display: none; }\n    .public-home .classes-learning {');
  assert.notEqual(candidate, afterHome);
  assert.throws(() => salesSourceScope(beforeHome, candidate, 'home'));
});

test('source guard rejects paid video embeds and unknown targets', () => {
  for (const id of ['Es-G6_WekWo', 'qdS2a3KXnmU']) {
    const candidate = afterHome.replace('gZTRX-sd0zQ', id);
    assert.notEqual(candidate, afterHome);
    assert.throws(() => salesSourceScope(beforeHome, candidate, 'home'));
  }
  for (const target of unsupported) assert.throws(() => salesSourceScope(beforeHome, afterHome, target));
});

test('CORE scope permits exactly one plain-text note with the named ID and no neighbor changes', () => {
  assert.doesNotThrow(() => salesSourceScope(beforeCore, afterCore, 'core-rules'));
  for (const candidate of [beforeCore, afterCore + '\n', afterCore.replace(note, note + note),
    afterCore.replace('video-sales-conversion-20261103', 'unapproved-note'),
    afterCore.replace('Existing rules', 'Changed rules'), afterCore.replace('Video sales', '<b>Video sales</b>'),
    afterCore.replace('Verified home', 'Verified\nhome')]) {
    assert.throws(() => salesSourceScope(beforeCore, candidate, 'core-rules'));
  }
  assert.throws(() => salesSourceScope(afterCore, afterCore, 'core-rules'));
});

test('redirect readback accepts only 301 with exact product identity and retained source tracking', () => {
  for (const [from, to] of [
    ['/17', 'https://archivepilates.imweb.me/17'],
    ['/17?idx=88&utm_source=qa', 'https://archivepilates.imweb.me/17/?idx=88&utm_source=qa'],
    ['/shop_view?idx=89&utm_source=qa', 'https://archivepilates.imweb.me/17/?idx=89&utm_source=qa'],
    ['/shop_view/88', 'https://archivepilates.imweb.me/17/?idx=88'],
  ]) assert.doesNotThrow(() => assertRedirectResult(from, 301, to));
});

test('redirect readback rejects lost/replaced idx, wrong origin/path, status failures and lost tracking', () => {
  const from = '/17?idx=88&utm_source=qa';
  for (const to of ['https://archivepilates.imweb.me/17?utm_source=qa',
    'https://archivepilates.imweb.me/17?idx=89&utm_source=qa',
    'https://evil.example/17?idx=88&utm_source=qa',
    'https://archivepilates.imweb.me.evil.example/17?idx=88&utm_source=qa',
    'http://archivepilates.imweb.me/17?idx=88&utm_source=qa',
    'https://archivepilates.imweb.me/48?idx=88&utm_source=qa',
    'https://archivepilates.imweb.me/17?idx=88', 'https://archivepilates.imweb.me/17?idx=88&utm_source=wrong',
    '/17?idx=88&utm_source=qa', null]) assert.throws(() => assertRedirectResult(from, 301, to));
  for (const status of [200, 302, 307, 308, 404, 500, '301', null]) {
    assert.throws(() => assertRedirectResult(from, status, 'https://archivepilates.imweb.me/17?idx=88&utm_source=qa'));
  }
  assert.throws(() => assertRedirectResult('/shop_view/88', 301, 'https://archivepilates.imweb.me/17?idx=89'));
});

test('product info uses write aliases and maps them to GET fields in both skip and post-write verification', () => {
  const source = read('video-sales-product-copy.mjs');
  assert.match(source, /payload:\s*\{\s*description:\s*renderProduct\(no\),\s*summaryDescription:\s*p\.simple\s*\}/);
  assert.match(source, /readKeys:\s*\{\s*description:\s*'content',\s*summaryDescription:\s*'simpleContent'\s*\}/);
  assert.match(source, /const resultKey = key => step\.readKeys\?\.\[key\] \|\| key;/);
  assert.match(source, /Object\.entries\(step\.payload\)\.every\(\(\[key,value\]\) => isDeepStrictEqual\(current\[resultKey\(key\)\],value\)\)/);
  assert.match(source, /for \(const \[key,value\] of Object\.entries\(step\.payload\)\) assert\.deepEqual\(after\[resultKey\(key\)\],value\)/);
  assert.match(source, /const \{ content, simpleContent, seoTitle, seoDescription, editTime, \.\.\.rest \} = p/);
  assert.match(source, /'--data',JSON\.stringify\(step\.payload\)/);
  assert.doesNotMatch(source, /payload:\s*\{\s*(?:content|simpleContent):/);
});

test('pure product exports expose exactly the two approved public previews and unchanged 40-day wording', () => {
  assert.deepEqual(Object.keys(productCopy), ['88', '89']);
  for (const [no, preview] of [[88, 'gZTRX-sd0zQ'], [89, 'iRMthLJlooA']]) {
    const html = renderProduct(no);
    assert.equal(productCopy[no].preview, preview);
    assert.equal((html.match(/<iframe\b/g) || []).length, 1);
    assert.match(html, new RegExp(`https://www\\.youtube\\.com/embed/${preview}\\?rel=0`));
    assert.match(html, /40일/);
    assert.doesNotMatch(html, /Es-G6_WekWo|qdS2a3KXnmU/);
  }
});
