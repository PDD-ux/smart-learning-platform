import { PrismaClient } from '@prisma/client';

/**
 * Prisma 客户端单例（防止开发热重载时创建过多连接）
 */

const globalForPrisma = globalThis as unknown as { __slpPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.__slpPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__slpPrisma = prisma;
}