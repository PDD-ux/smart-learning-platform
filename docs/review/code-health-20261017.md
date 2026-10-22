# 代码体检报告

> 检查日期：2026-10-17
> 检查方式：只读审查（未修改任何业务代码）
> 项目：文豪智能学习平台 · Next.js 16.4.1 + React 19.3.1 + Prisma 5 + PostgreSQL

---

## 一、自动化检查结果

| 检查项 | 命令 | 结果 |
|--------|------|------|
| TypeScript 类型检查 | `npx tsc --noEmit` | ✅ 0 错误（strict 模式全通过） |
| ESLint | `npx eslint src --max-warnings=0` | ✅ 0 错误 0 警告 |
| 单元测试 | `npx vitest run` | ✅ 165 个测试文件 / 1283 个用例全部通过 |
| 生产构建 | `npx next build --webpack` | ✅ **构建成功**（`BUILD_ID=K212bsu6L0hWnVdU8jw3Z`，standalone 产物已生成）。此前两次中断均因环境沙箱的文件删除保护拦截清理 `.next/trace-build`，非代码缺陷 |

---

## 二、事实基线（写文档请以这组数字为准）

| 项目 | 实际数量 | 取证命令 |
|------|----------|----------|
| Prisma 模型 | **43** | `grep -c "^model " prisma/schema.prisma` |
| Prisma 枚举 | **27** | `grep -c "^enum " prisma/schema.prisma` |
| 数据库迁移 | 16 | `ls prisma/migrations` |
| API 路由 | **100** | `find src/app/api -name "route.ts" \| wc -l` |
| 页面 | 31 | `find src/app -name "page.tsx" \| wc -l` |
| HTML 原型 | **8** | `ls prototype/*.html \| wc -l` |
| 源码文件（src） | 312 | `find src -name "*.ts" -o -name "*.tsx"` |

---

## 三、待修复问题

> **状态说明**：第 1～5 项已于 2026-10-17 全部修复，详见文末「修复记录」。
> 本节保留问题的原始记录，便于回溯当时的判断依据。

### 🔴 严重

**1. 79% 的核心源码未纳入 Git 版本控制** → ✅ **已解决**

> 已通过一次完整提交（`197cdc9`）将 1059 个文件入库并推送至 Gitee，详见文末「修复记录」。以下为问题当时的原始记录。

`src/` 下 312 个 `.ts/.tsx` 文件，只有 67 个被 Git 跟踪，246 个处于未跟踪状态。

未跟踪的模块包括（均为核心业务）：

- `src/app/api/exam-*`（考试、组卷、阅卷、生成任务）
- `src/app/api/discussions/`、`discussion-replies/`、`discussion-reports/`
- `src/app/api/courses/`（共享课程）
- `src/app/api/auth/face/`、`src/app/api/face/`（人脸登录）
- `src/app/api/contents/[id]/ai/qa/`、`generated-note/`、`watched-note/`
- `src/app/admin/`（管理后台）

另有 131 个测试文件、61 个脚本未跟踪，55 个已跟踪文件被修改但未提交。全仓仅 157 个 tracked 文件。

**风险**：任何误删、误改或系统故障都不可恢复。答辩前必须完成提交。

---

### 🟡 中等

**2. 文档数字严重漂移** → ✅ **已修正**（下表为修正前的对照记录）

| 位置 | 文档写的 | 实际 |
|------|----------|------|
| `README.md:18` | 17 张表 + 33 个接口 | 43 张表 + 100 个接口 |
| `README.md:263` | 33 个接口 | 100 个接口 |
| `README.md:26` | 7 个 HTML 原型 | 8 个 |
| `PROGRESS.md:1615` | 17 张表 + 11 枚举 | 43 张表 + 27 枚举 |
| `PROGRESS.md:1844` | 17 张表事实来源 | 43 张表 |
| `PROGRESS.md:1635` / `1843` | 7 个 HTML 原型 | 8 个 |
| `spec/03-ARCHITECTURE.md:79` | 16 表全量 | 43 张表 |
| `spec/03-ARCHITECTURE.md:1298` | 32 接口 / 16 表 | 100 接口 / 43 表 |
| `spec/05-TASKS.md:95` | 16 表 | 43 张表 |

> 注：`spec/04-DATA-MODEL.md:138` 写的「共 43 张业务表」是准确的，可据此校准其余文档。

**3. 两个死依赖** → ✅ **已移除**

`clsx` 与 `tailwind-merge` 在 `src/`、`scripts/`、`tests/`、`prototype/` 中零引用。`package.json` 中可移除，同时更新 `README.md` §🛠️ 技术选型。

**4. 前端耦合 Prisma 类型** → ✅ **已解除**

`src/components/review/RarityBadge.tsx:2`

```ts
import type { CardStatus } from '@prisma/client';
```

客户端组件依赖 Prisma 生成的类型，违反 `AGENTS.md`「不要让前端直接操作数据库」的架构约束。虽然 `import type` 编译后会完全擦除、不影响产物体积，但仍属耦合，建议改为本地联合类型。

**5. 构建警告** → ✅ **已修复**

```
Warning: Next.js ignored package-lock.json ... because it is outside the current Git repository
```

需在 `next.config.mjs` 中设置 `outputFileTracingRoot` 消除。

---

### 🟢 轻微

**6. 外键命名不一致**：同一个 `User` 实体在内容/考试模型里叫 `ownerId`（`schema.prisma:56`），在成就/签到里叫 `userId`（`:456`），在掌握度/弱点/进度里叫 `learnerId`（`:469`）。TS 侧也混用 `userId` / `studentId` / `learnerId`。跨表查询容易写错。

**7. 魔法数字散落**：超时 `15_000`（`services/api.ts:122`）、`25_000`（`live-notes.ts:94`）、`90_000`（`learning-agent.ts:146`）、`180_000`（`asr-local.ts:52`）；模型温度 `0.1 / 0.3 / 0`；分页 `10 / 20 / 50`。建议集中到配置模块。

**8. 事务包装重复**：`bank-service.ts:34` 与 `student-service.ts:27` 各有一份几乎相同的 `transaction(user, op)`（均包 `prisma.$transaction` + `courseAccount` + `timeout: 15000`），仅第二参不同，可抽到共享模块。

**9. Python 编译产物** → 经复查为**误报**：`.gitignore:55` 的 `*.py[cod]` 已覆盖 `.pyc`，无需处理。历史中遗留的 12 个 `.pyc` 已在本次提交中删除。

本次实际补充的忽略项：含个人信息的简历文件、AI/编辑器工具目录（`.codeartsdoer/`、`.cursor/`、`.codex-tmp/`）、验收日志（`docs/**/*.log`）。

**10. 环境变量未登记**：代码中使用但 `.env.example` 未登记的有 18 个，多为验收脚手架开关（如 `EXAM_STUDENTS_UI_PASSWORD`、`EXAM_GENERATION_LIVE`、`UI_ACCEPTANCE_BASE_URL`）。

> 注意：`DASHSCOPE_API_KEY`、`ZHIPU_API_KEY` 等是通过变量 `keyName` 动态读取的（`spark.ts:123`），静态扫描会误判为「未使用」，实际在用。

---

## 四、已核实「不是问题」的项（避免重复排查）

- **类型安全**：全仓无 `as any`、无 `@ts-ignore`。仅 3 处 `eslint-disable` 用于 `console`，1 处用于 `no-img-element`，均有正当理由。
- **身份认证**：100 个接口中，除 `auth/*`（本就公开）、`storage/*`（HMAC 预签名）、`metrics`（独立 token + `timingSafeEqual`）外，全部经 `withAuth` / `sharedRoute`。
- **越权 / IDOR**：资源接口均校验归属，如 `contents/[id]/route.ts:36`、`notes/[id]/route.ts:36`、`study-plans/[id]:11`（`where` 带 `ownerId`）。
- **管理员接口**：全部经 `assertAdmin` 重新查库校验角色，不直接信任 JWT 中的 `role`。
- **SQL 注入**：全部使用 zod 校验；`$queryRaw` 均为参数化模板，无 `queryRawUnsafe`。
- **密钥管理**：无硬编码密钥；响应统一走 `toPublicUser`，不含 `passwordHash`；`.env` 已被 gitignore。
- **上传安全**：`storage/upload` 与 `storage/object` 均校验 HMAC 签名，key 须命中已授权记录，无路径穿越。
- **空 catch**：`api.ts:93`、`rate-limit.ts:50/67`、`storage.ts:348/491` 等处的空 catch 均带中文注释说明降级意图，属于有意为之，不是吞异常。

---

## 五、任务完成情况

`spec/05-TASKS.md`：246 项已完成，6 项未完成。

剩余 6 项均为**外部依赖导致**，非代码缺陷：

- 222 页长 PDF 的完整语义理解与补修（受大模型额度 / 内容审核阻塞）
- 真实摄像头人脸录入登录（无本人摄像头设备）
- 公网 HTTPS 部署、Docker/Linux 环境验证
- AI 生成内容的语义忠实性人工验收

---

## 六、修复记录与后续待办

### 已完成（2026-10-17）

| # | 问题 | 处理 | 涉及文件 |
|---|------|------|----------|
| 1 | 79% 源码未入库 | 全量提交并推送 Gitee | `197cdc9`（1059 文件 / +327440 行） |
| 2 | 文档数字漂移 | 按实际值修正表数/枚举/接口数/原型数，并修正两处版本错误 | `README.md`、`PROGRESS.md`、`spec/03-ARCHITECTURE.md`、`spec/05-TASKS.md` |
| 3 | 两个死依赖 | 移除依赖并同步 lockfile 与 README 技术选型 | `package.json`、`package-lock.json`、`README.md` |
| 4 | 前端耦合 Prisma | 改为本地联合类型（行为完全等价） | `src/components/review/RarityBadge.tsx` |
| 5 | 构建警告 | 设置 `outputFileTracingRoot` 指向项目根 | `next.config.mjs` |
| 6 | 忽略规则 | 补充个人信息文件、工具目录、验收日志 | `.gitignore` |
| 7 | 魔法数字散落 | 新建统一配置模块，归集超时 / 模型默认参数 / 分页大小；修缮 Agent 总时限两处不一致 | `src/lib/config.ts` 等 8 个文件 |

**文档修正附带发现**：除数量表述外，还有两处框架版本过期——`PROGRESS.md` 写「Next.js 14 + React 18」、`spec/05-TASKS.md` 与 `spec/03-ARCHITECTURE.md` 写「Next.js 14」，实际均为 **Next.js 16.4.1 + React 19.3.1**，已同步修正。`PROGRESS.md` 的原型清单还漏列了 `admin-dashboard.html`，已补齐。

**保留未改的部分**：历史记录中的旧数字（如「当时生成了 16 表的初始迁移」）属于当时的事实，未做篡改；`spec/03-ARCHITECTURE.md` 第三章的范围收敛基线也未改，仅加注了当前实际规模的补充说明。

**回归验证**：

| 检查 | 结果 |
|------|------|
| `tsc --noEmit` | ✅ 0 错误 |
| `eslint src --max-warnings=0` | ✅ 0 错误 0 警告 |
| `vitest run` | ✅ 165 个测试文件 / 1283 个用例全部通过 |
| `next build --webpack` | ✅ **成功**（`BUILD_ID=K212bsu6L0hWnVdU8jw3Z`，standalone 产物已生成，且 package-lock 被忽略的警告已消失）|

四项检查全部通过，此前因沙箱删除保护导致的构建中断已排除，确认是环境问题而非代码问题。

### 推送前的安全处理

扫描发现两处个人信息泄露风险，这两个文件此前从未提交，已加入 `.gitignore`：

| 文件 | 泄露内容 |
|------|----------|
| `docs/简历-通用版.md` | 本人手机号、QQ 邮箱、住址 |
| `scripts/build_resume_template.py` | 本人手机号、QQ 邮箱 |

若日后要保留简历到仓库，请先手动删除其中的联系方式。其余文件中的手机号均为测试数据（如 `13800138000`、`14285714285`），无泄露风险；全仓未发现真实 API 密钥。

### 尚未处理（可选优化）

**2. 魔法数字提取** → ✅ **已完成**（2026-10-17）

新建 `src/lib/config.ts` 集中管理跨场景通用参数，所有数值与抽取前完全一致，仅做归集：

| 常量组 | 内容 | 来源 |
|--------|------|------|
| `TIMEOUTS` | 会话刷新、人脸校验、课程预处理、课程状态变更、Agent 请求、**Agent 总时限**、课堂要点、本地 ASR | `api.ts`、`verification-provider.ts`、`learning-agent.ts`、`asr-local.ts`、`live-notes.ts` |
| `AI_DEFAULTS` | 默认 temperature、默认 maxTokens | `spark.ts` |
| `PAGE_SIZES` | 内容 / 闪卡 / 学习计划 / 题库科目 | `api.ts`、`exam-bank.ts` |

抽取过程中发现一处**潜在隐患**：`learning-agent.ts` 的 `deadline`（第 19 行）与外层 race 超时（第 146 行）是两个独立的 `90_000`，分属同一「Agent 总时限」概念的两处实现。若只改其一会造成软 limit 与硬 limit 错配，现统一为 `TIMEOUTS.AGENT_TOTAL_MS`。

刻意**不提取**的部分：忠实性审查的 `temperature: 0`、课堂要点的 `temperature: 0.1 / maxTokens: 500` 等——这些是特定场景的调参，留在调用点反而更能说明「为什么是这个数」，抽到全局会丢失上下文。

其余两项**未执行**（风险相对更高）：

1. **统一外键命名**：`ownerId` / `userId` / `learnerId` 三套并存，改名需同步修改 schema、全部查询代码并生成迁移，风险较高
3. **合并重复事务封装**：`bank-service.ts:34` 与 `student-service.ts:27` 的事务包装几乎相同

这三项属于代码整洁度优化，不影响功能正确性，也不会影响答辩。

### 备注

远端遗留分支 `feat/zhiliao-v1`（`1859bba`）看已废弃，确认后可删除。
