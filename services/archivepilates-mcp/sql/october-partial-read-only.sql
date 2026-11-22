BEGIN;

-- Keep the October pilot isolated from the existing full-month and transaction reader.
CREATE FUNCTION archive_history_ro.mcp_october_booking_pass(p_member_key text)
RETURNS jsonb
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $body$
DECLARE
  snapshot archive_history_partial.booking_pass_snapshot%ROWTYPE;
  reply jsonb := jsonb_build_object('month','2026-10','scope','booking_issued_pass_only');
  member_bookings jsonb;
  member_passes jsonb;
BEGIN
  IF p_member_key !~ '^[0-9a-f]{64}$' OR length(p_member_key) <> 64 THEN
    RAISE EXCEPTION 'Invalid history query';
  END IF;
  SELECT * INTO snapshot FROM archive_history_partial.booking_pass_snapshot
  WHERE month = DATE '2026-10-01';
  IF NOT FOUND THEN
    RETURN reply || jsonb_build_object('state','not_loaded');
  END IF;
  IF snapshot.scope <> 'booking_issued_pass_only' OR snapshot.transaction_coverage <> 'not_collected'
    OR snapshot.payload_sha256 <> 'b1ee32c979d9a38c390301c07a267ffe937ddd087da23ff5b4da7aabfc834737'
    OR snapshot.source_sha256 <> '3eb1b47aa44bffe09f4b0c706fd5c735e3261c137a3785ecfcfe979ac9ae928b' THEN
    RAISE EXCEPTION 'Unapproved partial history snapshot';
  END IF;
  reply := reply || jsonb_build_object('observedAt',snapshot.observed_at,'loadedAt',snapshot.loaded_at);
  WITH passes AS (
    SELECT v->>'pass_key' AS pass_key, row_number() OVER (ORDER BY (v->>'pass_key') COLLATE "C") AS ref
    FROM jsonb_array_elements(snapshot.payload::jsonb->'passes') v
    WHERE v->>'member_key' = p_member_key
  ), bookings AS (
    SELECT v FROM jsonb_array_elements(snapshot.payload::jsonb->'bookings') v
    WHERE v->>'member_key' = p_member_key
    ORDER BY (v->>'booking_key') COLLATE "C" LIMIT 201
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object('day',v->>'service_day','type',v->>'lesson_type',
      'status',v->>'status','passRef',p.ref) ORDER BY v->>'service_day',(v->>'booking_key') COLLATE "C"),'[]'::jsonb),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('ref',ref) ORDER BY ref),'[]'::jsonb) FROM passes)
  INTO member_bookings, member_passes
  FROM bookings b JOIN passes p ON p.pass_key = b.v->>'pass_key';
  IF jsonb_array_length(member_bookings) + jsonb_array_length(member_passes) > 200 THEN
    RETURN reply || jsonb_build_object('state','record_limit');
  END IF;
  IF jsonb_array_length(member_bookings) = 0 THEN
    RETURN reply || jsonb_build_object('state','partial_no_verified_rows');
  END IF;
  RETURN reply || jsonb_build_object('state','partial_member_found',
    'bookings',member_bookings,'issuedPasses',member_passes);
END
$body$;
REVOKE ALL ON FUNCTION archive_history_ro.mcp_october_booking_pass(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION archive_history_ro.mcp_october_booking_pass(text) TO archive_history_mcp_reader;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_class WHERE oid = 'archive_history_partial.booking_pass_snapshot'::regclass AND relrowsecurity)
    OR EXISTS (
      SELECT FROM unnest(ARRAY['anon','authenticated','service_role','archive_history_mcp_reader']) r
      WHERE has_schema_privilege(r,'archive_history_partial','USAGE,CREATE')
        OR has_table_privilege(r,'archive_history_partial.booking_pass_snapshot','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(r,'archive_history_partial.booking_pass_snapshot','SELECT,INSERT,UPDATE,REFERENCES')
        OR (r <> 'archive_history_mcp_reader'
          AND has_function_privilege(r,'archive_history_ro.mcp_october_booking_pass(text)','EXECUTE'))
    ) THEN
    RAISE EXCEPTION 'Unexpected partial history access';
  END IF;
END
$guard$;
COMMIT;
