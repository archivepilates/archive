-- Fresh private namespace only; intentionally not an upgrade or re-run script.
-- Keep outside Data API schemas. No login, runtime membership or credentials are provisioned.
BEGIN;

CREATE ROLE archive_help_member_auth_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE archive_help_member_auth_runtime NOLOGIN NOINHERIT NOBYPASSRLS;

-- Managed CREATEROLE installers get ADMIN but not SET on new roles.
DO $role$
BEGIN
  IF NOT pg_has_role(current_user, 'archive_help_member_auth_owner', 'SET') THEN
    EXECUTE format('GRANT archive_help_member_auth_owner TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  END IF;
END
$role$;

CREATE SCHEMA archive_help_member_auth AUTHORIZATION archive_help_member_auth_owner;
SET LOCAL ROLE archive_help_member_auth_owner;

CREATE FUNCTION archive_help_member_auth.valid_key(p_kind text, p_key text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, pg_temp
RETURN p_kind COLLATE "C" IN (
  'binding', 'member-index', 'invite', 'invite-index', 'challenge', 'flow', 'credential',
  'credential-index', 'session', 'budget', 'otp', 'otp-budget', 'otp-receipt'
) AND octet_length(p_key) = 64 AND p_key COLLATE "C" ~ '^[0-9a-f]{64}$';

CREATE TABLE archive_help_member_auth.records (
  kind text COLLATE "C" NOT NULL,
  key_hash text COLLATE "C" NOT NULL,
  value json NOT NULL CHECK (octet_length(convert_to(value::text, 'UTF8')) <= 12000),
  expires bigint CHECK (expires BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (kind, key_hash),
  CHECK (archive_help_member_auth.valid_key(kind, key_hash))
);

CREATE INDEX records_expiry ON archive_help_member_auth.records (expires) WHERE expires IS NOT NULL;

ALTER TABLE archive_help_member_auth.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_member_auth.records FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON archive_help_member_auth.records
  TO archive_help_member_auth_owner USING (true) WITH CHECK (true);

CREATE FUNCTION archive_help_member_auth.read_record(p_kind text, p_key text, p_now bigint) RETURNS text
LANGUAGE sql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
RETURN (
  SELECT value::text FROM archive_help_member_auth.records
  WHERE archive_help_member_auth.valid_key(p_kind, p_key)
    AND p_now BETWEEN 0 AND 9007199254740991
    AND kind = p_kind AND key_hash = p_key AND (expires IS NULL OR expires > p_now)
);

-- The adapter acquires this same lock before the callback, covering composite
-- read/modify/write operations. Direct writes must also respect that lock.
CREATE FUNCTION archive_help_member_auth.put_record(p_kind text, p_key text, p_value text, p_expires bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '750ms'
AS $body$
BEGIN
  IF archive_help_member_auth.valid_key(p_kind, p_key) IS NOT TRUE
    OR (p_expires IS NOT NULL AND p_expires NOT BETWEEN 1 AND 9007199254740991)
    OR p_value IS NULL OR octet_length(convert_to(p_value, 'UTF8')) > 12000
    OR p_value IS NOT JSON THEN
    RAISE EXCEPTION 'Invalid auth record' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(1095910216, 1212501072);
  INSERT INTO archive_help_member_auth.records (kind, key_hash, value, expires)
  VALUES (p_kind, p_key, p_value::json, p_expires)
  ON CONFLICT (kind, key_hash) DO UPDATE SET value = EXCLUDED.value, expires = EXCLUDED.expires;
END
$body$;

CREATE FUNCTION archive_help_member_auth.remove_record(p_kind text, p_key text) RETURNS void
LANGUAGE plpgsql STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '750ms'
AS $body$
BEGIN
  IF archive_help_member_auth.valid_key(p_kind, p_key) THEN
    PERFORM pg_advisory_xact_lock(1095910216, 1212501072);
    DELETE FROM archive_help_member_auth.records WHERE kind = p_kind AND key_hash = p_key;
  END IF;
END
$body$;

CREATE FUNCTION archive_help_member_auth.prune_records(p_now bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '750ms'
AS $body$
BEGIN
  IF p_now IS NULL OR p_now NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid auth store time' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(1095910216, 1212501072);
  DELETE FROM archive_help_member_auth.records WHERE expires <= p_now;
END
$body$;

REVOKE ALL ON SCHEMA archive_help_member_auth FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE archive_help_member_auth.records FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA archive_help_member_auth FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA archive_help_member_auth TO archive_help_member_auth_runtime;
GRANT EXECUTE ON FUNCTION archive_help_member_auth.read_record(text, text, bigint),
  archive_help_member_auth.put_record(text, text, text, bigint),
  archive_help_member_auth.remove_record(text, text),
  archive_help_member_auth.prune_records(bigint)
  TO archive_help_member_auth_runtime;

COMMIT;
