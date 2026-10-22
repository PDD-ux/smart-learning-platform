-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('SIGNED_IN', 'MANUAL_CONFIRMATION');

-- CreateTable
CREATE TABLE "FaceTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedVector" BYTEA NOT NULL,
    "encryptionIv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyId" TEXT NOT NULL,
    "enrollmentPhotoKey" TEXT,
    "photoExpiresAt" TIMESTAMP(3),
    "photoEncryptionIv" BYTEA,
    "photoAuthTag" BYTEA,
    "photoKeyId" TEXT,
    "modelVersion" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "verificationVersion" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FaceTemplate_userId_key" ON "FaceTemplate"("userId");

-- CreateIndex
CREATE INDEX "FaceTemplate_photoExpiresAt_idx" ON "FaceTemplate"("photoExpiresAt");

-- CreateIndex
CREATE INDEX "AttendanceRecord_userId_signedAt_idx" ON "AttendanceRecord"("userId", "signedAt");

-- AddForeignKey
ALTER TABLE "FaceTemplate" ADD CONSTRAINT "FaceTemplate_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
