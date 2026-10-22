# §21.3 有界思考与术语核对续验（2026-10-11）

执行仓库：`C:\Users\qwh76\Desktop\智能学习平台`。只续做§21.3，不执行下一编号，不训练、改云端推理、增加依赖、公开DTO、数据库表或写工具。所有真实请求沿用本人已配置的百炼北京qwen3.5-plus及额度确认；没有购买或切换型号，密钥与隐藏推理不写入记录。

20:47最终结论：§21.3已完成本轮本地毕设演练验收，真实解释已在本人登录页面人工核对。当前provider=aliyun，AGENT_REVIEW_READY/AGENT_REVIEW_THINKING均精确true；.env.local仍被忽略，不提交凭据。默认关闭、语义两次拒绝后的证据模式及服务/安全/格式/期限失败拒绝保留。完成的是已保存错误样本与30分钟资料的有界验收，模型仍可能误拒或漏检，不宣称普遍准确或项目整体完成。

## 本轮实现

- `src/lib/ai/spark.ts`增加私有boundedThinking/deadlineAt。有界思考仅百炼可用，固定512-token思考预算，回答输出预算单独保留；其它供应商拒绝该选项。每个请求及格式重试共享绝对期限，超期不发新请求、迟到响应不作为成功结果，单次最多20秒、Agent总90秒。
- `src/lib/agent/faithfulness.ts`生成实际候选句编号，覆盖回答与方案标题、每段连续6–300字符，最多60段；超量在模型调用前拒绝。来源编号仍映射真实连续摘录，所有拒绝继续校验真实候选/原文及内容安全。
- 只去除已逐字对应所选原文的开头服务端摘引行，原文上下文与解释/方案继续核对。不能隐藏正文里的引号、虚构前缀或有意义的英文空格变化。去前缀是减少干扰的设计，不是因果证明。
- 思考审查必须覆盖全部实际候选句且整体结论一致。私有supported/rejected协议只简化负向分类：有合法课程锚点的拒绝映射contradicted，缺课程锚点映射insufficient；不伪造学习记录的原文，不把拒绝转成supported。旧三态协议及其严格锚点约束保留。
- 首轮supported后另核对被作为确定事实使用、而全部所选原文未出现的专业术语/成语。返回真实候选编号和连续2–30字term，后端验证候选中确有、来源中确无；非法编号、虚构文字、来源已有词均失败。普通忠实概括、未来建议和明确不确定不应因此拒绝。
- 明确learning.points是知识点目录与数值摘要，不能因有知识点条目就推断有掌握记录。score/isWeak均null且近期0次作答允许描述“暂无掌握记录/待检验”，不能说已掌握或已完成可用分钟。
- 最多3次决策、2次最终生成、2轮审查；思考每轮可另有术语核对，每次最多2次格式尝试，非思考最多14次、思考最多18次请求，但仍共同受90秒限制。原配置/权限/工具/安全失败仍拒绝，语义两次拒绝后丢弃候选，返回既有证据模式。

## 真实失败与修复过程

本机忽略目录`.taskbook-working`保留全部新旧证据，不覆盖历史。以下“回放通过”只指固定样本预期匹配，人工理由核对和完整生成仍另验收。

1. 早期隔离探针：1024思考预算的三个旧错误均20秒超时，256/512及缩短提示的探针仍出现格式失败或误拒忠实未来建议；不把格式失败当语义正确拒绝。这些只是探针，最终产品固定512。
2. `agent-qwen-thinking-20261011-replay-1/2`：旧主体错误及正例部分通过，但新增术语页面回答仍被supported。去除开头摘引没有独立解决漏检。
3. `...-replay-3`：逐句coverage仍放行未加引号的成语；部分样本服务/格式失败，replayPassed=false。`...-full-1`结构成功但人工发现加强原文程度的说法，不算忠实解释通过。
4. `...-replay-4`：新增术语核对拦住未加引号的“攥指成拳”，两个正例supported；两项拒绝因contradicted缺课程锚点而Schema失败，整轮false。
5. `...-replay-5`：简化负向协议后八项预期均匹配、replayPassed=true；人工发现部分拒绝理由误将知识点条目视为掌握记录，因此仍不作为最终开放依据。`...-full-2`完整流程返回证据模式，不是自由解释成功。
6. `...-replay-6`（20:28）：明确知识点/掌握摘要语义后，三个历史主体错误contradicted，页面新增术语、未加引号的成语和虚构已掌握/已完成记录insufficient，纯摘引及完整忠实解释两个正例supported，8/8预期通过。人工核对关键理由对应实际主体、未证实成语及虚构学习事实；不是仅因无引号、缺计划或HTTP状态通过。

7. `...-full-3`：两轮整段审查均supported，但术语步骤先误拒学习数字/无掌握记录，再误拒普通角色指称，最终安全退回证据模式。只读私有探针在`...-full-3-model`捕获最终content，未记录Key、请求头、隐藏推理；首次探针因CJS顶层await编译失败，修复包装后再运行，编译失败未调用模型。
8. 限定课程概念名、排除普通角色/统计/建议，并向术语步骤提供既有真实learning/exercises后，`...-replay-7`（20:37）八项预期再次匹配、两个正例supported、未加引号成语insufficient。个别额外拒绝理由仍有指代苛刻或概念分类偏严，保留报告，不声称所有理由完美。
9. `...-full-4`（20:35）：取得自由解释，人工核对攻防主体、单一目标限制、系统升级方向，未补确定成语或称已掌握/已完成；真实535秒来源、1题、8+7+5分钟方案合法。转写噪声继续明确需回看。该轮结构重试及审查content在`...-full-4-model`，只保留content。
10. 在回放与隔离完整解释核对后，仅本地演练开启两审查开关，Next dev重载.env.local；`...-web-3`（20:39–20:40）真实接口200自由解释、匿名401/跨用户admin403，引用在目标范围且真实已有练习/预算方案通过，保护指纹不变。人工核对没有主体颠倒或确定补成语；既有非Agent调用仍星火。随后本人重新登录完成最终页面核对，演示开关保留true，主项核销；详见下节。

## 代码与当前网页验收

20:40–20:41最终15文件177项相关回归、TypeScript strict、定向ESLint通过。日志在`agent-qwen-thinking-20261011-final-checks-4`，较早checks-3保留。包括编号/连续性、全句覆盖、合法负向分类、术语锚点、安全拒绝、有界思考、超期无请求/无格式重试/迟到拒绝，以及助手、练习、计划与旧AI路径回归；模拟测试不证明模型普遍准确。

文档收尾后，三个改动源文件及三个改动测试文件ESLint再次退出0（同目录eslint-status.txt）；范围内CRLF-aware diff检查通过，未跟踪代码/验收文档的直接逐行检查无尾随空白，.env.local仍被git忽略。没有重复请求真实模型或扩大到其它编号。

20:20关闭状态下网页真实接口`agent-qwen-thinking-20261011-final-evidence-2`：本人200证据模式，匿名401、跨用户admin403，guardPassed=true。摘录连续存在于实际转写、引用实际535秒、已有练习及20分钟安排合法。该时配置只读确认：provider=aliyun，AGENT_REVIEW_READY=false、思考未启用；之后本地页面验收只改两开关，凭据/其它AI配置保持，.env.local仍被git忽略、不提交。

本地3000网页服务在续验时未运行，已从桌面主仓库`npm run dev`恢复，未启动Ascend或视频后台任务。用户本人重新登录后，在助手选择“阿里木江7.10-前30分钟”提交20分钟目标，实际出现证据模式说明、8:55来源、1道已有题和8+8+4分钟安排。打开练习后0/1未作答、未选任何答案，返回助手；未保存计划或提交成绩。截图与DOM在`agent-qwen-thinking-20261011-page-2`，登录阻塞旧证据同目录保留，最终页面已恢复助手。

最终再次由本人重新登录，提交“我有20分钟，请检索第七题原文，解释来袭方与防御方的区别，挑选已有练习并给出复习方案。只解释能确认的内容。”实际自由解释正确区分来袭方高效空袭/饱和袭击与防御方单目标限制，保留系统升级与集合协同逻辑；未知掌握未改成已掌握，转写噪声明确需回看，没有补成确定成语。真实引用8:55指向`/study/cmuqhyf7h00027q29tijy4uer?t=535`，已有1题“第七题情境分析”，方案20分钟（8+7+5）。未提交作答/保存方案。截图已实际查看，DOM及可见解释图在`agent-qwen-thinking-20261011-page-3/verified-page.txt`与`verified-answer.png`；助手标签保持打开。

![最终真实解释页面](C:/Users/qwh76/Desktop/智能学习平台/.taskbook-working/agent-qwen-thinking-20261011-page-3/verified-answer.png)

涉及资料的全部已完成报告十类保护指纹前后均为`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`，recordsUnchanged=true。保护范围是XP、资料标题/状态、个人笔记、掌握、作答、计划、自动笔记、知识点、转写及OCR；不包含缓存播放进度或登录会话元数据。页面后20:43只读重查`agent-qwen-thinking-20261011-final-tools-2/report.json`确认retrievalPassed=true、modelCalled=false及同一保护指纹，无额外模型请求。

## 本机复现

先保留本机`.taskbook-working`中的旧错误JSON及`agent-qwen-thinking-20261011-extended-cases.json`，它们是回放入口的数据依据，不含密钥；新克隆不能假定这些忽略资产已存在。每次用新目录，已有目录拒绝覆盖。未取得精确型号有效免费额度及云端用完即停确认，不执行真实模型请求。

```powershell
$taskPriorProvider = [Environment]::GetEnvironmentVariable('AGENT_MODEL_PROVIDER', 'Process')
$taskPriorThinking = [Environment]::GetEnvironmentVariable('AGENT_REVIEW_THINKING', 'Process')
$taskRunExit = 1
try {
  $env:AGENT_MODEL_PROVIDER = 'aliyun'
  $env:AGENT_REVIEW_THINKING = 'true'
  npx tsx scripts/acceptance/agent-faithfulness.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-thinking-new-replay replay .taskbook-working/agent-qwen-thinking-20261011-extended-cases.json
  $taskRunExit = $LASTEXITCODE
} finally {
  [Environment]::SetEnvironmentVariable('AGENT_MODEL_PROVIDER', $taskPriorProvider, 'Process')
  [Environment]::SetEnvironmentVariable('AGENT_REVIEW_THINKING', $taskPriorThinking, 'Process')
}
# 根据$taskRunExit及report.json判断；不能因finally成功就认为模型验收成功。
```

固定回放通过并人工核对后，隔离进程另设置`AGENT_REVIEW_READY=true`运行`agent-retrieval.ts <资料ID> <新目录> diagnostic`，结束必须恢复三个进程变量；不改网页.env.local。完整结果若仍是证据模式，只证明拒绝保护可用，不是自由解释验收。当前已开启解释的网页接口/权限复现（使用本人现有数据，model模式仍需人工核对回答；它不是自动语义证明）：

```powershell
npx tsx scripts/acceptance/agent-retrieval.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-thinking-new-web model
npx tsx scripts/acceptance/agent-retrieval.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-thinking-new-readonly
```

若需关闭解释，可只将本机AGENT_REVIEW_READY改为false并确认网页环境重载；关闭后再用历史evidence模式入口核对原文降级，不要在当前开启状态下将evidence专用预期误当接口异常。任务主项状态已同步PROGRESS；训练视觉分类器不是解决此处生成/审查质量的必要前提。
