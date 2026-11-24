BEGIN;

CREATE TABLE archive_lesson_history.supplement_batch (
  batch_key text PRIMARY KEY CHECK (batch_key = 'legacy-native-recheck-20261124'),
  source_rows integer NOT NULL CHECK (source_rows BETWEEN 0 AND 10000),
  accepted_rows integer NOT NULL CHECK (accepted_rows BETWEEN 0 AND source_rows),
  payload_sha text NOT NULL CHECK (payload_sha ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL CHECK (isfinite(observed_at)),
  loaded_at timestamptz CHECK (isfinite(loaded_at) AND loaded_at >= observed_at)
);

CREATE TABLE archive_lesson_history.supplement (
  key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  member_key text NOT NULL CHECK (member_key ~ '^[a-f0-9]{64}$'),
  service_day date NOT NULL CHECK (service_day BETWEEN DATE '2025-06-26' AND DATE '2026-05-26'),
  start_time time CHECK (start_time < TIME '24:00:00'),
  end_time time CHECK (end_time < TIME '24:00:00'),
  lesson_type text CHECK (lesson_type IN ('group', 'private')),
  status text NOT NULL CHECK (status IN (
    'attendance', 'absence', 'noshow', 'cancel', 'booked',
    'booking_confirmed', 'booking_waiting', 'wait_cancel'
  )),
  batch_key text NOT NULL REFERENCES archive_lesson_history.supplement_batch (batch_key),
  CHECK (start_time IS NULL OR end_time IS NULL OR start_time < end_time)
);

ALTER TABLE archive_lesson_history.supplement_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_lesson_history.supplement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE archive_lesson_history.supplement_batch, archive_lesson_history.supplement
  FROM PUBLIC, anon, authenticated, service_role, archive_history_mcp_reader,
    archive_history_ingest_writer, archive_inbody_writer, archive_lesson_history_writer;

CREATE VIEW archive_lesson_history.all_bookings WITH (security_invoker = true) AS
  SELECT key, member_key, service_day, start_time, end_time, lesson_type, status
  FROM archive_lesson_history.booking
  UNION ALL
  SELECT key, member_key, service_day, start_time, end_time, lesson_type, status
  FROM archive_lesson_history.supplement;
REVOKE ALL ON TABLE archive_lesson_history.all_bookings
  FROM PUBLIC, anon, authenticated, service_role, archive_history_mcp_reader,
    archive_history_ingest_writer, archive_inbody_writer, archive_lesson_history_writer;

CREATE FUNCTION archive_lesson_history.supplement_receipt()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $receipt$
  WITH rows AS MATERIALIZED (
    SELECT key, member_key, service_day, start_time, end_time, lesson_type, status
    FROM archive_lesson_history.supplement WHERE batch_key = 'legacy-native-recheck-20261124'
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
    'batchKey', b.batch_key,
    'sourceRows', b.source_rows, 'acceptedRows', b.accepted_rows,
    'observedAt', b.observed_at, 'loadedAt', b.loaded_at, 'digest', b.payload_sha,
    'loaded', b.loaded_at IS NOT NULL,
    'verified', b.loaded_at IS NOT NULL AND saved.size = b.accepted_rows,
    'bookings', saved.size, 'rowsDigest', saved.digest,
    'statuses', coalesce((SELECT jsonb_object_agg(s.status, s.size) FROM by_status s), '{}'::jsonb)
  )
  FROM archive_lesson_history.supplement_batch b CROSS JOIN saved
  WHERE b.batch_key = 'legacy-native-recheck-20261124';
$receipt$;

CREATE FUNCTION archive_lesson_history.publish_supplement(p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $publish$
DECLARE
  approved_key constant text := 'legacy-native-recheck-20261124';
  manifest archive_lesson_history.supplement_batch%ROWTYPE;
  payload jsonb;
  expected_rows_digest text;
  result jsonb;
  keys constant text[] := ARRAY['key', 'member_key', 'service_day', 'start_time', 'end_time', 'lesson_type', 'status'];
BEGIN
  PERFORM pg_advisory_xact_lock(5330, 20261125);
  SELECT * INTO STRICT manifest
  FROM archive_lesson_history.supplement_batch WHERE batch_key = approved_key FOR UPDATE;
  IF p_body IS NULL OR octet_length(p_body) > 4000000
    OR encode(sha256(convert_to(p_body, 'UTF8')), 'hex') <> manifest.payload_sha THEN
    RAISE EXCEPTION 'Lesson history supplement digest mismatch';
  END IF;
  IF manifest.loaded_at IS NOT NULL THEN
    result := archive_lesson_history.supplement_receipt();
    IF NOT coalesce((result->>'verified')::boolean, false) THEN
      RAISE EXCEPTION 'Loaded lesson history supplement needs review';
    END IF;
    RETURN result;
  END IF;

  IF manifest.observed_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Lesson history supplement observation out of scope';
  END IF;
  IF pg_database_size(current_database()) >= 350000000
    OR pg_database_size(current_database()) + 16000000 + 8::bigint * octet_length(p_body) >= 400000000 THEN
    RAISE EXCEPTION 'Lesson history database budget exceeded';
  END IF;

  payload := p_body::jsonb;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid lesson history supplement payload';
  END IF;
  IF jsonb_array_length(payload) <> manifest.accepted_rows THEN
    RAISE EXCEPTION 'Wrong lesson history supplement count';
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
    RAISE EXCEPTION 'Invalid lesson history supplement row';
  END IF;

  -- Distinct native IDs can represent separate cancellations and rebookings in the same slot.
  IF (SELECT count(DISTINCT v->>'key') FROM jsonb_array_elements(payload) v) <> manifest.accepted_rows
    OR EXISTS (
      SELECT FROM jsonb_to_recordset(payload) AS r(
        key text, member_key text, service_day date, start_time time, end_time time
      )
      WHERE r.service_day NOT BETWEEN DATE '2025-06-26' AND DATE '2026-05-26'
        OR r.service_day > (manifest.observed_at AT TIME ZONE 'Asia/Seoul')::date
        OR r.start_time >= r.end_time
        OR NOT EXISTS (
          SELECT FROM archive_lesson_history.batch b
          WHERE b.loaded_at IS NOT NULL AND r.service_day BETWEEN b.from_day AND b.through_day
        )
        OR EXISTS (
          SELECT FROM archive_lesson_history.booking b
          WHERE b.key = r.key OR (
            b.member_key = r.member_key AND b.service_day = r.service_day
            AND b.start_time IS NOT DISTINCT FROM r.start_time
          )
        )
        OR EXISTS (
          SELECT FROM archive_lesson_history.supplement s
          WHERE s.key = r.key
        )
    ) THEN
    RAISE EXCEPTION 'Overlapping or out-of-range lesson history supplement row';
  END IF;

  WITH incoming AS MATERIALIZED (
    SELECT key, member_key, service_day, start_time, end_time, lesson_type, status
    FROM jsonb_to_recordset(payload) AS r(
      key text, member_key text, service_day date, start_time time, end_time time, lesson_type text, status text
    )
  ), inserted AS (
    INSERT INTO archive_lesson_history.supplement
      (key, member_key, service_day, start_time, end_time, lesson_type, status, batch_key)
    SELECT key, member_key, service_day, start_time, end_time, lesson_type, status, approved_key
    FROM incoming RETURNING key
  )
  SELECT encode(sha256(convert_to(coalesce(
    jsonb_agg(to_jsonb(r) ORDER BY r.key COLLATE "C"), '[]'::jsonb
  )::text, 'UTF8')), 'hex') INTO expected_rows_digest
  FROM incoming r JOIN inserted i USING (key);

  IF pg_database_size(current_database()) >= 400000000 THEN
    RAISE EXCEPTION 'Lesson history database budget exceeded';
  END IF;
  UPDATE archive_lesson_history.supplement_batch SET loaded_at = clock_timestamp() WHERE batch_key = approved_key;
  result := archive_lesson_history.supplement_receipt();
  IF NOT coalesce((result->>'verified')::boolean, false)
    OR result->>'rowsDigest' IS DISTINCT FROM expected_rows_digest THEN
    RAISE EXCEPTION 'Lesson history supplement readback mismatch';
  END IF;
  RETURN result;
END
$publish$;

REVOKE ALL ON FUNCTION
  archive_lesson_history.supplement_receipt(), archive_lesson_history.publish_supplement(text)
  FROM PUBLIC, anon, authenticated, service_role, archive_history_mcp_reader,
    archive_history_ingest_writer, archive_inbody_writer, archive_lesson_history_writer;
GRANT EXECUTE ON FUNCTION
  archive_lesson_history.supplement_receipt(), archive_lesson_history.publish_supplement(text)
  TO archive_lesson_history_writer;

COMMIT;
