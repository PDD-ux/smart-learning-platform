import { execFile } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 扫描 PDF 页渲染（tasks.md §6.3 P1）
 * ------------------------------------------------------------
 * Poppler 的 `pdftoppm` 将指定 PDF 页转为 PNG，以便交给 MindSpore 文字检测。
 * 不可用时由调用方记录降级，既有 PDF 文本层仍可继续完成学习链路。
 */

function pdfToPpmPath(): string {
  return process.env.PDFTOPPM_PATH?.trim() || 'pdftoppm';
}

function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function isPdfRendererAvailable(): Promise<boolean> {
  try {
    await run(pdfToPpmPath(), ['-v'], 5_000);
    return true;
  } catch {
    return false;
  }
}

export type RenderedPdfPage = { page: number; filePath: string };

/** 将指定页按 150 DPI 渲染为 PNG，并按输入页码返回。 */
export async function renderPdfPages(
  pdfPath: string,
  pages: number[],
  outputDir: string,
): Promise<RenderedPdfPage[]> {
  const normalizedPages = [...new Set(pages)].filter((page) => Number.isInteger(page) && page > 0).sort((a, b) => a - b);
  if (normalizedPages.length === 0) return [];

  await mkdir(outputDir, { recursive: true });
  const rendered: RenderedPdfPage[] = [];
  for (const page of normalizedPages) {
    const prefix = path.join(outputDir, `page-${page}`);
    await run(pdfToPpmPath(), ['-f', String(page), '-l', String(page), '-r', '150', '-png', pdfPath, prefix], 60_000);
    const files = (await readdir(outputDir)).filter((file) => file.startsWith(`page-${page}-`) && file.endsWith('.png'));
    const file = files.sort()[0];
    if (!file) throw new Error(`PDF 第 ${page} 页渲染后未找到 PNG 输出`);
    rendered.push({ page, filePath: path.join(outputDir, file) });
  }
  return rendered;
}
