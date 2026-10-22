CREATE TABLE "LiveSession" (
 "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "title" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'LIVE', "nextSequence" INTEGER NOT NULL DEFAULT 0,
 "totalSamples" INTEGER NOT NULL DEFAULT 0, "processingSequence" INTEGER, "processingToken" TEXT, "processingStartedAt" TIMESTAMP(3),
 "highlights" JSONB NOT NULL DEFAULT '[]', "lastHighlightSequence" INTEGER NOT NULL DEFAULT -1,
 "highlightVersion" INTEGER NOT NULL DEFAULT 0, "summaryMarkdown" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LiveChunk" (
 "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "sequence" INTEGER NOT NULL,
 "digest" TEXT NOT NULL, "sampleCount" INTEGER NOT NULL, "startMs" INTEGER NOT NULL, "endMs" INTEGER NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'RUNNING', "text" TEXT NOT NULL DEFAULT '', "reason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LiveChunk_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LiveSession_ownerId_createdAt_idx" ON "LiveSession"("ownerId", "createdAt");
CREATE UNIQUE INDEX "LiveChunk_sessionId_sequence_key" ON "LiveChunk"("sessionId", "sequence");
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveChunk" ADD CONSTRAINT "LiveChunk_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
