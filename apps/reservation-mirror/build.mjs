import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir(new URL('./dist/', import.meta.url), {recursive: true});
await build({entryPoints: [new URL('./web/app.js', import.meta.url).pathname], bundle: true, format: 'esm', outfile: new URL('./dist/app.js', import.meta.url).pathname, minify: true, target: 'es2022'});
for (const name of ['index.html', 'style.css']) await copyFile(new URL('./web/' + name, import.meta.url), new URL('./dist/' + name, import.meta.url));
await copyFile(new URL('../../core/icons/archive-pilates-icon-192.png', import.meta.url), new URL('./dist/symbol.png', import.meta.url));
console.log('Mirror build complete. No data/config/secrets bundled.');
