-- Separate from the pilot. Publish a complete contact and pass generation
-- atomically. No names, raw phones, native IDs, or payment data are stored.
BEGIN;
CREATE SCHEMA archive_help_roster AUTHORIZATION archive_help_pass_owner;
SET LOCAL ROLE archive_help_pass_owner;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE archive_help_roster.generation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  observed_at timestamptz NOT NULL,
  source_digest text COLLATE "C" NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  member_count integer NOT NULL CHECK (member_count BETWEEN 0 AND 5000),
  card_count integer NOT NULL CHECK (card_count BETWEEN member_count AND member_count * 100)
);
CREATE TABLE archive_help_roster.member_projection (
  member_key text COLLATE "C" PRIMARY KEY CHECK (member_key ~ '^[0-9a-f]{64}$'),
  phone_key text COLLATE "C" NOT NULL UNIQUE CHECK (phone_key ~ '^[0-9a-f]{64}$'),
  revision text COLLATE "C" NOT NULL CHECK (revision ~ '^[0-9a-f]{64}$'),
  cards jsonb NOT NULL
);
CREATE TABLE archive_help_roster.contact_approval (
  member_key text COLLATE "C" NOT NULL CHECK (member_key ~ '^[0-9a-f]{64}$'),
  phone_key text COLLATE "C" NOT NULL UNIQUE CHECK (phone_key ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY(member_key,phone_key)
);
CREATE UNIQUE INDEX help_one_approved_contact ON archive_help_roster.contact_approval(member_key)
  WHERE revoked_at IS NULL;
CREATE TABLE archive_help_roster.read_grant (
  session_digest text COLLATE "C" PRIMARY KEY CHECK (session_digest ~ '^[0-9a-f]{64}$'),
  member_key text COLLATE "C" NOT NULL CHECK (member_key ~ '^[0-9a-f]{64}$'),
  revision text COLLATE "C" NOT NULL CHECK (revision ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
ALTER TABLE archive_help_roster.generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_roster.generation FORCE ROW LEVEL SECURITY;
ALTER TABLE archive_help_roster.member_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_roster.member_projection FORCE ROW LEVEL SECURITY;
ALTER TABLE archive_help_roster.contact_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_roster.contact_approval FORCE ROW LEVEL SECURITY;
ALTER TABLE archive_help_roster.read_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_roster.read_grant FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON archive_help_roster.generation
  TO archive_help_pass_owner USING (true) WITH CHECK (true);
CREATE POLICY owner_only ON archive_help_roster.member_projection
  TO archive_help_pass_owner USING (true) WITH CHECK (true);
CREATE POLICY owner_only ON archive_help_roster.contact_approval
  TO archive_help_pass_owner USING (true) WITH CHECK (true);
CREATE POLICY owner_only ON archive_help_roster.read_grant
  TO archive_help_pass_owner USING (true) WITH CHECK (true);

CREATE FUNCTION archive_help_roster.status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
RETURN (SELECT jsonb_build_object('observedAt', observed_at, 'sourceDigest', source_digest,
  'members', member_count, 'cards', card_count) FROM archive_help_roster.generation WHERE singleton);

-- Approval is a separate capability, never given to the hourly writer.
-- Contact changes or previously assigned numbers are not re-enrolled in bulk.
CREATE FUNCTION archive_help_roster.approve_contact(p_member text, p_phone text,
  p_verified_at timestamptz DEFAULT clock_timestamp()) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $body$
BEGIN
  IF p_verified_at IS NULL OR p_verified_at>clock_timestamp()
    OR p_verified_at<clock_timestamp()-interval '30 minutes' THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(1095910216, 1904790064);
  INSERT INTO archive_help_roster.contact_approval(member_key,phone_key,verified_at)
  VALUES(p_member,p_phone,p_verified_at) ON CONFLICT DO NOTHING;
  RETURN FOUND;
END
$body$;
CREATE FUNCTION archive_help_roster.revoke_contact(p_member text, p_phone text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $body$
DECLARE projected_cards integer;
BEGIN
  PERFORM pg_advisory_xact_lock(1095910216, 1904790064);
  UPDATE archive_help_roster.contact_approval SET revoked_at=clock_timestamp()
    WHERE member_key=p_member COLLATE "C" AND phone_key=p_phone COLLATE "C" AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM archive_help_roster.member_projection
    WHERE member_key=p_member COLLATE "C" AND phone_key=p_phone COLLATE "C"
    RETURNING jsonb_array_length(cards) INTO projected_cards;
  IF FOUND THEN
    UPDATE archive_help_roster.generation SET member_count=member_count-1,card_count=card_count-projected_cards WHERE singleton;
  END IF;
  RETURN true;
END
$body$;

CREATE FUNCTION archive_help_roster.publish(
  p_observed timestamptz, p_digest text, p_members jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET lock_timeout = '3s'
AS $body$
DECLARE
  prior archive_help_roster.generation%ROWTYPE;
  member_row jsonb;
  card jsonb;
  qty jsonb;
  member_count integer;
  card_count integer := 0;
  checked_at timestamptz;
  source_day date;
  previous_rows jsonb := '{}'::jsonb;
  projected_count integer;
  projected_cards integer;
BEGIN
  IF p_observed IS NULL OR p_digest IS NULL OR p_digest COLLATE "C" !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_members) IS DISTINCT FROM 'array' OR jsonb_array_length(p_members)>5000
  THEN RAISE EXCEPTION 'Invalid member generation' USING ERRCODE='22023'; END IF;
  member_count := jsonb_array_length(p_members);
  source_day := (p_observed AT TIME ZONE 'Asia/Seoul')::date;
  FOR member_row IN SELECT value FROM jsonb_array_elements(p_members) LOOP
    IF jsonb_typeof(member_row) IS DISTINCT FROM 'object'
      OR NOT (member_row ?& ARRAY['memberKey','phoneKey','cards'])
      OR member_row - ARRAY['memberKey','phoneKey','cards'] <> '{}'::jsonb
      OR coalesce(member_row->>'memberKey','') COLLATE "C" !~ '^[0-9a-f]{64}$'
      OR coalesce(member_row->>'phoneKey','') COLLATE "C" !~ '^[0-9a-f]{64}$'
      OR jsonb_typeof(member_row->'cards') IS DISTINCT FROM 'array'
      OR jsonb_array_length(member_row->'cards') NOT BETWEEN 1 AND 100
    THEN RAISE EXCEPTION 'Invalid member projection' USING ERRCODE='22023'; END IF;
    card_count := card_count + jsonb_array_length(member_row->'cards');
    FOR card IN SELECT value FROM jsonb_array_elements(member_row->'cards') LOOP
      IF jsonb_typeof(card) IS DISTINCT FROM 'object'
        OR NOT (card ?& ARRAY['category','type','status','startsOn','expiresOn','remaining','bookable'])
        OR card - ARRAY['category','type','status','startsOn','expiresOn','remaining','bookable'] <> '{}'::jsonb
        OR coalesce(card->>'category','') NOT IN ('group','private','duet','triple')
        OR coalesce(card->>'type','') NOT IN ('count','period')
        OR coalesce(card->>'status','') NOT IN ('active','held','future')
        OR coalesce(card->>'startsOn','') COLLATE "C" !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
        OR coalesce(card->>'expiresOn','') COLLATE "C" !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      THEN RAISE EXCEPTION 'Invalid member card' USING ERRCODE='22023'; END IF;
      IF (card->>'startsOn')::date > (card->>'expiresOn')::date
        OR (card->>'expiresOn')::date < source_day
        OR ((card->>'status')='future') <> ((card->>'startsOn')::date > source_day)
      THEN RAISE EXCEPTION 'Invalid member card period' USING ERRCODE='22023'; END IF;
      FOREACH qty IN ARRAY ARRAY[card->'remaining', card->'bookable'] LOOP
        IF card->>'type'='period' THEN
          IF qty <> 'null'::jsonb THEN RAISE EXCEPTION 'Invalid period balance' USING ERRCODE='22023'; END IF;
        ELSIF jsonb_typeof(qty) IS DISTINCT FROM 'number' OR (qty::numeric NOT BETWEEN 0 AND 100000)
          OR trunc(qty::numeric) <> qty::numeric
        THEN RAISE EXCEPTION 'Invalid count balance' USING ERRCODE='22023'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  PERFORM pg_advisory_xact_lock(1095910216, 1904790064);
  checked_at := clock_timestamp();
  IF p_observed > checked_at OR p_observed <= checked_at - interval '30 minutes' THEN
    RAISE EXCEPTION 'Invalid source freshness' USING ERRCODE='22023';
  END IF;
  SELECT * INTO prior FROM archive_help_roster.generation WHERE singleton;
  IF FOUND AND p_observed <= prior.observed_at THEN
    IF p_observed = prior.observed_at AND p_digest = prior.source_digest THEN
      RETURN archive_help_roster.status();
    END IF;
    RAISE EXCEPTION 'Older or conflicting member generation' USING ERRCODE='22023';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_members) GROUP BY value->>'memberKey' HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_members) GROUP BY value->>'phoneKey' HAVING count(*)>1)
  THEN RAISE EXCEPTION 'Ambiguous member generation' USING ERRCODE='22023'; END IF;
  IF prior.observed_at IS NOT NULL AND p_observed-prior.observed_at <= interval '90 minutes' THEN
    SELECT coalesce(jsonb_object_agg(member_key,jsonb_build_array(phone_key,revision)),'{}'::jsonb)
      INTO previous_rows FROM archive_help_roster.member_projection;
  END IF;
  UPDATE archive_help_roster.contact_approval a SET revoked_at=checked_at
  FROM jsonb_array_elements(p_members) AS source(v)
  WHERE a.revoked_at IS NULL AND a.member_key=v->>'memberKey' AND a.phone_key<>v->>'phoneKey';
  DELETE FROM archive_help_roster.member_projection;
  WITH inserted AS (
    INSERT INTO archive_help_roster.member_projection(member_key,phone_key,revision,cards)
    SELECT v->>'memberKey',v->>'phoneKey',
      CASE WHEN previous_rows->(v->>'memberKey')->>0 = v->>'phoneKey'
        THEN previous_rows->(v->>'memberKey')->>1
        ELSE replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','') END,
      v->'cards'
    FROM jsonb_array_elements(p_members) AS source(v)
    JOIN archive_help_roster.contact_approval a ON a.member_key=v->>'memberKey' AND a.phone_key=v->>'phoneKey'
    WHERE a.revoked_at IS NULL AND a.verified_at<=p_observed
    RETURNING cards
  ) SELECT count(*),coalesce(sum(jsonb_array_length(cards)),0) INTO projected_count,projected_cards FROM inserted;

  INSERT INTO archive_help_roster.generation VALUES(true,p_observed,p_digest,projected_count,projected_cards)
  ON CONFLICT (singleton) DO UPDATE SET observed_at=EXCLUDED.observed_at,source_digest=EXCLUDED.source_digest,
    member_count=EXCLUDED.member_count,card_count=EXCLUDED.card_count;
  DELETE FROM archive_help_roster.read_grant WHERE expires_at < checked_at-interval '1 day';
  RETURN jsonb_build_object('observedAt',p_observed,'sourceDigest',p_digest,
    'members',projected_count,'cards',projected_cards,'held',member_count-projected_count);
END
$body$;

CREATE FUNCTION archive_help_roster.find_binding(p_phone text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
RETURN (SELECT jsonb_build_object('subject',m.member_key,'revision',m.revision,
  'observedAt',floor(extract(epoch FROM g.observed_at)*1000)::bigint)
  FROM archive_help_roster.member_projection m CROSS JOIN archive_help_roster.generation g
  WHERE p_phone COLLATE "C" ~ '^[0-9a-f]{64}$' AND m.phone_key=p_phone COLLATE "C"
    AND g.singleton AND g.observed_at BETWEEN statement_timestamp()-interval '60 minutes' AND statement_timestamp());

CREATE FUNCTION archive_help_roster.read_binding(p_member text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
RETURN (SELECT jsonb_build_object('subject',m.member_key,'revision',m.revision,
  'observedAt',floor(extract(epoch FROM g.observed_at)*1000)::bigint)
  FROM archive_help_roster.member_projection m CROSS JOIN archive_help_roster.generation g
  WHERE p_member COLLATE "C" ~ '^[0-9a-f]{64}$' AND m.member_key=p_member COLLATE "C"
    AND g.singleton AND g.observed_at BETWEEN statement_timestamp()-interval '60 minutes' AND statement_timestamp());

CREATE FUNCTION archive_help_roster.pin_binding(p_member text,p_revision text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout='2s'
AS $body$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(1095910216,1904790064);
  RETURN coalesce(archive_help_roster.read_binding(p_member)->>'revision'=p_revision COLLATE "C",false);
END
$body$;

CREATE FUNCTION archive_help_roster.issue_read_session(p_grant text,p_member text,p_revision text,p_expiry timestamptz)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $body$
  WITH issued AS (
    INSERT INTO archive_help_roster.read_grant(session_digest,member_key,revision,expires_at)
    SELECT p_grant, p_member, p_revision, p_expiry
    WHERE p_expiry>statement_timestamp() AND p_expiry<=statement_timestamp()+interval '2 minutes'
      AND archive_help_roster.read_binding(p_member)->>'revision'=p_revision COLLATE "C"
    ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT EXISTS (SELECT FROM issued)
$body$;

CREATE FUNCTION archive_help_roster.revoke_read_session(p_grant text) RETURNS void
LANGUAGE sql STRICT SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $body$
  UPDATE archive_help_roster.read_grant SET revoked=true WHERE session_digest=p_grant COLLATE "C"
$body$;

CREATE FUNCTION archive_help_roster.read_own(p_grant text) RETURNS jsonb
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog, pg_temp
RETURN (SELECT jsonb_build_object('cards',m.cards,'observedAt',g.observed_at,
  'expiresAt',floor(extract(epoch FROM r.expires_at)*1000)::bigint)
  FROM archive_help_roster.read_grant r
  JOIN archive_help_roster.member_projection m USING (member_key,revision)
  CROSS JOIN archive_help_roster.generation g
  WHERE r.session_digest=p_grant COLLATE "C" AND NOT r.revoked AND r.expires_at>statement_timestamp()
    AND g.singleton AND g.observed_at BETWEEN statement_timestamp()-interval '60 minutes' AND statement_timestamp());

REVOKE ALL ON SCHEMA archive_help_roster FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA archive_help_roster FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA archive_help_roster FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA archive_help_roster TO archive_help_pass_writer, archive_help_enrollment_writer,
  archive_help_member_auth_runtime, archive_help_pass_session_issuer, archive_help_pass_reader;
GRANT EXECUTE ON FUNCTION archive_help_roster.status(),archive_help_roster.publish(timestamptz,text,jsonb)
  TO archive_help_pass_writer;
GRANT EXECUTE ON FUNCTION archive_help_roster.approve_contact(text,text,timestamptz),archive_help_roster.revoke_contact(text,text)
  TO archive_help_enrollment_writer;
GRANT EXECUTE ON FUNCTION archive_help_roster.find_binding(text),archive_help_roster.read_binding(text),
  archive_help_roster.pin_binding(text,text) TO archive_help_member_auth_runtime;
GRANT EXECUTE ON FUNCTION archive_help_roster.issue_read_session(text,text,text,timestamptz),
  archive_help_roster.revoke_read_session(text) TO archive_help_pass_session_issuer;
GRANT EXECUTE ON FUNCTION archive_help_roster.read_own(text) TO archive_help_pass_reader;

COMMIT;
