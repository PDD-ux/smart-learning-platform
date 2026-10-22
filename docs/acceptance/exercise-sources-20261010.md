# §20.1 错题知识点与来源回看验收

完成时间：2026-10-10 15:27（Asia/Shanghai）。用户确认三项加强后，按AGENTS一次一个编号任务，仅实现第一项。

## 实现与边界

题库选择本人已作答题，或本次提交得到判分结果后，显示关联知识点标题、摘要与来源链接。错题显示“知识点补强”，答对显示“知识点与来源”；未作答不提前显示摘要提示。只读取既有资料详情、理解产物，不调用模型。

引用必须属于题目的pointId和contentId；定位通过ContentRef类型/范围校验，并匹配当前非空转写的起始整数秒或文本块定位。视频按时间去重，文档同页合并；链接复用学习页?t=/ ?page=，视频定位后暂停，不推断整段语义范围。缺引用、知识点被替换、尚未就绪和读取失败均有明确状态；失败单独重试，切题忽略旧请求。

数据库和公开接口不变。改动为question-bank页面、新ExerciseSourcePanel组件和exercise-source领域函数；规格更新PRD/DESIGN/TASKS，进度记PROGRESS。没有新增依赖或修补未知引用。

## 验证

- 6文件44项相关测试通过：10项新增覆盖错题来源、未作答无提示、迟到请求、重试、缺引用、知识点替换、资料不一致、文档/未就绪及定位依据边界；其余回归既有题库与判分规则。
- TypeScript严格检查和所有本轮改动TS/TSX文件ESLint通过。
- 真实本地HTTP/PostgreSQL只读验证：30分钟资料题库5题，关联点均有摘要与真实来源，每题有效定位数3/3/3/4/4，匿名理解读取401；无模型调用、数据库写入或临时账号。脱敏证据见同名JSON。
- 实际浏览器题库显示5题，选中未作答题时只有选项和提交按钮，无答案/来源提示。没有代本人作答；即时判分后的新增面板交互由页面测试覆盖，未把它标为本人浏览器判分通过。

复现：在桌面主仓库启动本地网页后运行：

```powershell
npx tsx scripts/acceptance/exercise-sources.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/exercise-source-verification.json
npx vitest run tests/unit/domain/exercise-source.test.ts tests/e2e/exercise-source.test.tsx tests/e2e/plans-bank.test.tsx tests/unit/domain/study-location.test.ts tests/unit/api/study-plans-bank.test.ts tests/unit/api/mastery-exercises.test.ts
npx tsc --noEmit
```

现场展示：在题库选定资料，作答一道题；结果下查看知识点，点击“回看视频”或“查看原文”，核对来源；历史答错题可从“曾经答错”筛选进入。当前5题仍未作答，因此未人为填充错题记录。

§20.2练习总结、§20.3今日任务继续待办。本入口不验收云端推理、AI题目语义正确率或生产部署。
