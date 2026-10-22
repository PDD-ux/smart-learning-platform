BEGIN;

-- A missing subjective answer needs an empty grade-history carrier, never late text.
CREATE OR REPLACE FUNCTION "exam_answer_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maximum integer; current_state "ExamAttemptState"; deadline timestamp; item_type text; blank_carrier boolean;
BEGIN
 IF TG_OP='DELETE' THEN
  SELECT "state","deadlineAt" INTO current_state,deadline FROM "ExamAttempt" WHERE "id"=OLD."attemptId" FOR UPDATE;
  IF FOUND AND (current_state<>'IN_PROGRESS' OR (clock_timestamp() AT TIME ZONE 'UTC')>=deadline) THEN RAISE EXCEPTION 'submitted or expired answer cannot be deleted' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (NEW."attemptId"<>OLD."attemptId" OR NEW."paperItemId"<>OLD."paperItemId" OR NEW."paperVersionId"<>OLD."paperVersionId") THEN RAISE EXCEPTION 'exam answer identity is immutable' USING ERRCODE='23514'; END IF;
 SELECT "state","deadlineAt" INTO current_state,deadline FROM "ExamAttempt" WHERE "id"=NEW."attemptId" FOR UPDATE;
 SELECT "scoreUnits", "body"->>'type' INTO maximum,item_type FROM "ExamPaperItem" WHERE "id"=NEW."paperItemId";
 IF NEW."scoreUnits">maximum THEN RAISE EXCEPTION 'answer score exceeds item maximum' USING ERRCODE='23514'; END IF;
 blank_carrier := TG_OP='INSERT' AND current_state='PENDING_REVIEW' AND item_type='SUBJECTIVE' AND NEW."answer" IS NULL AND NEW."marked"=false AND NEW."revision"=0 AND NEW."scoreUnits" IS NULL AND NEW."correct" IS NULL AND NEW."feedback" IS NULL;
 IF current_state<>'IN_PROGRESS' AND NOT blank_carrier AND (TG_OP='INSERT' OR NEW."answer" IS DISTINCT FROM OLD."answer" OR NEW."marked" IS DISTINCT FROM OLD."marked") THEN RAISE EXCEPTION 'submitted answer content is immutable' USING ERRCODE='23514'; END IF;
 IF current_state='GRADED' AND TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'final answer grade is immutable' USING ERRCODE='23514'; END IF;
 IF current_state='IN_PROGRESS' AND (NEW."scoreUnits" IS NOT NULL OR NEW."correct" IS NOT NULL) THEN RAISE EXCEPTION 'draft answer cannot be graded' USING ERRCODE='23514'; END IF;
 IF current_state='IN_PROGRESS' AND (clock_timestamp() AT TIME ZONE 'UTC')>=deadline AND (TG_OP='INSERT' OR NEW."answer" IS DISTINCT FROM OLD."answer" OR NEW."marked" IS DISTINCT FROM OLD."marked") THEN RAISE EXCEPTION 'exam answer deadline passed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

COMMIT;
