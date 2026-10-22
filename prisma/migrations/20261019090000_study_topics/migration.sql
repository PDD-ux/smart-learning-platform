CREATE TABLE "StudyTopic" (
 "id" TEXT PRIMARY KEY,
 "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "createDigest" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
 "data" JSONB NOT NULL CHECK (octet_length("data"::text) <= 1200000),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "StudyTopic_ownerId_createdAt_idx" ON "StudyTopic"("ownerId", "createdAt");
