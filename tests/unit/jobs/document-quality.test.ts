import { describe, expect, it } from 'vitest';
import { documentFacts, parseDocumentFactSelection, documentQuote, isDocumentNavigation, uniqueDocumentFacts } from '@/lib/jobs/pipeline/document-quality';

describe('document evidence quality', (): void => {
  it('omits running website headers and numbered headings but keeps formula rows', (): void => {
    const facts = documentFacts([{ id: 'S1', text: 'www .example.com 官方学习网站\n一 、 题量占比 （参考最近一次的试卷）\n副省级：（40÷135）×100%=29.6%' }]);
    expect(facts).toHaveLength(1);
    expect(facts[0].title).toBe('副省级');
    expect(facts[0].text).toContain('29.6%');
  });
  it('preserves numbered definitions and sentences that explain an actual URL', (): void => {
    const facts = documentFacts([{ id: 'S1', text: '一、能量：能量不会凭空产生或消失。\n网址www.example.com是示例域名。' }]);
    expect(facts).toHaveLength(2);
  });
  it('maps selected IDs to original facts, subjects and exact parent source IDs', (): void => {
    const facts = documentFacts([{ id: 'S9', text: '副省级：（40 ÷135）×100%=29.6%\n市地级：（40÷130）×100%=30.8%' }]);
    expect(parseDocumentFactSelection('事实:F2', facts)).toEqual({ points: [{ title: '市地级', summary: '市地级：（40÷130）×100%=30.8%', sourceIds: ['S9'] }] });
    expect(() => parseDocumentFactSelection('事实:F99', facts)).toThrow('不存在');
    expect(() => parseDocumentFactSelection('事实:F1,F1', facts)).toThrow('重复');
    expect(() => parseDocumentFactSelection('事实:F1\n命题难度提高', facts)).toThrow('单行');
  });
  it('restores exact source spacing and characters after presentation normalization', (): void => {
    const source = '副省级： （40 ÷ 135）× 100% = 29.6%';
    expect(documentQuote(source, '副省级:(40÷135)×100%=29.6%')).toBe(source);
    expect(documentQuote(source, '副省级：(40÷135)×100%=30.8%')).toBeNull();
    expect(documentQuote(source, '据此判断命题难度提升。')).toBeNull();
  });
  it('rejects isolated short snippets and handles astral characters without cutting them', (): void => {
    expect(documentQuote('比例为29.6%', '29.6%')).toBeNull();
    expect(documentQuote('😀原文足够长并且可以逐字核对其真实的内容。', '😀原文足够长并且可以逐字核对')).toBe('😀原文足够长并且可以逐字核对');
  });
  it('identifies explicit tables of contents and short covers, not substantive prose', (): void => {
    expect(isDocumentNavigation('目录\n第一章.....1\n第二章.....2\n第三章.....3')).toBe(true);
    expect(isDocumentNavigation('基础理论\n2025年全程班\n主讲：张老师')).toBe(true);
    expect(isDocumentNavigation('目录结构可以用树表示。以下说明目录的实际作用。')).toBe(false);
    expect(isDocumentNavigation('主讲：张老师。公式U=IR描述电压、电流与电阻关系。')).toBe(false);
  });
  it('removes equivalent and contained quotes but preserves distinct numerical facts', (): void => {
    const points = [
      { summary: '甲卷比例：（40÷135）×100%=29.6%' },
      { summary: '甲卷比例: (40 ÷135)×100%=29.6%' },
      { summary: '（40÷135）×100%=29.6%' },
      { summary: '乙卷比例：（40÷130）×100%=30.8%' },
    ];
    expect(uniqueDocumentFacts(points)).toEqual([points[0], points[3]]);
  });
});
