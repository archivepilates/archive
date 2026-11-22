CREATE FUNCTION archive_history_ro.mcp_backfill_member_month(p_member_key text, p_month date)
RETURNS jsonb
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $body$
DECLARE
  b archive_history_backfill.batch%ROWTYPE;
  reply jsonb;
  bookings jsonb;
  passes jsonb;
BEGIN
  IF p_member_key !~ '^[0-9a-f]{64}$' OR length(p_member_key) <> 64
    OR NOT isfinite(p_month) OR p_month < DATE '2000-01-01'
    OR extract(day FROM p_month) <> 1 OR p_month = DATE '2026-10-01'
    OR p_month > date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'Invalid history query';
  END IF;
  reply := jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'scope','booking_issued_pass_only');
  SELECT * INTO b FROM archive_history_backfill.batch
  WHERE loaded_at IS NOT NULL AND from_day >= p_month AND from_day < p_month + interval '1 month'
  ORDER BY from_day LIMIT 1;
  IF NOT FOUND THEN RETURN reply || jsonb_build_object('state','not_loaded'); END IF;
  IF EXISTS (SELECT FROM archive_history_backfill.batch
    WHERE loaded_at IS NOT NULL AND from_day > b.from_day AND from_day < p_month + interval '1 month') THEN
    RAISE EXCEPTION 'Multiple history coverage intervals';
  END IF;
  reply := reply || jsonb_build_object('observedAt',b.observed_at,'loadedAt',b.loaded_at,
    'coverageFrom',b.from_day,'coverageThrough',b.through_day);

  WITH selected AS MATERIALIZED (
    SELECT key, pass_key, service_day, lesson_type, status FROM archive_history_backfill.booking
    WHERE member_key=p_member_key AND batch_from=b.from_day
      AND service_day BETWEEN b.from_day AND b.through_day
    ORDER BY service_day,key COLLATE "C" LIMIT 201
  ), refs AS (
    SELECT pass_key,row_number() OVER (ORDER BY pass_key COLLATE "C") AS ref
    FROM (SELECT DISTINCT pass_key FROM selected) d
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',s.service_day,'type',s.lesson_type,
    'status',s.status,'passRef',r.ref) ORDER BY s.service_day,s.key COLLATE "C"),'[]'::jsonb),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('ref',ref) ORDER BY ref),'[]'::jsonb) FROM refs)
  INTO bookings, passes FROM selected s JOIN refs r USING (pass_key);
  IF jsonb_array_length(bookings) + jsonb_array_length(passes) > 200 THEN
    RETURN reply || jsonb_build_object('state','record_limit');
  END IF;
  IF jsonb_array_length(bookings) = 0 THEN
    RETURN reply || jsonb_build_object('state','partial_no_verified_rows');
  END IF;
  RETURN reply || jsonb_build_object('state','partial_member_found','bookings',bookings,'issuedPasses',passes);
END
$body$;
REVOKE ALL ON FUNCTION archive_history_ro.mcp_backfill_member_month(text,date)
  FROM PUBLIC, anon, authenticated, service_role, archive_history_ingest_writer;
GRANT EXECUTE ON FUNCTION archive_history_ro.mcp_backfill_member_month(text,date) TO archive_history_mcp_reader;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT FROM pg_class c CROSS JOIN
      unnest(ARRAY['anon','authenticated','service_role','archive_history_mcp_reader','archive_history_ingest_writer']) r
    WHERE c.relnamespace='archive_history_backfill'::regnamespace AND c.relkind='r'
      AND (NOT c.relrowsecurity OR has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE')
        OR has_schema_privilege(r,'archive_history_backfill','CREATE')
        OR (r <> 'archive_history_mcp_reader'
          AND has_function_privilege(r,'archive_history_ro.mcp_backfill_member_month(text,date)','EXECUTE')))
  ) THEN
    RAISE EXCEPTION 'Unexpected backfill history access';
  END IF;
END
$guard$;
