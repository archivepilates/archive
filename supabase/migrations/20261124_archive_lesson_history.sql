BEGIN;

CREATE ROLE archive_lesson_history_writer
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 2;
ALTER ROLE archive_lesson_history_writer SET statement_timeout = '5s';
ALTER ROLE archive_lesson_history_writer SET log_parameter_max_length = 0;
ALTER ROLE archive_lesson_history_writer SET log_parameter_max_length_on_error = 0;
ALTER ROLE archive_lesson_history_writer SET auto_explain.log_parameter_max_length = 0;
ALTER ROLE archive_lesson_history_writer SET plan_cache_mode = 'force_generic_plan';

CREATE SCHEMA archive_lesson_history;
REVOKE ALL ON SCHEMA archive_lesson_history
  FROM PUBLIC, anon, authenticated, service_role, archive_history_mcp_reader,
    archive_history_ingest_writer, archive_inbody_writer, archive_lesson_history_writer;

-- Only the migration owner can stage an independently reviewed manifest.
CREATE TABLE archive_lesson_history.batch (
  from_day date PRIMARY KEY,
  through_day date NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('member_usage_excel', 'reservation_excel')),
  source_rows integer NOT NULL CHECK (source_rows BETWEEN 0 AND 10000),
  accepted_rows integer NOT NULL CHECK (accepted_rows BETWEEN 0 AND source_rows),
  observed_at timestamptz NOT NULL CHECK (isfinite(observed_at)),
  source_sha text NOT NULL CHECK (source_sha ~ '^[a-f0-9]{64}$'),
  payload_sha text NOT NULL CHECK (payload_sha ~ '^[a-f0-9]{64}$'),
  loaded_at timestamptz CHECK (isfinite(loaded_at) AND loaded_at >= observed_at),
  CHECK (isfinite(from_day) AND isfinite(through_day)
    AND from_day >= DATE '2025-01-01' AND through_day - from_day BETWEEN 0 AND 30),
  EXCLUDE USING gist (daterange(from_day, through_day, '[]') WITH &&)
);

CREATE TABLE archive_lesson_history.booking (
  key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  member_key text NOT NULL CHECK (member_key ~ '^[a-f0-9]{64}$'),
  service_day date NOT NULL CHECK (isfinite(service_day) AND service_day >= DATE '2025-01-01'),
  start_time time CHECK (start_time < TIME '24:00:00'),
  end_time time CHECK (end_time < TIME '24:00:00'),
  lesson_type text CHECK (lesson_type IN ('group', 'private')),
  status text NOT NULL CHECK (status IN (
    'attendance', 'absence', 'noshow', 'cancel', 'booked',
    'booking_confirmed', 'booking_waiting', 'wait_cancel'
  )),
  batch_from date NOT NULL REFERENCES archive_lesson_history.batch (from_day),
  CHECK (start_time IS NULL OR end_time IS NULL OR start_time < end_time)
);
CREATE INDEX lesson_history_booking_batch ON archive_lesson_history.booking (batch_from);
CREATE INDEX lesson_history_booking_member_day ON archive_lesson_history.booking (member_key, service_day);

ALTER TABLE archive_lesson_history.batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_lesson_history.booking ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA archive_lesson_history
  FROM PUBLIC, anon, authenticated, service_role, archive_history_mcp_reader,
    archive_history_ingest_writer, archive_inbody_writer, archive_lesson_history_writer;

CREATE FUNCTION archive_lesson_history.receipt(p_from date)
RETURNS jsonb LANGUAGE sql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $receipt$
  WITH rows AS MATERIALIZED (
    SELECT key, member_key, service_day, start_time, end_time, lesson_type, status
    FROM archive_lesson_history.booking WHERE batch_from = p_from
  ), saved AS (
    SELECT count(*) AS size,
      encode(sha256(convert_to(coalesce(
        jsonb_agg(to_jsonb(r) ORDER BY r.key COLLATE "C"), '[]'::jsonb
      )::text, 'UTF8')), 'hex') AS digest
    FROM rows r
  ), by_status AS (
    SELECT status, count(*) AS size FROM rows GROUP BY status
  )
  SELECT jsonb_build_object(
    'from', b.from_day, 'through', b.through_day, 'sourceKind', b.source_kind,
    'sourceRows', b.source_rows, 'acceptedRows', b.accepted_rows,
    'observedAt', b.observed_at, 'loadedAt', b.loaded_at,
    'sourceSha', b.source_sha, 'digest', b.payload_sha,
    'loaded', b.loaded_at IS NOT NULL,
    'verified', b.loaded_at IS NOT NULL AND saved.size = b.accepted_rows,
    'bookings', saved.size, 'rowsDigest', saved.digest,
    'statuses', coalesce((SELECT jsonb_object_agg(s.status, s.size) FROM by_status s), '{}'::jsonb)
  )
  FROM archive_lesson_history.batch b CROSS JOIN saved
  WHERE b.from_day = p_from;
$receipt$;

CREATE FUNCTION archive_lesson_history.publish(p_from date, p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $publish$
DECLARE
  manifest archive_lesson_history.batch%ROWTYPE;
  payload jsonb;
  expected_rows_digest text;
  observed_window_end date := (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  result jsonb;
  keys constant text[] := ARRAY['key', 'member_key', 'service_day', 'start_time', 'end_time', 'lesson_type', 'status'];
BEGIN
  PERFORM pg_advisory_xact_lock(5330, 20261125);
  SELECT * INTO STRICT manifest FROM archive_lesson_history.batch WHERE from_day = p_from FOR UPDATE;
  IF p_body IS NULL OR octet_length(p_body) > 4000000
    OR encode(sha256(convert_to(p_body, 'UTF8')), 'hex') <> manifest.payload_sha THEN
    RAISE EXCEPTION 'Lesson history batch digest mismatch';
  END IF;
  IF manifest.loaded_at IS NOT NULL THEN
    result := archive_lesson_history.receipt(p_from);
    IF NOT coalesce((result->>'verified')::boolean, false) THEN
      RAISE EXCEPTION 'Loaded lesson history batch needs review';
    END IF;
    RETURN result;
  END IF;

  IF manifest.through_day > observed_window_end OR manifest.observed_at > clock_timestamp()
    OR (manifest.observed_at AT TIME ZONE 'Asia/Seoul')::date < manifest.through_day THEN
    RAISE EXCEPTION 'Lesson history source date out of scope';
  END IF;
  IF pg_database_size(current_database()) >= 350000000
    OR pg_database_size(current_database()) + 16000000 + 8::bigint * octet_length(p_body) >= 400000000 THEN
    RAISE EXCEPTION 'Lesson history database budget exceeded';
  END IF;

  payload := p_body::jsonb;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid lesson history payload';
  END IF;
  IF jsonb_array_length(payload) <> manifest.accepted_rows THEN
    RAISE EXCEPTION 'Wrong lesson history batch count';
  END IF;
  IF EXISTS (
    SELECT FROM jsonb_array_elements(payload) AS v
    WHERE jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT (v ?& keys)
      OR v - keys <> '{}'::jsonb
      OR jsonb_typeof(v->'key') IS DISTINCT FROM 'string'
      OR (v->>'key') !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(v->'member_key') IS DISTINCT FROM 'string'
      OR (v->>'member_key') !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(v->'service_day') IS DISTINCT FROM 'string'
      OR (v->>'service_day') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      OR jsonb_typeof(v->'start_time') NOT IN ('string', 'null')
      OR (v->>'start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      OR jsonb_typeof(v->'end_time') NOT IN ('string', 'null')
      OR (v->>'end_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      OR jsonb_typeof(v->'lesson_type') NOT IN ('string', 'null')
      OR (v->>'lesson_type') NOT IN ('group', 'private')
      OR jsonb_typeof(v->'status') IS DISTINCT FROM 'string'
      OR (v->>'status') NOT IN (
        'attendance', 'absence', 'noshow', 'cancel', 'booked',
        'booking_confirmed', 'booking_waiting', 'wait_cancel'
      )
  ) THEN
    RAISE EXCEPTION 'Invalid lesson history row';
  END IF;

  IF (SELECT count(DISTINCT v->>'key') FROM jsonb_array_elements(payload) v) <> manifest.accepted_rows
    OR EXISTS (
      SELECT FROM jsonb_array_elements(payload) v
      WHERE (v->>'service_day')::date NOT BETWEEN p_from AND manifest.through_day
        OR ((v->>'start_time')::time >= (v->>'end_time')::time)
    )
    OR EXISTS (
      SELECT FROM jsonb_array_elements(payload) v
      JOIN archive_lesson_history.booking saved ON saved.key = v->>'key'
    ) THEN
    RAISE EXCEPTION 'Overlapping or out-of-range lesson history row';
  END IF;

  WITH incoming AS MATERIALIZED (
    SELECT key, member_key, service_day, start_time, end_time, lesson_type, status
    FROM jsonb_to_recordset(payload) AS r(
      key text, member_key text, service_day date, start_time time, end_time time, lesson_type text, status text
    )
  ), inserted AS (
    INSERT INTO archive_lesson_history.booking
      (key, member_key, service_day, start_time, end_time, lesson_type, status, batch_from)
    SELECT key, member_key, service_day, start_time, end_time, lesson_type, status, p_from FROM incoming
    RETURNING key
  )
  SELECT encode(sha256(convert_to(coalesce(
    jsonb_agg(to_jsonb(r) ORDER BY r.key COLLATE "C"), '[]'::jsonb
  )::text, 'UTF8')), 'hex') INTO expected_rows_digest
  FROM incoming r JOIN inserted i USING (key);

  IF pg_database_size(current_database()) >= 400000000 THEN
    RAISE EXCEPTION 'Lesson history database budget exceeded';
  END IF;
  UPDATE archive_lesson_history.batch SET loaded_at = clock_timestamp() WHERE from_day = p_from;
  result := archive_lesson_history.receipt(p_from);
  IF NOT coalesce((result->>'verified')::boolean, false)
    OR result->>'rowsDigest' IS DISTINCT FROM expected_rows_digest THEN
    RAISE EXCEPTION 'Lesson history readback mismatch';
  END IF;
  RETURN result;
END
$publish$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA archive_lesson_history
  FROM PUBLIC, anon, authenticated, service_role, archive_history_mcp_reader,
    archive_history_ingest_writer, archive_inbody_writer, archive_lesson_history_writer;
GRANT USAGE ON SCHEMA archive_lesson_history TO archive_lesson_history_writer;
GRANT EXECUTE ON FUNCTION archive_lesson_history.publish(date, text),
  archive_lesson_history.receipt(date) TO archive_lesson_history_writer;

COMMIT;
