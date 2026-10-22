CREATE TABLE "HomeworkDraft" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "title" TEXT NOT NULL, "createDigest" TEXT NOT NULL, "source" JSONB NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'PROCESSING', "revision" INTEGER NOT NULL DEFAULT 1,
 "rawText" TEXT NOT NULL DEFAULT '', "issues" JSONB NOT NULL DEFAULT '[]',
 "questions" JSONB NOT NULL DEFAULT '[]', "operations" JSONB NOT NULL DEFAULT '[]',
 "leaseExpiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "HomeworkDraft_state_check" CHECK ("state" IN ('PROCESSING','DRAFT','FAILED','CONFIRMED','ARCHIVED')),
 CONSTRAINT "HomeworkDraft_limits_check" CHECK ("revision">0 AND char_length("title") BETWEEN 1 AND 100 AND char_length("rawText")<=50000 AND jsonb_typeof("questions")='array' AND jsonb_array_length("questions")<=20 AND jsonb_typeof("operations")='array' AND jsonb_array_length("operations")<=100)
);
CREATE INDEX "HomeworkDraft_ownerId_createdAt_idx" ON "HomeworkDraft"("ownerId", "createdAt");
