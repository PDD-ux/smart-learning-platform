import path from 'node:path';
import { SaxesParser } from 'saxes';
import { BOOK_LIMITS, chaptersFromStarts, type BookChapter } from './contracts';
import { archivePath, epubArchive, epubFailure, EPUB_LIMITS } from './epub-zip';

type Node = { name: string; attributes: Record<string, string>; children: (Node | string)[] };
export type ParsedEpub = { paragraphs: string[]; chapters: BookChapter[] };
function xml(bytes: Buffer): Node {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const root: Node = { name: '#root', attributes: {}, children: [] }, stack = [root];
  const parser = new SaxesParser({ xmlns: true, position: false }); let nodes = 0;
  parser.on('error', (): never => { throw epubFailure(); });
  parser.on('doctype', (doctype): void => { if (doctype.trim().toLowerCase() !== 'html') throw epubFailure(); });
  parser.on('processinginstruction', (): never => { throw epubFailure(); });
  parser.on('opentag', (tag): void => {
    if (++nodes > EPUB_LIMITS.nodes || stack.length > EPUB_LIMITS.depth || Object.keys(tag.attributes).length > 128) throw epubFailure();
    const attributes = Object.fromEntries(Object.values(tag.attributes).map((attribute): [string, string] => [attribute.name, attribute.value]));
    const node: Node = { name: tag.local.toLowerCase(), attributes, children: [] }; stack.at(-1)!.children.push(node); stack.push(node);
  });
  parser.on('closetag', (): void => { stack.pop(); });
  const text = (text: string): void => { if (++nodes > EPUB_LIMITS.nodes) throw epubFailure(); stack.at(-1)!.children.push(text); };
  parser.on('text', text); parser.on('cdata', text); parser.write(value).close();
  const document = root.children.find((child): child is Node => typeof child !== 'string'); if (!document) throw epubFailure(); return document;
}
function children(node: Node, name: string): Node[] { return node.children.filter((child): child is Node => typeof child !== 'string' && child.name === name); }
function descendants(node: Node, name: string): Node[] { return [ ...(node.name === name ? [node] : []), ...node.children.flatMap((child): Node[] => typeof child === 'string' ? [] : descendants(child, name)) ]; }
function textContent(node: Node): string { return node.children.map((child): string => typeof child === 'string' ? child : textContent(child)).join('').replace(/\s+/gu, ' ').trim(); }
function target(base: string, href: string): { file: string; anchor: string } {
  if (href.length > 1024) throw epubFailure();
  const hash = href.indexOf('#'), raw = hash < 0 ? href : href.slice(0, hash), anchor = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
  const decoded = decodeURIComponent(raw);
  if (/[:?]/u.test(decoded) || [...decoded].some((character): boolean => character.charCodeAt(0) < 32 || [92, 127].includes(character.charCodeAt(0))) || decoded.startsWith('/')) throw epubFailure();
  const segments = raw ? path.posix.dirname(base).split('/').filter((part): boolean => part !== '.') : base.split('/');
  if (raw) for (const part of decoded.split('/')) { if (!part || part === '.') continue; if (part === '..') { if (!segments.length) throw epubFailure(); segments.pop(); } else segments.push(part); }
  return { file: archivePath(segments.join('/')), anchor };
}
function required(files: Map<string, Buffer>, name: string): Node { const bytes = files.get(name); if (!bytes) throw epubFailure(); return xml(bytes); }
function readable(body: Node): { paragraphs: string[]; anchors: Map<string, number>; title: string } {
  const paragraphs: string[] = [], anchors = new Map<string, number>(), seenIds = new Set<string>(); let current = '', pending: string[] = [], title = '';
  const skip = new Set(['script','style','iframe','object','embed','svg','math','audio','video','canvas','noscript','template','head','form']);
  const blocks = new Set(['p','div','section','article','h1','h2','h3','h4','h5','h6','li','blockquote','pre','tr','dt','dd']);
  const flush = (): void => { const text = current.replace(/\s+/gu, ' ').trim(); if (text) { if (text.length > BOOK_LIMITS.unitCharacters) throw epubFailure(); for (const id of pending) if (!anchors.has(id)) anchors.set(id, paragraphs.length); pending = []; paragraphs.push(text); } current = ''; };
  const visit = (node: Node | string): void => {
    if (typeof node === 'string') { current += node; return; }
    if (skip.has(node.name) || node.attributes.hidden !== undefined || /(?:^|;)\s*display\s*:\s*none/iu.test(node.attributes.style ?? '')) return;
    if (blocks.has(node.name)) flush();
    const headingStart = paragraphs.length;
    if (node.attributes.id) { if (seenIds.has(node.attributes.id)) throw epubFailure(); seenIds.add(node.attributes.id); pending.push(node.attributes.id); }
    if (node.name === 'br' || node.name === 'td' || node.name === 'th') current += ' ';
    for (const child of node.children) visit(child);
    if (blocks.has(node.name)) flush();
    if (node.name === 'h1' && !title) title = paragraphs[headingStart] ?? '';
  };
  visit(body); flush();
  return { paragraphs, anchors, title };
}
/** No DOM, browser, filesystem extraction or network operations are used for an EPUB. */
export function parseEpub(bytes: Buffer): ParsedEpub {
  try {
    const files = epubArchive(bytes), container = required(files, 'META-INF/container.xml');
    const opfs = descendants(container, 'rootfile').filter((item): boolean => item.attributes['media-type'] === 'application/oebps-package+xml');
    if (!opfs.length) throw epubFailure(); const opfName = archivePath(opfs[0].attributes['full-path'] ?? ''), opf = required(files, opfName);
    if (opf.name !== 'package') throw epubFailure();
    const manifest = children(opf, 'manifest')[0], spine = children(opf, 'spine')[0]; if (!manifest || !spine) throw epubFailure();
    const items = new Map<string, Node>();
    for (const item of children(manifest, 'item')) { const id = item.attributes.id; if (!id || items.has(id)) throw epubFailure(); items.set(id, item); }
    const refs = children(spine, 'itemref').filter((item): boolean => item.attributes.linear !== 'no');
    if (!refs.length || refs.length > EPUB_LIMITS.spine) throw epubFailure();
    const paragraphs: string[] = [], starts: { title: string; position: number }[] = [], positions = new Map<string, number>(); const used = new Set<string>();
    let characters = 0;
    for (const [index, ref] of refs.entries()) {
      const item = items.get(ref.attributes.idref); if (!item || item.attributes['media-type'] !== 'application/xhtml+xml') throw epubFailure();
      const file = target(opfName, item.attributes.href ?? '').file; if (used.has(file)) throw epubFailure(); used.add(file);
      const document = required(files, file), body = descendants(document, 'body')[0]; if (document.name !== 'html' || !body) throw epubFailure();
      const content = readable(body); if (!content.paragraphs.length) throw epubFailure();
      const start = paragraphs.length + 1; positions.set(file, start);
      for (const [anchor, offset] of content.anchors) positions.set(file + '#' + anchor, start + offset);
      starts.push({ title: content.title.slice(0, 160) || '阅读顺序第' + (index + 1) + '节', position: start });
      for (const paragraph of content.paragraphs) { characters += paragraph.length; paragraphs.push(paragraph); if (characters > EPUB_LIMITS.characters || paragraphs.length > BOOK_LIMITS.paragraphs) throw epubFailure(); }
    }
    const navItem = [...items.values()].find((item): boolean => (item.attributes.properties ?? '').split(/\s+/u).includes('nav'));
    const ncx = spine.attributes.toc ? items.get(spine.attributes.toc) : undefined;
    const navigation: { title: string; position: number }[] = [];
    if (navItem || ncx) {
      const item = navItem ?? ncx!, file = target(opfName, item.attributes.href ?? '').file, tree = required(files, file);
      const nav = navItem ? descendants(tree, 'nav').find((node): boolean => (node.attributes['epub:type'] ?? node.attributes.type ?? '').split(/\s+/u).includes('toc')) : tree;
      if (nav) {
        const entries = navItem ? descendants(nav, 'a').map((node): { href: string; title: string } => ({ href: node.attributes.href ?? '', title: textContent(node) })) : descendants(nav, 'navpoint').map((node): { href: string; title: string } => ({ href: children(node, 'content')[0]?.attributes.src ?? '', title: children(node, 'navlabel').map(textContent).join('') }));
        if (entries.length > 1000) throw epubFailure();
        for (const entry of entries) { const destination = target(file, entry.href), position = positions.get(destination.file + (destination.anchor ? '#' + destination.anchor : '')); if (position && entry.title) navigation.push({ title: entry.title.slice(0, 160), position }); }
      }
    }
    if (new Set([...navigation, ...starts].map((item): number => item.position)).size > BOOK_LIMITS.chapters) throw epubFailure();
    const origins = new Set(navigation.map((item): number => item.position));
    const chapters = chaptersFromStarts([...navigation, ...starts], paragraphs.length, 'epub-spine', 50).map((chapter): BookChapter => ({ ...chapter, origin: origins.has(chapter.start) ? 'epub-nav' : 'epub-spine' }));
    return { paragraphs, chapters };
  } catch { throw epubFailure(); }
}
