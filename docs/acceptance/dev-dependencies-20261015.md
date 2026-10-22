# §26.7 开发依赖告警处置 · 2026-10-15 22:43

用户点选上一轮“9个开发依赖告警”并要求继续。本轮只处理该编号，未新增业务功能；方案先落spec/15及05任务清单。

## 修复结果

完整官方npm审计从 **9个受影响包（7high / 2moderate）降为7个（全部high）**；运行依赖审计仍 **0**。本轮消除了postcss-selector-parser和postcss-nested两项moderate告警。受影响包数量不等于独立漏洞数量，未宣称剩余7项已修复。

仅在package overrides的 **tailwindcss / postcss-nested** 两条消费路径，将postcss-selector-parser从6.1.4替换为已修补的 **7.1.6**。Tailwind仍3.4.19，未迁移4、未安装不兼容ESLint10、未删lint规则或执行audit fix --force。lock差异只移除根部旧parser、增加两条消费路径下的7.1.6，其他包版本不变；npm ls无无效peer。

这是有验证的跨主版本传递依赖替换。官方7.0.0说明遍历期间插入的语义改变，已核对现有Tailwind/postcss-nested消费点；没有仅凭审计数字认定兼容。[7.0.0发布说明](https://github.com/postcss/postcss-selector-parser/releases/tag/v7.0.0)、[安全公告](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)和已安装7.1.6 CHANGELOG共同留证。上轮暂不覆盖的选择保留历史，本轮按新增明确方案与实际对比执行。

## 兼容与工程验证

新增 `scripts/acceptance/css-parser-compat.cjs`，使用项目真实Tailwind配置、globals.css及React Flow样式编译；另外覆盖嵌套&、逗号多选择器、:is、:hover/:focus-visible、属性选择器、@apply、group/peer、响应式、任意值、负值和supports变体。升级前6.1.4与升级后两条路径7.1.6，输出逐字一致，编译警告均0：

- 项目CSS：159696字节，SHA256 `faba616e112d603e977c2469f90711acf05f237c8e453bebf0ae5261684360c2`。
- 嵌套/变体样例：12589字节，SHA256 `58082df4ae402c6c20ef853622e125f65073c18fa60e7edbcefe5f1c81d15f67`。

首次对比实际CSS已一致，但证据元数据误从根目录读取parser包，scoped override未hoist导致MODULE_NOT_FOUND；改从每个实际消费者createRequire读取版本后再次通过。首次两份CSS保存于first-after-attempt，不覆盖失败证据。

**1199项/152文件全量测试、严格类型、lint通过**。串行执行的隔离生产构建/standalone真实登录、Cookie、授权读、匿名401/学生管理403、退出、随看来源拒绝/缺模型503不写笔记/旧入口跳转及PDF/ASR打包资产哈希通过；临时服务/快照/账号全部清理。第一次与测试并行的快照复制阶段ENOENT，未进入构建，不算通过；之后无并发测试的完整重跑通过。原生产脚本的可选Valkey adapter warning仍在，不冒充零warning或实际BullMQ部署验收。

第一次运行依赖审计发生TLS连接中断，明确不是成功；官方源重新审计成功为0，完整审计7。npm install跳过依赖自动脚本，无全局registry修改。恢复3000回环本地网页，demo:check展示预检通过；没有新AI/ASR/Ascend或摄像头请求。

## 尚未解决的7个包

根因均为 **braces <=3.0.3** 的深层嵌套模式栈耗尽，上游当前最新3.0.3、[官方公告Patched versions仍为None](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。传播包为braces、chokidar、micromatch、fast-glob、tailwindcss、@next/eslint-plugin-next、eslint-config-next；不是7个独立漏洞。

当前Tailwind只扫描 `./src/**/*.{ts,tsx}`，Next lint检查仓库源码/页面规则，未将uploads、用户文本、用户自定义glob纳入构建；这些包不在运行依赖审计树中。该边界降低当前部署的暴露面，但不等于漏洞已修复，尤其不能把不可信贡献或源码当可信输入。只升级Tailwind4也不能消除Next官方ESLint插件上的同一依赖链，因此未冒险改变全站样式或删规则凑零。ESLint9维护期限制仍保留。后续需要上游补丁或独立评估工具链替换；本轮保留原始告警，不自造包版本/改名/屏蔽审计。

## 保护与复现

31张public表所有行哈希、原媒体文件集合/哈希、.env与.env.local前后完全一致。无迁移/reset、原资料重解析、正式共享发布或公网部署。本轮没有单独重做原生交互/移动端/AI质量验收；样式逐字一致和本轮生产检查不冒充这些结果。

私有证据：`.taskbook-working/dev-dependencies-20261015/` 中的package及lock备份、css-before/after.json、前后CSS、parser-tree.log、audit-all.json、audit-runtime-recheck.json（成功）、原网络失败文件、tests/types/lint.log、production-second/production.json、demo-check.log和protection.json。日志/数据库保护材料不公开分发。

复现常规检查：`npm test`、`npm run type-check`、`npm run lint`、`npm audit --registry=https://registry.npmjs.org`（当前预期非零，7项）、`npm audit --omit=dev --registry=https://registry.npmjs.org`（当前0）。生产检查：`node scripts/acceptance/production-demo-smoke.cjs --watched-notes --output-dir .taskbook-working/dev-dependencies-replay`，目录须不存在、3100需空闲，使用现有本地配置并自动清理夹具。

CSS比较应在待验证升级前运行 `node scripts/acceptance/css-parser-compat.cjs before .taskbook-working/css-compat-replay`，升级后用相同目录运行 `after`；脚本只写忽略目录，拒绝覆盖既有证据，差异会非零退出。不会为复现自动降级当前应用依赖。
