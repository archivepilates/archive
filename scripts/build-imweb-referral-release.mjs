import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(process.env.ARCHIVE_BUILD_PACKAGE || resolve('package.json'));
const { build } = require('esbuild');
const logo = `data:image/png;base64,${readFileSync('core/icons/archive-pilates-icon-192.png').toString('base64')}`;
const result = await build({ entryPoints: ['scripts/imweb-referral-site.mjs'], bundle: true, write: false,
  format: 'iife', target: ['safari15.4', 'chrome100'], minify: true, charset: 'utf8',
  define: { __ARCHIVE_REFERRAL_LOGO__: JSON.stringify(logo) } });
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync('artifacts/imweb-referral', { recursive: true });
writeFileSync('artifacts/imweb-referral/script.html', `<!-- ARCHIVE-REFERRAL:START -->\n<script data-archive-referral="2026-09-15.1">${script}</script>\n<!-- ARCHIVE-REFERRAL:END -->`);
console.log(JSON.stringify({ bundleBytes: Buffer.byteLength(script), output: 'artifacts/imweb-referral/script.html' }));
