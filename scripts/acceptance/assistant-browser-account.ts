import { readFile, writeFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/auth/password';

loadEnvConfig(process.cwd());
const db = new PrismaClient();
async function main(): Promise<void> {
  const [mode, runId] = process.argv.slice(2);
  if (!['setup', 'cleanup'].includes(mode) || !/^[a-z0-9-]{8,80}$/.test(runId ?? '')) throw new Error('Invalid invocation');
  const ownerId = `assistant-browser-${runId}`;
  const statePath = `.taskbook-working/real-playback-${runId}.json`;
  const state = JSON.parse(await readFile(statePath, 'utf8')) as { cloneId: string; ownerId: string; sourceId: string };
  try {
    if (mode === 'cleanup') {
      if (await db.learningContent.count({ where: { ownerId } })) throw new Error('Clean database fixture first; shared media must remain');
      await db.user.deleteMany({ where: { id: ownerId } });
      console.log('Temporary assistant account removed');
      return;
    }
    const password = process.env.UI_ACCEPTANCE_PASSWORD;
    if (!password || password.length < 12 || state.cloneId === state.sourceId) throw new Error('Missing temporary password or invalid fixture');
    await db.$transaction(async (tx): Promise<void> => {
      await tx.user.create({ data: { id: ownerId, email: `${ownerId}@example.com`, nickname: '真实视频助手验收', passwordHash: await hashPassword(password) } });
      await tx.learningContent.update({ where: { id: state.cloneId }, data: { ownerId } });
      await tx.knowledgePoint.updateMany({ where: { contentId: state.cloneId }, data: { ownerId } });
    });
    await writeFile(statePath, JSON.stringify({ ...state, ownerId }), 'utf8');
    console.log(JSON.stringify({ account: `${ownerId}@example.com`, contentId: state.cloneId }));
  } finally { await db.$disconnect(); }
}
void main().catch(() => { console.error('Assistant fixture account failed; retain shared source media and inspect fixture state'); process.exitCode = 1; });
