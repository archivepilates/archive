# ArchiveIN Custom Domain

Date: 2026-05-16

Status: Complete; custom domain active; Firebase certificate active; HTTPS serves ArchiveIN

## Goal

Serve ArchiveIN at:

```text
https://in.archivepilates.com/
```

without changing the existing default Firebase Hosting site behavior at:

```text
https://archive-pilates.web.app/
https://archive-pilates.web.app/archivein/
https://archive-pilates.web.app/dashboard/
```

## Firebase Hosting Site

Created a dedicated Firebase Hosting site:

```text
Project: archive-pilates
Site: archive-pilates-in
Default URL: https://archive-pilates-in.web.app
```

Updated `firebase.json` to use Firebase multisite hosting:

```text
archive-pilates     -> public "."
archive-pilates-in  -> public "archivein"
```

This keeps the existing default site intact while allowing `archive-pilates-in` to serve ArchiveIN at site root.

## Deploy

Ran a dry-run first:

```bash
firebase deploy --only hosting:archive-pilates-in --project archive-pilates --token "$FIREBASE_TOKEN" --dry-run --non-interactive
```

Then deployed only the new ArchiveIN site:

```bash
firebase deploy --only hosting:archive-pilates-in --project archive-pilates --token "$FIREBASE_TOKEN" --non-interactive
```

Result:

```text
Hosting URL: https://archive-pilates-in.web.app
```

Verification:

```text
https://archive-pilates-in.web.app/ HTTP/2 200
title: 아카이브IN
```

## Custom Domain

Created Firebase Hosting custom domain:

```text
in.archivepilates.com
Site: archive-pilates-in
```

Initial Firebase state:

```text
ownershipState: OWNERSHIP_ACTIVE
hostState: HOST_MISMATCH
certState: CERT_VALIDATING
```

## Cloudflare DNS

Firebase quick setup requires `in.archivepilates.com` to point at the new site default domain.

Cloudflare DNS records now set:

```text
in.archivepilates.com CNAME archive-pilates-in.web.app DNS-only
_acme-challenge.in.archivepilates.com TXT 4Vy5MVzOmrkzIkvzOr0Zjv5E1dVEjQXb3TXtTYjpLw0 DNS-only
```

Public resolver check at 2026-05-16 21:30 KST:

```text
dig @1.1.1.1 +short CNAME in.archivepilates.com
archive-pilates-in.web.app.

dig @1.1.1.1 +short A in.archivepilates.com
archive-pilates-in.web.app.
199.36.158.100
```

## Waiting State

Firebase still reported cached discovered records from the previous wildcard route:

```text
in.archivepilates.com A 121.254.178.238
in.archivepilates.com TXT hosting-site=archive-pilates-in
```

Those records are no longer present as exact Cloudflare records. Firebase should re-check and move from `HOST_MISMATCH` toward active after DNS/cache refresh and certificate validation.

Expected next checks:

```text
hostState: HOST_ACTIVE or HOST_SERVING
certState: CERT_ACTIVE
https://in.archivepilates.com/ HTTP/2 200
title: 아카이브IN
```

## Usable Domain Check

Checked on 2026-05-16 22:17 KST.

Firebase status:

```text
hostState: HOST_ACTIVE
ownershipState: OWNERSHIP_ACTIVE
certState: CERT_PROPAGATING
issues: null
requiredDnsUpdates: null
```

DNS:

```text
in.archivepilates.com CNAME archive-pilates-in.web.app.
in.archivepilates.com A 199.36.158.100
_acme-challenge.in.archivepilates.com TXT 4Vy5MVzOmrkzIkvzOr0Zjv5E1dVEjQXb3TXtTYjpLw0
```

Live HTTPS:

```text
https://in.archivepilates.com/ HTTP/2 200
title: 아카이브IN
```

Related service checks remained healthy:

```text
https://archive-pilates-in.web.app/ HTTP/2 200
https://apply.archivepilates.com/ HTTP/2 200
http://archivepilates.com HTTP/1.1 302 -> https://m.blog.naver.com/archive_23
```

## Final Certificate Check

Checked on 2026-05-16 23:03 KST.

Firebase status:

```text
hostState: HOST_ACTIVE
ownershipState: OWNERSHIP_ACTIVE
certState: CERT_ACTIVE
issues: null
```

Live HTTPS remains healthy:

```text
https://in.archivepilates.com/ HTTP/2 200
title: 아카이브IN
```
