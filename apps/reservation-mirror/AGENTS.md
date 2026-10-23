# Reservation Mirror

- This is an authenticated operator-only read-only mirror, never an operational writer.
- The only cloud database accepted by app/import writes is `archive-pilates/reservation-mirror`.
- `(default)` is source read-only for the offline import tool; the serving runtime must be IAM-denied access to it.
- No StudioMate writes, messages, contracts, payments, reservations, production triggers or send adapters.
- Never embed member data, passwords, credentials, snapshots, tokens, or private imports in Hosting/build/Git/logs.
- All APIs except public health/config require a verified operator Firebase identity.
- Prove anonymous denial and database isolation before serving member data.
- Preserve provenance, source timestamp, incomplete coverage and snapshot generation. Do not claim 'all StudioMate data' from a partial CRM mirror.
- All direct Firestore client access denied. Source documents retained privately; API views explicitly allowlist fields.
