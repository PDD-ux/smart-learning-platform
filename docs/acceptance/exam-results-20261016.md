# §27.7 成绩、错题、来源回看与必要人工批阅验收

2026-10-16，桌面主仓库。本编号在 27.6 客观评分/主观待批的基础上补齐交卷后的成绩回看（本人答卷快照上的解析与错题）与管理员人工批阅通路；AI 自主整卷仍留 27.8/27.9。

## 实现范围

- `GET /api/exam-attempts/:id/result`（`attemptResult`）：仅本人、且答卷已非 IN_PROGRESS 可读（未交卷 409，他人/管理员跨人 404）。返回 `{ 答卷基础字段, gradeSummary, typeStats[], questions[], wrongCount, sourceReview[] }`，questions 逐题给出本人作答、已封卷正确答案、解析、客观正确/得分、主观 pending 与批阅评语、错题标记与来源摘要。来源只投影 `kind/name/sourceYear/edition`，不下发题源 url/授权说明/checkedAt；学员侧不下发 rubric 与 requestDigest。
- 前端 `ExamAttemptResult` 页面 `/exam-attempts/[id]/result`：总分概况（客观/待批/最终，最终待批明确为待定）、题型统计、来源回看、逐题解析与错题整卡高亮、主观题待批提示与批阅后得分/评语；答卷页新增“查看成绩、解析与错题 →”入口。
- 新增 `src/lib/exams/grading-service.ts`：`GET /api/admin/exam-attempts/:id` 仅管理员（非管理员 403），且只开放 `PUBLIC + PUBLISHED` 正式卷上 `referenceOnly = false` 的答卷，揭示主观作答、参考答案、rubric 与当前分数；私人 AI 练习答卷 404。
- `POST /api/admin/exam-attempts/:id/grades`：严格 `{ expectedRevision, requestId, grades[{ paperItemId, scoreUnits, feedback }] }`，`z.strict()` 拒绝未知字段与分值/答案/评分人注入；只能批阅主观题，非本卷题/客观题/超满分/无作答 400；版本冲突或已评定最终成绩 409；非管理员 403；私人 AI 卷 404。每次批阅写 `ExamGradeRecord` 留痕（同 requestId 幂等不重复写入），重算 pendingScoreUnits/finalScoreUnits 并在无待批时转 GRADED。
- 关键约束发现：`prisma/migrations/20261016050000_exam_foundation` 的 `exam_attempt_guard` 规定 `OLD.state='GRADED'` 时答卷行不可再变更（final exam score is immutable）。因此批阅只能在待批阅阶段反复留痕，最终成绩一经评定即冻结；服务层已显式以 409 拒绝，避免落到数据库触发器产生 500。
- 前端统一经 `src/services/exam-grading.ts`，两条管理路由与一条学员路由均为 `sharedRoute` 薄路由（no-store）。无新依赖/新表/新迁移，不发 XP、不写旧练习或掌握度记录。

## 验证证据

1. `npx vitest run`：全量 162 文件 1263 项通过；`tests/unit/exams` 54 项含新增的批阅入参边界（UUID 幂等键、revision 范围、grades 1–200、分值 0–1000000、feedback ≤10000、严格拒绝 correct/correctAnswer/finalScoreUnits/graderId/gradedAt 等注入）。
2. `node scripts/acceptance/exam-students.cjs --answering`：随机临时 PostgreSQL 执行迁移，97 项真实 NextRequest + 真实数据库检查通过（27.5 的 44 项 + 27.6 的 41 项 + 27.7 的 12 项）。27.7 专项含：交卷后本人成绩揭示 LEAK-EXPLANATION 且不泄露 rubric/题源 url/授权说明/requestDigest、主观题 pending 且 correct=null、wrongCount≥1、题型统计与来源回看存在、他人与管理员跨人 404、未交卷 409、管理员读卷含 LEAK-RUBRIC 且不泄露 url/授权说明、批阅主观题留痕并算出 final=280、同 requestId 幂等不重复留痕、最终成绩冻结后再次批阅 409 且历史记录与 final=280 不变、客观题批阅 400、非管理员 403、私人 AI 练习答卷（AI_MOCK 私有卷）管理员不可读 404 且不可批阅 404。
3. `npm run type-check`、`npx eslint` 对新增源码通过；最终隔离生产构建通过，路由清单包含 `/exam-attempts/[id]/result` 与 `/admin/exam-attempts/[id]`。临时库/账号清理，harness 报告 `originalAssetsUnchanged=true`（主库 44 物理表、.env 指纹与 uploads 媒体一致）。
4. 同步修改：`tests/unit/architecture/p0-contract.test.ts` 的路由守卫正则加入 `admin/exam-attempts`（该目录同样经 `sharedRoute` 单一鉴权与 no-store 适配器），否则新管理路由会被误判为缺少 `@/lib/api/response`。

路径：`.taskbook-working/exam-attempts-20261016/run-1792142827051/`、`run-1792143021470/`、`run-179214*` 后续成功 run（checks.json、before.json/after.json、migration.log/routes.log）。

## 尚未完成

27.8/27.9 AI 自主组卷后台与页面、27.10 PDF/Word 导入、27.11 多学科最终演练仍未实施。本轮仍为自编隔离卷，真实题源授权/最新适用性/逐题教育质量未验；不虚构知识点掌握度，不混入旧练习记录重复统计。旧五题质量失败与开发依赖上游告警不核销，不能称整项目或完整考试无问题。原生浏览器宽窄屏的成绩页/管理批阅页交互尚未单独人工核对。

本轮先核对 17 实施契约再编码，spec/02、spec/04、spec/17 与 05/PROGRESS 已同步 27.7 的接口、交互与状态。无新依赖，README 技术选型不改。
