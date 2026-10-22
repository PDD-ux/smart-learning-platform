import {describe,it,expect} from 'vitest';
import {preparePaste} from '@/lib/text-imports/prepare';
import {pasteCommandSchema} from '@/lib/text-imports/contracts';
import {bookView} from '@/lib/books/contracts';
const input={title:'课堂整理',sourceLabel:'本人课堂笔记，未经外部核验',author:'',text:'第一章 条件\n\n只有完成练习，才进入复习；不能倒置主体与条件。'};
describe('paste snapshot input and provenance',():void=>{
 it('normalizes line endings but does not invent a verified website or author',async():Promise<void>=>{const a=await preparePaste(input),b=await preparePaste({...input,text:'\uFEFF'+input.text.replaceAll('\n','\r\n')});expect(a.preview).toEqual(b.preview);expect(a.preview.author).toBeNull();expect(a.preview).not.toHaveProperty('url');expect(a.book.units).toEqual({});expect(a.preview.paragraphs).toBe(2);});
 it('binds the complete text and declared attribution, including beyond visible preview',async():Promise<void>=>{const text='复习条件。'.repeat(2500)+'\n\n尾段原文。';const a=await preparePaste({...input,text}),b=await preparePaste({...input,text:text+'变化'});expect(a.preview.excerpt).toHaveLength(12000);expect(a.preview.previewDigest).not.toBe(b.preview.previewDigest);expect(a.preview.previewDigest).not.toBe((await preparePaste({...input,text,sourceLabel:'不同来源'})).preview.previewDigest);});
 it('rejects control characters, meaningless strings and overlong paragraphs',async():Promise<void>=>{for(const text of ['。'.repeat(30),'有效文字\u0000'.repeat(10),'长'.repeat(20001)])await expect(preparePaste({...input,text})).rejects.toMatchObject({code:'VALIDATION_FAILED'});});
 it('keeps markup as plain text and hides internal import fields from book DTO',async():Promise<void>=>{const p=await preparePaste({...input,text:'<script>这是纯文字而不是网页执行内容</script>\n\n原始段落用于阅读。'});expect(p.preview.excerpt).toContain('<script>');p.book.pastedSource={version:1,kind:'PASTE',label:'self',author:null,importedAt:'today',bodyDigest:p.preview.bodyDigest,requestId:'private',inputDigest:'private'};expect(bookView(p.book,1)).not.toHaveProperty('pastedSource');});
 it('requires explicit confirmation and rejects unrelated fields',():void=>{expect(pasteCommandSchema.safeParse({...input,action:'confirm',requestId:crypto.randomUUID(),previewDigest:'a'.repeat(64),confirmed:false}).success).toBe(false);expect(pasteCommandSchema.safeParse({...input,action:'preview',url:'https://example.invalid'}).success).toBe(false);});
});
