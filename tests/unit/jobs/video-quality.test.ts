import { describe, expect, it } from 'vitest';
import { videoSelectionSchema } from '@/lib/jobs/pipeline/video-quality';
const sources = [
 { id: 'S1', ref: { type: 'video' as const, timestampSec: 688 }, text: '为什么要求必须是单设呢，因为如果是两个x对应一个y。' },
 { id: 'S2', ref: { type: 'video' as const, timestampSec: 701 }, text: '倒过来的话就是这一个y得对应两个x。' },
 { id: 'S3', ref: { type: 'video' as const, timestampSec: 711 }, text: '所以这里加了一个单摄的条件就是这个原因。' },
];
describe('video source selection', () => {
 it('restores adjacent original wording and timestamps, without correcting ASR or inventing bijection', () => {
  const result=videoSelectionSchema(sources).parse({points:[{sourceIds:['S2']}]});
  expect(result.points[0]).toMatchObject({title:'原文精选 · 11:28', summary:sources.map(s=>s.text).join('\n'), refs:sources.map(s=>s.ref)});
  expect(result.points[0].summary).not.toContain('双射');
 });
 it('rejects rewritten claims, arbitrary titles, guessed refs, foreign IDs and duplicated IDs', () => {
  for(const point of [{sourceIds:['S2'],summary:'原映射必须双射'}, {sourceIds:['S2'],title:'结论'}, {sourceIds:['S2'],refs:[]}, {sourceIds:['S99']}, {sourceIds:['S2','S2']}])
   expect(videoSelectionSchema(sources).safeParse({points:[point]}).success).toBe(false);
 });
 it('refuses empty or excessive evidence without truncating and permits explicit abstention', () => {
  expect(videoSelectionSchema([]).parse({points:[]})).toEqual({points:[]});
  expect(videoSelectionSchema([{...sources[0],text:'短句'}]).safeParse({points:[{sourceIds:['S1']}]}).success).toBe(false);
  expect(videoSelectionSchema([{...sources[0],text:'长'.repeat(1001)}]).safeParse({points:[{sourceIds:['S1']}]}).success).toBe(false);
 });
 it('repairs over-eager output: caps at 2 points and keeps the longest consecutive run (max 5 ids)', () => {
  const many = Array.from({length: 40}, (_, i): typeof sources[0] => ({ id:`S${i+1}`, ref:{type:'video' as const, timestampSec:i*10}, text:`第${i+1}句话，讲述一个具体的定义细节。` }));
  // 13 个连续编号 → 取该连续段的前 5 个（外加两侧相邻来源），不再整批拒绝
  const clamped = videoSelectionSchema(many).parse({points:[{sourceIds: Array.from({length: 13}, (_, i): string => `S${i+11}`)}]});
  expect(clamped.points).toHaveLength(1);
  expect(clamped.points[0].sourceIds).toEqual(['S10','S11','S12','S13','S14','S15','S16']);
  // 3 个重点 → 只保留前 2 个
  const three = videoSelectionSchema(many).parse({points:[{sourceIds:['S1','S2','S3']},{sourceIds:['S10','S11']},{sourceIds:['S20','S21']}]});
  expect(three.points).toHaveLength(2);
  // 跳跃编号 → 修复为其中最长的连续段（S12~S15 共 4 个），保留模型本意
  const jumpy = videoSelectionSchema(many).parse({points:[{sourceIds:['S6','S7','S8','S10','S12','S13','S14','S15']}]});
  expect(jumpy.points).toHaveLength(1);
  expect(jumpy.points[0].sourceIds).toEqual(['S11','S12','S13','S14','S15','S16']);
 });
});
