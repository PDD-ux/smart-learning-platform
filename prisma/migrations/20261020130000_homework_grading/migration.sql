CREATE TABLE "HomeworkGradingReport" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestDigest" CHAR(64) NOT NULL,
  "sourceDigest" CHAR(64) NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "result" JSONB,
  "corrections" JSONB NOT NULL DEFAULT '[]',
  "operations" JSONB NOT NULL DEFAULT '[]',
  "errorCode" VARCHAR(40),
  "leaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeworkGradingReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HomeworkGradingReport_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "HomeworkDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "HomeworkGradingReport_state_check" CHECK ("state" IN ('PENDING','RUNNING','READY','FAILED','CANCELLED')),
  CONSTRAINT "HomeworkGradingReport_errorCode_check" CHECK ("errorCode" IS NULL OR "errorCode" IN ('AI_UNAVAILABLE','AI_TIMEOUT','SCHEMA_INVALID','CANCELLED','GRADING_EXPIRED')),
  CONSTRAINT "HomeworkGradingReport_limits_check" CHECK (
    "sourceRevision" > 0 AND "revision" > 0 AND
    jsonb_typeof("snapshot") = 'object' AND
    jsonb_typeof("snapshot"->'draftDigest') = 'string' AND length("snapshot"->>'draftDigest') = 64 AND
    CASE WHEN jsonb_typeof("snapshot"->'questions') = 'array' THEN jsonb_array_length("snapshot"->'questions') BETWEEN 1 AND 8 ELSE false END AND
    CASE WHEN jsonb_typeof("corrections") = 'array' THEN jsonb_array_length("corrections") <= 50 ELSE false END AND
    CASE WHEN jsonb_typeof("operations") = 'array' THEN jsonb_array_length("operations") <= 100 ELSE false END AND
    ("result" IS NULL OR (jsonb_typeof("result") = 'object' AND jsonb_typeof("result"->'items') = 'array')) AND
    ("state" <> 'READY' OR CASE WHEN "result" IS NOT NULL AND jsonb_typeof("result"->'items') = 'array' AND jsonb_typeof("snapshot"->'questions') = 'array' THEN jsonb_array_length("result"->'items') = jsonb_array_length("snapshot"->'questions') ELSE false END)
  )
);

CREATE UNIQUE INDEX "HomeworkGradingReport_draftId_requestId_key" ON "HomeworkGradingReport"("draftId", "requestId");
CREATE INDEX "HomeworkGradingReport_draftId_createdAt_idx" ON "HomeworkGradingReport"("draftId", "createdAt");
