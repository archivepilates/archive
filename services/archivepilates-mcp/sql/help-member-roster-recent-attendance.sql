-- Part of the existing OTP roster; stores only one window of counts per subject.
BEGIN;
SET LOCAL ROLE archive_help_pass_owner;
CREATE TABLE archive_help_roster.recent_attendance (
  member_key text COLLATE "C" PRIMARY KEY REFERENCES archive_help_roster.member_projection(member_key) ON DELETE CASCADE,
  attendance jsonb NOT NULL
);
ALTER TABLE archive_help_roster.recent_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_help_roster.recent_attendance FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON archive_help_roster.recent_attendance
  TO archive_help_pass_owner USING (true) WITH CHECK (true);
REVOKE ALL ON archive_help_roster.recent_attendance FROM PUBLIC, anon, authenticated, service_role,
  archive_help_member_auth_runtime, archive_help_pass_session_issuer, archive_help_pass_reader, archive_help_enrollment_writer;

CREATE FUNCTION archive_help_roster.publish_native_registration_with_attendance(
  p_observed timestamptz, p_digest text, p_members jsonb, p_contacts jsonb, p_attendance jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '3s'
AS $body$
DECLARE result jsonb; source_day date := (p_observed AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF jsonb_typeof(p_attendance) IS DISTINCT FROM 'array' OR jsonb_array_length(p_attendance)>5000
  OR EXISTS (SELECT FROM jsonb_array_elements(p_attendance) a(v) GROUP BY v->>'memberKey' HAVING count(*)>1)
  OR EXISTS (
    SELECT FROM jsonb_array_elements(p_attendance) a(v)
    WHERE jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT(v ?& ARRAY['memberKey','attendance'])
      OR v-ARRAY['memberKey','attendance'] <> '{}'::jsonb
      OR NOT EXISTS (SELECT FROM jsonb_array_elements(p_members) m(x) WHERE x->>'memberKey'=v->>'memberKey')
      OR jsonb_typeof(v->'attendance') IS DISTINCT FROM 'object'
      OR NOT ((v->'attendance') ?& ARRAY['windowThrough','lastOn','byCategory'])
      OR (v->'attendance')-ARRAY['windowThrough','lastOn','byCategory'] <> '{}'::jsonb
      OR (v->'attendance'->>'windowThrough') IS DISTINCT FROM to_char(source_day,'YYYY-MM-DD')
      OR jsonb_typeof(v->'attendance'->'byCategory') IS DISTINCT FROM 'object'
      OR NOT ((v->'attendance'->'byCategory') ?& ARRAY['group','private','duet','triple'])
      OR (v->'attendance'->'byCategory')-ARRAY['group','private','duet','triple'] <> '{}'::jsonb
  ) THEN RAISE EXCEPTION 'Invalid attendance projection' USING ERRCODE='22023'; END IF;
  IF EXISTS (
    SELECT FROM jsonb_array_elements(p_attendance) a(v)
    WHERE (v->'attendance'->'lastOn' <> 'null'::jsonb
      AND (coalesce(v->'attendance'->>'lastOn','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
        OR (v->'attendance'->>'lastOn')::date NOT BETWEEN source_day-27 AND source_day))
      OR EXISTS (SELECT FROM jsonb_each(v->'attendance'->'byCategory') c(k,n)
        WHERE jsonb_typeof(n) IS DISTINCT FROM 'number' OR n::text !~ '^(0|[1-9][0-9]{0,2})$' OR n::numeric>500)
      OR (v->'attendance'->'lastOn' = 'null'::jsonb) IS DISTINCT FROM
        (v->'attendance'->'byCategory' = '{"group":0,"private":0,"duet":0,"triple":0}'::jsonb)
  ) THEN RAISE EXCEPTION 'Invalid attendance summary' USING ERRCODE='22023'; END IF;

  PERFORM pg_advisory_xact_lock(1095910216,1904790064);
  IF EXISTS (SELECT FROM archive_help_roster.generation g WHERE g.singleton AND p_observed<=g.observed_at)
    THEN RETURN archive_help_roster.publish_native_registration(p_observed,p_digest,p_members,p_contacts);
  END IF;
  result := archive_help_roster.publish_native_registration(p_observed,p_digest,p_members,p_contacts);
  INSERT INTO archive_help_roster.recent_attendance(member_key,attendance)
    SELECT m.member_key,v->'attendance' FROM jsonb_array_elements(p_attendance) a(v)
    JOIN archive_help_roster.member_projection m ON m.member_key=v->>'memberKey';
  RETURN result;
END
$body$;

CREATE FUNCTION archive_help_roster.read_own_recent_attendance(p_grant text,p_observed timestamptz)
RETURNS jsonb LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog, pg_temp
RETURN (SELECT a.attendance FROM archive_help_roster.read_grant r
  JOIN archive_help_roster.member_projection m USING (member_key,revision)
  JOIN archive_help_roster.recent_attendance a USING (member_key)
  CROSS JOIN archive_help_roster.generation g
  WHERE r.session_digest=p_grant COLLATE "C" AND NOT r.revoked AND r.expires_at>statement_timestamp()
    AND g.singleton AND g.observed_at=p_observed
    AND g.observed_at BETWEEN statement_timestamp()-interval '60 minutes' AND statement_timestamp());

REVOKE ALL ON FUNCTION archive_help_roster.publish_native_registration_with_attendance(timestamptz,text,jsonb,jsonb,jsonb),
  archive_help_roster.read_own_recent_attendance(text,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION archive_help_roster.publish_native_registration_with_attendance(timestamptz,text,jsonb,jsonb,jsonb)
  TO archive_help_enrollment_writer;
GRANT EXECUTE ON FUNCTION archive_help_roster.read_own_recent_attendance(text,timestamptz)
  TO archive_help_pass_reader;
COMMIT;
