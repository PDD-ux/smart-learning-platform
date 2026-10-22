# 文豪智能学习平台 · AI 执行规则

> 本项目是端云协同智能学习平台（MindSpore + 讯飞星火）。AI 写代码前必须先读取上下文文档，不允许只根据一句话直接生成代码。

---

## 必读文档

按以下顺序读取，按需查详细章节：

| 顺序 | 文档 | 必读章节 | 何时必读 |
|------|------|---------|---------|
| 1 | [`spec/01-PRD.md`](spec/01-PRD.md) | 全文 | 任何任务开始前 |
| 2 | [`spec/02-DESIGN.md`](spec/02-DESIGN.md) | 全文 | 涉及页面或交互的任务 |
| 3 | [`spec/03-ARCHITECTURE.md`](spec/03-ARCHITECTURE.md) | §1.1 / §2.2 / §2.3 | 涉及接口、数据模型、架构的任务 |
| 4 | [`spec/04-DATA-MODEL.md`](spec/04-DATA-MODEL.md) | 全文 | 涉及字段、接口、校验规则的任务 |
| 5 | [`spec/05-TASKS.md`](spec/05-TASKS.md) | 当前 Phase | 任何编码任务 |
| 6 | [`spec/06-VISUAL-SPEC.md`](spec/06-VISUAL-SPEC.md) | 当前涉及组件 | 前端实现任务 |
| 7 | [`DEPLOY.md`](DEPLOY.md) | 全文 | 部署相关任务 |
| 8 | [`README.md`](README.md) | §🛠️ 技术选型 | 引入新依赖或选型讨论 |
| 9 | [`PROGRESS.md`](PROGRESS.md) | 全文 | 新会话开局 |

---

## 执行规则

1. **每次只执行 `spec/05-TASKS.md` 中的一个编号任务**，不要批量。
2. **不要顺手实现后续任务**——下一个任务留给下一个会话。
3. **不要实现任务清单之外的功能**——除非先更新 PRD 并与用户确认。
4. **如果任务不合理，先修改文档，再写代码**——架构变更必须先有文档落地。
5. **页面和交互对齐 `spec/02-DESIGN.md`**——视觉细节对齐 `spec/06-VISUAL-SPEC.md`。
6. **数据字段、接口入参出参、校验规则对齐 `spec/04-DATA-MODEL.md`**（详细 TS 类型见 `spec/03-ARCHITECTURE.md §2.2`）。
7. **文件职责、模块边界和数据流对齐 `spec/03-ARCHITECTURE.md`**。

---

## 文档修改规则

当任务是完善 `spec/` 或根目录文档时：

- **必须阅读目标文档全文**，不要只搜索 `TODO`。
- **优先补全所有 `TODO`**——按章节补完。
- 如果已有内容和当前 `spec/01-PRD.md`、原型或课堂项目边界不一致，**必须同步修改非 `TODO` 内容**。
- 如果已有内容是通用规则，且没有和当前项目冲突，**应该保留**。
- 不要擅自新增课堂范围之外的功能。
- 修改完成后**说明补全了哪些 `TODO`、修改了哪些非 `TODO` 内容，以及为什么修改**。

---

## 完成规则

每完成一个任务后：

1. **更新 [`PROGRESS.md`](PROGRESS.md)**——把对应任务从 `[ ]` 改 `[x]`，记录完成时间。
2. **如果改动架构**，同步更新 [`spec/03-ARCHITECTURE.md`](spec/03-ARCHITECTURE.md)。
3. **如果改动数据字段或接口**，同步更新 [`spec/04-DATA-MODEL.md`](spec/04-DATA-MODEL.md)。
4. **如果新增页面或改交互**，同步更新 [`spec/02-DESIGN.md`](spec/02-DESIGN.md)。
5. **如果引入新依赖**，同步更新 [`README.md §🛠️ 技术选型`](README.md)。
6. **如果踩坑**，写入 [`LEARNINGS.md`](LEARNINGS.md)。
7. 回复中说明修改了哪些文件、如何验证、是否还有未完成项。

---

## 禁止事项

- ❌ **不要删除 `prototype/` 和 `spec/`**——这些是项目核心资产。
- ❌ **不要把管理员密码、AI API Key、JWT 签名密钥写入前端代码**——一律从环境变量读取。
- ❌ **不要提交 `.env`、`.env.local`**——已加入 `.gitignore`。
- ❌ **不要让前端直接操作数据库**，必须通过 `src/app/api/*` 接口。
- ❌ **不要把 `fetch` 调用散落在页面组件里**，统一通过 `src/services/`（前端）或 `src/lib/api/`（后端）封装。
- ❌ **不要在日志中输出 API Key、密码、token 等敏感信息**——大模型网关 `src/lib/ai/spark.ts` 中不得拼接或输出凭据。
- ❌ **不要引入新依赖而不更新 README §🛠️**——技术栈边界见该节「不引入的依赖」表。

---

## 工程约束（CodeArts 自动注入）

```json
{
  "Language Context": ["TS", "TS_Strict"],
  "Architecture Stack": ["React"]
}
```

- **TypeScript 严格模式**：`strict: true` 开启，禁止 `any`，所有函数必须有显式返回类型。
- **React 19.3.1 / Next.js 16.4.1**：使用 App Router + Server Components 默认；动态params/searchParams按Next16异步契约处理。版本迁移见spec/15-FINAL-REPAIRS.md。
- **依赖路径别名**：`@/*` 指向 `src/*`。

---

**最近核对**：2026-09-10

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
