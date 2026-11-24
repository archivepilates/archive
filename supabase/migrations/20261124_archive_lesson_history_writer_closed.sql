BEGIN;
ALTER ROLE archive_lesson_history_writer NOLOGIN;
REVOKE EXECUTE ON FUNCTION archive_lesson_history.publish(date,text),
  archive_lesson_history.receipt(date), archive_lesson_history.publish_supplement(text),
  archive_lesson_history.supplement_receipt() FROM archive_lesson_history_writer;
REVOKE USAGE ON SCHEMA archive_lesson_history FROM archive_lesson_history_writer;
COMMIT;
