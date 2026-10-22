# §27.8 自主组卷后台验收

2026-10-16，桌面主仓库。只执行27.8，不实现27.9页面或确认成卷。后台工程验收通过；真实星火出题质量未通过。

## 实现与边界

- `src/lib/exams/generation-contracts.ts`、`generation-store.ts`、`generation-service.ts`、`generation-worker.ts`分别负责严格蓝图/候选、安全本人事务与原文快照、命令/状态、预算/队列执行；`src/app/api/exam-generation-jobs/route.ts`及`[id]/route.ts`为薄路由，`src/services/exam-generation.ts`统一HTTP。复用paper-service题库池、PRODUCT_GEN队列分支、Spark AbortSignal及已有生成表；没有新依赖/迁移/训练。
- BANK/AI_SUBJECT/AI_SOURCE明确分开，1..50题默认20；题型/分值沿既有严格蓝图，范围/难度由用户明确，服务端确定固定位置，不额外调用模型规划。BANK仅当前公开启用/最新审核版本，缺题保留缺口、不跨科目/补AI；恢复重新核验撤审。AI固定星火，不换供应商。
- 最多2个本人活跃任务；每批最多5题、2次尝试，总预算2×ceil(N/5)，10分钟截止、45秒单请求、120秒租约。调用前持久化次数，恢复不重置次数/期限，重放不再入队。取消先写状态，本进程请求尽力中止，跨进程及迟到输出由状态/租约拒绝。
- AI_SOURCE仅本人READY原始TranscriptSegment/TextBlock，最多24片段/12000字且保持整片段；截断明确标记，引用ID及8..500字逐字摘录/真实页码时间，生成前及提交前重查来源摘要与归属。无外部抓题或猜造来源。
- 候选严格JSON/题型/答案/配额/基本内容校验，固定位置、题干规范化/近似去重；这不能证明学科知识正确、干扰项合理或资料全覆盖。AI来源标待核验，不自动APPROVED/公开，也没有创建最终ExamPaper。
- GET仅本人状态/预算/缺口，不下发候选正文、正确答案、资料、提示、租约或摘要；管理员无跨人豁免。状态与命令鉴权/no-store，严格未知字段及CAS/幂等审计。BANK对外模型预算0，数据库内部占位1满足原约束，未消耗模型调用。

## 已执行验证

- 全量164文件1272项单元通过，含5项新候选/输入测试；非增量TypeScript、lint通过。日志：`.taskbook-working/exam-generation-20261016/tests-final.log`、`types-final.log`、`lint.log`。既有队列、Spark错误及架构边界回归通过。
- 最新87项真实隔离NextRequest/PostgreSQL检查：`run-1792147762920/`。包括44项既有学生检查及43项生成相关检查/状态断言，覆盖严格注入、分类与本人权限、并发幂等、BANK不足/补充/撤审、固定分批与重复投递、部分合格保留、预算/期限不得重置、取消与迟到输出、租约接管、真实原文引用/来源变化、活跃任务上限、安全状态投影。生成成功夹具只验证结构/流程，不作为模型教育质量证据。
- 干净生产：`run-1792147544022/`，84项隔离数据库检查、20项学生/生成真实HTTP检查通过，后者含9项生成检查；生产构建、standalone、登录Cookie、匿名/跨人拒绝、本人状态/重放/题库生成、运行资产和退出通过。该轮在额外3项撤审检查加入前执行，数字不得相加。后续只修正验收脚本集合/动态路由类型与补充撤审夹具，业务代码与该生产轮一致。
- 所有上述成功轮报告均`cleaned=true`、`originalAssetsUnchanged=true`；原主库44物理表、媒体、两env指纹一致，临时随机库及生产快照/服务清理，未替换原开发网页。没有新主库迁移或业务资料写入。
- 首次补充撤审夹具违反数据库审核元数据约束，隔离库已清理，修正夹具同步清空审核人/时间后87项通过。初始全项目TS发现测试路由函数类型不匹配，区分集合与动态参数调用后重新检查通过，未隐瞒首次失败。

## 真实星火结果：未通过

只执行一次受控任务，1道题、两次上限，来源为隔离自编数学短文，不是用户整份课程。证据`.taskbook-working/exam-generation-20261016/run-1792147424545/live.json`：state=FAILED、requestedCount=1、acceptedCount=0、usedCalls=2、failureCode=INVALID_JSON，candidates为空。85项工程检查与清理通过不意味着真实题目质量通过。

两次输出无法被严格JSON解析，没有保存假题、放宽质量规则、隐式换模型或继续重试。原始模型内容/密钥/私人原文没有写入公共状态或通用日志。当前证据不能判断额度耗尽，不能承诺整卷成功率/速度。27.11真实多学科整卷逐题质量仍待验。

## 复现入口

在桌面主仓库执行（保留本机环境变量，不把密钥放进命令或聊天）：

```powershell
npm test
npx tsc --noEmit --incremental false
npm run lint
node scripts/acceptance/exam-students.cjs --generation
node scripts/acceptance/exam-students.cjs --generation --production
```

验收脚本建立随机隔离PostgreSQL库，模型凭据默认禁用，结束比较原资产并清理。真实模型入口另为`node scripts/acceptance/exam-students.cjs --generation --live`，仅保留现有星火配置并请求一题，仍可能实际消耗两次模型额度；本轮已执行，不为制造成功重复运行。输出live.json安全记录状态及合格候选，不保存原始无效模型文本；它只反映单题探测，不能当整卷验收。

业务入口：POST `/api/exam-generation-jobs`带`{plan:{blueprint,scope,difficultyMin,difficultyMax},requestId,confirmed:true}`；GET集合或`/:id`查本人状态；POST `/:id`带`{action:'retry'|'cancel',expectedRevision,requestId}`。完整字段限制见`spec/17-EXAM-FOUNDATION.md`及generation-contracts；不提供浏览器可注入模型输出、provider或预算的测试后门。

## 未完成

27.9自主组卷页面、私人预览/确认成卷、进入模拟答卷；27.10真实授权新版题源/PDF Word试点；27.11真实多学科整卷质量。自动断电后台扫恢复、真正语义判题和全课程覆盖不在本编号已验范围。原旧五题质量缺陷及上游开发依赖告警未因此核销。

本次未补TODO；修改的非TODO为PRD、03/04领域/API边界、05单任务状态、16/17实施状态与既有过时“作答尚未实现”描述，以及PROGRESS/LEARNINGS。没有页面交互变化，无需更改02/06；没有引入依赖，无需修改README技术选型。
