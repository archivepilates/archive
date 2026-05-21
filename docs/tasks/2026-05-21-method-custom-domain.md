# method.archivepilates.com Firebase Hosting 연결

## 목표

- `method.archivepilates.com`을 ARCHIVE PILATES 오프라인 강사레슨 상세페이지 전용 Firebase Hosting 사이트로 연결한다.
- 기존 wildcard DNS가 가리키던 Apache 서버의 HTTPS 인증서 불일치 문제를 해소한다.

## 초기 상태

- `method.archivepilates.com`은 명시 DNS 레코드 없이 `*.archivepilates.com` wildcard A 레코드로 `121.254.178.238`에 연결되어 있었다.
- `http://method.archivepilates.com/`은 Apache에서 `200 OK`.
- `https://method.archivepilates.com/`은 인증서 SAN 불일치로 실패.

## 변경

- Firebase Hosting site: `archive-pilates-method`
- Default URL: `https://archive-pilates-method.web.app`
- Hosting public directory: `method`
- Source HTML: `/Users/archivepilates/Downloads/archive_method.html`
- Deployed file: `method/index.html`

## 진행 로그

- 2026-05-21: `archive-pilates-method` Firebase Hosting site 생성 완료.
- 2026-05-21: `method/index.html` 추가 및 `firebase.json`에 method hosting site 추가.
- 2026-05-21: `firebase deploy --only hosting:archive-pilates-method --dry-run` 성공.
- 2026-05-21: `firebase deploy --only hosting:archive-pilates-method` 성공.
- 2026-05-21: `https://archive-pilates-method.web.app/` HTTP 200 확인, `OFFLINE LESSON` 및 `5:1` 페이지 내용 확인.
- 2026-05-21: Firebase Hosting custom domain `method.archivepilates.com` 생성 완료.
- 2026-05-21: Cloudflare DNS 추가:
  - `method.archivepilates.com CNAME archive-pilates-method.web.app` (`proxied=false`, TTL 600)
  - `_acme-challenge.method.archivepilates.com TXT vTXnuKu-YS1Aio7X44xUMXBQtpJMasQFC3VQLcdOvYw` (TTL 600)
- 2026-05-21: `dig @1.1.1.1 method.archivepilates.com CNAME`에서 `archive-pilates-method.web.app.` 확인.

## 현재 대기

- Firebase SSL 인증서 발급 대기 중.
- 2026-05-21 21:38 KST 무렵 Firebase API 상태가 `HOST_ACTIVE` / `OWNERSHIP_ACTIVE`로 전환됨.
- 2026-05-21 21:40 KST 기준 `cert.state`는 `CERT_VALIDATING`.
- 강제 resolve로 `https://method.archivepilates.com/`를 Firebase IP `199.36.158.100`에 연결하면 페이지 HTML은 HTTP 200으로 서빙됨.
- 단, TLS 인증서는 아직 `firebaseapp.com` 임시 인증서라 일반 브라우저 HTTPS 검증은 실패한다.
