import {describe,expect,it} from 'vitest';
import {parseDocument} from '@/lib/media/document-parser';
import { minimalPdfFixture as fixture } from '../../fixtures/minimal-pdf';
describe('parseDocument',()=>{
 it('preserves Markdown text',async():Promise<void>=>{expect((await parseDocument(Buffer.from('标题\n\n第一段\n第二行'),'MD')).pages).toEqual(['标题\n\n第一段 第二行']);});
 it('keeps multiple text objects on their actual page, and marks the blank second page',async():Promise<void>=>{const parsed=await parseDocument(fixture(),'PDF');expect(parsed.pageCount).toBe(2);expect(parsed.pages[0]).toContain('First page');expect(parsed.pages[0]).toContain('Second block');expect(parsed.pages[1]).toBe('');expect(parsed.pagesNeedingVisualOcr).toEqual([2]);});
 it('rejects malformed PDF instead of manufacturing pages',async():Promise<void>=>{await expect(parseDocument(Buffer.from('%PDF-1.4\n/Type /Page\nstream\nBT (fake) Tj ET\nendstream'),'PDF')).rejects.toThrow();});
});
