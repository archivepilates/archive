# Reservation Mirror

- Retired lane as of 2026-10-28. Keep historical sources; do not execute imports,
  recreate the named database, or redeploy the mirror server/site without a new
  explicit operator approval. Refer to the retirement task for verified status.
- The release helper's separate CORE rules-only capability is still active;
  mirror retirement does not authorize deleting shared CORE/Auth resources.

- This is an authenticated operator-only read-only mirror, never an operational writer.
- The only cloud database accepted by app/import writes is `archive-pilates/reservation-mirror`.
- `(default)` is source read-only for the offline import tool; the serving runtime must be IAM-denied access to it.
- No StudioMate writes, messages, contracts, payments, reservations, production triggers or send adapters.
- Never embed member data, passwords, credentials, snapshots, tokens, or private imports in Hosting/build/Git/logs.
- All APIs except public health/config require a verified operator Firebase identity.
- Prove anonymous denial and database isolation before serving member data.
- Preserve provenance, source timestamp, incomplete coverage and snapshot generation. Do not claim 'all StudioMate data' from a partial CRM mirror.
- All direct Firestore client access denied. Source documents retained privately; API views explicitly allowlist fields.
