CREATE TYPE "DiscussionReportState" AS ENUM ('OPEN', 'HANDLED');
CREATE TABLE "DiscussionReport" (
 "id" TEXT PRIMARY KEY, "reporterId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "courseId" TEXT NOT NULL REFERENCES "SharedCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "threadId" TEXT NOT NULL REFERENCES "DiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "replyId" TEXT REFERENCES "DiscussionReply"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "targetKey" TEXT NOT NULL, "reason" TEXT NOT NULL, "state" "DiscussionReportState" NOT NULL DEFAULT 'OPEN',
 "resolution" TEXT, "handledBy" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE, "handledAt" TIMESTAMP(3),
 "version" INTEGER NOT NULL DEFAULT 1, "requestId" TEXT NOT NULL, "requestDigest" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "DiscussionReport_reporterId_requestId_key" ON "DiscussionReport"("reporterId", "requestId");
CREATE UNIQUE INDEX "DiscussionReport_one_open_target" ON "DiscussionReport"("reporterId", "targetKey") WHERE "state"='OPEN';
CREATE INDEX "DiscussionReport_courseId_state_createdAt_id_idx" ON "DiscussionReport"("courseId", "state", "createdAt", "id");
CREATE INDEX "DiscussionReport_reporterId_createdAt_id_idx" ON "DiscussionReport"("reporterId", "createdAt", "id");
CREATE TABLE "DiscussionEvent" (
 "id" TEXT PRIMARY KEY, "recipientId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "reportId" TEXT NOT NULL REFERENCES "DiscussionReport"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "eventKey" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'REPORT_RESULT', "courseId" TEXT NOT NULL, "threadId" TEXT NOT NULL, "replyId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "DiscussionEvent_reportId_key" ON "DiscussionEvent"("reportId");
CREATE UNIQUE INDEX "DiscussionEvent_eventKey_key" ON "DiscussionEvent"("eventKey");
CREATE INDEX "DiscussionEvent_recipientId_createdAt_idx" ON "DiscussionEvent"("recipientId", "createdAt");
