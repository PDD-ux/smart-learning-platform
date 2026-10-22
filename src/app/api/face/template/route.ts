import { NextRequest } from 'next/server';

import { withAuth } from '@/lib/auth/middleware';
import { ok } from '@/lib/api/response';
import { getTemplateStatus, removeFaceTemplate } from '@/lib/face/face-service';
import { assertFaceEnabledUser } from '@/lib/face/daily-check-in';

/** 当前用户的人脸模板状态；刻意不返回密文、对象键或任何比对数据。 */
export const GET = withAuth(async (_request: NextRequest, { user }) => {
  await assertFaceEnabledUser(user.id);
  return ok(await getTemplateStatus(user.id));
});

/** 硬删除模板，并由领域服务优先清理私有照片对象。 */
export const DELETE = withAuth(async (request: NextRequest, { user }) => {
  await assertFaceEnabledUser(user.id);
  const deleted = await removeFaceTemplate(user.id, request);
  return ok({ deleted });
});
