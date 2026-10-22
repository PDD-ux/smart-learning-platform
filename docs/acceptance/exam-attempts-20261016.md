# §27.6 整卷答题、草稿续答、计时交卷与评分验收

2026-10-16，桌面主仓库。本编号在27.5只读开考基础上实现逐题草稿保存/续答、服务端期限校验、幂等提交与客观评分；主观题留待批阅，详细解析/错题/人工批阅与AI生成留27.7以后。

## 实现范围

- PUT /api/exam-attempts/:id/answers：仅本人、IN_PROGRESS且数据库时钟未过期限可保存；按已封卷题型校验（单选合法key/null、多选无重合法key数组、判断布尔/null、主观<=10000字文本/null），空串/空数组为未答；严格拒绝未知字段、客户端分值/答案/身份/期限注入。逐题保存成功才回显已保存，失败保留本页输入；刷新只恢复服务器确认过的草稿，多标签版本冲突明确重新核对，不自动覆盖。
- POST .../submit：仅expectedRevision/requestId，不接受答案或客户端分数；本人答卷行锁→审计幂等→版本校验→提交与评分同事务。到期仍允许提交已保存内容但不补写；页面到期只尝试一次自动提交，失败给明确手动重试，无定时循环。不自动后台评分，再打开可确认提交；数据库期限始终限制改答。
- 评分仅用已封卷body与scoreUnits：单选/判断正确满分否则0；多选集合完全相等满分，漏选/错选/多选0，不计部分分；未答客观0；主观题（含未答）满分计pendingScoreUnits，不冒充0分。有主观题→PENDING_REVIEW且finalScoreUnits=null；全客观→GRADED且pending=0、final=objective。聚合gradeSummary仅交卷后白名单提供客观/待批/最终与submittedAt，正确答案/逐题分/解析/rubric仍不下发。
- 审计复用exam-write前缀、本人+答卷+requestId唯一摘要；同键异内容409，并发由答卷锁串行、expectedRevision冲突409；保存幂等返回原确认，提交幂等不重复计分/发奖。本阶段不发XP、不写旧练习/掌握记录。
- 前端ExamAttemptWorkspace：答题卡（已答/未答/未保存/标记）、逐题草稿保存与清空、服务端倒计时（客户端仅显示）、交卷前展示未答数并要求先保存或放弃本页草稿、刷新恢复固定顺序、离开未保存提示。提交后展示客观分/待批分与最终分区分。无新依赖/表/迁移/模型请求，不改原私人资料、历史题或成绩。

## 验证证据

1. `npx vitest run tests/unit/exams tests/unit/architecture/p0-contract.test.ts`：53项针对回归通过；attempt-scoring 10项覆盖单选/多选/判断/主观评分与未答0、多选题集合相等、主观返回null；student-pages 7项覆盖答题卡/保存/交卷/刷新续答与未保存提示。
2. `node scripts/acceptance/exam-students.cjs --answering`：随机临时PostgreSQL执行15迁移，85项真实NextRequest路由检查通过（含27.5的44项与27.6的41项）。27.6专项含：匿名/他人/管理员写本人答案404/401、保存拒绝分值/答案/身份/期限注入、单选题型外键与非法值400、过期revision冲突409、陌生题项400、同键改答案409、并发草稿只成一稿且revision=2、多选题去重/合法集合持久化、判断题布尔、主观文本保存不评分、重载恢复4条确认草稿且无答案无分、提交拒绝注入finalScore、提交stale revision 409、原子客观评分+主观待批(PENDING_REVIEW, 客观200/待批100/final null)、重复提交精确重放不二次评分、新提交请求不得二次计分409、提交后保存409、早期保存重放保持原确认、本人提交后读仅聚合、过期草稿写拒绝409、过期仅保存提交不回填答案(客观0/待批100)、全客观卷最终GRADED(final=objective)、并发相同提交一致、无ExamGradeRecord/ExerciseRecord。所有成功DTO递归检查correctOptionKeys/correctBoolean/referenceAnswer/rubric/explanation/LEAK-/requestDigest不泄露。
3. 全量`npm run type-check`、`npm run lint`、`npm test`通过；最终隔离生产构建通过（run-1792134094024 同次 harness 已含 build 前的 routes 检查；生产构建另行执行并复核）。临时账号/数据库/服务全部清理，原生产登录/Cookie/私人权限/运行资产与两env指纹不变。
4. 原始资产指纹保护：harness 在创建临时库前后对主库44物理表行数/哈希、.env/.env.local及uploads媒体做指纹比对，result.originalAssetsUnchanged=true，主库未加入样题、未发布假卷、未创建真人答卷。

路径：`.taskbook-working/exam-attempts-20261016/run-1792134094024/`（checks.json、before.json/after.json、migration.log/routes.log）；`latest.json` 指向该 run。

## 尚未完成

27.7成绩/错题/来源回看与必要人工批阅（GET .../result按本人返回解析与待批状态、POST /api/admin/exam-attempts/:id/grades限定所管理正式卷），27.8/27.9 AI自主整卷后台与页面、27.10 PDF/Word导入、27.11多学科最终演练仍未实施。本轮只有自编隔离卷，真实题源授权/最新适用性/逐题教育质量未验；旧五题质量失败和开发依赖上游告警不核销，不能称整项目或完整考试无问题。原生浏览器宽窄屏答题卡/交卷交互尚未单独人工核对。

本轮先落17契约再编码，PRD/02/03/04/06/16/17及05/PROGRESS同步非TODO接口/交互/状态（17已注明27.6客观评分已实现、主观待批）。无新依赖，README技术选型不改。
