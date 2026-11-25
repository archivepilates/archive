-- Requires a fresh private schema/role namespace.
-- No login or role memberships are provisioned. Keep the schema outside the Data API.
BEGIN;

CREATE ROLE archive_help_pass_owner NOLOGIN NOINHERIT;
CREATE ROLE archive_help_pass_writer NOLOGIN NOINHERIT;
CREATE ROLE archive_help_pass_reader NOLOGIN NOINHERIT;
CREATE ROLE archive_help_pass_session_issuer NOLOGIN NOINHERIT;

-- A managed CREATEROLE administrator initially gets ADMIN but not SET.
DO $role$
BEGIN
  IF NOT pg_has_role(current_user, 'archive_help_pass_owner', 'SET') THEN
    EXECUTE format('GRANT archive_help_pass_owner TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  END IF;
END
$role$;

CREATE SCHEMA archive_help_pass_snapshot AUTHORIZATION archive_help_pass_owner;
SET LOCAL ROLE archive_help_pass_owner;

CREATE TABLE archive_help_pass_snapshot.snapshot_batch (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  kst_day date NOT NULL,
  observed_at timestamptz NOT NULL,
  source_digest text COLLATE "C" NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  member_count integer NOT NULL CHECK (member_count BETWEEN 1 AND 5000),
  card_count integer NOT NULL CHECK (card_count BETWEEN 0 AND member_count * 100)
);

CREATE TABLE archive_help_pass_snapshot.member_projection (
  member_key text COLLATE "C" PRIMARY KEY CHECK (member_key ~ '^[0-9a-f]{64}$'),
  binding_revision text COLLATE "C" NOT NULL CHECK (binding_revision ~ '^[0-9a-f]{64}$'),
  cards jsonb NOT NULL
);

CREATE TABLE archive_help_pass_snapshot.read_session (
  session_digest text COLLATE "C" PRIMARY KEY CHECK (session_digest ~ '^[0-9a-f]{64}$'),
  member_key text COLLATE "C" NOT NULL CHECK (member_key ~ '^[0-9a-f]{64}$'),
  binding_revision text COLLATE "C" NOT NULL CHECK (binding_revision ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);

ALTER TABLE archive_help_pass_snapshot.snapshot_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_pass_snapshot.snapshot_batch FORCE ROW LEVEL SECURITY;
ALTER TABLE archive_help_pass_snapshot.member_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_pass_snapshot.member_projection FORCE ROW LEVEL SECURITY;
ALTER TABLE archive_help_pass_snapshot.read_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_pass_snapshot.read_session FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_only ON archive_help_pass_snapshot.snapshot_batch
  TO archive_help_pass_owner USING (true) WITH CHECK (true);
CREATE POLICY owner_only ON archive_help_pass_snapshot.member_projection
  TO archive_help_pass_owner USING (true) WITH CHECK (true);
CREATE POLICY owner_only ON archive_help_pass_snapshot.read_session
  TO archive_help_pass_owner USING (true) WITH CHECK (true);

-- The caller must verify a complete, exact, fresh native read of enrolled member
-- cards before publishing. The projection cannot establish source completeness.
CREATE FUNCTION archive_help_pass_snapshot.publish_daily(
  p_observed_at timestamptz, p_source_digest text, p_members jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $body$
DECLARE
  checked_at timestamptz;
  today_kst date;
  prior_batch archive_help_pass_snapshot.snapshot_batch%ROWTYPE;
  member_row jsonb;
  card jsonb;
  quantity jsonb;
  quantity_value numeric;
  card_type text;
  starts_on text;
  expires_on text;
  member_total integer;
  card_total integer := 0;
BEGIN
  IF p_observed_at IS NULL OR NOT isfinite(p_observed_at)
    OR p_source_digest IS NULL OR p_source_digest COLLATE "C" !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_members) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid pass snapshot' USING ERRCODE = '22023';
  END IF;

  member_total := jsonb_array_length(p_members);
  IF member_total NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Invalid pass snapshot size' USING ERRCODE = '22023';
  END IF;

  FOR member_row IN SELECT value FROM jsonb_array_elements(p_members) LOOP
    IF jsonb_typeof(member_row) <> 'object' THEN
      RAISE EXCEPTION 'Invalid pass snapshot member' USING ERRCODE = '22023';
    END IF;
    IF member_row - ARRAY['memberKey', 'bindingRevision', 'cards'] <> '{}'::jsonb
      OR jsonb_typeof(member_row->'memberKey') IS DISTINCT FROM 'string'
      OR (member_row->>'memberKey') COLLATE "C" !~ '^[0-9a-f]{64}$'
      OR jsonb_typeof(member_row->'bindingRevision') IS DISTINCT FROM 'string'
      OR (member_row->>'bindingRevision') COLLATE "C" !~ '^[0-9a-f]{64}$'
      OR jsonb_typeof(member_row->'cards') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid pass snapshot member' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(member_row->'cards') > 100 THEN
      RAISE EXCEPTION 'Invalid pass card count' USING ERRCODE = '22023';
    END IF;
    card_total := card_total + jsonb_array_length(member_row->'cards');

    FOR card IN SELECT value FROM jsonb_array_elements(member_row->'cards') LOOP
      IF jsonb_typeof(card) <> 'object' THEN
        RAISE EXCEPTION 'Invalid pass card' USING ERRCODE = '22023';
      END IF;
      IF NOT (card ?& ARRAY['category', 'type', 'status', 'startsOn', 'expiresOn', 'remaining', 'bookable'])
        OR card - ARRAY['category', 'type', 'status', 'startsOn', 'expiresOn', 'remaining', 'bookable'] <> '{}'::jsonb
        OR coalesce(card->>'category', '') COLLATE "C" NOT IN ('group', 'private', 'duet', 'triple')
        OR coalesce(card->>'type', '') COLLATE "C" NOT IN ('count', 'period')
        OR coalesce(card->>'status', '') COLLATE "C" NOT IN ('active', 'held', 'future')
        OR jsonb_typeof(card->'startsOn') IS DISTINCT FROM 'string'
        OR jsonb_typeof(card->'expiresOn') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Invalid pass card' USING ERRCODE = '22023';
      END IF;

      starts_on := card->>'startsOn';
      expires_on := card->>'expiresOn';
      IF starts_on COLLATE "C" !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
        OR expires_on COLLATE "C" !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'Invalid pass card dates' USING ERRCODE = '22023';
      END IF;
      IF starts_on::date > expires_on::date THEN
        RAISE EXCEPTION 'Invalid pass card dates' USING ERRCODE = '22023';
      END IF;

      card_type := card->>'type';
      IF (card_type = 'period' AND (card->'remaining' <> 'null'::jsonb OR card->'bookable' <> 'null'::jsonb))
        OR (card_type = 'count' AND jsonb_typeof(card->'remaining') <> 'number') THEN
        RAISE EXCEPTION 'Invalid pass card quantities' USING ERRCODE = '22023';
      END IF;
      FOREACH quantity IN ARRAY ARRAY[card->'remaining', card->'bookable'] LOOP
        IF quantity = 'null'::jsonb THEN
          CONTINUE;
        END IF;
        IF jsonb_typeof(quantity) <> 'number' THEN
          RAISE EXCEPTION 'Invalid pass card quantities' USING ERRCODE = '22023';
        END IF;
        quantity_value := quantity::numeric;
        IF quantity_value NOT BETWEEN 0 AND 100000 OR trunc(quantity_value) <> quantity_value THEN
          RAISE EXCEPTION 'Invalid pass card quantities' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_members) AS m(value)
    GROUP BY (m.value->>'memberKey') COLLATE "C" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate pass snapshot member' USING ERRCODE = '22023';
  END IF;

  -- Serialize publishers (including the first) without blocking ordinary reads.
  -- Recheck actual time after the lock in case the wait crossed KST midnight.
  LOCK TABLE archive_help_pass_snapshot.snapshot_batch IN SHARE ROW EXCLUSIVE MODE;
  checked_at := clock_timestamp();
  today_kst := (checked_at AT TIME ZONE 'Asia/Seoul')::date;
  IF p_observed_at > checked_at OR p_observed_at < checked_at - interval '120 minutes'
    OR (p_observed_at AT TIME ZONE 'Asia/Seoul')::date <> today_kst THEN
    RAISE EXCEPTION 'Pass snapshot must be fresh and from the current KST day' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO prior_batch FROM archive_help_pass_snapshot.snapshot_batch WHERE singleton;
  IF FOUND THEN
    IF prior_batch.kst_day = today_kst THEN
      RETURN jsonb_build_object('status', 'already_published',
        'members', prior_batch.member_count, 'cards', prior_batch.card_count);
    ELSIF prior_batch.kst_day > today_kst THEN
      RAISE EXCEPTION 'Pass snapshot would move backwards' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO archive_help_pass_snapshot.snapshot_batch
    (kst_day, observed_at, source_digest, member_count, card_count)
  VALUES (today_kst, p_observed_at, p_source_digest, member_total, card_total)
  ON CONFLICT (singleton) DO UPDATE SET
    kst_day = EXCLUDED.kst_day,
    observed_at = EXCLUDED.observed_at,
    source_digest = EXCLUDED.source_digest,
    member_count = EXCLUDED.member_count,
    card_count = EXCLUDED.card_count;

  DELETE FROM archive_help_pass_snapshot.member_projection;
  INSERT INTO archive_help_pass_snapshot.member_projection (member_key, binding_revision, cards)
  SELECT value->>'memberKey', value->>'bindingRevision', value->'cards'
  FROM jsonb_array_elements(p_members);

  RETURN jsonb_build_object('status', 'published', 'members', member_total, 'cards', card_total);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Invalid pass card dates' USING ERRCODE = '22023';
END
$body$;

CREATE FUNCTION archive_help_pass_snapshot.daily_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
RETURN (
  SELECT jsonb_build_object('observedAt', observed_at, 'sourceDigest', source_digest,
    'members', member_count, 'cards', card_count)
  FROM archive_help_pass_snapshot.snapshot_batch
  WHERE singleton AND kst_day = (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date
);

-- Only the trusted issuer supplies the verified binding and a high-entropy
-- token's digest. Keep revoked/expired rows as tombstones against digest reuse.
CREATE FUNCTION archive_help_pass_snapshot.issue_read_session(
  p_session_digest text, p_member_key text, p_binding_revision text, p_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $body$
DECLARE
  issued_at timestamptz := clock_timestamp();
BEGIN
  IF p_session_digest IS NULL OR p_session_digest COLLATE "C" !~ '^[0-9a-f]{64}$'
    OR p_member_key IS NULL OR p_member_key COLLATE "C" !~ '^[0-9a-f]{64}$'
    OR p_binding_revision IS NULL OR p_binding_revision COLLATE "C" !~ '^[0-9a-f]{64}$'
    OR p_expires_at IS NULL OR p_expires_at <= issued_at OR p_expires_at > issued_at + interval '20 minutes' THEN
    RAISE EXCEPTION 'Invalid pass read session' USING ERRCODE = '22023';
  END IF;

  INSERT INTO archive_help_pass_snapshot.read_session (session_digest, member_key, binding_revision, expires_at)
  VALUES (p_session_digest, p_member_key, p_binding_revision, p_expires_at)
  ON CONFLICT (session_digest) DO NOTHING;
END
$body$;

CREATE FUNCTION archive_help_pass_snapshot.revoke_read_session(p_session_digest text) RETURNS void
LANGUAGE sql STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $body$
  UPDATE archive_help_pass_snapshot.read_session SET revoked = true
  WHERE session_digest = p_session_digest AND NOT revoked;
$body$;

-- Read in a fresh transaction so a prior MVCC snapshot cannot mask revocation.
CREATE FUNCTION archive_help_pass_snapshot.read_own(p_session_digest text) RETURNS jsonb
LANGUAGE sql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
RETURN (
  SELECT jsonb_build_object('observedAt', b.observed_at,
    'expiresAt', floor(extract(epoch FROM s.expires_at) * 1000)::bigint, 'cards', m.cards)
  FROM archive_help_pass_snapshot.read_session AS s
  JOIN archive_help_pass_snapshot.member_projection AS m
    ON m.member_key = s.member_key AND m.binding_revision = s.binding_revision
  CROSS JOIN archive_help_pass_snapshot.snapshot_batch AS b
  WHERE s.session_digest = p_session_digest AND NOT s.revoked
    AND s.expires_at > statement_timestamp()
    AND b.singleton AND b.observed_at <= statement_timestamp()
    AND b.observed_at >= statement_timestamp() - interval '26 hours'
);

REVOKE ALL ON SCHEMA archive_help_pass_snapshot
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA archive_help_pass_snapshot
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA archive_help_pass_snapshot
  FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA archive_help_pass_snapshot
  TO archive_help_pass_writer, archive_help_pass_reader, archive_help_pass_session_issuer;
GRANT EXECUTE ON FUNCTION archive_help_pass_snapshot.publish_daily(timestamptz, text, jsonb),
  archive_help_pass_snapshot.daily_status()
  TO archive_help_pass_writer;
GRANT EXECUTE ON FUNCTION archive_help_pass_snapshot.issue_read_session(text, text, text, timestamptz),
  archive_help_pass_snapshot.revoke_read_session(text)
  TO archive_help_pass_session_issuer;
GRANT EXECUTE ON FUNCTION archive_help_pass_snapshot.read_own(text)
  TO archive_help_pass_reader;

COMMIT;
