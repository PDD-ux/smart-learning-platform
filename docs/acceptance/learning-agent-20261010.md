# §21.1 学习Agent闭环验收（2026-10-10）

执行仓库：`C:\Users\qwh76\Desktop\智能学习平台`。本轮仅§21.1，由用户明确提出“做一个比较强的agent”授权，先补PRD与编号任务，再实现；不训练模型、不新增依赖/数据库表、不部署网站。

## 实际能力

在`/assistant`选择本人已就绪且理解完成的资料，默认学习Agent模式；设置5–120分钟，输入复习目标。运行时重新读取真实学习状态，模型自主选择原文检索/已有练习挑选，生成带真实定位的回答和方案。显示实际执行工具摘要，可信学习状态在回答前独立展示；0分与未知分开。

推荐题进入既有练习组，本人提交才判分。返回助手预填重新分析目标，发送后读取新记录再调整建议。计划预览由本人确认才通过原接口保存目标/分钟/时间/提醒，详细步骤和聊天只保留本页；刷新、换资料或换模式会清空。失败保留问题，保存状态不确定时先核对已有计划，不自动重放。

## 验证结果

- 22:10：8文件60项相关回归、`npm run type-check`、定向ESLint均通过，最终输出留在`.taskbook-working/learning-agent-20261010/checks-verified.json`（先前57/58/60项结果保留）。覆盖匿名/归属/限流、原文/题目/知识点编号、预算/迭代/超时、无隐藏答案、真实0/未知、虚构完成时长拦截、练习说明与实际知识点明显冲突、缺必需方案、旧摘要不进入最终原文分析、失败草稿/互斥/范围切换、练习反馈及计划显式保存/结果核对。没有运行会覆盖开发`.next`的生产构建。
- 原30分钟课程真实API：`owner-result.json`与`report.json`记录HTTP200，5知识点/最近0次作答/5张到期卡/暂无掌握记录；检索8段原文，最终5引用、3题、16分钟方案。匿名401、其它用户即使admin也403。18:40原始成功证明保留，不作为全部后续代码的单独验收。
- 最终状态修正后真实隔离闭环：`feedback-state-final/initial.json`200；真实选择B得到判错200；`after-answer.json`200并读取最近1次作答，实际链式法则0%、未知0，回答正确使用0%并调整复习方案；已有计划POST200，实际落库1条。`cleanup.json`确认本轮临时账号及级联数据已删除。只创建测试数据库内容，没有上传或删除原媒体。
- `feedback-state-final/report.json`中原演示保护指纹前后均为`25a11bd584b85c8d9ef2eb82f2113a450c35df116d28456b649f01f5f437801a`；包括XP、资料标题/状态、个人笔记、掌握度、作答记录和计划，不包含浏览器正常进度元数据。脚本elapsed只记录原账号阶段，不冒充隔离闭环总耗时。
- 本人登录浏览器：真实原课程回答、可信未知状态、20分钟方案、3道已有题可见；真实练习从第1到第2仍0/3，没有选择/提交答案；返回预填分析目标，没有自动调用。1440px与768px下记录等宽，无横向溢出；引用与工具浅蓝底颜色已修正。手机最终核对见下方追记。

历史复杂格式失败、重复状态、硬编码题号、真假掌握状态问题及修正前错误回答分别保留于`diagnostic.json`、`feedback-final`、`feedback-verified`、`feedback-final-run`、`feedback-format-fixed`、`feedback-state-verified`，不能将旧HTTP200中的矛盾回答改写为语义通过。失败轮的临时清理证据仍保留。

手机首次请求13:59 UTC返回UPSTREAM_ERROR/503，错误提示与草稿保留，`agent-mobile-failure.jpg`记录布局；一次手动重试成功，但人工核对发现文字列举了未实际推荐的知识点。最终补上真实推荐题名/题干列表、提示不在回答编写题目清单，并对常见完整知识点名称冲突做有限校验；该旧回答不算语义通过。实际题目始终来自服务端白名单，未对本人作答。

后续综合请求返回SCHEMA_INVALID/503，独立`final-diagnostic/diagnostic.json`记录两次方案超过时间预算及保护记录不变。没有放宽预算。单难点请求曾200但plan=null；补上显式方案请求必须非空校验，并从最终分析输入移除旧摘要。错误输出与成功输出分别保留，不能将这两轮算作完整方案成功。

22:12收尾：最终完整隔离闭环再次通过，文件为`feedback-complete-final/{initial,after-answer,isolated-feedback,report,cleanup}.json`，初始/反馈/计划均200，1次错题及0%状态正确读取，保护指纹同上且removed=true。此后仅调整预算纠正提示以显示实际总数、建议1–3步，60项回归/TS/ESLint复验通过。

最终本人浏览器请求第七题原文/已有练习/≤20分钟方案成功：3步实际工具、4个真实定位/摘录、实际第七题1题、2步各8分钟共16分钟。标题中的20分钟属于目标预算，实际计划总分钟由服务端合计显示16，不是完成时长。仍有无关关键词片段（例如全文分析），因此只证明定位、工具与方案链路可用，不把课程解释认定为全面语义通过。`agent-final-ui.txt`保存真实DOM，`agent-final-answer.jpg`/`agent-final-wide.jpg`/`agent-final-narrow.jpg`/`agent-final-mobile.jpg`为最终截图。

1440px布局clientWidth/scrollWidth=1432/1432，768px=760/760，390px=382/382且侧栏64px；未出现横向溢出。手机真实练习按钮可进入第1题0/3、未选择/提交答案，原3题组也完成切第2题/返回预填核对。最终保留助手回答，清空仅验收生成的未提交草稿，临时视口已reset；本人原标签保留，不代输凭据。两次会话过期均由本人重新登录，自动续期未在本轮实现。

## 实现文件与边界

`src/lib/agent/{contracts,tools,learning-agent}.ts`定义严格公开入参、受控工具和有界循环；`src/app/api/assistant/agent/route.ts`鉴权、归属、限流和通用503；`src/services/api.ts`集中请求（100秒客户端上限）。`src/app/assistant/page.tsx`与`src/components/assistant/AgentActions.tsx`展示回答、计划及内嵌练习；`ExercisePracticeGroup.tsx`仅增加可选退出文案。`AppShell.tsx`增加默认关闭的compactNavigation，助手≤640px启用64px图标栏，入口保留可访问名称；`globals.css`的范围样式仅在该属性开启时生效。

状态最多30知识点/最近50作答；检索使用中文双字与英文词匹配、可选知识点窗口，每类候选2000条、每次8段；选题从最多50题中按最近答错/未作答优先，最终最多5题。三轮模型决策加一次最终生成，每轮最多两次格式尝试，总90秒；相同参数重复/必要工具未执行/未知编号/超预算拒绝。中文关键词约束与常见矛盾规则有限，不保证任意语言意图或全面语义准确。

ASR/OCR原文可能有噪声，关键词结果可能无关或不足；有真实定位不等于已证明回答全部有语义支持或覆盖整课。没有学习时长计量，不把分钟预算当实际完成。模型仍可能超时、上游故障或格式错误，页面明确失败，不伪造降级建议。本轮未验收训练、全课语义质量、长期模型稳定性、自动会话续期、网站公网部署或新导入Ascend流程。

## 复现

在桌面主仓库启动既有本地数据库和`npm run dev -- -H 127.0.0.1`，使用已有环境中的真实Spark配置（密钥只在本机环境中）。用户正常登录后打开`http://localhost:3000/assistant`，选择30分钟课程，可问：“我有20分钟，请检索课程原文，选3道已有练习，再给我一个复习方案。请依据真实学习记录说明目前的掌握状态。”

```powershell
npx vitest run tests/unit/agent/tools.test.ts tests/unit/agent/learning-agent.test.ts tests/unit/api/learning-agent.test.ts tests/e2e/assistant.test.tsx tests/e2e/exercise-group.test.tsx tests/unit/api/ai-qa.test.ts tests/unit/api/study-plans-bank.test.ts tests/e2e/app-shell-states.test.tsx
npm run type-check
npx eslint src/lib/agent src/app/api/assistant/agent/route.ts src/services/api.ts src/components/assistant/AgentActions.tsx src/app/assistant/page.tsx src/components/app/AppShell.tsx src/components/review/ExercisePracticeGroup.tsx scripts/acceptance/learning-agent.ts tests/unit/agent tests/unit/api/learning-agent.test.ts tests/e2e/assistant.test.tsx
npx tsx scripts/acceptance/learning-agent.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/learning-agent-new-readonly readonly
npx tsx scripts/acceptance/learning-agent.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/learning-agent-new-feedback feedback
```

每次使用新结果目录避免覆盖旧证据。readonly调用真实模型但不写学习数据；feedback在自己创建的隔离账号中调用真实模型、提交错题并保存计划，finally只删除该账号，保留原数据。异常中断时先按fixture/cleanup证据核对临时账号，不批量删除其它用户。内部签名令牌仅进程中用于本机API验收，不向浏览器注入、不打印凭据；这些脚本验收不代替本人登录。

无新依赖，README技术选型不变；PRD/DESIGN/ARCHITECTURE/DATA-MODEL同步新增Agent与实际契约，TASKS/PROGRESS记录§21.1，LEARNINGS记录真实踩坑。没有补TODO，修改的是用户授权新增能力及旧助手的非TODO说明。
