# §20.2 连续练习与结果总结验收

完成时间：2026-10-10 15:54（Asia/Shanghai）。用户确认七项完善后，依据AGENTS每次一个编号任务，本轮仅完成§20.2。其余六项列为§20.3–20.8，保持未完成。

## 行为

题库“开始本页练习”固定当前筛选页的题目，支持上一题、下一题和每题草稿。判断题使用正确/错误按钮，简答保留文本输入，单选保留选项。该组最多为当前题库的一页，不假定全库题目已加载。

本组进度仅来自本次成功判分，历史记录不计入，也不提前展示答案或来源摘要。成功后沿用已有判分与来源回看；失败保留输入，判分中禁用切题、退出及重复提交，不自动重试。全部题目成功判分且没有正在重做的题，才可查看总结。

总结显示唯一题数、答对/答错、正确率和按知识点归并的错题数量；可回到该点首道错题核对。重做仅替换该题最新成功结果，失败不覆盖前次成功结果，编辑期间不能结束。返回题库刷新原筛选，已空末页回到有效页。刷新或退出会清空客户端分组草稿和总结，已提交的服务端记录保留。

不新增数据库表、公开接口、依赖或模型调用。改动：question-bank页面、ExercisePracticeGroup、共享ExerciseAnswerInput、测试及规格/进度文档。PRD/DESIGN/TASKS修改为非TODO范围和交互补充，无TODO补全。

## 验证与限制

- 新增6项交互测试覆盖：冻结筛选且不计历史成绩、判断答案传值、重做不重复计数、跳题草稿保留、失败和请求互斥、简答及0%总结、返回空末页收敛。相关3文件19项测试全部通过。
- TypeScript严格检查、全部本轮TS/TSX改动ESLint通过。保留正在运行的Next开发输出，未执行覆盖.next的构建。
- 真实HTTP/PostgreSQL只读验收：30分钟演示资料5题，关联有效来源数3/3/3/4/4，匿名理解读取401。无模型调用、数据库写入、代本人评分或新账号；脱敏结果见同名JSON。
- 临时浏览器页访问题库后跳登录，未继续输入账号信息或操作用户原页面，临时页关闭。因此没有将组件中的模拟判分声明为本人浏览器真实判分验收。
- 正确率为本组每题最新成功判分的结果，不是全站累计或AI语义质量评分；简答仍按既有规范化字符串判分。当前云端稳定性和生产部署未在本任务验收。

复现命令（桌面主仓库）：

```powershell
npx vitest run tests/e2e/exercise-group.test.tsx tests/e2e/plans-bank.test.tsx tests/e2e/exercise-source.test.tsx
npx tsc --noEmit
npx eslint src/components/review/ExercisePracticeGroup.tsx src/components/review/ExerciseAnswerInput.tsx src/app/question-bank/page.tsx tests/e2e/exercise-group.test.tsx
npx tsx scripts/acceptance/exercise-sources.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/exercise-group-20261010/read-only.json
```

本人登录后的展示：题库选择资料，点击“开始本页练习 · 5题”，逐题提交；尝试前后题切换、重做，再查看本组总结和错题来源。既有保存题目与判分、来源回看不调用生成模型，展示已有题目无需开启云端推理；重新生成题目仍需要对应AI服务。
