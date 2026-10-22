import { afterEach, expect, it, vi } from 'vitest';
import { isRefInRange } from '@/lib/domain/content-ref';
import { resolveStudyLocation } from '@/lib/domain/study-location';
import { parseEpub } from '@/lib/books/epub';
import { archivePath, epubArchive } from '@/lib/books/epub-zip';
import { initializeBook, extractBookUnits } from '@/lib/books/source';
import { epubEntries, minimalEpub, zipFixture, type ZipEntry } from '../../fixtures/minimal-epub';
afterEach((): void => { vi.unstubAllGlobals(); });
function changed(file: string, value: string): Buffer { return zipFixture(epubEntries().map((entry): ZipEntry => entry.name === file ? { ...entry, value } : entry)); }
it('reads real EPUB3 bytes in spine order and maps navigation fragments to stable global paragraphs', (): void => {
  const network = vi.fn(); vi.stubGlobal('fetch', network); const parsed = parseEpub(minimalEpub());
  expect(parsed.paragraphs).toHaveLength(28); expect(parsed.paragraphs[0]).toBe('学习目标'); expect(parsed.paragraphs[25]).toBe('回顾方法');
  expect(parsed.chapters.map((chapter): string => chapter.title)).toEqual(['原书第一章', '深入理解', '原书第二章']);
  expect(parsed.chapters.map((chapter): number => chapter.start)).toEqual([1, 14, 26]);
  expect(parsed.chapters.every((chapter): boolean => chapter.origin === 'epub-nav')).toBe(true);
  expect(parsed.paragraphs.join('')).not.toMatch(/throw new|隐藏正文|invalid.example|color:red/u); expect(network).not.toHaveBeenCalled();
});
it('reads EPUB2 NCX and marks absent navigation as actual spine order', (): void => {
  expect(parseEpub(minimalEpub(true)).chapters.map((chapter): string => chapter.title)).toEqual(['原书第一章', '原书第二章']);
  const entries = epubEntries().filter((entry): boolean => entry.name !== 'OPS/nav.xhtml').map((entry): ZipEntry => entry.name === 'OPS/package.opf' ? { ...entry, value: String(entry.value).replace(/<item id="nav"[^>]+\/>/u, '') } : entry);
  expect(parseEpub(zipFixture(entries)).chapters.every((chapter): boolean => chapter.origin === 'epub-spine')).toBe(true);
});
it('initializes only metadata and extracts an explicit range without changing paragraph positions', async (): Promise<void> => {
  const bytes = minimalEpub(), state = await initializeBook(bytes, 'EPUB'); expect(state.units).toEqual({}); expect(state.unitKind).toBe('paragraph');
  const units = await extractBookUnits(bytes, state, 14, 15); expect(Object.keys(units)).toEqual(['14','15']); expect(units['14'].text).toContain('原文第13段');
});
it.each(['../outside','/absolute','C:/file','a/../b','a\\b','a%2fb','a#b','a?b','a//b','a\u0000b'])('rejects unsafe archive path %s', (name): void => { expect(() => archivePath(name)).toThrow(); });
it.each([
  ['META-INF/encryption.xml', '<encryption/>'], ['META-INF/rights.xml', '<rights/>'], ['../escape', 'bad'],
] as const)('rejects protected or unsafe entry %s', (name, value): void => { expect(() => parseEpub(zipFixture([...epubEntries(), { name, value }]))).toThrow('EPUB'); });
it('rejects duplicate filenames, symlinks and encrypted entries', (): void => {
  expect(() => parseEpub(zipFixture([...epubEntries(), epubEntries()[0]]))).toThrow();
  expect(() => parseEpub(zipFixture([...epubEntries(), { name: 'link', value: 'target', externalAttributes: 0xa0000000 }]))).toThrow();
  expect(() => parseEpub(zipFixture(epubEntries().map((entry): ZipEntry => ({ ...entry, flags: 1 }))))).toThrow();
});
it('rejects disguised ZIPs, missing mimetype and non-stored/non-first mimetype', (): void => {
  expect(() => parseEpub(Buffer.from('not a zip'))).toThrow(); const entries = epubEntries(); expect(() => parseEpub(zipFixture(entries.slice(1)))).toThrow();
  expect(() => parseEpub(zipFixture(entries.map((entry): ZipEntry => entry.name === 'mimetype' ? { ...entry, compress: true } : entry)))).toThrow();
  expect(() => parseEpub(zipFixture([entries[1], entries[0], ...entries.slice(2)]))).toThrow();
});
it('rejects bad CRC, directory tampering, truncation and ZIP64', (): void => {
  const bytes = minimalEpub(); bytes[38] ^= 1; expect(() => parseEpub(bytes)).toThrow();
  const bad = minimalEpub(), end = bad.length - 22; bad.writeUInt32LE(0xffffffff, end + 16); expect(() => parseEpub(bad)).toThrow();
  expect(() => parseEpub(minimalEpub().subarray(0, -4))).toThrow(); const zip64 = minimalEpub(); zip64.writeUInt16LE(0xffff, zip64.length - 12); expect(() => parseEpub(zip64)).toThrow();
});
it('bounds actual inflation even when both headers lie about original size', (): void => {
  expect(() => epubArchive(zipFixture([...epubEntries(), { name: 'bomb', value: 'x'.repeat(200000), compress: true, originalSize: 1 }]))).toThrow();
  expect(() => epubArchive(zipFixture([...epubEntries(), { name: 'bomb', value: 'x'.repeat(200000), compress: true }]))).toThrow();
  expect(() => epubArchive(zipFixture([...epubEntries(), { name: 'large', value: 'x', originalSize: 4 * 1024 ** 2 + 1 }]))).toThrow();
});
it.each([
  '<!DOCTYPE html SYSTEM "https://invalid.example/evil"><html><body><p>unsafe</p></body></html>',
  '<!DOCTYPE html [<!ENTITY xx "secret">]><html><body>&xx;</body></html>',
  '<html><body><p>broken</body></html>', '<html><body><p>&unknown;</p></body></html>',
  '<html><body>' + '<div>'.repeat(65) + 'deep' + '</div>'.repeat(65) + '</body></html>',
  '<html><body><p>' + '字'.repeat(20001) + '</p></body></html>', '<html><body><script>only script</script></body></html>',
])('rejects unsafe, malformed or unreadable XHTML without exposing the source', (value): void => {
  expect(() => parseEpub(changed('OPS/a.xhtml', value))).toThrow('EPUB格式损坏');
});
it.each(['https://invalid.example/a.xhtml','../../../outside.xhtml','%2e%2e/%2e%2e/outside.xhtml'])('rejects remote or escaping spine target %s', (href): void => {
  const entry = epubEntries().find((entry): boolean => entry.name === 'OPS/package.opf')!; expect(() => parseEpub(changed(entry.name, String(entry.value).replace('href="a.xhtml"', 'href="' + href + '"')))).toThrow();
});
it('refuses excessive entry count and total inflated size before inflation', (): void => {
  expect(() => epubArchive(zipFixture([...epubEntries(), ...Array.from({ length: 2001 }, (_, index): ZipEntry => ({ name: 'extra' + index, value: '' }))]))).toThrow();
  expect(() => epubArchive(zipFixture([...epubEntries(), ...Array.from({ length: 9 }, (_, index): ZipEntry => ({ name: 'large' + index, value: '', originalSize: 4 * 1024 ** 2 }))]))).toThrow();
});

it('bounds EPUB references by global paragraph count with no physical-page fiction',():void=>{
  const bounds={format:'EPUB',pageCount:null,paragraphCount:28};
  expect(isRefInRange({type:'document',page:1,blockIndex:27},bounds)).toBe(true);
  expect(isRefInRange({type:'document',page:1,blockIndex:28},bounds)).toBe(false);
  expect(isRefInRange({type:'document',page:2,blockIndex:0},bounds)).toBe(false);
  expect(isRefInRange({type:'document',page:1},bounds)).toBe(false);
  expect(resolveStudyLocation({page:'1',block:'27'},{...bounds,contentType:'document',durationSec:null})).toEqual({type:'document',page:1,blockIndex:27});
});

it('rejects a stored entry whose size headers lie before copying its payload',():void=>{
 expect(()=>epubArchive(zipFixture([...epubEntries(),{name:'lying-stored',value:'payload',originalSize:1}]))).toThrow();
});
it('uses visible text rather than a hidden heading as the spine fallback title',():void=>{
 const entries=epubEntries().filter((entry):boolean=>entry.name!=='OPS/nav.xhtml').map((entry):ZipEntry=>entry.name==='OPS/package.opf'?{...entry,value:String(entry.value).replace(/<item id="nav"[^>]+\/>/u,'')}:entry.name==='OPS/a.xhtml'?{...entry,value:'<html><body><h1 style="color:red;display:none">隐藏标题</h1><h1>真实标题</h1><p>正文内容。</p></body></html>'}:entry);
 expect(parseEpub(zipFixture(entries)).chapters[0].title).toBe('真实标题');
});

it('rejects ambiguous duplicate anchors and more than 200 chapter positions',():void=>{
 expect(()=>parseEpub(changed('OPS/a.xhtml','<html><body><p id="same">正文甲</p><p id="same">正文乙</p></body></html>'))).toThrow();
 const many=epubEntries().map((entry):ZipEntry=>entry.name==='OPS/a.xhtml'?{...entry,value:'<html><body>'+Array.from({length:201},(_,i):string=>'<p id="part'+i+'">第'+i+'段</p>').join('')+'</body></html>'}:entry.name==='OPS/nav.xhtml'?{...entry,value:'<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc">'+Array.from({length:201},(_,i):string=>'<a href="a.xhtml#part'+i+'">第'+i+'节</a>').join('')+'</nav></body></html>'}:entry);
 expect(()=>parseEpub(zipFixture(many))).toThrow();
});
