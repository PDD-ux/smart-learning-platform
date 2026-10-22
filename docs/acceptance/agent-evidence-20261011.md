# §21.3 学习Agent证据模式验收（2026-10-11 14:08）

20:47最新状态见[有界思考验收](agent-review-thinking-20261011.md)：真实回放、完整解释与本人页面人工核对已通过，当前本地演练两审查开关true，§21.3主项完成；语义两次拒绝仍退回本页证据模式。以下关闭状态、未完成项及evidence专用命令记录14:08时点，需关闭解释才能复现该专用预期，不代表当前开关。

执行仓库：`C:\Users\qwh76\Desktop\智能学习平台`。仅续做§21.3，解决未可靠核验的解释阻断学习演示的问题。当前Agent仍选择aliyun，AGENT_REVIEW_READY=false；密钥及额度配置未改动，无新模型、训练、依赖、表或写工具。

## 实现与边界

- 新增`src/lib/agent/evidence-answer.ts`，只接受真实工具状态、可信学习摘要、预算和是否请求计划，不接收模型候选解释。最多5处连续原文摘录，只折叠空白，不修复转写口误；来源和练习来自当前本人资料。没有原文/练习时明确说明，不补造。
- `learning-agent.ts`仍运行最多3轮受控模型工具决策。开关关闭且目标涉及原文时，跳过最终解释生成/独立审查，返回明确标注的证据模式；已开放的解释连续两次语义拒绝后也丢弃两版候选及计划，改用此模式。权限、配置、工具、内容安全、格式与总超时故障继续拒绝，不能用降级掩盖服务不可用。
- 请求方案时后端分配5–120分钟预算：有实际练习时回看/自行练习/整理疑问，无题时不安排虚构作答。方案只是预览，用户点击后才使用原计划接口保存。未作答不显示答案或解析，无自动掌握/XP/笔记/进度写入。
- 公开AgentResult与既有页面布局保持，仅回答中说明解释暂未通过核验。未加入课程专用答案或专业术语替换。证据模式可用不代表自由解释或独立审查模型已经可靠。

## 真实接口和页面

资料：`cmuqhyf7h00027q29tijy4uer`（阿里木江7.10-前30分钟）。以下证据保留在被忽略的`.taskbook-working`新目录，历史失败不覆盖。

1. `agent-evidence-20261011-web-1`：13:59实际网页接口200，匿名401、跨用户管理员403；真实535秒来源、1道已有题及20分钟方案。模型调用仅用于工具决策，不生成最终解释。`semanticReviewRequired=true`是该旧完整请求入口的通用报告字段，不能理解为本次运行了语义审查。
2. `agent-evidence-20261011-guard-1`：14:01新增显式`evidence`验收模式通过（guardPassed=true）。核对证据模式提示、连续原文子串/引用定位、实际题目归属及正整数20分钟预算；HTTP200/401/403均符合预期。replayPassed=false仅表示本次不是模型回放模式，不能改写为生成式质量通过。
3. `agent-evidence-20261011-page-1`：本人已登录的真实助手选择此资料，发送“我有20分钟，请检索第七题的原文依据，挑选该知识点已有练习，给出复习方案。转写不清楚的地方请保留原文。”页面展示真实5知识点/最近0次作答/5张到期卡/无掌握记录，证据模式说明、原文摘录及8:55来源、3个真实工具、1道实际练习、8＋8＋4分钟安排。点击开始针对练习后显示第1/1题、本组已答0/1、答案隐藏；未选择或提交，随后返回助手，没有发送预填的重读目标。
4. `agent-evidence-20261011-after-page`：14:03只读重查（modelCalled=false），上述页面访问后学习数据仍未改变。

接口前后及页面访问后的十类保护指纹均为：

`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`

范围为XP、资料标题/状态、个人笔记、掌握度、作答记录、计划、自动笔记、知识点、ASR和OCR；该指纹不包含播放器缓存进度。未提交答案、保存计划、调用学习页播放器或重跑解析。

截图与DOM：`agent-evidence-20261011-page-1/evidence-mode.jpg`、`plan-and-practice.jpg`、`practice-unanswered.jpg`、`response-dom.txt`。

## 代码验证与复现

14:03最终14文件149项相关回归通过，TypeScript strict与定向ESLint通过。覆盖真实0与未知、来源连续性/最多5处、无来源/无题、5/7/20/120分钟预算、丢弃错误候选、配置不绕过、权限、超时及内容安全。模拟覆盖“已开放模型两次拒绝后降级”，本轮真实网页保持开关关闭，没有再打开未经稳定验收的解释。

在桌面主仓库、现有本地网页运行且本人配置有效时执行；使用全新的证据目录。以下model/evidence请求会消耗工具决策模型额度，但不写学习数据：

```powershell
npx tsx scripts/acceptance/agent-retrieval.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-evidence-new-api model
npx tsx scripts/acceptance/agent-faithfulness.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-evidence-new-check evidence
npx tsx scripts/acceptance/agent-retrieval.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-evidence-new-readonly
```

历史`guard`模式检查旧“核验关闭即503”，不适用于当前证据模式。不要为运行旧guard而开启模型解释或改动真实配置。

```powershell
npx vitest run tests/unit/agent tests/unit/ai/agent-provider.test.ts tests/unit/ai/extract-json.test.ts tests/unit/api/learning-agent.test.ts tests/e2e/assistant.test.tsx tests/e2e/exercise-group.test.tsx tests/unit/api/ai-qa.test.ts tests/unit/api/study-plans-bank.test.ts tests/e2e/app-shell-states.test.tsx
npm run type-check
npx eslint src/lib/agent/learning-agent.ts src/lib/agent/evidence-answer.ts scripts/acceptance/agent-faithfulness.ts tests/unit/agent/learning-agent.test.ts tests/unit/agent/evidence-answer.test.ts
```

## 剩余问题与文档同步

证据模式子工作完成，可以演示原文检索、已有练习及安排预览。§21.3主项仍保持未完成：非思考千问的自由解释/独立审查仍有已保存的语义漏检，未通过稳定错误样本、完整解释正例及真实页面核验。它需要继续同一编号的模型质量验收，不能以本次200、引用合法或149项回归宣称已解决。

同步DESIGN、ARCHITECTURE、DATA-MODEL、TASKS、README、PROGRESS及LEARNINGS的非TODO内容，使当前降级行为、历史失败和剩余项一致；没有TODO补全或增加下一任务。
