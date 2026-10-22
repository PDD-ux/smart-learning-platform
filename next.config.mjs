import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 本项目根目录。ESM 里没有 `__dirname`，需要自己换算。
 *
 * 显式声明给 Next.js 之后，文件追踪就不会跑到上层目录去找 package-lock.json，
 * 构建时那条 "ignored package-lock.json ... outside the current Git repository" 警告随之消失。
 */
const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ['pdfjs-dist'],
  outputFileTracingIncludes: {
      '/api/homework/**/*': [
        './node_modules/pdfjs-dist/legacy/build/*.mjs',
        './node_modules/pdfjs-dist/cmaps/**/*',
        './node_modules/pdfjs-dist/standard_fonts/**/*',
        './node_modules/pdfjs-dist/package.json',
      ],
      '/api/class-attachments/**/*': [
        './node_modules/pdfjs-dist/legacy/build/*.mjs',
        './node_modules/pdfjs-dist/package.json',
        './node_modules/pdfjs-dist/LICENSE',
      ],
      '/api/live-notes/**/*': ['./services/local-asr/*.py'],
      '/api/contents/**/*': [
        './node_modules/pdfjs-dist/legacy/build/*.mjs',
        './node_modules/pdfjs-dist/cmaps/**/*',
        './node_modules/pdfjs-dist/standard_fonts/**/*',
        './node_modules/pdfjs-dist/package.json',
        './node_modules/pdfjs-dist/LICENSE',
        './services/local-asr/*.py',
      ],
  },
  // 设计稿导出图为本地 PNG，直接用 next/image 优化即可
  images: {
    formats: ['image/webp'],
  },
};

export default nextConfig;
