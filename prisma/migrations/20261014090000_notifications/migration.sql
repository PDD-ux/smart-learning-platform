CREATE TYPE "NotificationKind" AS ENUM ('REPLY', 'REPORT_RESULT');
CREATE TABLE "Notification" (
 "id" TEXT PRIMARY KEY,
 "recipientId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "kind" "NotificationKind" NOT NULL, "eventKey" TEXT NOT NULL,
 "courseId" TEXT NOT NULL REFERENCES "SharedCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "threadId" TEXT NOT NULL REFERENCES "DiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "replyId" TEXT REFERENCES "DiscussionReply"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "reportId" TEXT REFERENCES "DiscussionReport"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Notification_source_kind_check" CHECK (("kind"='REPLY' AND "replyId" IS NOT NULL AND "reportId" IS NULL) OR ("kind"='REPORT_RESULT' AND "reportId" IS NOT NULL))
);
CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");
CREATE INDEX "Notification_recipientId_readAt_createdAt_id_idx" ON "Notification"("recipientId","readAt","createdAt","id");
INSERT INTO "Notification" ("id","recipientId","kind","eventKey","courseId","threadId","replyId","reportId","createdAt")
 SELECT e."id",e."recipientId",'REPORT_RESULT',e."eventKey",r."courseId",r."threadId",r."replyId",r."id",e."createdAt"
 FROM "DiscussionEvent" e JOIN "DiscussionReport" r ON r."id"=e."reportId"
 WHERE e."recipientId"=r."reporterId" AND r."state"='HANDLED'
 ON CONFLICT ("eventKey") DO NOTHING;
