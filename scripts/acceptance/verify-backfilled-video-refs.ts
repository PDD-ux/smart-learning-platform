import { loadEnvConfig } from '@next/env';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { contentRefSchema } from '../../src/lib/domain/content-ref';
import { playbackSections, currentPlaybackSection } from '../../src/lib/domain/playback-notes';
loadEnvConfig(process.cwd());
const responseSchema = z.object({ success: z.literal(true), data: z.object({ knowledgePoints: z.array(z.object({ pointId: z.string(), title: z.string(), summary: z.string(), tags: z.array(z.string()), importance: z.number(), refs: z.array(contentRefSchema) })) }) });
async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (ids.length === 0) throw new Error('Provide verified content ids');
  const { prisma } = await import('../../src/lib/prisma');
  const { signAccessToken } = await import('../../src/lib/auth/jwt');
  const results: unknown[] = [];
  try {
    for (const id of ids) {
      const content = await prisma.learningContent.findUniqueOrThrow({ where: { id }, include: { owner: { select: { id: true, email: true, role: true } } } });
      // Controlled localhost API read using an in-memory token; no login/session is changed.
      const token = signAccessToken({ sub: content.owner.id, email: content.owner.email, role: content.owner.role });
      const response = await fetch(`http://localhost:3000/api/contents/${encodeURIComponent(id)}/understanding`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('HTTP_READ_FAILED');
      const { data } = responseSchema.parse(await response.json());
      const sections = playbackSections(data.knowledgePoints, content.durationSec);
      if (!sections.length) throw new Error('NO_PLAYBACK_SECTIONS');
      const transitions = sections.map(section => ({ timestampSec: section.timestampSec, pointTitles: currentPlaybackSection(sections, section.timestampSec)?.points.map(point => point.title) ?? [] }));
      if (transitions.some(row => row.pointTitles.length === 0)) throw new Error('MISSING_CURRENT_POINT');
      if (currentPlaybackSection(sections, sections[0].timestampSec - 1) !== null) throw new Error('EARLY_POINT');
      results.push({ contentId: id, title: content.title, httpStatus: response.status, pointCount: data.knowledgePoints.length, sectionCount: sections.length, transitions });
    }
    const report = { recordedAt: new Date().toISOString(), kind: 'controlled localhost authenticated GET + real playback selector, not password login/browser media test', passed: true, results };
    await writeFile('docs/acceptance/video-refs-backfill-20261008-read.json', JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ passed: true, contentCount: results.length }));
  } finally { await prisma.$disconnect(); }
}
void main().catch(() => { console.error('Read verification failed'); process.exitCode = 1; });
