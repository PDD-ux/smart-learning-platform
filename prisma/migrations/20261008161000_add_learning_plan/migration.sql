CREATE TABLE "LearningPlan" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearningPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LearningPlan_targetMinutes_check" CHECK ("targetMinutes" BETWEEN 1 AND 600),
    CONSTRAINT "LearningPlan_remindAt_check" CHECK ("remindAt" <= "scheduledAt")
);
CREATE INDEX "LearningPlan_ownerId_completedAt_remindAt_idx" ON "LearningPlan"("ownerId", "completedAt", "remindAt");
ALTER TABLE "LearningPlan" ADD CONSTRAINT "LearningPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningPlan" ADD CONSTRAINT "LearningPlan_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
