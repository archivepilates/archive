-- Fresh private schema. Do not add it to the Supabase Data API schemas.
-- Requires the existing auth runtime role. No login or runtime membership is created.
BEGIN;

CREATE ROLE archive_help_enrollment_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE archive_help_enrollment_writer NOLOGIN NOINHERIT NOBYPASSRLS;

DO $role$
BEGIN
  IF NOT pg_has_role(current_user, 'archive_help_enrollment_owner', 'SET') THEN
    EXECUTE format('GRANT archive_help_enrollment_owner TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  END IF;
END
$role$;

CREATE SCHEMA archive_help_enrollment AUTHORIZATION archive_help_enrollment_owner;
SET LOCAL ROLE archive_help_enrollment_owner;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- A revision, once used or explicitly revoked, cannot become a new head again.
CREATE TABLE archive_help_enrollment.revision_tombstones (
  studio_id text COLLATE "C" NOT NULL CHECK (studio_id = '5330'),
  member_id text COLLATE "C" NOT NULL CHECK (member_id ~ '^[1-9][0-9]{0,15}$'),
  revision text COLLATE "C" NOT NULL CHECK (revision ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (studio_id, member_id, revision)
);

CREATE TABLE archive_help_enrollment.current_binding (
  studio_id text COLLATE "C" NOT NULL,
  member_id text COLLATE "C" NOT NULL,
  revision text COLLATE "C" NOT NULL,
  source_observed_at timestamptz CHECK (isfinite(source_observed_at)),
  revoked_at timestamptz CHECK (isfinite(revoked_at)),
  phone_box text COLLATE "C" CHECK (
    octet_length(phone_box) = 52 AND phone_box ~ '^[A-Za-z0-9_-]+$'
  ),
  PRIMARY KEY (studio_id, member_id),
  FOREIGN KEY (studio_id, member_id, revision)
    REFERENCES archive_help_enrollment.revision_tombstones (studio_id, member_id, revision),
  CHECK (
    (revoked_at IS NULL AND source_observed_at IS NOT NULL AND phone_box IS NOT NULL)
    OR (revoked_at IS NOT NULL AND phone_box IS NULL)
  )
);

CREATE TABLE archive_help_enrollment.staff_approval (
  reference_digest text COLLATE "C" PRIMARY KEY CHECK (reference_digest ~ '^[0-9a-f]{64}$'),
  studio_id text COLLATE "C" NOT NULL,
  member_id text COLLATE "C" NOT NULL,
  revision text COLLATE "C" NOT NULL,
  approved_at timestamptz NOT NULL CHECK (isfinite(approved_at)),
  expires_at timestamptz NOT NULL CHECK (
    isfinite(expires_at) AND expires_at > approved_at AND expires_at <= approved_at + interval '10 minutes'
  ),
  FOREIGN KEY (studio_id, member_id, revision)
    REFERENCES archive_help_enrollment.revision_tombstones (studio_id, member_id, revision)
);

ALTER TABLE archive_help_enrollment.revision_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_enrollment.revision_tombstones FORCE ROW LEVEL SECURITY;
ALTER TABLE archive_help_enrollment.current_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_enrollment.current_binding FORCE ROW LEVEL SECURITY;
ALTER TABLE archive_help_enrollment.staff_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_enrollment.staff_approval FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_only ON archive_help_enrollment.revision_tombstones
  TO archive_help_enrollment_owner USING (true) WITH CHECK (true);
CREATE POLICY owner_only ON archive_help_enrollment.current_binding
  TO archive_help_enrollment_owner USING (true) WITH CHECK (true);
CREATE POLICY owner_only ON archive_help_enrollment.staff_approval
  TO archive_help_enrollment_owner USING (true) WITH CHECK (true);

CREATE FUNCTION archive_help_enrollment.valid_identity(p_studio_id text, p_member_id text, p_revision text)
RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, pg_temp
RETURN p_studio_id COLLATE "C" = '5330' AND p_member_id COLLATE "C" ~ '^[1-9][0-9]{0,15}$'
  AND p_revision COLLATE "C" ~ '^[0-9a-f]{64}$';

-- The writer attests to exact, active, in-person StudioMate signup and verified
-- registered contact. It must AEAD-seal the contact before SQL; SQL only
-- validates the envelope format. A refresh of one revision keeps the same box.
CREATE FUNCTION archive_help_enrollment.publish_binding(
  p_studio_id text, p_member_id text, p_revision text, p_source_observed_at timestamptz, p_phone_box text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '750ms'
AS $body$
DECLARE
  prior archive_help_enrollment.current_binding%ROWTYPE;
  checked_at timestamptz;
BEGIN
  IF archive_help_enrollment.valid_identity(p_studio_id, p_member_id, p_revision) IS NOT TRUE
    OR p_source_observed_at IS NULL OR NOT isfinite(p_source_observed_at)
    OR p_phone_box IS NULL OR octet_length(p_phone_box) <> 52
    OR p_phone_box COLLATE "C" !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Invalid enrollment binding' USING ERRCODE = '22023';
  END IF;

  -- Serialize all authority writes for one native member, even before its first insert.
  PERFORM pg_advisory_xact_lock(1095910216, hashtext(('help-enrollment:' || p_member_id) COLLATE "C"));
  SELECT * INTO prior FROM archive_help_enrollment.current_binding
  WHERE studio_id = p_studio_id AND member_id = p_member_id FOR UPDATE;

  checked_at := clock_timestamp();
  IF p_source_observed_at > checked_at OR p_source_observed_at < checked_at - interval '26 hours' THEN
    RETURN false;
  END IF;
  IF prior.revision COLLATE "C" = p_revision THEN
    IF prior.revoked_at IS NOT NULL OR prior.phone_box COLLATE "C" <> p_phone_box
      OR p_source_observed_at < prior.source_observed_at THEN
      RETURN false;
    END IF;
    IF p_source_observed_at = prior.source_observed_at THEN
      RETURN true;
    END IF;
  ELSE
    IF p_source_observed_at <= greatest(prior.source_observed_at, prior.revoked_at) THEN
      RETURN false;
    END IF;
    INSERT INTO archive_help_enrollment.revision_tombstones (studio_id, member_id, revision)
    VALUES (p_studio_id, p_member_id, p_revision) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO archive_help_enrollment.current_binding (studio_id, member_id, revision, source_observed_at, phone_box)
  VALUES (p_studio_id, p_member_id, p_revision, p_source_observed_at, p_phone_box)
  ON CONFLICT (studio_id, member_id) DO UPDATE
  SET revision = EXCLUDED.revision, source_observed_at = EXCLUDED.source_observed_at,
    phone_box = EXCLUDED.phone_box, revoked_at = NULL;
  RETURN true;
END
$body$;

-- Explicit revocation erases the current box and blocks replay of this revision.
-- A revoke for another revision never overwrites a different current binding.
CREATE FUNCTION archive_help_enrollment.revoke_binding(p_studio_id text, p_member_id text, p_revision text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '750ms'
AS $body$
BEGIN
  IF archive_help_enrollment.valid_identity(p_studio_id, p_member_id, p_revision) IS NOT TRUE THEN
    RAISE EXCEPTION 'Invalid enrollment revocation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(1095910216, hashtext(('help-enrollment:' || p_member_id) COLLATE "C"));
  INSERT INTO archive_help_enrollment.revision_tombstones (studio_id, member_id, revision)
  VALUES (p_studio_id, p_member_id, p_revision) ON CONFLICT DO NOTHING;

  INSERT INTO archive_help_enrollment.current_binding (studio_id, member_id, revision, revoked_at)
  VALUES (p_studio_id, p_member_id, p_revision, clock_timestamp())
  ON CONFLICT (studio_id, member_id) DO UPDATE SET revoked_at = EXCLUDED.revoked_at, phone_box = NULL
  WHERE current_binding.revision = EXCLUDED.revision AND current_binding.revoked_at IS NULL;
  RETURN FOUND;
END
$body$;

CREATE FUNCTION archive_help_enrollment.approve_enrollment(
  p_reference_digest text, p_studio_id text, p_member_id text, p_revision text, p_expires_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '750ms'
AS $body$
DECLARE
  observed_at timestamptz;
  checked_at timestamptz;
BEGIN
  IF archive_help_enrollment.valid_identity(p_studio_id, p_member_id, p_revision) IS NOT TRUE
    OR p_reference_digest IS NULL OR p_reference_digest COLLATE "C" !~ '^[0-9a-f]{64}$'
    OR p_expires_at IS NULL OR NOT isfinite(p_expires_at) THEN
    RAISE EXCEPTION 'Invalid enrollment approval' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(1095910216, hashtext(('help-enrollment:' || p_member_id) COLLATE "C"));
  SELECT source_observed_at INTO observed_at FROM archive_help_enrollment.current_binding
  WHERE studio_id = p_studio_id AND member_id = p_member_id AND revision = p_revision
    AND revoked_at IS NULL FOR UPDATE;

  checked_at := clock_timestamp();
  IF p_expires_at <= checked_at OR p_expires_at > checked_at + interval '10 minutes' THEN
    RAISE EXCEPTION 'Invalid enrollment approval expiry' USING ERRCODE = '22023';
  END IF;
  IF observed_at IS NULL OR observed_at > checked_at OR observed_at < checked_at - interval '26 hours' THEN
    RETURN false;
  END IF;

  -- Never extend or reassign a digest, including after its approval expires.
  INSERT INTO archive_help_enrollment.staff_approval
    (reference_digest, studio_id, member_id, revision, approved_at, expires_at)
  VALUES (p_reference_digest, p_studio_id, p_member_id, p_revision, checked_at, p_expires_at)
  ON CONFLICT (reference_digest) DO NOTHING;
  RETURN FOUND;
END
$body$;

-- Call reads in fresh READ COMMITTED transactions to see committed revocations.
CREATE FUNCTION archive_help_enrollment.read_enrollment(p_reference_digest text) RETURNS jsonb
LANGUAGE sql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
RETURN (
  SELECT jsonb_build_object(
    'authority', 'approved_help_enrollment', 'approved', true, 'studioId', a.studio_id,
    'memberId', a.member_id, 'revision', a.revision,
    'expiresAt', floor(extract(epoch FROM a.expires_at) * 1000)::bigint
  )
  FROM archive_help_enrollment.staff_approval AS a
  JOIN archive_help_enrollment.current_binding AS b USING (studio_id, member_id, revision)
  WHERE p_reference_digest COLLATE "C" ~ '^[0-9a-f]{64}$' AND a.reference_digest = p_reference_digest
    AND a.expires_at > statement_timestamp() AND b.revoked_at IS NULL
    AND b.source_observed_at BETWEEN statement_timestamp() - interval '26 hours' AND statement_timestamp()
);

-- Returns only the current active revision; the helper verifies its expected
-- revision before using the result and applies the tighter OTP freshness limit.
CREATE FUNCTION archive_help_enrollment.read_binding(p_studio_id text, p_member_id text) RETURNS jsonb
LANGUAGE sql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
RETURN (
  SELECT jsonb_build_object(
    'authority', 'verified_studiomate_in_person_signup', 'signupComplete', true, 'active', true,
    'revoked', false, 'registeredContactVerified', true, 'studioId', b.studio_id, 'memberId', b.member_id,
    'revision', b.revision, 'sourceObservedAt', floor(extract(epoch FROM b.source_observed_at) * 1000)::bigint,
    'phoneBox', b.phone_box
  )
  FROM archive_help_enrollment.current_binding AS b
  WHERE p_studio_id COLLATE "C" = '5330' AND p_member_id COLLATE "C" ~ '^[1-9][0-9]{0,15}$'
    AND b.studio_id = p_studio_id AND b.member_id = p_member_id AND b.revoked_at IS NULL
    AND b.source_observed_at BETWEEN statement_timestamp() - interval '26 hours' AND statement_timestamp()
);

REVOKE ALL ON SCHEMA archive_help_enrollment
  FROM PUBLIC, anon, authenticated, service_role, archive_help_member_auth_runtime, archive_help_enrollment_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA archive_help_enrollment
  FROM PUBLIC, anon, authenticated, service_role, archive_help_member_auth_runtime, archive_help_enrollment_writer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA archive_help_enrollment
  FROM PUBLIC, anon, authenticated, service_role, archive_help_member_auth_runtime, archive_help_enrollment_writer;

GRANT USAGE ON SCHEMA archive_help_enrollment TO archive_help_member_auth_runtime, archive_help_enrollment_writer;
GRANT EXECUTE ON FUNCTION archive_help_enrollment.read_enrollment(text), archive_help_enrollment.read_binding(text, text)
  TO archive_help_member_auth_runtime;
GRANT EXECUTE ON FUNCTION archive_help_enrollment.publish_binding(text, text, text, timestamptz, text),
  archive_help_enrollment.revoke_binding(text, text, text),
  archive_help_enrollment.approve_enrollment(text, text, text, text, timestamptz)
  TO archive_help_enrollment_writer;

COMMIT;
