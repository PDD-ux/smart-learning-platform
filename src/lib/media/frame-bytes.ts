import { readFile } from 'node:fs/promises';

/**
 * 读取帧图文件为 base64（tasks.md §6.3）
 * 独立小模块便于单测替换，避免直接 mock node:fs/promises。
 */
export async function readFileBase64(filePath: string): Promise<string> {
  return (await readFile(filePath)).toString('base64');
}
