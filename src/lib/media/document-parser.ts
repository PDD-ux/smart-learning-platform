import path from 'node:path';

/**
 * 文档文本层提取（tasks.md §3.2）
 * ------------------------------------------------------------
 * Markdown/TXT 直接按 UTF-8 读取；PDF.js 按真实页面树/字体映射做文本层的
 * 提取。扫描型 PDF 不伪造文本，加密或损坏 PDF 拒绝解析，调用方可据此将页面交给后续
 * 的视觉 OCR 任务（§6.3 P1）。
 */

export type ParsedDocument = {
  pageCount: number;
  pages: string[];
  /** 没有可读文本层、需要进入视觉 OCR 的页码（从 1 开始）。 */
  pagesNeedingVisualOcr: number[];
  requiresVisualOcr: boolean;
};

async function parsePdf(bytes: Buffer): Promise<ParsedDocument> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageRoot = path.resolve('node_modules/pdfjs-dist');
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false,
    cMapUrl: path.join(packageRoot, 'cmaps') + path.sep, cMapPacked: true,
    standardFontDataUrl: path.join(packageRoot, 'standard_fonts') + path.sep });
  try {
    const document = await loading.promise;
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push(text.trim());
      page.cleanup();
    }
    const pagesNeedingVisualOcr = pages.flatMap((text, index) => text ? [] : [index + 1]);
    return { pageCount: document.numPages, pages, pagesNeedingVisualOcr, requiresVisualOcr: pagesNeedingVisualOcr.length > 0 };
  } finally {
    await loading.destroy();
  }
}

function parsePlainText(bytes: Buffer): ParsedDocument {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const blocks = text
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter(Boolean);
  return { pageCount: 1, pages: [blocks.join('\n\n')], pagesNeedingVisualOcr: [], requiresVisualOcr: false };
}

export async function parseDocument(bytes: Buffer, format: string): Promise<ParsedDocument> {
  if (format.toUpperCase() === 'EPUB') throw new Error('EPUB请使用书籍章节阅读解析，不作为普通文本读取。');
  return format.toUpperCase() === 'PDF' ? parsePdf(bytes) : parsePlainText(bytes);
}
