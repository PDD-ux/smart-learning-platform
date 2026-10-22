# 全工程检查记录 · 2026-10-21

后续修复：同日§29.23已按用户要求修复A1–A4的代码并通过1793项回归及8项真实数据库专项，Docker真实容器验收因daemon未运行仍待执行。详见[修复记录](queue-reliability-20261021.md)。以下保留巡检当时的原始发现和证据，开发依赖治理等未被核销。

## 结论与范围

本轮检查对象是 `C:\Users\qwh76\Desktop\智能学习平台`，不是旧的 `3fdc` worktree。结论是：工程基线可运行，仍有四处需要修复的运行/部署缺陷，以及开发依赖和维护性债务，不能宣称“所有功能零问题”。本次只执行 §29.22 检查、隔离复现与记录，不修改业务逻辑、依赖或原业务数据。

通过 Git 已跟踪及未忽略文件枚举并过滤已删除文件，共建立 **1367 个文件**的工程清单：src 426、tests 199、services 117、scripts 118、prisma 25、spec 36、prototype 9、docs 412、public 2、deliverables 1、根目录22。这里是源码/工程资产口径，不把 node_modules、上传资料、模型、构建缓存和忽略的诊断产物算成业务代码。

对全清单实施文件/语法/规则扫描，对导入与队列、存储、权限、班级作业、AI入口、生产打包、Docker配置等关键链路人工阅读及自动回归。**不等于逐行人工证明1367个文件均无缺陷**，也没有用覆盖率数据声称分支全覆盖。

## 已确认的问题（建议修复顺序）

### A1 / P1：入队失败后资料可能永久卡在解析中

- 位置：`src/app/api/contents/[id]/complete/route.ts:81–103`。
- 先提交事务，将资料设为 PARSING 并创建 PENDING 作业，然后调用 enqueue；enqueue 抛错时没有补偿、回退或可靠投递记录。调用者收到500，数据库却仍是 PARSING；再次 complete 又被当前状态拒绝。当前没有该解析队列的自动孤儿任务扫描。
- 隔离复现：使队列返回受控异常，记录到的唯一资料更新仍为 PARSING，没有 FAILED/回退更新。真实数据库/队列未注入故障。
- 同型代码：`src/lib/jobs/pipeline/understanding-pipeline.ts:80–99`，创建作业与 RUNNING 状态后也直接入队。
- 建议：明确可靠入队/恢复协议；若选补偿，需要只补偿本次作业且防止已经投递成功后的误回退，并提供可重试入口。不要只吞掉异常返回成功。

### A2 / P2：并发上传确认会创建两份解析任务

- 位置：`src/app/api/contents/[id]/complete/route.ts:39–49,81–95`。
- 状态校验在事务外；事务内 update 只有 id 条件。两个请求都读到 PENDING 后，即使事务顺序执行，也会各自更新 PARSING、创建不同作业并入队。前端按钮禁用无法保证服务端幂等。
- 隔离复现：同时调用真实路由函数两次，模拟相同的合法上传快照，结果两次200、两份 AsyncJob、两次 enqueue。使用模块替身，未调用模型或写入业务库。
- 建议：在事务内原子更新可迁移状态并检查 count，或锁定同一资料后重新检查；竞争失败返回既有状态/409；测试并发请求只能入队一次。

### A3 / P2：worker 忽略任务认领结果，重复投递仍执行

- 位置：`src/lib/jobs/workers/lifecycle.ts:58–66,80`；对应 `src/lib/jobs/async-job.ts:33`。
- startJob 已返回原子认领是否成功，但 runStage 忽略该返回值。两个投递均读到 PENDING 时，只有一个能认领，另一个仍会执行 fn；读取到 RUNNING 也不会跳过。理解流水线可能因此重复调用外部服务、替换解析或学习产物。
- 隔离复现：让两次认领分别返回 true/false，并发执行实际 runStage，业务处理函数仍被调用两次。
- 建议：引入明确的执行所有权/租约及重试语义。不能简单对所有 false 返回，因为现有失败重试仍可能保持 RUNNING，必须同时验证正常重试、进程中断恢复与重复投递。

### A4 / P2：默认 Docker 镜像遗漏 ffmpeg/ffprobe

- 位置：`Dockerfile:22,52`；使用位置 `src/lib/media/ffmpeg.ts:21–27`、`src/lib/video-imports/source.ts:23`。
- builder（worker继承）和 runner 都只安装 Poppler 等工具，没有 ffmpeg 包；Compose 没有挂载这两个二进制或配置替代路径。新视频直链探测直接调用 ffprobe，上传视频理解也需要抽帧/抽音轨，因此默认镜像无法完成视频主链路。
- 本机安装这些工具不代表容器具有它们。文档提示目标机须安装也不能替代镜像依赖。
- 已做 Dockerfile/Compose/调用链静态核对；Docker daemon 当前未运行，因此**没有实际构建容器验证**。
- 建议：在 worker 和 Web 镜像需要的阶段安装 ffmpeg，并在镜像中执行版本探测和一段原创短视频的探测/抽帧/抽音轨验收。

## 依赖审计

- 默认 npm 镜像 `registry.npmmirror.com` 的 audit 接口返回404/NOT_IMPLEMENTED，这不是零漏洞。
- 改用 `npm audit --json --registry=https://registry.npmjs.org` 成功：**7个 high 依赖条目**，0 critical；它们沿 braces → micromatch/fast-glob/chokidar → Tailwind/Next ESLint 传播，不能当作7个相互独立漏洞。
- `npm audit --omit=dev --json --registry=https://registry.npmjs.org`：**生产依赖0条已知告警**。这也不代表应用绝对安全。
- 根因公告：[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，本次查询时 braces <=3.0.3 受影响，公告未列修复版本。
- 未执行 `npm audit fix --force`。审计建议包含把 Next ESLint 降至14、Tailwind升至4等破坏性版本变动，不能照搬；需另编号验证兼容升级/替代及工具输入边界。
- `npm ls --depth=0 --json` 无依赖树 problems。

## 工程与目录维护问题

1. **压缩式代码不易维护**：学习页395行但19行超过500字符，最长3628字符；TopicWorkspace仅50行，却有13行超过500字符。班级、作业、阅读笔记和若干服务也有类似情况。建议先独立格式化，再按功能提取 hook/组件/事务函数；不要用减少文件行数冒充模块化。
2. **显式返回类型规则未完全落实**：扫描到14个具名函数声明没有显式返回类型，包括异步作业服务及响应工具。strict和目前lint不会自动执行AGENTS里这条规则。此为工程规则差距，不是14个运行错误。
3. **lint范围较窄**：日常命令仅校验src；scripts/tests/services不在该命令检查范围。本轮补了81个Python文件AST语法和13个非原型JavaScript文件 `node --check`，均通过；没有安装/执行所有Python服务依赖。
4. **遗留worker不能直接删除**：`product-gen.worker.ts`仍有脚手架TODO，且注册器/队列引用它；实际当前理解流水线的产物逻辑在 `pipeline/product-gen.stage.ts`。应先定义旧队列停用与迟到消息处理，再撤除，不把脚手架TODO误报为当前笔记主链路未实现。
5. **文档与缓存应区别管理**：412份docs含历史失败和验收证据，不因日期旧就删除；spec/prototype保留。模型、uploads和忽略诊断目录另有用途，未对它们进行无依据清理。tracked敏感文件名扫描未发现真实.env/.env.local或pem/key/p12；这不是完整密钥内容扫描认证。
6. **已有差异存在空白错误**：全局 `git diff --check` 在globals.css、api/response.ts等已有改动中报行尾空白；本轮记录文件单独校验。不把CRLF提示当功能缺陷。

自动扫描发现的两处候选已人工排除：HomeworkWorkspace导入的homework/contracts是可共享校验契约；classes路由的GET/POST解构导出是合法HTTP方法，且新构建通过。

## 本轮验证结果

- 全量 Vitest：**196个文件 / 1782项通过、0失败、0跳过**。JSON中的394是suite层级计数，不能当文件数。
- `npm run type-check`、`npm run lint`、`npx prisma validate`：通过。
- 独立生产快照构建及standalone启动：通过，未替换正在运行的3000端口构建。
- 隔离真实HTTP/PostgreSQL：临时学员登录、授权资料接口、匿名401、学员访问管理员403、退出通过；生产Cookie带Secure/HttpOnly。临时账号、快照、服务已清理，未使用修复密钥参数，原配置未改。
- 构建仍有BullMQ可选 `@valkey/valkey-glide` 解析告警，构建成功；没有因此擅自安装未用驱动。
- 只读演练检查：58项，57 PASS / 1 WARN / 0 FAIL；WARN为演示账号没有已建立目录的书籍。页面HTTP200只说明入口可达，不代表登录后的教学流程验收通过。
- 并发/队列失败隔离复现：3项均复现上述缺陷。这些断言描述当前缺陷，不应当作正确性回归通过。
- src AST扫描：显式any为0、带use-client文件直接fetch调用为0；未发现该扫描范围内客户端直接导入数据库/存储服务。不能据此替代完整安全审计。
- Python AST：81/81通过；非原型JS语法：13/13通过。

## 可复现入口与证据

命令均在桌面主仓库执行：

```powershell
npx vitest run --maxWorkers=4 --reporter=json --outputFile=.taskbook-working/engineering-audit-20261021/tests.json
npm run type-check
npm run lint
npx prisma validate
npm audit --json --registry=https://registry.npmjs.org
npm audit --omit=dev --json --registry=https://registry.npmjs.org
npx vitest run --config .taskbook-working/engineering-audit-20261021/vitest.config.mts
npm run demo:walkthrough
```

独立生产验收使用 `node scripts/acceptance/production-demo-smoke.cjs --output-dir .taskbook-working/engineering-audit-20261021/production`。该目录已存在，重复验收应换全新的忽略目录；不要传 `--repair-local-secrets`。会短暂创建隔离账号并清理，不调用模型。

原始清单、tests/concurrency JSON、官方完整/生产依赖审计、Python/JS/AST扫描、只读演练日志和生产日志/清理证据均保存在 `.taskbook-working/engineering-audit-20261021/`。临时复现测试位于同目录，仅通过独立配置运行，不加入正常回归；后续修复应转成断言正确行为的正式测试。

## 仍未覆盖及下一步

§29.11三角色原生交互/真人摄像头和§29.21正常公网DNS下新视频直链端到端验收继续保留未完成。本轮没有启动收费云资源、调用大模型、重训或重新处理现有资料，也没有绕过浏览器URL访问策略。Docker daemon不可用，Linux容器真实启动未验。

建议下个会话先以单独编号修复A1入队失败恢复，再处理A2/A3并发执行协议，随后补齐A4容器依赖及兼容的开发依赖治理。本轮不跨任务顺手修改。
