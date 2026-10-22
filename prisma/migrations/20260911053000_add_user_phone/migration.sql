-- 账号体系支持邮箱或手机号（tasks.md §1.6）
-- email 改为可空（二选一），新增 phone 唯一列

ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
