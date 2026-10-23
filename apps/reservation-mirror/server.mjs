import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createMirrorDb, validateTarget} from './safety.mjs';
import {authorize, publicConfig} from './auth.mjs';
import {MirrorRepository, ApiError} from './repository.mjs';

export function createServer({repo, auth = authorize}) {
  const buckets = new Map();
  return http.createServer(async (req, res) => {
    const finish = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY'}); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'https://mirror.invalid');
      if (req.method !== 'GET') return finish(405, {code: 'READ_ONLY_MIRROR', message: '미러에서는 운영 자료를 변경할 수 없습니다.'});
      if (url.pathname === '/api/health') return finish(200, {status: 'ok', mode: 'read_only_mirror', dispatchEnabled: false});
      if (url.pathname === '/api/config') return finish(200, publicConfig);
      if (url.pathname.startsWith('/api/')) {
        const ip = req.socket.remoteAddress || 'unknown', minute = Math.floor(Date.now() / 60000);
        if (buckets.size > 2048) for (const [k, v] of buckets) if (v.minute !== minute) buckets.delete(k);
        const bucket = buckets.get(ip)?.minute === minute ? buckets.get(ip) : {minute, count: 0};
        if (++bucket.count > 180) return finish(429, {code: 'RATE_LIMIT', message: '요청이 많습니다. 잠시 후 다시 시도해 주세요.'});
        buckets.set(ip, bucket);
        const session = await auth(req);
        if (url.pathname === '/api/session') return finish(200, session);
        if (url.pathname === '/api/summary') return finish(200, await repo.summary());
        if (url.pathname === '/api/list') return finish(200, await repo.list(url.searchParams));
        if (url.pathname === '/api/member') return finish(200, await repo.member(url.searchParams.get('id')));
        return finish(404, {code: 'NOT_FOUND', message: '지원하지 않는 조회입니다.'});
      }
      const assets = {'/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/symbol.png': ['symbol.png', 'image/png']};
      const file = assets[url.pathname]; if (!file) return finish(404, {code: 'NOT_FOUND'});
      const bytes = await readFile(new URL('./dist/' + file[0], import.meta.url));
      res.writeHead(200, {'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src https://archive-pilates.firebaseapp.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
      res.end(bytes);
    } catch (error) {
      const known = error instanceof ApiError;
      if (!known) console.error(JSON.stringify({type: 'mirror_read_failed', code: String(error.code || error.name).slice(0, 40)}));
      finish(known ? error.status : 503, {code: known ? error.code : 'MIRROR_UNAVAILABLE', message: known ? error.message : '미러 조회를 완료하지 못했습니다. 다시 확인해 주세요.'});
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  validateTarget();
  const db = createMirrorDb(), server = createServer({repo: new MirrorRepository(db)});
  const port = Number(process.env.PORT || 4312); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  server.listen(port, process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', () => console.log('Read-only reservation mirror started. No dispatch adapter.'));
  const stop = () => { server.close(); server.closeIdleConnections(); void db.terminate(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
