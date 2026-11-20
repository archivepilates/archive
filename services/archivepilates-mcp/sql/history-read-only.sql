BEGIN;

CREATE FUNCTION archive_history_ro.mcp_member_month(p_member_key text, p_month date)
RETURNS jsonb
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $body$
DECLARE
  month_label text;
  observed timestamptz;
  loaded timestamptz;
  reply jsonb;
  name_at_load text;
  attendance_rows jsonb;
  purchase_rows jsonb;
BEGIN
  IF p_member_key !~ '^[0-9a-f]{64}$' OR length(p_member_key) <> 64
     OR NOT isfinite(p_month) OR p_month < DATE '2000-01-01'
     OR p_month >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date
     OR extract(day from p_month) <> 1 THEN
    RAISE EXCEPTION 'Invalid history query';
  END IF;
  month_label := to_char(p_month, 'YYYY-MM');
  SELECT observed_at, loaded_at INTO observed, loaded
  FROM archive_history_ro.month_load WHERE month = p_month;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','not_loaded','month',month_label);
  END IF;
  reply := jsonb_build_object('month',month_label,'observedAt',observed,'loadedAt',loaded);
  SELECT display_name INTO name_at_load
  FROM archive_history_ro.member_name WHERE month = p_month AND member_key = p_member_key;
  IF NOT FOUND THEN
    IF EXISTS (SELECT FROM archive_history_ro.issued_pass WHERE month = p_month AND member_key = p_member_key)
      OR EXISTS (SELECT FROM archive_history_ro.booking WHERE month = p_month AND member_key = p_member_key)
      OR EXISTS (SELECT FROM archive_history_ro.purchase_event WHERE month = p_month AND member_key = p_member_key) THEN
      RAISE EXCEPTION 'Named snapshot is incomplete';
    END IF;
    RETURN reply || jsonb_build_object('state','no_member_rows');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',service_day,'type',lesson_type,'status',status)
    ORDER BY service_day, key), '[]'::jsonb) INTO attendance_rows
  FROM (SELECT service_day, lesson_type, status, key FROM archive_history_ro.booking
    WHERE month = p_month AND member_key = p_member_key ORDER BY service_day, key LIMIT 201) b;
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',transaction_day,'kind',kind)
    ORDER BY transaction_day, key), '[]'::jsonb) INTO purchase_rows
  FROM (SELECT transaction_day, kind, key FROM archive_history_ro.purchase_event
    WHERE month = p_month AND member_key = p_member_key ORDER BY transaction_day, key LIMIT 201) p;
  IF jsonb_array_length(attendance_rows) + jsonb_array_length(purchase_rows) > 200 THEN
    RETURN reply || jsonb_build_object('state','record_limit');
  END IF;
  RETURN reply || jsonb_build_object('state','member_found','name',name_at_load,
    'attendance',attendance_rows,'purchaseEvents',purchase_rows);
END
$body$;
REVOKE ALL ON FUNCTION archive_history_ro.mcp_member_month(text,date) FROM PUBLIC, anon, authenticated, service_role;

CREATE ROLE archive_history_mcp_reader NOLOGIN NOINHERIT NOREPLICATION
NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER CONNECTION LIMIT 2;
ALTER ROLE archive_history_mcp_reader SET default_transaction_read_only = on;
ALTER ROLE archive_history_mcp_reader SET statement_timeout = '4500ms';
GRANT USAGE ON SCHEMA archive_history_ro TO archive_history_mcp_reader;
GRANT EXECUTE ON FUNCTION archive_history_ro.mcp_member_month(text,date) TO archive_history_mcp_reader;
DO $body$
BEGIN
  IF EXISTS (
    SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('archive_history_ro', 'archive_history_pilot', 'public', 'auth', 'storage')
      AND c.relkind IN ('r','p','v','m','f')
      AND (has_table_privilege('archive_history_mcp_reader', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_any_column_privilege('archive_history_mcp_reader', c.oid, 'SELECT,INSERT,UPDATE'))
  ) OR has_schema_privilege('archive_history_mcp_reader','public','CREATE') THEN
    RAISE EXCEPTION 'Unexpected inherited privileges for dedicated reader';
  END IF;
END
$body$;
COMMIT;
