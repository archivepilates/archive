-- Stage only. No credentials, LOGIN, member data, or grants on existing history.
CREATE ROLE archive_help_member_auth_app NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE archive_help_pass_issuer_app NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE archive_help_pass_reader_app NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE archive_help_enrollment_writer_app NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE archive_help_snapshot_writer_app NOLOGIN NOINHERIT NOBYPASSRLS;

GRANT archive_help_member_auth_runtime TO archive_help_member_auth_app
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT archive_help_pass_session_issuer TO archive_help_pass_issuer_app
  WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT archive_help_pass_reader TO archive_help_pass_reader_app
  WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT archive_help_enrollment_writer TO archive_help_enrollment_writer_app
  WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT archive_help_pass_writer TO archive_help_snapshot_writer_app
  WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
