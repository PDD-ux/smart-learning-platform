# ============================================================
# 文豪智能学习平台 · Next.js 主应用 Dockerfile
# 多阶段构建：deps → builder → runner
# ============================================================

# ---- 阶段 1：安装依赖 ----
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* ./
# 启用国内镜像（可选，取消注释生效）
# RUN npm config set registry https://registry.npmmirror.com
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  else echo "Lockfile not found, falling back to npm install" && npm install; \
  fi

# ---- 阶段 2：构建产物（生成 Prisma client + Next.js standalone）----
FROM node:24-alpine AS builder
# worker 运行扫描 PDF OCR：Poppler 提供 pdftoppm 页渲染工具。
RUN apk add --no-cache libc6-compat openssl poppler-utils ffmpeg && \
    ffmpeg -version && ffprobe -version
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma 需要在构建期生成 client
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate

# Next.js standalone 输出（产出更小的生产镜像）
ENV NEXT_OUTPUT_STANDALONE=true
RUN npm run build

# ---- 阶段 2.5：BullMQ worker（复用构建期依赖与 TypeScript 源码）----
FROM builder AS worker
RUN apk add --no-cache tini && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production

USER nextjs

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./node_modules/.bin/tsx", "src/worker.ts"]

# ---- 阶段 3：生产运行（最小化镜像）----
FROM node:24-alpine AS runner
# memory 队列模式下 Web 进程也可能消费解析任务，因此保留 PDF 页渲染工具。
RUN apk add --no-cache libc6-compat openssl curl tini poppler-utils ffmpeg && \
    ffmpeg -version && ffprobe -version
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 非 root 用户运行（安全最佳实践）
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 复制 standalone 产物（包含 node_modules 必要子集）
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Prisma schema + generated client（运行时需要）
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:3000/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
