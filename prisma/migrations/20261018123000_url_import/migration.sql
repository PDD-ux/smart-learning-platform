ALTER TABLE "LearningContent" ADD COLUMN "urlSource" JSONB;
CREATE TABLE "UrlImportDraft" (
 "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "requestDigest" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'FETCHING', "requestedUrl" TEXT NOT NULL, "prepared" JSONB, "snapshot" BYTEA, "errorCode" TEXT, "contentId" TEXT,
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "UrlImportDraft_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "UrlImportDraft_state_check" CHECK ("state" IN ('FETCHING','PREVIEW','FAILED','CANCELLED','EXPIRED','COMMITTED')),
 CONSTRAINT "UrlImportDraft_snapshot_check" CHECK ("snapshot" IS NULL OR octet_length("snapshot") <= 10485760),
 CONSTRAINT "UrlImportDraft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "UrlImportDraft_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UrlImportDraft_ownerId_requestId_key" ON "UrlImportDraft"("ownerId","requestId");
CREATE INDEX "UrlImportDraft_ownerId_expiresAt_idx" ON "UrlImportDraft"("ownerId","expiresAt");
CREATE INDEX "UrlImportDraft_state_expiresAt_idx" ON "UrlImportDraft"("state","expiresAt");
