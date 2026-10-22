# §22.14 AI选择题选项质量修复

完成：2026-10-12 18:19（上海）。只处理B02现有题库生成质量，不修改历史题目、作答或其他业务模块。

## 修复

- 生成schema拒绝仅A-F、全角/括号编号、字母A/选项A等编号包装及明确占位词。NFKC、空白与编号前缀规范化后重复的选项也拒绝。数字、数学符号、x/y变量、A型血等实际内容仍允许。
- 不从解析猜测/补造选项，不根据解析改答案。正确答案仍须精确匹配选项；若解析显式声称某选项正确/错误，必须与选项顺序和答案一致，覆盖字母及中文/数字编号。避免把“答案为B型血”的实际内容误认为B编号。
- 保留extractJson两次校验纠正，向模型传递具体选项错误；耗尽返回AI_UNAVAILABLE/503并明确“本批题目未保存”。所有题都验证通过才提交事务，后一题失败也不能保存前面一题。
- 星火Lite连续输出编号包装或矛盾解析，真实失败保留。现有网关新增题库显式EXERCISE_MODEL_PROVIDER=spark|aliyun，默认spark；本机忽略.env.local配置aliyun，沿用已接入qwen3.5-plus及既有百炼额度确认门禁。不切换其他AI模块，不自动fallback，不新增SDK或修改额度确认。

## 实际验证与失败

.taskbook-working/exercise-options-20261012中：

1. real-generation.json：初次门禁只拒绝A/B，模型包装成字母A/B，结构200但业务仍失败，2题中1题无有效内容。不是成功验收。
2. real-generation-final.json：补编号包装后真实503，0题落库，临时清理完成。
3. real-generation-3.json：2题选项有内容，但一题真实正确答案第1项、解析说D正确/A错误，不能当整体质量通过；继续补显式编号一致校验。
4. real-generation-4.json：补一致门禁后星火503，0题落库，临时清理完成。
5. real-generation-aliyun.json：题库显式切已接入千问后真实200/10729ms，2题选项完整、答案在选项内，手工核对链式法则和sin(x²)导数数学结论正确，解析不再与答案编号冲突。临时题目/资料/账号已清理，没有加入原学习者题库。

最后样本只证明这2道题的选项与答案/解析一致，不是整体语义准确率或对所有来源的忠实度保证。第二题为模型自设sin(x²)应用示例，涉及基础sin导数，并非人工资料原句；严守仅原文事实的出题覆盖/语义审查仍需后续评估，不能冒充全面完成。

45项相关回归通过（mastery-exercises、exercise-group、exercise-source），TS/ESLint通过。回归使用真实extractJson逻辑+隔离fetch响应验证坏→好重试，以及后批两次失败整批不落库；没有外部API/原用户写入。初次测试发现Zod union掩盖选项错误，仅返回Invalid input，已传递具体选项错误；新增显式编号核验的TS数组类型错误已修复。最终没有放宽门禁以换取成功。

原有题库只读核对5道单选、0道编号占位题；原题与作答不改。所有本轮system-exercise临时账号清理，.env.local仍忽略，除EXERCISE_MODEL_PROVIDER外凭据保留。

## 文件与边界

业务改动src/app/api/exercises/generate/route.ts；回归tests/unit/api/mastery-exercises.test.ts；配置示例.env.example、README/DEPLOY、ARCH/DATA/DESIGN、TASKS/PROGRESS/LEARNINGS同步，无新增依赖/表/公开字段。

无TODO补全，非TODO修改为现有题库质量门禁、错误提示、显式模型配置和真实结果。其他缺陷（长PDF覆盖、ASR预检、失败上传残留、standalone资产、人脸/视觉环境）未在本编号修改。

复现：
```powershell
npx vitest run tests/unit/api/mastery-exercises.test.ts tests/e2e/exercise-group.test.tsx tests/e2e/exercise-source.test.tsx
npx tsc --noEmit
```
真实隔离入口real-generation-aliyun.ts保留在上述忽略目录；重新运行时须另设结果路径避免覆盖证据，百炼调用继续受既有额度确认限制，不能无界循环。
