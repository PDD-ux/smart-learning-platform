BEGIN;

-- CreateEnum
CREATE TYPE "ClassroomState" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClassMemberState" AS ENUM ('ACTIVE', 'LEFT', 'REMOVED');

-- CreateEnum
CREATE TYPE "ClassPublicationState" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AssignmentSubmissionState" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'GRADED');

-- CreateEnum
CREATE TYPE "AssignmentReviewState" AS ENUM ('RETURNED', 'GRADED');

-- CreateEnum
CREATE TYPE "AssignmentAttachmentState" AS ENUM ('UPLOADING', 'READY', 'ATTACHED', 'DELETED');

-- CreateTable
CREATE TABLE "Classroom" (
    "id" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "state" "ClassroomState" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Classroom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassMember" (
    "classroomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "state" "ClassMemberState" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassMember_pkey" PRIMARY KEY ("classroomId","studentId")
);

-- CreateTable
CREATE TABLE "ClassInvite" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassChapter" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "sequence" INTEGER NOT NULL,
    "state" "ClassPublicationState" NOT NULL DEFAULT 'DRAFT',
    "sharedCourseId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassAssignment" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "chapterId" TEXT,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "state" "ClassPublicationState" NOT NULL DEFAULT 'DRAFT',
    "dueAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "state" "AssignmentSubmissionState" NOT NULL DEFAULT 'DRAFT',
    "draftText" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionVersion" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "bodyText" TEXT NOT NULL,
    "assignmentTitle" TEXT NOT NULL,
    "instructionsSnapshot" TEXT NOT NULL,
    "dueAtSnapshot" TIMESTAMP(3) NOT NULL,
    "assignmentRevision" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentReview" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "state" "AssignmentReviewState" NOT NULL,
    "score" INTEGER,
    "feedback" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentAttachment" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "versionId" TEXT,
    "state" "AssignmentAttachmentState" NOT NULL DEFAULT 'UPLOADING',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" CHAR(64),
    "storageKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassroomOperation" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "inputDigest" CHAR(64) NOT NULL,
    "resultId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassroomOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Classroom_responsibleId_state_createdAt_idx" ON "Classroom"("responsibleId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Classroom_id_responsibleId_key" ON "Classroom"("id", "responsibleId");

-- CreateIndex
CREATE INDEX "ClassMember_studentId_state_joinedAt_idx" ON "ClassMember"("studentId", "state", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClassInvite_codeHash_key" ON "ClassInvite"("codeHash");

-- CreateIndex
CREATE INDEX "ClassInvite_classroomId_expiresAt_idx" ON "ClassInvite"("classroomId", "expiresAt");

-- CreateIndex
CREATE INDEX "ClassChapter_classroomId_state_idx" ON "ClassChapter"("classroomId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ClassChapter_classroomId_sequence_key" ON "ClassChapter"("classroomId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ClassChapter_id_classroomId_key" ON "ClassChapter"("id", "classroomId");

-- CreateIndex
CREATE INDEX "ClassAssignment_classroomId_state_dueAt_idx" ON "ClassAssignment"("classroomId", "state", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClassAssignment_id_classroomId_key" ON "ClassAssignment"("id", "classroomId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_classroomId_state_idx" ON "AssignmentSubmission"("classroomId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_studentId_key" ON "AssignmentSubmission"("assignmentId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_id_classroomId_studentId_key" ON "AssignmentSubmission"("id", "classroomId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionVersion_submissionId_versionNo_key" ON "SubmissionVersion"("submissionId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionVersion_id_classroomId_key" ON "SubmissionVersion"("id", "classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionVersion_id_submissionId_classroomId_studentId_key" ON "SubmissionVersion"("id", "submissionId", "classroomId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentReview_versionId_key" ON "AssignmentReview"("versionId");

-- CreateIndex
CREATE INDEX "AssignmentReview_classroomId_createdAt_idx" ON "AssignmentReview"("classroomId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentReview_versionId_classroomId_key" ON "AssignmentReview"("versionId", "classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentAttachment_storageKey_key" ON "AssignmentAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "AssignmentAttachment_submissionId_state_idx" ON "AssignmentAttachment"("submissionId", "state");

-- CreateIndex
CREATE INDEX "AssignmentAttachment_state_expiresAt_idx" ON "AssignmentAttachment"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "ClassroomOperation_classroomId_createdAt_idx" ON "ClassroomOperation"("classroomId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomOperation_actorId_requestId_key" ON "ClassroomOperation"("actorId", "requestId");

-- AddForeignKey
ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMember" ADD CONSTRAINT "ClassMember_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMember" ADD CONSTRAINT "ClassMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassInvite" ADD CONSTRAINT "ClassInvite_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassChapter" ADD CONSTRAINT "ClassChapter_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassChapter" ADD CONSTRAINT "ClassChapter_sharedCourseId_fkey" FOREIGN KEY ("sharedCourseId") REFERENCES "SharedCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAssignment" ADD CONSTRAINT "ClassAssignment_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAssignment" ADD CONSTRAINT "ClassAssignment_chapterId_classroomId_fkey" FOREIGN KEY ("chapterId", "classroomId") REFERENCES "ClassChapter"("id", "classroomId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_assignmentId_classroomId_fkey" FOREIGN KEY ("assignmentId", "classroomId") REFERENCES "ClassAssignment"("id", "classroomId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_classroomId_studentId_fkey" FOREIGN KEY ("classroomId", "studentId") REFERENCES "ClassMember"("classroomId", "studentId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SubmissionVersion" ADD CONSTRAINT "SubmissionVersion_submissionId_classroomId_studentId_fkey" FOREIGN KEY ("submissionId", "classroomId", "studentId") REFERENCES "AssignmentSubmission"("id", "classroomId", "studentId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssignmentReview" ADD CONSTRAINT "AssignmentReview_versionId_classroomId_fkey" FOREIGN KEY ("versionId", "classroomId") REFERENCES "SubmissionVersion"("id", "classroomId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssignmentReview" ADD CONSTRAINT "AssignmentReview_classroomId_reviewerId_fkey" FOREIGN KEY ("classroomId", "reviewerId") REFERENCES "Classroom"("id", "responsibleId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssignmentAttachment" ADD CONSTRAINT "AssignmentAttachment_submissionId_classroomId_studentId_fkey" FOREIGN KEY ("submissionId", "classroomId", "studentId") REFERENCES "AssignmentSubmission"("id", "classroomId", "studentId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssignmentAttachment" ADD CONSTRAINT "AssignmentAttachment_versionId_submissionId_classroomId_st_fkey" FOREIGN KEY ("versionId", "submissionId", "classroomId", "studentId") REFERENCES "SubmissionVersion"("id", "submissionId", "classroomId", "studentId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClassroomOperation" ADD CONSTRAINT "ClassroomOperation_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomOperation" ADD CONSTRAINT "ClassroomOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foundation invariants (do not replace these with db push).
ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_valid" CHECK (
  length(btrim("title")) BETWEEN 1 AND 100 AND length("description") <= 2000 AND "revision" >= 1
);
ALTER TABLE "ClassMember" ADD CONSTRAINT "ClassMember_revision" CHECK ("revision" >= 1);
ALTER TABLE "ClassInvite" ADD CONSTRAINT "ClassInvite_valid" CHECK (
  "codeHash" ~ '^[a-f0-9]{64}$' AND "maxUses" BETWEEN 1 AND 5000 AND "usedCount" BETWEEN 0 AND "maxUses"
  AND "revision" >= 1 AND "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '30 days'
);
ALTER TABLE "ClassChapter" ADD CONSTRAINT "ClassChapter_valid" CHECK (
  length(btrim("title")) BETWEEN 1 AND 100 AND length("body") <= 20000 AND "sequence" >= 0
  AND "revision" >= 1 AND "state" <> 'CLOSED'
);
ALTER TABLE "ClassAssignment" ADD CONSTRAINT "ClassAssignment_valid" CHECK (
  length(btrim("title")) BETWEEN 1 AND 100 AND length("instructions") <= 20000 AND "revision" >= 1
  AND ("state" NOT IN ('PUBLISHED', 'CLOSED') OR "dueAt" IS NOT NULL)
);
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_valid" CHECK (length("draftText") <= 50000 AND "revision" >= 1);
ALTER TABLE "SubmissionVersion" ADD CONSTRAINT "SubmissionVersion_valid" CHECK (
  "versionNo" >= 1 AND "assignmentRevision" >= 1 AND length("bodyText") <= 50000
  AND length(btrim("assignmentTitle")) BETWEEN 1 AND 100 AND length("instructionsSnapshot") <= 20000
  AND "submittedAt" < "dueAtSnapshot"
);
ALTER TABLE "AssignmentReview" ADD CONSTRAINT "AssignmentReview_valid" CHECK (
  length(btrim("feedback")) BETWEEN 1 AND 10000
  AND (("state" = 'RETURNED' AND "score" IS NULL) OR ("state" = 'GRADED' AND "score" IS NOT NULL AND "score" BETWEEN 0 AND 100))
);
ALTER TABLE "AssignmentAttachment" ADD CONSTRAINT "AssignmentAttachment_valid" CHECK (
  "sizeBytes" BETWEEN 1 AND 20971520 AND length(btrim("fileName")) BETWEEN 1 AND 180
  AND "fileName" !~ '[[:cntrl:]/]' AND position(chr(92) in "fileName") = 0
  AND (("mimeType" = 'application/pdf' AND "fileName" ~* '\.pdf$') OR ("mimeType" = 'text/plain' AND "fileName" ~* '\.txt$')
    OR ("mimeType" = 'text/markdown' AND "fileName" ~* '\.md$') OR ("mimeType" = 'image/png' AND "fileName" ~* '\.png$')
    OR ("mimeType" = 'image/jpeg' AND "fileName" ~* '\.jpe?g$'))
  AND (("state" = 'ATTACHED' AND "versionId" IS NOT NULL) OR ("state" <> 'ATTACHED' AND "versionId" IS NULL))
  AND ("sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$')
  AND ("state" NOT IN ('READY', 'ATTACHED') OR "sha256" IS NOT NULL)
  AND "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '24 hours'
  AND "storageKey" = 'class-assignments/' || "classroomId" || '/' || "studentId" || '/' || "id" || '/source.' || CASE "mimeType"
    WHEN 'application/pdf' THEN 'pdf' WHEN 'text/plain' THEN 'txt' WHEN 'text/markdown' THEN 'md' WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg' END
);
ALTER TABLE "ClassroomOperation" ADD CONSTRAINT "ClassroomOperation_valid" CHECK (
  "action" IN ('CREATE_CLASS', 'EDIT_CLASS', 'ARCHIVE_CLASS', 'INVITE', 'JOIN', 'MEMBER', 'CHAPTER', 'ASSIGNMENT', 'DRAFT', 'SUBMIT', 'REVIEW', 'ATTACHMENT')
  AND "inputDigest" ~ '^[a-f0-9]{64}$' AND length("resultId") BETWEEN 1 AND 200
);

COMMIT;
