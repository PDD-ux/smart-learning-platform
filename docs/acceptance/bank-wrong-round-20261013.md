# §24.1 题库本轮错题重练

完成：2026-10-13 21:03，桌面主仓库；仅本编号，其余Phase24保持未完成。

## 参考与范围

用户明确要求借鉴学习平台，加强学习中心之外的功能。参考[Khan Academy作答后解析与自我解释](https://blog.khanacademy.org/how-should-people-practice-on-khan-academy/)、[已学技能Mastery Challenges](https://support.khanacademy.org/hc/en-us/articles/360037494231-What-are-Mastery-Challenges)及[Quizlet学习路径/进度](https://quizlet.com/blog/4-ways-to-study-for-your-next-test-with-the-learning-assistant)，提炼反馈→针对错误练习→复习的闭环，不声称这些平台具有本次同款按钮或复制它们算法/付费业务。

PRD先记录授权范围，Phase24列出题库、复习、计划、助手、图谱、工作台、账号/管理员的独立编号。学习中心不改，本轮不批量实施后续模块。

## 修改

ExercisePracticeGroup总结只在本轮有错题时提供“只重练本轮错题 · N题”。显式开启下一轮，清单仅由本轮最新成功判分的错题构造，清空答案/反馈/重做状态；保留上一轮题数/答对/答错及轮号。新轮不使用历史latestRecord当新成绩，不提前显示旧解析，不自动作答或生成题。每轮统计独立，订正100%不称首次成绩/知识掌握率，既有提交锁、判分失败保留答案与来源回看复用。

题库和助手共用该组件，助手仍按runId重挂载/退出分析。没有新增API/字段/表/依赖，不改判分/掌握度算法；页面轮次不是持久任务，离开/刷新会清空，已提交记录仍保留。

## 验证

- 2文件16项回归、type-check及改动文件lint通过；覆盖一对一错只重练错题、历史记录不参与、答案/解析不泄露、多轮范围收敛、失败保留、全对无错题按钮及既有布局/提交保护。
- Edge真实隔离账号，明确标注两道基础算术测试题。第一轮2题一对一错→总结50%→第二轮只有上一轮错题、未预选答案→真实提交正确→本轮1题100%，上一轮一对一错仍显示。没有用真实学生题目代本人作答。
- PostgreSQL恰好两题/3条ExerciseRecord，其中错题保留false→true两条，原始错误记录未覆盖，另一题只有一次。打开新轮没有新判分请求/出题/AI调用；数据结果和界面一致。截图呈现第二轮订正后的题目/解析，未呈现总结；最终总结完整文字在ui.txt，非原学习账号成绩。
- 真实退出并关闭隔离标签，临时账号/资料/知识点/题目/记录清理，共享媒体保留；原学习数据及.env/.env.local指纹一致。用户原视频页/草稿/工作台保留。

证据：.taskbook-working/bank-wrong-round-20261013中的tests.log、types.log、lint.log、verification.json、ui.txt、page.png、cleanup.json、protection.json及隔离setup/verify/cleanup入口。private.json仅忽略目录且账号已删除，不公开凭据。

复现：npx vitest run tests/e2e/exercise-group.test.tsx tests/e2e/question-bank-layout.test.tsx；npm run type-check；npx next lint --file src/components/review/ExercisePracticeGroup.tsx --file tests/e2e/exercise-group.test.tsx。真实UI使用临时账号的测试题，不操作原学习者。

没有重跑全量/生产构建，助手中共用入口与窄屏本轮未独立实测；没有证明教学效果/语义判分改进，原简答文字匹配限制保留。PRD/DESIGN/ARCH/VISUAL非TODO同步边界，TASKS/PROGRESS新增编号/结果；无TODO补全，DATA公开契约不变。其它Phase24模块仍待逐项处理。

页面还观察到既有判断题解析直接显示true/false，不够友好；单独列24.8后续，不在本轮顺手改答案格式。
