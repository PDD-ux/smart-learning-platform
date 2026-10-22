import { expect, it } from 'vitest';
import { exerciseSource } from '@/lib/domain/exercise-source';
import type { ContentSummary, Understanding } from '@/services/api';

const content: ContentSummary = { contentId: 'c', contentType: 'video', title: '视频', status: '已就绪', durationSec: 100, pageCount: null, description: null, coverUrl: null, understandingStatus: 'completed', createdAt: '', updatedAt: '' };
function products(): Understanding {
  return { contentId: 'c', status: 'completed', transcriptSegments: [{ segmentId: 's', seq: 0, startMs: 12050, endMs: 15000, text: '转写' }], textBlocks: [{ blockId: 'b', source: 'FRAME', text: '文字', ref: { type: 'video', timestampSec: 20 } }], knowledgePoints: [{ pointId: 'p', title: '点', summary: '摘要', tags: [], importance: 1, refs: [{ type: 'video', timestampSec: 20 }, { type: 'video', timestampSec: 12 }, { type: 'video', timestampSec: 20 }] }] };
}
it('deduplicates and orders actual OCR and transcript anchors', () => {
  expect(exerciseSource(content, products(), 'p')?.refs).toEqual([{ type: 'video', timestampSec: 12 }, { type: 'video', timestampSec: 20 }]);
});
it('rejects unsupported, negative, fractional, wrong-type and out-of-range anchors', () => {
  const data = products();
  data.knowledgePoints[0].refs.push({ type: 'video', timestampSec: 99 }, { type: 'video', timestampSec: -1 }, { type: 'video', timestampSec: 12.5 }, { type: 'video', timestampSec: 101 }, { type: 'document', page: 1 });
  data.textBlocks.push({ blockId: 'bad', source: 'FRAME', text: '文字', ref: { type: 'video', timestampSec: 101 } });
  expect(exerciseSource(content, data, 'p')?.refs).toHaveLength(2);
  expect(exerciseSource({ ...content, durationSec: null }, data, 'p')?.refs).toEqual([]);
});
it('requires the cited document block to exist and collapses links to the same page', () => {
  const data = products(); data.transcriptSegments = [];
  data.textBlocks = [{ blockId: 'b', source: 'PDF', text: '文字', ref: { type: 'document', page: 2, blockIndex: 0 } }];
  data.knowledgePoints[0].refs = [{ type: 'document', page: 2, blockIndex: 9 }, { type: 'document', page: 2, blockIndex: 0 }, { type: 'document', page: 2 }];
  expect(exerciseSource({ ...content, contentType: 'document', pageCount: 3 }, data, 'p')?.refs).toEqual([{ type: 'document', page: 2 }]);
});
