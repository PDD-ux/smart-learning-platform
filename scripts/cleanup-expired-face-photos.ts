import { cleanupExpiredEnrollmentPhotos } from '@/lib/face/template-store';

/**
 * 供部署平台的每日定时任务调用。输出只有计数，严禁写入用户 ID、对象键或照片数据。
 */
async function main(): Promise<void> {
  const result = await cleanupExpiredEnrollmentPhotos();
  process.stdout.write(
    `face enrollment photo cleanup: scanned=${result.scanned} cleared=${result.cleared} failed=${result.failed}\n`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

void main().catch(() => {
  // 不输出底层异常文本：存储/数据库驱动的 message 可能携带对象路径或连接上下文。
  process.stderr.write('face enrollment photo cleanup failed\n');
  process.exitCode = 1;
});
