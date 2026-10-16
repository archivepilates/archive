# Shared Target Validation Without A New Source Database

Use existing feature collections, not member360 or workLanes, to inspect exact Alimtalk candidate IDs. Introduce one shared rule boundary used by the current senders and a read-only inspector consumed by CORE and local MCP. The inspector is not an approval, a queue producer or a delivery endpoint.

Keep provider sends and queue mutations inside the existing execution paths. Maintain candidate discovery, approval fingerprints, test recipient exceptions, canonical booking selection, dedupe keys/windows, final source checks and atomic claims. A preflight snapshot must never be reused as a send authorization.

Read-only inspection may only use cached template evidence under the existing ten-minute freshness rule. It must not silently refresh remote template state or mutate caches. Stale evidence, access errors and specialized runtime-dependent checks are review-required, never empty success. All results disclose non-live freshness and remaining send-time checks.

Local MCP executes the same compiled backend in a bounded child so Firebase Admin instances and cleanup are isolated from the long-lived MCP process. No additional network listener or scheduler is introduced.
