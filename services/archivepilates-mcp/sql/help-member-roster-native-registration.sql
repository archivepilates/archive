-- Native registration is the center's identity evidence; OTP still proves
-- possession. Only the dedicated enrollment writer can publish this batch.
BEGIN;
SET LOCAL ROLE archive_help_pass_owner;

CREATE FUNCTION archive_help_roster.publish_native_registration(
  p_observed timestamptz, p_digest text, p_members jsonb, p_contacts jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET lock_timeout = '3s'
AS $body$
DECLARE
  last_observed timestamptz;
  last_digest text;
BEGIN
  IF p_observed IS NULL OR NOT isfinite(p_observed) OR p_digest IS NULL
    OR p_digest COLLATE "C" !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_members) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_contacts) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid native registration source' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_members) NOT BETWEEN 1 AND 5000
    OR jsonb_array_length(p_contacts) NOT BETWEEN 1 AND 5000
    OR EXISTS (
      SELECT FROM jsonb_array_elements(p_contacts) AS c(v)
      WHERE jsonb_typeof(v) <> 'object' OR NOT (v ?& ARRAY['memberKey','phoneKey'])
        OR v - ARRAY['memberKey','phoneKey'] <> '{}'::jsonb
        OR coalesce(v->>'memberKey','') COLLATE "C" !~ '^[0-9a-f]{64}$'
        OR (v->'phoneKey' <> 'null'::jsonb AND coalesce(v->>'phoneKey','') COLLATE "C" !~ '^[0-9a-f]{64}$')
    ) OR EXISTS (
      SELECT FROM jsonb_array_elements(p_contacts) AS c(v) GROUP BY v->>'memberKey' HAVING count(*)>1
    ) OR EXISTS (
      SELECT FROM jsonb_array_elements(p_contacts) AS c(v) WHERE v->>'phoneKey' IS NOT NULL
      GROUP BY v->>'phoneKey' HAVING count(*)>1
    ) OR EXISTS (
      SELECT FROM jsonb_array_elements(p_members) AS p(v)
      WHERE NOT EXISTS (
        SELECT FROM jsonb_array_elements(p_contacts) AS c(v)
        WHERE c.v->>'memberKey'=p.v->>'memberKey' AND c.v->>'phoneKey'=p.v->>'phoneKey'
      )
    )
  THEN RAISE EXCEPTION 'Incomplete or ambiguous native registration source' USING ERRCODE='22023'; END IF;

  PERFORM pg_advisory_xact_lock(1095910216,1904790064);
  IF p_observed > clock_timestamp() OR p_observed <= clock_timestamp()-interval '30 minutes' THEN
    RAISE EXCEPTION 'Invalid native registration freshness' USING ERRCODE='22023';
  END IF;
  SELECT observed_at,source_digest INTO last_observed,last_digest
  FROM archive_help_roster.generation WHERE singleton;
  IF last_observed IS NOT NULL AND p_observed<=last_observed THEN
    IF p_observed=last_observed AND p_digest=last_digest THEN RETURN archive_help_roster.status(); END IF;
    RAISE EXCEPTION 'Older or conflicting native registration generation' USING ERRCODE='22023';
  END IF;

  -- A missing/ambiguous/changed contact must not come back by phone reuse.
  UPDATE archive_help_roster.contact_approval AS a SET revoked_at=clock_timestamp()
  WHERE a.revoked_at IS NULL AND NOT EXISTS (
    SELECT FROM jsonb_array_elements(p_contacts) AS c(v)
    WHERE c.v->>'memberKey'=a.member_key AND c.v->>'phoneKey'=a.phone_key
  );
  INSERT INTO archive_help_roster.contact_approval(member_key,phone_key,verified_at)
  SELECT p.v->>'memberKey',p.v->>'phoneKey',p_observed
  FROM jsonb_array_elements(p_members) AS p(v)
  WHERE NOT EXISTS (
    SELECT FROM archive_help_roster.contact_approval AS a
    WHERE a.member_key=p.v->>'memberKey' OR a.phone_key=p.v->>'phoneKey'
  )
  ON CONFLICT DO NOTHING;

  -- Keep contact changes and replacement of the pass generation atomic.
  RETURN archive_help_roster.publish(p_observed,p_digest,p_members);
END
$body$;

REVOKE ALL ON FUNCTION archive_help_roster.publish_native_registration(timestamptz,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION archive_help_roster.publish_native_registration(timestamptz,text,jsonb,jsonb)
  TO archive_help_enrollment_writer;
GRANT EXECUTE ON FUNCTION archive_help_roster.status() TO archive_help_enrollment_writer;
COMMIT;
