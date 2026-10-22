-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('PENDING', 'UPLOADING', 'PARSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "UnderstandStatus" AS ENUM ('NONE', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TextSource" AS ENUM ('PDF', 'MD', 'OCR', 'FRAME');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('QA', 'CLOZE', 'FORMULA');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'GRADUATED');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('CONCEPT', 'FORMULA', 'METHOD', 'THEOREM');

-- CreateEnum
CREATE TYPE "EdgeRelation" AS ENUM ('PREREQUISITE', 'RELATED', 'EXAMPLE_OF');

-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('SINGLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('CONTENT_PARSE', 'UNDERSTANDING', 'PRODUCT_GEN');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'student',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningContent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "durationSec" INTEGER,
    "pageCount" INTEGER,
    "fileSizeBytes" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "coverUrl" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'PENDING',
    "failReason" TEXT,
    "understandingStatus" "UnderstandStatus" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "ref" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextBlock" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "ref" JSONB NOT NULL,
    "source" "TextSource" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "TextBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePoint" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "tags" TEXT[],
    "importance" INTEGER NOT NULL,
    "refs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flashcard" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "pointId" TEXT,
    "cardType" "CardType" NOT NULL DEFAULT 'QA',
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "hint" TEXT,
    "status" "CardStatus" NOT NULL DEFAULT 'NEW',
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "nextReviewAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flashcard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" TEXT NOT NULL,
    "flashcardId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "prevInterval" DOUBLE PRECISION NOT NULL,
    "newInterval" DOUBLE PRECISION NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mastery" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "correctRate" DOUBLE PRECISION,
    "isWeak" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "nodeType" "NodeType" NOT NULL DEFAULT 'CONCEPT',
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "sourcePointId" TEXT NOT NULL,
    "targetPointId" TEXT NOT NULL,
    "relation" "EdgeRelation" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "contentId" TEXT,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "type" "ExerciseType" NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "correctAnswer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseRecord" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "userAnswer" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "masteryDelta" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningProgress" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "ref" JSONB NOT NULL,
    "lastStudiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsyncJob" (
    "id" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "contentId" TEXT NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorReason" TEXT,
    "traceId" TEXT NOT NULL,
    "stage" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "ip" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "LearningContent_ownerId_idx" ON "LearningContent"("ownerId");

-- CreateIndex
CREATE INDEX "LearningContent_status_idx" ON "LearningContent"("status");

-- CreateIndex
CREATE INDEX "Note_contentId_idx" ON "Note"("contentId");

-- CreateIndex
CREATE INDEX "Note_ownerId_idx" ON "Note"("ownerId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_contentId_idx" ON "TranscriptSegment"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_contentId_seq_key" ON "TranscriptSegment"("contentId", "seq");

-- CreateIndex
CREATE INDEX "TextBlock_contentId_sequence_idx" ON "TextBlock"("contentId", "sequence");

-- CreateIndex
CREATE INDEX "KnowledgePoint_contentId_idx" ON "KnowledgePoint"("contentId");

-- CreateIndex
CREATE INDEX "KnowledgePoint_ownerId_idx" ON "KnowledgePoint"("ownerId");

-- CreateIndex
CREATE INDEX "Flashcard_ownerId_nextReviewAt_idx" ON "Flashcard"("ownerId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "Flashcard_contentId_idx" ON "Flashcard"("contentId");

-- CreateIndex
CREATE INDEX "ReviewLog_flashcardId_idx" ON "ReviewLog"("flashcardId");

-- CreateIndex
CREATE INDEX "Mastery_learnerId_isWeak_idx" ON "Mastery"("learnerId", "isWeak");

-- CreateIndex
CREATE UNIQUE INDEX "Mastery_learnerId_pointId_key" ON "Mastery"("learnerId", "pointId");

-- CreateIndex
CREATE UNIQUE INDEX "GraphNode_pointId_key" ON "GraphNode"("pointId");

-- CreateIndex
CREATE INDEX "GraphEdge_sourcePointId_idx" ON "GraphEdge"("sourcePointId");

-- CreateIndex
CREATE INDEX "GraphEdge_targetPointId_idx" ON "GraphEdge"("targetPointId");

-- CreateIndex
CREATE INDEX "ExerciseRecord_learnerId_idx" ON "ExerciseRecord"("learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgress_learnerId_contentId_key" ON "LearningProgress"("learnerId", "contentId");

-- CreateIndex
CREATE INDEX "AsyncJob_contentId_idx" ON "AsyncJob"("contentId");

-- CreateIndex
CREATE INDEX "AsyncJob_jobType_state_idx" ON "AsyncJob"("jobType", "state");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_objectId_idx" ON "AuditLog"("objectId");

-- AddForeignKey
ALTER TABLE "LearningContent" ADD CONSTRAINT "LearningContent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextBlock" ADD CONSTRAINT "TextBlock_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePoint" ADD CONSTRAINT "KnowledgePoint_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "KnowledgePoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mastery" ADD CONSTRAINT "Mastery_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mastery" ADD CONSTRAINT "Mastery_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphNode" ADD CONSTRAINT "GraphNode_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_sourcePointId_fkey" FOREIGN KEY ("sourcePointId") REFERENCES "GraphNode"("pointId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_targetPointId_fkey" FOREIGN KEY ("targetPointId") REFERENCES "GraphNode"("pointId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseRecord" ADD CONSTRAINT "ExerciseRecord_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsyncJob" ADD CONSTRAINT "AsyncJob_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
