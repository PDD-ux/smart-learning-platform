# 最后两项修复验收 · 2026-10-15

执行范围：用户明确要求“解决最后两个问题”，顺序完成 §26.5 框架及运行依赖安全修复、§26.6 总图谱练习记录口径修复。实施目录为桌面主仓库，方案先落 `spec/15-FINAL-REPAIRS.md`。没有新增业务模块、迁移、模型请求或公开资料。

## 1. 框架与运行依赖

- Next 14.2.21 → **16.4.1**，React / ReactDOM → **19.3.1**，对应类型 **19.3.0**；保留 App Router 和 Webpack，开发/构建命令显式 `--webpack`。
- 鉴权包装器先鉴权，再在边界 await Next 的 Promise params；现有领域 handler 仍使用已解析的参数，归属与角色校验保留。五个客户端页面解包 Promise params/searchParams，同时保留直接测试的同步参数。学习时间定位、题库知识点筛选、计划与助手资料定位均真实页面通过。
- `serverExternalPackages`、`outputFileTracingIncludes` 移至稳定配置。PDF JS/worker、中文 CMap、字体及 ASR Python/音频 worklet 与 standalone 中对应文件逐项哈希一致；这是打包检查，不是本轮实际 ASR/云推理验收。
- ESLint 改 flat config / 独立 CLI。保留原 hooks 和 Next 规则；未启 React Compiler，因此不启用此次升级新增的 refs / set-state-in-effect 编译建议。认证服务清空旧会话时的硬跳转保留有说明的单行例外。
- Vitest / UI **5.0.4**、Happy DOM **21.0.1**、Vite **8.3.4** / React 插件 **6.1.2**。测试配置改 `.mts`；React19 的异步内容断言等待实际出现，Happy DOM 未实现的原生确认框在单项测试中显式 stub 并 finally 恢复。未放宽业务判定或移除断言。
- 最低 Node 为 **22.13+（22 系）、24.x 或 26+**，本机 24.18.0，Docker 基础镜像同步 24-alpine。原有依赖范围在新 lock 中重新解析；`npm ls --depth=0` 无无效 peer。安装未使用 force / legacy-peer-deps；未修改全局 registry。跳过依赖自动脚本后单独执行 Prisma generate，成功且无数据库迁移/重置。

### 官方安全审计结论

本轮升级前发现 3 个运行依赖受影响包（Next critical、PostCSS / source-map-js high）。最终以 `https://registry.npmjs.org` 为审计源：

- **`npm audit --omit=dev`：0 项告警**。Next、PostCSS 8.5.30、source-map-js 1.2.2 已覆盖本轮运行依赖发现。source-map-js 使用明确 override。
- **完整开发依赖审计：9 个受影响包（7 high / 2 moderate / 0 critical）**，不是 9 个独立漏洞。根因是 braces 深层嵌套模式栈耗尽、旧 postcss-selector-parser 二次复杂度；影响链包括 micromatch / fast-glob / chokidar / Tailwind3 和 Next ESLint 配置。当前是处理仓库受控源码与样式的开发/构建工具，未作为网页运行时处理上传内容；不能据此断言所有场景不受影响。
- braces 官方当前发布仍在受影响范围；审计提出的 Tailwind4.3.3 是主版本迁移。未强制跨版本覆盖 parser 或删 lint / Tailwind 来制造零告警。ESLint9.39.5 已结束维护，但当前 eslint-plugin-react 的 peer 尚未声明 ESLint10 支持，保留兼容版本并明确该维护限制。公开部署前仍需复审开发供应链，不能把本次运行依赖清零当作全栈永久无漏洞。

参考：[Next Windows 公告](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)、[braces 公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)、[selector parser 公告](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)。最终版本、数量以本轮官方 registry JSON 为证；npmmirror 审计 404 不算成功。

## 2. 总图谱

原问题：只有 ExerciseRecord、Mastery.correctRate=1 / score=1、reviewCount=0 的节点，被总图谱按复习次数过滤后 correctRate=null，页面错误显示“暂无学习记录”。

修复为查询当前学习者、本人内容及知识点白名单内的实际 ExerciseRecord，按知识点累计正确条数和作答条数。同义节点正确率为总正确条数 / 总作答条数，不再以复习次数加权。无作答返回 null，全部错误返回 0；复习次数、最近复习时间不补造，掌握度与薄弱算法不变，没有新增接口字段或表。

回归覆盖：仅练习答对 / 答错、仅复习无作答、不同题量同义点合并、无内容 / 无知识点及本人查询约束。实际隔离账号经真实接口先错答再答对加法、另正确回答乘法（合计3次、2次正确），乘法在数据库、单资料图谱、总图谱、掌握画像中一致：掌握度/正确率100%、复习0次、最近复习null。页面节点显示“较熟悉”，详情保留真实“最近复习暂无记录”；点击练习带上该知识点筛选，未调用出题模型。

## 3. 本轮验证

- **1199 项 / 152 个文件全量测试通过**；严格类型与 lint 通过。生成 Next16 路由校验后类型检查亦通过。
- **隔离快照真实生产构建及 standalone 通过**：登录、HttpOnly Secure Cookie、授权读取、匿名401、学生管理403、退出；随看来源归属/未来片段拒绝、缺模型503且不写笔记，旧录音入口跳转，运行资产哈希核对。3100 服务、快照和临时账号均清理，不替换开发构建。
- **46 项真实 HTTP 检查通过**：笔记创建/修改、进度、媒体Range206、另一学生及管理员私人读取403、真实判分、计划完成/撤销、管理读取、正式消息门控404。另补真实 graph/overview、单资料图谱和 mastery 一致性检查。
- **真实续期与退出通过**：HttpOnly refresh Cookie、POST refresh200 / no-store、新 access 可读本人内容、外站 Origin403、退出清除 Cookie。第一次手工探针遗漏既有 x-session-refresh 保护头而403，修正探针后通过，没有修改或关闭保护。
- **原生页面通过**：临时学习者登录，总图谱状态与详情、图谱到题库 pointId 筛选、学习页 `?t=1` 定位并默认暂停、关闭随看模型后视频实际播放到30秒/error=null、学习计划与助手的 contentId 选择保留、助手未发送/未自动调用。浏览器捕获 error/warn 为0。实际默认952宽、文档944，无强制手机尺寸；本轮未另外宣称完整移动端验收。
- `demo:check` 展示预检通过；3000 网页保持回环监听，真实CPU人脸健康。未采摄像头、执行人脸登录或启动 Ascend。当前 AI/ASR 只是既有配置，本轮不消耗额度。
- **保护校验通过**：临时用户/内容/审计为0、临时媒体目录清除；31张public表所有行哈希、原媒体集合/哈希、.env 与 .env.local 前后完全一致。

真实页面使用人工算术夹具，不能充当课堂AI质量证据。生产构建保留 BullMQ 可选 Valkey adapter 缺包 warning（本地 memory / 既有 ioredis 路径不使用该 adapter），没有伪称 build 零 warning；未安装无用 adapter。开发进程忽略用户主目录祖先 lock 的提示为 Next16 的根目录保护行为。Next16 自动追加自身版本文档指引到 AGENTS.md，既有项目规则保留。

## 4. 复现入口与记录

在桌面主仓库、兼容 Node 版本下：

```powershell
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run prisma:generate
npm test
npm run type-check
npm run lint
npm audit --omit=dev --registry=https://registry.npmjs.org
npm audit --registry=https://registry.npmjs.org
node scripts/acceptance/production-demo-smoke.cjs --watched-notes --output-dir .taskbook-working/final-repairs-replay
npm run demo:start
```

生产脚本输出目录需不存在；3100需空闲，数据库、原样本及现有生产密钥规则须满足。不用迁移/reset、不重跑原长资料。图谱重点单测可用 `npm test -- tests/unit/api/graph-overview.test.ts tests/unit/auth/middleware.test.ts`。

私有原始证据位于 `.taskbook-working/final-repairs-20261015/`：audit-runtime-final.json、audit-all-final.json、dependencies-final.log、tests-confirm-fixed.log、types-final.log、lint-final.log、production-second/production.json、http.json、refresh-proof.json、graph-proof.json、ui-proof.json、graph-fixed.png、playback.json、cleanup.json、protection.json。保留之前安装/类型/测试失败日志，不用最终成功覆盖历史；临时账号明文凭据文件已删除，私有日志不可公开分发。

当前两项修复完成；开发供应链残余已明确。222页整份解析、自由解释Agent、正式共享素材发布、Docker实际构建、S3、公网HTTPS和云端真实推理不在本轮验收内，沿用原记录，不宣称全项目永远无问题。
