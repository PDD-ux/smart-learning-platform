-- Private self-tests use reference grades, including reviewed-bank MOCK papers.
CREATE OR REPLACE FUNCTION "exam_attempt_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_row "ExamPaperVersion"; paper_row "ExamPaper"; item_total bigint; item_row record; expected_keys text[]; actual_keys text[];
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD."state"='GRADED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'final exam score is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','revision','submittedAt','gradedAt','objectiveScoreUnits','pendingScoreUnits','finalScoreUnits']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','submittedAt','gradedAt','objectiveScoreUnits','pendingScoreUnits','finalScoreUnits']) THEN RAISE EXCEPTION 'exam attempt identity and deadline are immutable' USING ERRCODE='23514'; END IF;
  IF NEW."state"<>OLD."state" AND NOT ((OLD."state"='IN_PROGRESS' AND NEW."state"='SUBMITTED') OR (OLD."state"='SUBMITTED' AND NEW."state" IN ('PENDING_REVIEW','GRADED')) OR (OLD."state"='PENDING_REVIEW' AND NEW."state"='GRADED')) THEN RAISE EXCEPTION 'invalid exam attempt transition' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW."state"<>'IN_PROGRESS' THEN RAISE EXCEPTION 'attempt must start in progress' USING ERRCODE='23514'; END IF;
  SELECT * INTO version_row FROM "ExamPaperVersion" WHERE "id"=NEW."paperVersionId";
  SELECT * INTO paper_row FROM "ExamPaper" WHERE "id"=version_row."paperId";
  IF paper_row."state"<>'PUBLISHED' OR paper_row."publishedVersionId" IS DISTINCT FROM NEW."paperVersionId" OR (paper_row."visibility"='PRIVATE' AND paper_row."ownerId" IS DISTINCT FROM NEW."learnerId") THEN RAISE EXCEPTION 'exam version unavailable to learner' USING ERRCODE='23514'; END IF;
  IF version_row."sealedAt" IS NULL OR NEW."totalScoreUnits"<>version_row."totalScoreUnits" OR NEW."referenceOnly"<>(version_row."kind"='AI_MOCK' OR paper_row."visibility"='PRIVATE') OR NEW."deadlineAt"<>NEW."startedAt"+make_interval(secs=>version_row."durationSec") THEN RAISE EXCEPTION 'exam attempt must bind frozen version and server duration' USING ERRCODE='23514'; END IF;
  SELECT count(DISTINCT value) INTO item_total FROM jsonb_array_elements_text(NEW."questionOrder");
  IF item_total<>version_row."questionCount" OR jsonb_array_length(NEW."questionOrder")<>version_row."questionCount" OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."questionOrder") x WHERE NOT EXISTS(SELECT 1 FROM "ExamPaperItem" i WHERE i."id"=x.value AND i."paperVersionId"=NEW."paperVersionId")) THEN RAISE EXCEPTION 'invalid exam question order' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(NEW."optionOrder"))<>version_row."questionCount" THEN RAISE EXCEPTION 'invalid exam option order' USING ERRCODE='23514'; END IF;
  FOR item_row IN SELECT "id","body" FROM "ExamPaperItem" WHERE "paperVersionId"=NEW."paperVersionId" LOOP
   IF jsonb_typeof(NEW."optionOrder"->item_row."id") IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid exam option order' USING ERRCODE='23514'; END IF;
   SELECT coalesce(array_agg(x->>'key' ORDER BY x->>'key'),ARRAY[]::text[]) INTO expected_keys FROM jsonb_array_elements(item_row."body"->'options') x;
   SELECT coalesce(array_agg(x ORDER BY x),ARRAY[]::text[]) INTO actual_keys FROM jsonb_array_elements_text(NEW."optionOrder"->item_row."id") x;
   IF expected_keys IS DISTINCT FROM actual_keys OR cardinality(actual_keys)<>(SELECT count(DISTINCT x) FROM unnest(actual_keys) x) THEN RAISE EXCEPTION 'invalid exam option order' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF; RETURN NEW;
END $$;
