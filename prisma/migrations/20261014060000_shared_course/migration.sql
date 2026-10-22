CREATE TYPE "SharedCourseState" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHDRAWN');
CREATE TABLE "SharedCourse" (
  "id" TEXT NOT NULL, "publisherId" TEXT, "sourceContentId" TEXT,
  "title" TEXT NOT NULL, "description" TEXT NOT NULL, "contentType" "ContentType" NOT NULL,
  "format" TEXT NOT NULL, "durationSec" INTEGER, "pageCount" INTEGER,
  "fileSizeBytes" BIGINT NOT NULL, "mediaKey" TEXT NOT NULL,
  "pageKeys" JSONB NOT NULL DEFAULT '{}', "snapshot" JSONB NOT NULL, "include" JSONB NOT NULL,
  "rightsStatement" TEXT NOT NULL, "rightsConfirmed" BOOLEAN NOT NULL,
  "state" "SharedCourseState" NOT NULL DEFAULT 'DRAFT', "discussionEnabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1, "preparedAt" TIMESTAMP(3), "publishedAt" TIMESTAMP(3),
  "requestId" TEXT NOT NULL, "requestDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SharedCourse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SharedCourse_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SharedCourse_sourceContentId_fkey" FOREIGN KEY ("sourceContentId") REFERENCES "LearningContent"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SharedCourse_publisherId_requestId_key" ON "SharedCourse"("publisherId", "requestId");
CREATE INDEX "SharedCourse_state_publishedAt_id_idx" ON "SharedCourse"("state", "publishedAt", "id");
CREATE INDEX "SharedCourse_publisherId_createdAt_idx" ON "SharedCourse"("publisherId", "createdAt");
