CREATE TYPE "DiscussionKind" AS ENUM ('QUESTION', 'DISCUSSION');
CREATE TABLE "DiscussionThread" (
 "id" TEXT PRIMARY KEY, "courseId" TEXT NOT NULL REFERENCES "SharedCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "authorId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "kind" "DiscussionKind" NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL, "ref" JSONB,
 "solvedAt" TIMESTAMP(3), "pinnedAt" TIMESTAMP(3), "hiddenAt" TIMESTAMP(3), "deletedAt" TIMESTAMP(3),
 "version" INTEGER NOT NULL DEFAULT 1, "createRequestId" TEXT NOT NULL, "requestDigest" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "DiscussionReply" (
 "id" TEXT PRIMARY KEY, "threadId" TEXT NOT NULL REFERENCES "DiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "authorId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "body" TEXT NOT NULL, "hiddenAt" TIMESTAMP(3), "deletedAt" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 1,
 "createRequestId" TEXT NOT NULL, "requestDigest" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "DiscussionThread_authorId_courseId_createRequestId_key" ON "DiscussionThread"("authorId","courseId","createRequestId");
CREATE UNIQUE INDEX "DiscussionReply_authorId_threadId_createRequestId_key" ON "DiscussionReply"("authorId","threadId","createRequestId");
CREATE INDEX "DiscussionThread_courseId_createdAt_id_idx" ON "DiscussionThread"("courseId","createdAt","id");
CREATE INDEX "DiscussionReply_threadId_createdAt_id_idx" ON "DiscussionReply"("threadId","createdAt","id");
CREATE INDEX "DiscussionThread_authorId_idx" ON "DiscussionThread"("authorId");
CREATE INDEX "DiscussionReply_authorId_idx" ON "DiscussionReply"("authorId");
CREATE FUNCTION "anonymize_discussion_author"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "DiscussionThread" SET "authorId"=NULL,"title"='',"body"='',"ref"=NULL,"deletedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP,"version"="version"+1 WHERE "authorId"=OLD."id";
 UPDATE "DiscussionReply" SET "authorId"=NULL,"body"='',"deletedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP,"version"="version"+1 WHERE "authorId"=OLD."id";
 RETURN OLD;
END; $$;
CREATE TRIGGER "user_discussion_anonymize" BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION "anonymize_discussion_author"();
