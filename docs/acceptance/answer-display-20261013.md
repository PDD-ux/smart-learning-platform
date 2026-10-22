# §24.8 题库答案可读性

完成：2026-10-13 21:10，桌面主仓库，仅本编号。

新增展示层formatExerciseAnswer，题库当前反馈/历史答案与练习组共用：判断题true/false大小写及首尾空白归一后显示正确/错误；单选有效字母显示“字母. 选项文本”，未知/越界/空选项保持原值，不猜含义；简答原字符串逐字保留。React继续文本转义，不解析HTML。判分提交、存储、正确性及简答文字匹配算法不变，无新API/字段/表/依赖。

## 验证

3文件21项回归、type-check、所有改动TS文件定向lint通过。覆盖类型/异常/简答原文、单选选项文字、当前反馈及历史中文显示，已有重练范围/提交保护仍通过。首轮1项测试因当前反馈和历史详情都存在相同正确答案文案而选择器不唯一失败，改为当前反馈status范围后重跑通过；没有删除历史显示或降低显示要求，tests.log与tests-final.log分别保留。

Edge真实临时账号，两道明确标注的算术测试题；练习组提交false后显示“回答正确 / 正确答案：错误”，返回题库展开该题历史，显示“你的答案：错误 / 正确答案：错误”。未重新提交历史题。PostgreSQL仅1条作答，userAnswer与Exercise.correctAnswer均仍为false，correct=true，未保存中文作为答案。

实际退出登录并关闭自己的标签，临时账号/资料/知识点/题目/作答清理，共享媒体仍在；原学习数据与.env/.env.local指纹一致，原用户工作台/视频临时笔记保留。无AI/出题/原学习者作答或摄像头操作。

证据.taskbook-working/answer-display-20261013：tests.log、tests-final.log、types.log、lint.log、ui.txt、page.png、verification.json、cleanup.json、protection.json及隔离setup/verify/cleanup入口。private.json仅被忽略目录，账号已删，凭据不公开。

复现：npx vitest run tests/unit/domain/exercise-answer-display.test.ts tests/e2e/exercise-group.test.tsx tests/e2e/question-bank-layout.test.tsx；npm run type-check。真实页面仅核对隔离判断题，单选/简答/异常为组件单测覆盖，不称所有类型真实浏览器均验；未新生产构建/全量回归/窄屏实测。

DESIGN非TODO同步显示规则，TASKS/PROGRESS记录完成；无TODO补全，不改变PRD业务范围或公开DATA契约。后续回到24.2复习指引，不批量其它编号。
