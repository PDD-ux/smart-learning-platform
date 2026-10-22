ALTER TYPE "AttendanceStatus" ADD VALUE 'SELF_CHECK_IN';
ALTER TABLE "AttendanceRecord" ADD COLUMN "checkInDay" TEXT;
CREATE UNIQUE INDEX "AttendanceRecord_userId_checkInDay_key" ON "AttendanceRecord"("userId", "checkInDay");
CREATE TABLE "FaceLoginChallenge" (
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FaceLoginChallenge_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX "FaceLoginChallenge_expiresAt_idx" ON "FaceLoginChallenge"("expiresAt");
