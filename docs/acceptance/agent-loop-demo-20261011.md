# §10.4 本地Agent练习与计划闭环续验（2026-10-11）

执行仓库：`C:\Users\qwh76\Desktop\智能学习平台`。用户“下一步”后，仅续做§10.4现有本地答辩闭环；§21.3保持上一轮验收，不新增模块、AI训练、依赖、数据字段、接口或云端部署。本轮模型沿用已配置百炼Agent，不改供应商/密钥/额度开关。

## 实际结果与发现

- 20:52只读原30分钟资料检查：`.taskbook-working/agent-feedback-20261011-before-1/report.json`，真实535秒检索及十类保护指纹通过，modelCalled=false。
- 20:53–20:54现有`learning-agent.ts feedback`真实HTTP隔离复验：只在脚本新建的测试账号/合成链式法则资料下运行。初始Agent 200，真实10秒原文、已有1题、10分钟3+5+2安排；无作答时明确暂无掌握记录。脚本选择B由原answer接口判错200；第二次Agent 200重新读到1次作答、链式法则0%、未知0项，回答区分真实0与无记录并调整为3+7分钟。方案POST 200、实际落库1条。匿名401、跨用户admin403，原账号六类保护指纹不变；fixture及cleanup证明仅该临时账号级联清理。文件在`agent-feedback-20261011-flow-1/{initial,after-answer,isolated-feedback,report,cleanup}.json`。这是合成课程闭环，不冒充再次重解析原30分钟视频。
- 20:56计划状态补验：本机忽略脚本`agent-feedback-20261011-plan-check.ts`只创建另一隔离账号/空媒体元数据，不调用AI或碰原媒体。真实POST保存200、GET提醒200且1条，completedAt=null、completedPlans=0；XP=0、作答记录=0。匿名创建401、跨用户admin创建403且未落库；清理确认该用户、资料、计划均已删除。证据`agent-feedback-20261011-plan-1/{report,fixture,cleanup}.json`，modelCalled=false。
- 已登录原助手实际练习按钮可进入0/1组，所有答案未选、提交/总结禁用；返回助手仅预填重新分析目标、不自动发送。保留原回答/8:55引用/20分钟安排。截图与DOM在`agent-feedback-20261011-page-1/practice.png`和`practice.txt`。没有在本人账号提交答案或保存计划。
- 页面进入练习前的学习时间20:46，返回后重新初始化为21:02；代码确认条件渲染卸载整个问答区及AgentActions，其scheduledAt/saved/uncertain/attemptedTime全部丢失。已保存方案或结果不确定方案也会重现可保存按钮，这是重复保存风险，不能将“接口能保存”视为页面闭环全部正确。

## 修复与回归

`src/app/assistant/page.tsx`把问答区保留在当前页面，以原生hidden随练习隐藏；练习组仍按本轮runId加载，返回恢复原问答区。学习时间、保存标记、结果不确定及原请求时间不随练习重置，隐藏区不进入可访问树/键盘操作；换资料/模式和刷新仍清空当前会话。无新存储、持久聊天或接口变化。

`tests/e2e/assistant.test.tsx`新增3项回归：指定未来时间经过练习后保持；保存成功后经过练习保持已保存且仅1次create；网络不确定后经过练习仍禁止重放，核对原尝试时间已落库后才显示已保存。还核对隐藏表单/保存按钮不可访问，以及返回不自动调用模型。

20:58最终4文件33项相关回归、TypeScript strict及页面/测试ESLint通过。命令：

```powershell
npx vitest run tests/e2e/assistant.test.tsx tests/e2e/exercise-group.test.tsx tests/unit/api/learning-agent.test.ts tests/unit/api/study-plans-bank.test.ts
npm run type-check
npx eslint src/app/assistant/page.tsx tests/e2e/assistant.test.tsx
```

模拟回归不能替代模型语义验收；本轮真实隔离两次完整回答另作人工核对，均符合实际链式法则原文与记录。既有模型误拒/漏检限制保留。前轮177项结果是§21.3的历史检查，不当作本轮重新运行结果。

## 数据保护与复现

20:56原十类只读重查`agent-feedback-20261011-after-1/report.json`，与20:52相同：

`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`

范围为XP、资料标题/状态、个人笔记、掌握、作答、计划、自动笔记、知识点、转写/OCR，不包含缓存播放进度或登录元数据。原页面练习进入/返回及热重载后的收尾只读检查`agent-feedback-20261011-final-tools-1/report.json`仍是同一指纹，modelCalled=false。隔离feedback旧入口只保存六类指纹，不能把它说成十类保护；本轮前后使用retrieval入口补齐。本人重新登录后的修复页面核对完成，21:12:25的`agent-feedback-20261011-final-tools-2/report.json`仍为相同指纹，retrievalPassed=true、recordsUnchanged=true、modelCalled=false。

从桌面主仓库、现有本地网页/数据库可用时运行；每次更换新目录，保留所有旧结果。feedback会调用真实模型并只对自身新建的临时账号提交错题和保存计划；不能用于替本人作答。内部签名令牌只用于本机HTTP，不打印或注入浏览器。计划检查脚本位于本机忽略目录，新克隆不能假定存在。

```powershell
if (Test-Path -LiteralPath '.taskbook-working/agent-feedback-new-flow') { throw '禁止覆盖已有证据' }
npx tsx scripts/acceptance/learning-agent.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-feedback-new-flow feedback
npx tsx .taskbook-working/agent-feedback-20261011-plan-check.ts .taskbook-working/agent-feedback-20261011-plan-new
npx tsx scripts/acceptance/agent-retrieval.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-feedback-new-readonly
```

更新DESIGN为保留状态的交互规则，TASKS/PROGRESS记录本编号、LEARNINGS记录卸载绕过保存保护；无TODO补全，非TODO更新原因是实际切换缺陷及验收状态变化。

## 页面收尾

修复后热重载触发已有15分钟会话过期；本人重新登录后，在原30分钟资料提交一次实际Agent请求。回答正确区分高效饱和袭击的来袭方和只能命中单一目标的防御方，说明转写含混需回看；8:55真实引用、1道已有题及20分钟8+7+5方案正常。模型语义人工核对仅针对本次回答，不证明普遍准确。

首次Playwright fill显示22:30，但练习返回后仍为原21:15；因此该DOM填值不作为页面状态已提交或修复通过的依据。保留`page-2/before.txt`及`practice.txt`。改用原生日期控件的方向键和失焦提交编辑，先确认独立表单更新后分钟编辑仍保持，再把小时设为22:16。随后实际进入练习0/1、四个选项均未选、提交/总结禁用；问答及保存区不在可访问树。返回后22:16仍保持，原回答/引用/方案恢复，输入框仅预填分析目标，未出现第二轮对话或正在回答。记录为`before-native.txt`、`practice-native.txt`、`returned-native.txt`。结束时清除本轮生成的预填问题，未提交答案或点击保存；没有代填登录凭据或注入令牌。

修复后截图为`agent-feedback-20261011-page-2/time-preserved.png`，已实际查看，显示22:16及练习入口。保存成功及网络结果不确定两种跨练习保护由3项新增回归核对，真实保存/权限/无自动完成由隔离HTTP核对，不冒充在本人网页提交过计划。本轮§10.4子项于2026-10-11 21:12完成，既有云端长期运行/公网部署项不核销。

![修复后返回助手仍保留22:16](C:/Users/qwh76/Desktop/智能学习平台/.taskbook-working/agent-feedback-20261011-page-2/time-preserved.png)
