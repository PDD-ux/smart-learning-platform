import { createHash } from 'node:crypto';
import { Parser } from 'htmlparser2';
import { initializeBook, extractBookUnits } from '@/lib/books/source';
import type { BookState } from '@/lib/books/contracts';
import { URL_LIMITS, UrlImportError, type DownloadedDocument } from './fetch';
import type { UrlSource } from './contracts';

export type PreparedUrl = { format: 'MD' | 'PDF'; source: UrlSource; bookState: BookState; characters: number; excerpt: string; previewRange: string };
export type PreparedSnapshot = { bytes: Buffer; prepared: PreparedUrl };
type Node = { name: string; attributes: Record<string,string>; children: (Node|string)[] };
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
function parseHtml(value: string): Node {
  const root: Node = { name: '#root', attributes: {}, children: [] }, stack = [root]; let nodes = 0;
  const parser = new Parser({
    onopentag(name, attributes): void { if (++nodes > URL_LIMITS.nodes || stack.length > URL_LIMITS.depth) throw new UrlImportError('TOO_LARGE'); const node: Node = { name, attributes, children: [] }; stack.at(-1)!.children.push(node); stack.push(node); },
    onclosetag(): void { if (stack.length > 1) stack.pop(); },
    ontext(text): void { if (++nodes > URL_LIMITS.nodes) throw new UrlImportError('TOO_LARGE'); stack.at(-1)!.children.push(text); },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.end(value); return root;
}
function all(node: Node, predicate: (node: Node)=>boolean): Node[] { return [...(predicate(node) ? [node] : []), ...node.children.flatMap((child): Node[] => typeof child === 'string' ? [] : all(child, predicate))]; }
const excluded = new Set(['script','style','nav','header','footer','aside','form','iframe','object','embed','svg','math','canvas','audio','video','noscript','template','button','input','select','textarea']);
function hidden(node: Node): boolean { return excluded.has(node.name) || node.attributes.hidden !== undefined || node.attributes['aria-hidden'] === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(node.attributes.style ?? '') || /(?:^|[\s_-])(?:sidebar|advertisement|cookie-banner|navigation)(?:$|[\s_-])/iu.test(node.attributes.class ?? ''); }
function visible(node:Node,predicate:(node:Node)=>boolean):Node[]{return hidden(node)?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap((child):Node[]=>typeof child==='string'?[]:visible(child,predicate))];}
function text(node: Node|string): string { return typeof node === 'string' ? node : hidden(node) ? '' : node.children.map(text).join(''); }
function article(value: string): { markdown: string; title: string; author: string|null; publishedLabel: string|null; characters: number } {
  const tree = parseHtml(value);
  if (all(tree, (node): boolean => node.name === 'input' && node.attributes.type?.toLowerCase() === 'password').length) throw new UrlImportError('CONTENT_UNREADABLE');
  const meta = (name: string): string|null => all(tree, (node): boolean => node.name === 'meta' && [node.attributes.name,node.attributes.property,node.attributes.itemprop].some((key): boolean => key?.toLowerCase() === name.toLowerCase()))[0]?.attributes.content?.trim().slice(0,160) || null;
  const title = meta('og:title') ?? visible(tree, (node): boolean => node.name === 'h1').map(text).map((value): string => value.trim()).find(Boolean) ?? all(tree, (node): boolean => node.name === 'title').map((node): string => node.children.map((child): string => typeof child === 'string' ? child : '').join('').trim()).find(Boolean);
  if (!title) throw new UrlImportError('CONTENT_UNREADABLE');
  const candidates = visible(tree, (node): boolean => node.name === 'article' || node.name === 'main' || node.attributes.role === 'main');
  const root = candidates.sort((a,b): number => text(b).length-text(a).length)[0] ?? all(tree, (node): boolean => node.name === 'body')[0]; if (!root) throw new UrlImportError('CONTENT_UNREADABLE');
  const actual = text(root).replace(/\s+/gu,' ').trim(), linkText = visible(root,(node):boolean=>node.name==='a').reduce((sum,node):number=>sum+text(node).length,0);
  if (actual.length < 200 || linkText > actual.length * 0.5) throw new UrlImportError('CONTENT_UNREADABLE'); if (actual.length > URL_LIMITS.characters) throw new UrlImportError('TOO_LARGE');
  const blocks = new Set(['p','div','section','article','h1','h2','h3','h4','h5','h6','li','blockquote','pre','tr','dt','dd']); let current = ''; const paragraphs: string[] = [];
  const flush = (): void => { const value = current.replace(/\s+/gu,' ').trim(); if(value){if(value.length>20000)throw new UrlImportError('TOO_LARGE');paragraphs.push(value);} current=''; };
  const visit = (node: Node|string): void => { if(typeof node==='string'){current+=node;return;}if(hidden(node))return;const block=blocks.has(node.name);if(block)flush();if(/^h[1-6]$/u.test(node.name))current+='#'.repeat(Number(node.name[1]))+' ';if(['br','td','th'].includes(node.name))current+=' ';for(const child of node.children)visit(child);if(block)flush(); };
  visit(root);flush(); if(!paragraphs.length)throw new UrlImportError('CONTENT_UNREADABLE');
  const markdown = '# '+title.trim().slice(0,160)+'\n\n'+paragraphs.join('\n\n'); if(markdown.length>URL_LIMITS.characters+500)throw new UrlImportError('TOO_LARGE');
  return { markdown, title: title.trim().slice(0,160), author: meta('author'), publishedLabel: meta('article:published_time') ?? meta('datePublished'), characters: actual.length };
}
export async function prepareUrl(download: DownloadedDocument, requestedUrl: string): Promise<PreparedSnapshot> {
  let bytes = download.bytes, title: string, author: string|null = null, publishedLabel: string|null = null, characters = 0;
  if (download.format === 'MD') {
    let charset = /charset\s*=\s*["']?([^\s;"']+)/iu.exec(download.contentType)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([^\s>"']+)/iu.exec(bytes.subarray(0,2048).toString('latin1'))?.[1] ?? 'utf-8';
    charset = charset.toLowerCase(); if(!['utf-8','utf8','gbk','gb2312','gb18030'].includes(charset))throw new UrlImportError('UNSUPPORTED_TYPE');
    let decoded: string;try{decoded=new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{throw new UrlImportError('CONTENT_UNREADABLE');}
    const parsed = article(decoded); bytes=Buffer.from(parsed.markdown);({title,author,publishedLabel,characters}=parsed);
  } else { try{title=decodeURIComponent(new URL(download.finalUrl).pathname.split('/').at(-1)??'').replace(/\.pdf$/iu,'').slice(0,160)||'链接PDF资料';}catch{title='链接PDF资料';} }
  const bookState = await initializeBook(bytes, download.format);
  const units = await extractBookUnits(bytes,bookState,1,Math.min(bookState.unitCount,download.format==='PDF'?3:20));
  const excerpt = Object.values(units).map((unit):string=>unit.text).join('\n\n').slice(0,URL_LIMITS.preview);
  return { bytes, prepared: { format: download.format, bookState, characters, excerpt, previewRange: download.format==='PDF'?'PDF前'+Math.min(bookState.unitCount,3)+'页文本层（不含OCR）':'正文前'+Math.min(bookState.unitCount,20)+'段（最多12000字）', source: { version:1,requestedUrl,finalUrl:download.finalUrl,title,author,publishedLabel,fetchedAt:download.fetchedAt,sourceDigest:digest(download.bytes),contentDigest:digest(bytes),previousContentId:null } } };
}
