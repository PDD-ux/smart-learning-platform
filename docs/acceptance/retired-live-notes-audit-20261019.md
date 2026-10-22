# 旧麦克风课堂 API 退场与依赖审计

日期：2026-10-19  
任务：§29.3.1  
工作区：桌面主仓库 `C:\Users\qwh76\Desktop\智能学习平台`

## 结果

- 用户已明确课堂笔记应跟随已导入视频播放生成，因此旧麦克风录音工作流不再开放。五个 `/api/live-notes` 路径保留兼容墓碑：GET、HEAD、POST、PUT、PATCH、DELETE、OPTIONS 均返回 `410 LIVE_NOTES_RETIRED`。HEAD不带正文，响应为 `private, no-store` 并按Cookie/Authorization区分缓存。
- 墓碑不经过认证，不读取请求身份、ID或正文，不访问数据库、ASR进程或大模型。旧LiveSession/LiveChunk表、迁移和既有行完整保留；没有删除或转换学习记录。`/live-notes` 旧页面仍兼容跳转到 `/import`。
- 本轮未修改 `package.json`、`package-lock.json`、环境文件或数据库。用户已有的模型/导入依赖更改保留。

## 验证

- 定向测试：`npx vitest run tests/unit/api/live-notes-retired-routes.test.ts tests/unit/api/live-notes.test.ts tests/unit/architecture/p0-contract.test.ts --reporter=dot`，3个测试文件、48项通过。
- 全量测试：183个测试文件、1658项通过。`npm run type-check`、`npm run lint`、新增测试及架构契约的显式ESLint检查、`npx prisma validate` 均通过。
- 当前本地Next服务真实HTTP复验五个路由×GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS，共35/35返回410，5个HEAD均为0字节正文。未进行生产构建或外部部署验收。
- 依赖审计使用官方 npm registry：完整树有7条High、0条Critical；`npm audit --omit=dev`为0项。七条报告均通过开发工具依赖链到达 `braces@3.0.3` 和公告 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。公告列出的受影响范围为 `<=3.0.3`，截至本记录日期没有发布修复版本。`npm audit fix --dry-run`没有可应用的无强制变更。
- npm建议的 `tailwindcss@4.3.3` 是Tailwind主版本升级，`eslint-config-next@14.2.35` 会从项目当前Next 16工具链降级；两者都不属于无破坏的依赖修复。本轮没有采用不受支持的braces覆盖，也没有宣称开发依赖审计已清零。

## 尚存边界

开发工具树仍有一项未修复的上游High公告，并在七个父依赖条目中重复出现。风险当前位于开发依赖树；生产依赖审计为零。待braces或其父依赖发布兼容修复后重跑官方审计。本记录不是全量部署、生产构建或代码安全审计结论。
