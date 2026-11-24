BEGIN;

CREATE ROLE archive_inbody_writer
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 2;
ALTER ROLE archive_inbody_writer SET statement_timeout = '5s';
ALTER ROLE archive_inbody_writer SET log_parameter_max_length = 0;
ALTER ROLE archive_inbody_writer SET log_parameter_max_length_on_error = 0;
ALTER ROLE archive_inbody_writer SET plan_cache_mode = 'force_generic_plan';

CREATE SCHEMA archive_inbody;
REVOKE ALL ON SCHEMA archive_inbody FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA archive_inbody TO archive_inbody_writer;

CREATE TABLE archive_inbody.measurement (
  event_key text PRIMARY KEY CHECK (event_key ~ '^[0-9a-f]{64}$'),
  member_key text NOT NULL CHECK (member_key ~ '^[0-9a-f]{64}$'),
  measured_at timestamptz NOT NULL CHECK (isfinite(measured_at)),
  expires_at timestamptz GENERATED ALWAYS AS (
    ((measured_at AT TIME ZONE 'Asia/Seoul') + interval '2 years') AT TIME ZONE 'Asia/Seoul'
  ) STORED NOT NULL,
  weight_kg numeric NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 1000),
  skeletal_muscle_mass_kg numeric NOT NULL CHECK (
    skeletal_muscle_mass_kg > 0 AND skeletal_muscle_mass_kg <= weight_kg
  ),
  percent_body_fat numeric NOT NULL CHECK (percent_body_fat BETWEEN 0 AND 100),
  UNIQUE (member_key, measured_at)
);
CREATE INDEX archive_inbody_measurement_expiry_idx ON archive_inbody.measurement (expires_at);

-- The migration owner can operate these functions. API roles and the ingest role
-- have no table policies or grants. Using FORCE would also block the owner role
-- behind the functions on deployments where that owner does not bypass RLS.
ALTER TABLE archive_inbody.measurement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE archive_inbody.measurement
  FROM PUBLIC, anon, authenticated, service_role, archive_inbody_writer;

CREATE FUNCTION archive_inbody.verify_measurement(
  p_event_key text,
  p_member_key text,
  p_measured_at timestamptz,
  p_weight_kg numeric,
  p_skeletal_muscle_mass_kg numeric,
  p_percent_body_fat numeric
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $verify$
  SELECT EXISTS (
    SELECT 1
    FROM archive_inbody.measurement AS m
    WHERE m.event_key = p_event_key
      AND m.member_key = p_member_key
      AND m.measured_at = p_measured_at
      AND m.expires_at > statement_timestamp()
      AND m.weight_kg = p_weight_kg
      AND m.skeletal_muscle_mass_kg = p_skeletal_muscle_mass_kg
      AND m.percent_body_fat = p_percent_body_fat
  );
$verify$;

CREATE FUNCTION archive_inbody.store_measurement(
  p_event_key text,
  p_member_key text,
  p_measured_at timestamptz,
  p_weight_kg numeric,
  p_skeletal_muscle_mass_kg numeric,
  p_percent_body_fat numeric
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $store$
BEGIN
  IF (
    p_event_key ~ '^[0-9a-f]{64}$'
    AND p_member_key ~ '^[0-9a-f]{64}$'
    AND isfinite(p_measured_at)
    AND p_measured_at <= statement_timestamp() + interval '5 minutes'
    AND (((p_measured_at AT TIME ZONE 'Asia/Seoul') + interval '2 years') AT TIME ZONE 'Asia/Seoul') > statement_timestamp()
    AND p_weight_kg > 0
    AND p_weight_kg <= 1000
    AND p_skeletal_muscle_mass_kg > 0
    AND p_skeletal_muscle_mass_kg <= p_weight_kg
    AND p_percent_body_fat BETWEEN 0 AND 100
  ) IS NOT TRUE THEN
    RETURN 'conflict';
  END IF;

  INSERT INTO archive_inbody.measurement (
    event_key, member_key, measured_at, weight_kg, skeletal_muscle_mass_kg, percent_body_fat
  )
  VALUES (
    p_event_key, p_member_key, p_measured_at, p_weight_kg, p_skeletal_muscle_mass_kg, p_percent_body_fat
  )
  ON CONFLICT DO NOTHING;

  IF FOUND THEN
    RETURN 'inserted';
  END IF;
  IF archive_inbody.verify_measurement(
    p_event_key, p_member_key, p_measured_at, p_weight_kg, p_skeletal_muscle_mass_kg, p_percent_body_fat
  ) THEN
    RETURN 'already_present';
  END IF;
  RETURN 'conflict';
END;
$store$;

REVOKE ALL ON FUNCTION
  archive_inbody.store_measurement(text, text, timestamptz, numeric, numeric, numeric),
  archive_inbody.verify_measurement(text, text, timestamptz, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  archive_inbody.store_measurement(text, text, timestamptz, numeric, numeric, numeric),
  archive_inbody.verify_measurement(text, text, timestamptz, numeric, numeric, numeric)
  TO archive_inbody_writer;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $schedule$
BEGIN
  IF EXISTS (SELECT FROM cron.job WHERE jobname = 'archive-inbody-retention') THEN
    RAISE EXCEPTION 'inbody retention job already exists';
  END IF;
  PERFORM cron.schedule(
    'archive-inbody-retention', '*/5 * * * *',
    'DELETE FROM archive_inbody.measurement WHERE expires_at <= statement_timestamp()'
  );
END;
$schedule$;

COMMIT;
