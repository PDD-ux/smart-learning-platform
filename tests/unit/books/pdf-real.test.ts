import {expect,it} from 'vitest';
import {initializeBook,extractBookUnits} from '@/lib/books/source';
import {minimalPdfFixture} from '../../fixtures/minimal-pdf';
it('reads a real PDF byte structure and preserves the blank-page OCR boundary',async():Promise<void>=>{
  const bytes=minimalPdfFixture();const book=await initializeBook(bytes,'PDF');expect(book.unitCount).toBe(2);expect(book.chapters[0].origin).toBe('page-range');
  const units=await extractBookUnits(bytes,book,1,2);expect(units['1'].text).toContain('First page');expect(units['1'].text).toContain('Second block');expect(units['2']).toEqual({text:'',status:'needs-ocr'});expect(book.units).toEqual({});
});
it('does not build an index for corrupted PDF bytes',async():Promise<void>=>{await expect(initializeBook(Buffer.from('%PDF-1.4 broken'),'PDF')).rejects.toThrow();});
