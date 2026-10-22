CREATE TABLE "GeneratedNote" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "sourceCount" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GeneratedNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeneratedNote_contentId_key" ON "GeneratedNote"("contentId");

ALTER TABLE "GeneratedNote" ADD CONSTRAINT "GeneratedNote_contentId_fkey"
FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
