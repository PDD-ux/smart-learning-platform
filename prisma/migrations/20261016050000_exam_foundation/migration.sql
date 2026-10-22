BEGIN;
-- CreateEnum
CREATE TYPE "ExamTrack" AS ENUM ('CIVIL_SERVICE', 'POSTGRADUATE', 'UNIVERSITY');

-- CreateEnum
CREATE TYPE "ExamQuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SUBJECTIVE');

-- CreateEnum
CREATE TYPE "ExamContentState" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ExamReviewState" AS ENUM ('UNREVIEWED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExamVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ExamPaperKind" AS ENUM ('OFFICIAL', 'MOCK', 'AI_MOCK');

-- CreateEnum
CREATE TYPE "ExamPaperState" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ExamAttemptState" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'PENDING_REVIEW', 'GRADED');

-- CreateEnum
CREATE TYPE "ExamGenerationState" AS ENUM ('QUEUED', 'RUNNING', 'INCOMPLETE', 'READY', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExamBatchState" AS ENUM ('QUEUED', 'RUNNING', 'ACCEPTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExamFailureCode" AS ENUM ('INVALID_JSON', 'QUALITY_REJECTED', 'INSUFFICIENT_EVIDENCE', 'UNAVAILABLE', 'TIMEOUT', 'CANCELLED', 'BUDGET_EXHAUSTED');

-- CreateTable
CREATE TABLE "ExamSubject" (
    "id" TEXT NOT NULL,
    "track" "ExamTrack" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "ExamContentState" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamChapter" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "ExamContentState" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamQuestion" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "subjectId" TEXT NOT NULL,
    "chapterId" TEXT,
    "visibility" "ExamVisibility" NOT NULL DEFAULT 'PRIVATE',
    "state" "ExamContentState" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamQuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "type" "ExamQuestionType" NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "source" JSONB NOT NULL,
    "sourceContentId" TEXT,
    "sourcePointId" TEXT,
    "reviewState" "ExamReviewState" NOT NULL DEFAULT 'UNREVIEWED',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamQuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaper" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "subjectId" TEXT NOT NULL,
    "visibility" "ExamVisibility" NOT NULL DEFAULT 'PRIVATE',
    "state" "ExamPaperState" NOT NULL DEFAULT 'DRAFT',
    "publishedVersionId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaperVersion" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "ExamPaperKind" NOT NULL,
    "sourceYear" INTEGER,
    "durationSec" INTEGER NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "totalScoreUnits" INTEGER NOT NULL,
    "blueprint" JSONB NOT NULL,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamPaperVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaperSection" (
    "id" TEXT NOT NULL,
    "paperVersionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ExamQuestionType" NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "scorePerQuestionUnits" INTEGER NOT NULL,

    CONSTRAINT "ExamPaperSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaperItem" (
    "id" TEXT NOT NULL,
    "paperVersionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "questionVersionId" TEXT,
    "sequence" INTEGER NOT NULL,
    "scoreUnits" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "source" JSONB NOT NULL,

    CONSTRAINT "ExamPaperItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "paperVersionId" TEXT NOT NULL,
    "state" "ExamAttemptState" NOT NULL DEFAULT 'IN_PROGRESS',
    "requestId" UUID NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "gradedAt" TIMESTAMP(3),
    "totalScoreUnits" INTEGER NOT NULL,
    "objectiveScoreUnits" INTEGER,
    "pendingScoreUnits" INTEGER,
    "finalScoreUnits" INTEGER,
    "referenceOnly" BOOLEAN NOT NULL,
    "questionOrder" JSONB NOT NULL,
    "optionOrder" JSONB NOT NULL,

    CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "paperVersionId" TEXT NOT NULL,
    "paperItemId" TEXT NOT NULL,
    "answer" JSONB,
    "marked" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "scoreUnits" INTEGER,
    "correct" BOOLEAN,
    "feedback" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamGradeRecord" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "graderId" TEXT,
    "scoreUnits" INTEGER NOT NULL,
    "feedback" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamGradeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamGenerationJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "paperId" TEXT,
    "state" "ExamGenerationState" NOT NULL DEFAULT 'QUEUED',
    "requestId" UUID NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "blueprint" JSONB NOT NULL,
    "requestedCount" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "callBudget" INTEGER NOT NULL,
    "usedCalls" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "cancelRequestedAt" TIMESTAMP(3),
    "failureCode" "ExamFailureCode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ExamGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamGenerationBatch" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "state" "ExamBatchState" NOT NULL DEFAULT 'QUEUED',
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "failureCode" "ExamFailureCode",
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamGenerationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamSubject_track_state_name_idx" ON "ExamSubject"("track", "state", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSubject_track_code_key" ON "ExamSubject"("track", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ExamChapter_subjectId_code_key" ON "ExamChapter"("subjectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ExamChapter_id_subjectId_key" ON "ExamChapter"("id", "subjectId");

-- CreateIndex
CREATE INDEX "ExamQuestion_subjectId_visibility_state_createdAt_idx" ON "ExamQuestion"("subjectId", "visibility", "state", "createdAt");

-- CreateIndex
CREATE INDEX "ExamQuestion_ownerId_state_idx" ON "ExamQuestion"("ownerId", "state");

-- CreateIndex
CREATE INDEX "ExamQuestionVersion_reviewState_type_difficulty_idx" ON "ExamQuestionVersion"("reviewState", "type", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "ExamQuestionVersion_questionId_versionNo_key" ON "ExamQuestionVersion"("questionId", "versionNo");

-- CreateIndex
CREATE INDEX "ExamPaper_subjectId_visibility_state_createdAt_idx" ON "ExamPaper"("subjectId", "visibility", "state", "createdAt");

-- CreateIndex
CREATE INDEX "ExamPaper_ownerId_state_idx" ON "ExamPaper"("ownerId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperVersion_paperId_versionNo_key" ON "ExamPaperVersion"("paperId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperVersion_id_paperId_key" ON "ExamPaperVersion"("id", "paperId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperSection_paperVersionId_sequence_key" ON "ExamPaperSection"("paperVersionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperSection_id_paperVersionId_key" ON "ExamPaperSection"("id", "paperVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperItem_paperVersionId_sequence_key" ON "ExamPaperItem"("paperVersionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperItem_id_paperVersionId_key" ON "ExamPaperItem"("id", "paperVersionId");

-- CreateIndex
CREATE INDEX "ExamAttempt_learnerId_startedAt_idx" ON "ExamAttempt"("learnerId", "startedAt");

-- CreateIndex
CREATE INDEX "ExamAttempt_state_deadlineAt_idx" ON "ExamAttempt"("state", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttempt_learnerId_requestId_key" ON "ExamAttempt"("learnerId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttempt_id_paperVersionId_key" ON "ExamAttempt"("id", "paperVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAnswer_attemptId_paperItemId_key" ON "ExamAnswer"("attemptId", "paperItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamGradeRecord_answerId_requestId_key" ON "ExamGradeRecord"("answerId", "requestId");

-- CreateIndex
CREATE INDEX "ExamGenerationJob_ownerId_createdAt_idx" ON "ExamGenerationJob"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ExamGenerationJob_state_leaseExpiresAt_idx" ON "ExamGenerationJob"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExamGenerationJob_ownerId_requestId_key" ON "ExamGenerationJob"("ownerId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamGenerationBatch_jobId_sequence_key" ON "ExamGenerationBatch"("jobId", "sequence");

-- AddForeignKey
ALTER TABLE "ExamChapter" ADD CONSTRAINT "ExamChapter_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "ExamSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "ExamSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_chapterId_subjectId_fkey" FOREIGN KEY ("chapterId", "subjectId") REFERENCES "ExamChapter"("id", "subjectId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ExamQuestionVersion" ADD CONSTRAINT "ExamQuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ExamQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestionVersion" ADD CONSTRAINT "ExamQuestionVersion_sourceContentId_fkey" FOREIGN KEY ("sourceContentId") REFERENCES "LearningContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestionVersion" ADD CONSTRAINT "ExamQuestionVersion_sourcePointId_fkey" FOREIGN KEY ("sourcePointId") REFERENCES "KnowledgePoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestionVersion" ADD CONSTRAINT "ExamQuestionVersion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "ExamSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_publishedVersionId_id_fkey" FOREIGN KEY ("publishedVersionId", "id") REFERENCES "ExamPaperVersion"("id", "paperId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ExamPaperVersion" ADD CONSTRAINT "ExamPaperVersion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperSection" ADD CONSTRAINT "ExamPaperSection_paperVersionId_fkey" FOREIGN KEY ("paperVersionId") REFERENCES "ExamPaperVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperItem" ADD CONSTRAINT "ExamPaperItem_paperVersionId_fkey" FOREIGN KEY ("paperVersionId") REFERENCES "ExamPaperVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperItem" ADD CONSTRAINT "ExamPaperItem_sectionId_paperVersionId_fkey" FOREIGN KEY ("sectionId", "paperVersionId") REFERENCES "ExamPaperSection"("id", "paperVersionId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ExamPaperItem" ADD CONSTRAINT "ExamPaperItem_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "ExamQuestionVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_paperVersionId_fkey" FOREIGN KEY ("paperVersionId") REFERENCES "ExamPaperVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_attemptId_paperVersionId_fkey" FOREIGN KEY ("attemptId", "paperVersionId") REFERENCES "ExamAttempt"("id", "paperVersionId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_paperItemId_paperVersionId_fkey" FOREIGN KEY ("paperItemId", "paperVersionId") REFERENCES "ExamPaperItem"("id", "paperVersionId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ExamGradeRecord" ADD CONSTRAINT "ExamGradeRecord_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "ExamAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamGradeRecord" ADD CONSTRAINT "ExamGradeRecord_graderId_fkey" FOREIGN KEY ("graderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamGenerationJob" ADD CONSTRAINT "ExamGenerationJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamGenerationJob" ADD CONSTRAINT "ExamGenerationJob_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamGenerationBatch" ADD CONSTRAINT "ExamGenerationBatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ExamGenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;







-- Non-negative integer money/score units and exact state boundaries.
ALTER TABLE "ExamSubject" ADD CHECK (length(btrim("code")) BETWEEN 1 AND 128 AND length(btrim("name")) BETWEEN 1 AND 200);
ALTER TABLE "ExamChapter" ADD CHECK (length(btrim("code")) BETWEEN 1 AND 128 AND length(btrim("name")) BETWEEN 1 AND 200);
ALTER TABLE "ExamQuestionVersion" ADD CHECK ("versionNo">0 AND "difficulty" BETWEEN 1 AND 5 AND jsonb_typeof("body")='object' AND jsonb_typeof("source")='object' AND "body"->>'type' IS NOT NULL AND "body"->>'type'="type"::text),
 ADD CHECK (("reviewState"='UNREVIEWED' AND "reviewedAt" IS NULL) OR ("reviewState"<>'UNREVIEWED' AND "reviewedAt" IS NOT NULL));
ALTER TABLE "ExamPaper" ADD CHECK ("revision">0 AND ("state"<>'PUBLISHED' OR "publishedVersionId" IS NOT NULL));
ALTER TABLE "ExamPaperVersion" ADD CHECK ("versionNo">0 AND length(btrim("title")) BETWEEN 1 AND 200 AND "durationSec" BETWEEN 60 AND 21600 AND "questionCount" BETWEEN 1 AND 200 AND "totalScoreUnits" BETWEEN 1 AND 1000000 AND jsonb_typeof("blueprint")='object'),
 ADD CHECK ("sourceYear" IS NULL OR "sourceYear" BETWEEN 1900 AND 2200),
 ADD CHECK ("kind"<>'AI_MOCK' OR ("questionCount"<=50 AND "sourceYear" IS NULL));
ALTER TABLE "ExamPaperSection" ADD CHECK ("sequence">=0 AND "questionCount" BETWEEN 1 AND 200 AND "scorePerQuestionUnits" BETWEEN 1 AND 1000000);
ALTER TABLE "ExamPaperItem" ADD CHECK ("sequence">=0 AND "scoreUnits" BETWEEN 1 AND 1000000 AND jsonb_typeof("body")='object' AND jsonb_typeof("source")='object');
ALTER TABLE "ExamAttempt" ADD CHECK ("revision">=0 AND "deadlineAt">"startedAt" AND "totalScoreUnits" BETWEEN 1 AND 1000000 AND "requestDigest" ~ '^[a-f0-9]{64}$'),
 ADD CHECK (jsonb_typeof("questionOrder")='array' AND jsonb_typeof("optionOrder")='object'),
 ADD CHECK (("state"='IN_PROGRESS' AND "submittedAt" IS NULL AND "gradedAt" IS NULL) OR ("state"<>'IN_PROGRESS' AND "submittedAt" IS NOT NULL AND "submittedAt">="startedAt")),
 ADD CHECK (("state" IN ('IN_PROGRESS','SUBMITTED') AND "objectiveScoreUnits" IS NULL AND "pendingScoreUnits" IS NULL AND "finalScoreUnits" IS NULL)
 OR ("state"='PENDING_REVIEW' AND "objectiveScoreUnits" IS NOT NULL AND "objectiveScoreUnits">=0 AND "pendingScoreUnits" IS NOT NULL AND "pendingScoreUnits">0 AND "objectiveScoreUnits"+"pendingScoreUnits"<="totalScoreUnits" AND "finalScoreUnits" IS NULL AND "gradedAt" IS NULL)
 OR ("state"='GRADED' AND "objectiveScoreUnits" IS NOT NULL AND "objectiveScoreUnits">=0 AND "pendingScoreUnits" IS NOT NULL AND "pendingScoreUnits"=0 AND "finalScoreUnits" IS NOT NULL AND "finalScoreUnits">="objectiveScoreUnits" AND "finalScoreUnits"<="totalScoreUnits" AND "gradedAt" IS NOT NULL AND "gradedAt">="submittedAt"));
ALTER TABLE "ExamAnswer" ADD CHECK ("revision">=0 AND ("scoreUnits" IS NULL OR "scoreUnits">=0));
ALTER TABLE "ExamGradeRecord" ADD CHECK ("scoreUnits">=0 AND length(btrim("feedback")) BETWEEN 1 AND 10000 AND "requestDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "ExamGenerationJob" ADD CHECK ("requestedCount" BETWEEN 1 AND 50 AND "acceptedCount" BETWEEN 0 AND "requestedCount" AND "rejectedCount">=0 AND "callBudget" BETWEEN 1 AND 20 AND "usedCalls" BETWEEN 0 AND "callBudget" AND "revision">=0 AND "requestDigest" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("blueprint")='object'),
 ADD CHECK ("deadlineAt">"createdAt" AND (("leaseToken" IS NULL)=("leaseExpiresAt" IS NULL))),
 ADD CHECK ("state"<>'READY' OR "acceptedCount"="requestedCount"),
 ADD CHECK ("callBudget"<=2*(("requestedCount"+4)/5));
ALTER TABLE "ExamGenerationBatch" ADD CHECK ("sequence">=0 AND "targetCount" BETWEEN 1 AND 5 AND "acceptedCount" BETWEEN 0 AND "targetCount" AND "attempts" BETWEEN 0 AND 2 AND jsonb_typeof("candidates")='array'),
 ADD CHECK ("state"<>'ACCEPTED' OR "acceptedCount"="targetCount");

CREATE FUNCTION "exam_question_version_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'exam question versions cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['reviewState','reviewedById','reviewedAt','sourceContentId','sourcePointId']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['reviewState','reviewedById','reviewedAt','sourceContentId','sourcePointId'])
 OR (NEW."sourceContentId" IS DISTINCT FROM OLD."sourceContentId" AND NEW."sourceContentId" IS NOT NULL)
 OR (NEW."sourcePointId" IS DISTINCT FROM OLD."sourcePointId" AND NEW."sourcePointId" IS NOT NULL)
 THEN RAISE EXCEPTION 'exam question versions are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "exam_question_version_immutable" BEFORE UPDATE OR DELETE ON "ExamQuestionVersion" FOR EACH ROW EXECUTE FUNCTION "exam_question_version_immutable"();

CREATE FUNCTION "exam_question_owner_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."subjectId"<>OLD."subjectId" OR (NEW."ownerId" IS DISTINCT FROM OLD."ownerId" AND NEW."ownerId" IS NOT NULL) THEN RAISE EXCEPTION 'exam question identity and subject are stable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "exam_question_owner_guard" BEFORE UPDATE ON "ExamQuestion" FOR EACH ROW EXECUTE FUNCTION "exam_question_owner_guard"();

-- Row locks on the parent serialize sealing against section/item writes.
CREATE FUNCTION "exam_version_children_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id text; frozen timestamp; subject_id text; item_subject text;
BEGIN
 IF TG_OP='UPDATE' AND NEW."paperVersionId" IS DISTINCT FROM OLD."paperVersionId" THEN RAISE EXCEPTION 'cannot move exam version child' USING ERRCODE='23514'; END IF;
 parent_id:=CASE WHEN TG_OP='DELETE' THEN OLD."paperVersionId" ELSE NEW."paperVersionId" END;
 SELECT v."sealedAt",p."subjectId" INTO frozen,subject_id FROM "ExamPaperVersion" v JOIN "ExamPaper" p ON p."id"=v."paperId" WHERE v."id"=parent_id FOR UPDATE OF v;
 IF frozen IS NOT NULL THEN
  IF TG_TABLE_NAME='ExamPaperItem' THEN
   IF TG_OP='UPDATE' AND NEW."questionVersionId" IS NULL AND (to_jsonb(NEW)-'questionVersionId')=(to_jsonb(OLD)-'questionVersionId') THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'sealed exam version children are immutable' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='ExamPaperItem' AND TG_OP<>'DELETE' THEN
  IF NEW."questionVersionId" IS NOT NULL THEN
   SELECT q."subjectId" INTO item_subject FROM "ExamQuestionVersion" v JOIN "ExamQuestion" q ON q."id"=v."questionId" WHERE v."id"=NEW."questionVersionId";
   IF item_subject IS DISTINCT FROM subject_id THEN RAISE EXCEPTION 'question subject mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "exam_section_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ExamPaperSection" FOR EACH ROW EXECUTE FUNCTION "exam_version_children_guard"();
CREATE TRIGGER "exam_item_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ExamPaperItem" FOR EACH ROW EXECUTE FUNCTION "exam_version_children_guard"();

CREATE FUNCTION "exam_paper_version_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_count bigint; actual_score bigint; section_count bigint; section_score bigint;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD."sealedAt" IS NOT NULL THEN RAISE EXCEPTION 'sealed exam version cannot be deleted' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD."sealedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'sealed exam version is immutable' USING ERRCODE='23514'; END IF;
 IF NEW."sealedAt" IS NOT NULL AND (TG_OP='INSERT' OR OLD."sealedAt" IS NULL) THEN
  SELECT count(*),coalesce(sum("scoreUnits"),0) INTO actual_count,actual_score FROM "ExamPaperItem" WHERE "paperVersionId"=NEW."id";
  SELECT coalesce(sum("questionCount"),0),coalesce(sum("questionCount"*"scorePerQuestionUnits"),0) INTO section_count,section_score FROM "ExamPaperSection" WHERE "paperVersionId"=NEW."id";
  IF actual_count<>NEW."questionCount" OR actual_score<>NEW."totalScoreUnits" OR section_count<>actual_count OR section_score<>actual_score
  OR EXISTS(SELECT 1 FROM "ExamPaperSection" s WHERE s."paperVersionId"=NEW."id" AND ((SELECT count(*) FROM "ExamPaperItem" i WHERE i."sectionId"=s."id")<>s."questionCount" OR EXISTS(SELECT 1 FROM "ExamPaperItem" i WHERE i."sectionId"=s."id" AND (i."scoreUnits"<>s."scorePerQuestionUnits" OR i."body"->>'type' IS DISTINCT FROM s."type"::text))))
  THEN RAISE EXCEPTION 'exam version count score or section mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "exam_paper_version_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ExamPaperVersion" FOR EACH ROW EXECUTE FUNCTION "exam_paper_version_guard"();

CREATE FUNCTION "exam_paper_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen timestamp;
BEGIN
 IF TG_OP='UPDATE' AND (NEW."subjectId" IS DISTINCT FROM OLD."subjectId" OR (NEW."ownerId" IS DISTINCT FROM OLD."ownerId" AND NEW."ownerId" IS NOT NULL)) THEN RAISE EXCEPTION 'exam paper ownership and subject are stable' USING ERRCODE='23514'; END IF;
 IF NEW."publishedVersionId" IS NOT NULL THEN
  SELECT "sealedAt" INTO frozen FROM "ExamPaperVersion" WHERE "id"=NEW."publishedVersionId" AND "paperId"=NEW."id";
  IF frozen IS NULL THEN RAISE EXCEPTION 'published exam version must be sealed' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER "exam_paper_guard" BEFORE INSERT OR UPDATE ON "ExamPaper" FOR EACH ROW EXECUTE FUNCTION "exam_paper_guard"();

CREATE FUNCTION "exam_attempt_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF version_row."sealedAt" IS NULL OR NEW."totalScoreUnits"<>version_row."totalScoreUnits" OR NEW."referenceOnly"<>(version_row."kind"='AI_MOCK') OR NEW."deadlineAt"<>NEW."startedAt"+make_interval(secs=>version_row."durationSec") THEN RAISE EXCEPTION 'exam attempt must bind frozen version and server duration' USING ERRCODE='23514'; END IF;
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
CREATE TRIGGER "exam_attempt_guard" BEFORE INSERT OR UPDATE ON "ExamAttempt" FOR EACH ROW EXECUTE FUNCTION "exam_attempt_guard"();

CREATE FUNCTION "exam_answer_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maximum integer; current_state "ExamAttemptState"; deadline timestamp;
BEGIN
 IF TG_OP='DELETE' THEN
  SELECT "state","deadlineAt" INTO current_state,deadline FROM "ExamAttempt" WHERE "id"=OLD."attemptId" FOR UPDATE;
  IF FOUND AND (current_state<>'IN_PROGRESS' OR (clock_timestamp() AT TIME ZONE 'UTC')>=deadline) THEN RAISE EXCEPTION 'submitted or expired answer cannot be deleted' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (NEW."attemptId"<>OLD."attemptId" OR NEW."paperItemId"<>OLD."paperItemId" OR NEW."paperVersionId"<>OLD."paperVersionId") THEN RAISE EXCEPTION 'exam answer identity is immutable' USING ERRCODE='23514'; END IF;
 SELECT "state","deadlineAt" INTO current_state,deadline FROM "ExamAttempt" WHERE "id"=NEW."attemptId" FOR UPDATE;
 SELECT "scoreUnits" INTO maximum FROM "ExamPaperItem" WHERE "id"=NEW."paperItemId";
 IF NEW."scoreUnits">maximum THEN RAISE EXCEPTION 'answer score exceeds item maximum' USING ERRCODE='23514'; END IF;
 IF current_state<>'IN_PROGRESS' AND (TG_OP='INSERT' OR NEW."answer" IS DISTINCT FROM OLD."answer" OR NEW."marked" IS DISTINCT FROM OLD."marked") THEN RAISE EXCEPTION 'submitted answer content is immutable' USING ERRCODE='23514'; END IF;
 IF current_state='IN_PROGRESS' AND (NEW."scoreUnits" IS NOT NULL OR NEW."correct" IS NOT NULL) THEN RAISE EXCEPTION 'draft answer cannot be graded' USING ERRCODE='23514'; END IF;
 IF current_state='IN_PROGRESS' AND (clock_timestamp() AT TIME ZONE 'UTC')>=deadline AND (TG_OP='INSERT' OR NEW."answer" IS DISTINCT FROM OLD."answer" OR NEW."marked" IS DISTINCT FROM OLD."marked") THEN RAISE EXCEPTION 'exam answer deadline passed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "exam_answer_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ExamAnswer" FOR EACH ROW EXECUTE FUNCTION "exam_answer_guard"();

CREATE FUNCTION "exam_grade_record_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maximum integer;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT i."scoreUnits" INTO maximum FROM "ExamAnswer" a JOIN "ExamPaperItem" i ON i."id"=a."paperItemId" WHERE a."id"=NEW."answerId";
  IF NEW."scoreUnits">maximum THEN RAISE EXCEPTION 'grade score exceeds item maximum' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 ELSIF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM "ExamAnswer" WHERE "id"=OLD."answerId") THEN RAISE EXCEPTION 'grade history is immutable' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 IF NEW."graderId" IS NULL AND (to_jsonb(NEW)-'graderId')=(to_jsonb(OLD)-'graderId') THEN RETURN NEW; END IF;
 IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'grade history is immutable' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "exam_grade_record_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ExamGradeRecord" FOR EACH ROW EXECUTE FUNCTION "exam_grade_record_guard"();

CREATE FUNCTION "exam_batch_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."jobId"<>OLD."jobId" OR NEW."sequence"<>OLD."sequence" OR NEW."targetCount"<>OLD."targetCount" OR NEW."attempts"<OLD."attempts" OR (OLD."state" IN ('ACCEPTED','CANCELLED') AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'generation batch cannot reset or move' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "exam_batch_guard" BEFORE UPDATE ON "ExamGenerationBatch" FOR EACH ROW EXECUTE FUNCTION "exam_batch_guard"();

CREATE FUNCTION "exam_generation_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."state"<>'QUEUED' OR NEW."usedCalls"<>0 OR NEW."acceptedCount"<>0 THEN RAISE EXCEPTION 'generation must start queued and empty' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW."usedCalls"<OLD."usedCalls" OR NEW."callBudget"<>OLD."callBudget" OR NEW."ownerId"<>OLD."ownerId" OR NEW."requestId"<>OLD."requestId" OR NEW."requestDigest"<>OLD."requestDigest" OR NEW."blueprint" IS DISTINCT FROM OLD."blueprint" OR NEW."requestedCount"<>OLD."requestedCount" OR NEW."deadlineAt"<>OLD."deadlineAt" THEN RAISE EXCEPTION 'generation identity and consumed budget cannot reset' USING ERRCODE='23514'; END IF;
 IF NEW."state"<>OLD."state" AND NOT ((OLD."state"='QUEUED' AND NEW."state" IN ('RUNNING','CANCELLED','FAILED')) OR (OLD."state"='RUNNING' AND NEW."state" IN ('INCOMPLETE','READY','FAILED','CANCELLED')) OR (OLD."state" IN ('INCOMPLETE','FAILED') AND NEW."state" IN ('RUNNING','CANCELLED'))) THEN RAISE EXCEPTION 'invalid generation transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "exam_generation_guard" BEFORE INSERT OR UPDATE ON "ExamGenerationJob" FOR EACH ROW EXECUTE FUNCTION "exam_generation_guard"();

COMMIT;
