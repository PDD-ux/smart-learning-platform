# §21.3 百炼千问候选接入（2026-10-11）

20:47最新状态见[有界思考验收](agent-review-thinking-20261011.md)：本地已完成错误/正例回放、完整解释、真实接口及本人登录页面人工核对，两审查开关true用于演练，§21.3主项完成。以下失败、关闭配置及待办是当时时点记录，保留历史证据；旧guard/evidence命令不应直接套用当前开启解释状态。

14:08续修已提供[证据模式](agent-evidence-20261011.md)：当前关闭开关时仍可返回真实原文、已有练习及复习安排；最终解释生成/审查跳过。以下13:46前的503及语义失败记录是历史结果，保持不改，生成式质量仍未通过。本页旧guard命令仅复现历史503检查，当前行为请用新记录的evidence模式。

执行仓库：`C:\Users\qwh76\Desktop\智能学习平台`。用户确认“可以用阿里云”并保存配置，仅续做§21.3，不训练模型、不新增业务模块或部署。真实连接及部分回放、完整接口已通过，但13:40登录页面发现新增术语漏检，后续完整请求也未可靠核对转写噪声，最终未通过语义验收。当前保留aliyun候选配置，AGENT_REVIEW_READY=false，本地网页运行；不能因连接或单次回放通过宣称模型普遍准确。

## 13:16起真实接入与修复

- 配置预检仅输出aliyunKeyConfigured=true/quotaConfirmed=true，网页provider=spark、reviewReady=false，未输出真实Key。本人截图显示精确qwen3.5-plus剩余1M，随后确认已配置；本地变量是本人确认，不是自动查询账户计费保护。13:16最小连接HTTP200、available、3375ms，证据`agent-aliyun-20261011-health-1`。
- 首次replay-1四项均HTTP400，上游详情不写产品日志。隔离json-cause最小诊断只保留httpStatus=400/jsonKeywordRequired=true，确认JSON对象模式要求messages包含字面JSON；仅百炼/jsonMode网关合并或前置明确JSON指令，原调用者数组、其它模型路径及预算保持。
- replay-2至4三个错误因sourceQuote自由复制时添加省略号/拼接而Schema失败，正例supported。私有review-cause仅在本机忽略目录保存模型回答供人工核对，发现模型能够指出主体颠倒但引用不连续；不把格式失败计成语义正确拒绝。
- 增加有界sourceQuoteChoices（最多每来源12段、步长120、连续6–160字符、最多5个来源），模型可选真实整数编号，服务器还原字符串再执行原双向锚定。精确字符串仍可兼容，虚构编号、改写/拼接、未出现候选claim均拒绝；不增加模型请求或放宽原文校验。审查示例改为编号并强化复合句中每项事实/术语类别核对。
- replay-5两项主体错误contradicted，model-subject仍错误supported；失败保留。13:25 replay-6三项旧错误全部contradicted、纯摘引supported；人工核对拒绝针对攻防主体/能力类别错误而非缺计划等无关理由，claim/原文锚点真实。解释“高效空袭体系为核心的防空能力”被识别为将进攻能力归为防御类别；审查措辞仍不作为普遍正确保证。
- full-1/full-2受控完整请求检索成功，但最终回答自由摘引改写，两次格式校验失败，均保留。最终生成新增私有quoteNumbers选择同一片段；严格检查编号属于所选sourceIds，服务器前置真实原文后继续逐字摘引/内容安全/整段独立审查。编号不返回客户端或数据库，旧合法逐字摘引兼容；格式示例与指令须同时使用编号，不能仍要求模型自由复制。
- 13:26网页关闭通道guard-before实际本人503/AI_UNAVAILABLE且无候选data、匿名401/跨用户admin403，guardPassed=true。上述各次涉及资料的报告，十类学习数据前后指纹均`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`，recordsUnchanged=true；未提交作答/保存计划/改笔记或成绩。
- 13:28相关13文件132项回归、TS strict及定向ESLint通过，覆盖JSON显式指令与消息不变、片段编号还原/范围/连续性/候选锚点，以及最终来源归属和解释仍需审查；中间发现审查多system消息不符既有新会话契约和泛型TS推断，已合并单system并显式类型修复后通过。后续最终检查结果另记。

证据均在`.taskbook-working`的新目录，历史失败不覆盖；没有购买、切换付费型号或自动回退。网页是否切换与最终编号状态以PROGRESS最新记录为准。

## 登录页面核对与最终阻塞（13:30–13:46）

- full-3受控完整请求成功，人工核对来源535秒、1道真实题、8+7+5分钟方案及未知掌握记录，随后显式设置Agent provider=aliyun、临时打开reviewReady并重启本地网页；原AI路径仍星火。web-1返回503/SCHEMA_INVALID，未发布候选；full-4捕获仅模型content，发现语义修正提示仍要求自由摘引，与编号协议冲突。修正提示统一编号，原预算不变。
- full-5审查把未来阅读建议误当已完成学习，并在contradicted下放空sourceQuote，格式失败；补充建议/事实区别、整体验收判定及真实锚点要求。13:39 replay-7三项错误拒绝、纯摘引支持；web-2本人200、匿名401/跨用户admin403，535秒真实来源、1道练习/15分钟方案。最初人工认为主体/主线合理；后续扩展回放指出“正在逐渐形成”被写成“已形成”，保留原记录，不据此标全面语义成功。
- 用户本人登录后在/assistant选择30分钟资料，实际发送同一20分钟目标。页面确有来源8:55、实际1题、8+7+5分钟方案，未作答或保存计划；解释新增“单兵作战”及“攥指成拳”，模型审查放行。页面证据`agent-aliyun-20261011-page-1/failed-answer.jpg`及DOM文本/原回答JSON保留；这是实际漏检，不算成功。随即关闭AGENT_REVIEW_READY并重启，清除本页旧会话，没有注入登录令牌。
- 回放入口增加可选附加样本文件（仅.taskbook-working内JSON、最多4个、名称不重复、本轮来源编号校验、预期总数严格匹配），不改公开接口。replay-8四项旧样本及新页面错误通过，人工核对明确指出设备/人员主体替换和未确认噪声还原；full-6结构成功却再次放行未确认的短成语，独立审查仍不稳定。
- 原逐字检查只看≥6字引号内容，四字术语可绕过。补强为所有非空引号内容1–180字逐字存在于所选来源、合计最多5处，仍要求至少一处≥6字核心摘引；新增通用短术语/无来源/核心长度回归，不硬编码课程答案。full-7通过结构，但模型改为在解释中不加引号补入同一成语，人工仍未通过。字符串校验不能证明未加引号的解释正确，保留该失败，不继续放宽规则。
- replay-9扩大为六项：三项旧错误、新页面错误正确拒绝，纯摘引支持；web-2完整解释正例候选被判insufficient，包含时态和噪声解释问题，最终replayPassed=false。此候选也需要人工审定，不能把它简单称为确定正确的正例，未改预期或删除失败使报告通过。最终语义阻塞独立于密钥/服务可达性。
- 13:45最终真实guard：本人503/AI_UNAVAILABLE并明确核验尚未通过、无候选data，匿名401/跨用户admin403，guardPassed=true。所有涉及学习数据的报告前后十类指纹仍`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`，recordsUnchanged=true。配置有效但§21.3保留[ ]，不把模型自评supported作为开放依据。

仍待完成：稳定拒绝未证实解释且支持完整忠实解释，随后真实完整请求与登录页面人工语义验收。既有资料/笔记/题库继续可展示；本轮没有训练、Ascend重连、部署、提交练习或保存计划。后续应继续本编号，不能因配置成功进入下一项。

13:48最终代码检查：13文件133项相关回归、TypeScript strict、定向ESLint（含回放入口）全部通过，范围内文档CRLF-aware diff检查通过，.env.local仍被git忽略。模拟测试不能证明模型语义准确。页面清除旧会话后尝试展示关闭提示时，原登录会话已过期并转到/login；未代输入凭据，不把最终浏览器提示写成已验收，真实guard接口结果仍有效。当前网页在桌面主仓库继续运行，已保存的错误截图仅用于说明漏检，不是通过截图。

## 服务边界

- Agent内部provider增加aliyun，决策、最终生成和独立审查共用选择；原知识点/闪卡/题库/问答路径继续星火。添加Key不自动切换，不回退其它模型。
- 固定模型`qwen3.5-plus`，固定北京官方`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，只读服务端DASHSCOPE_API_KEY。官方推荐业务空间新域名，但明确现有域名仍可使用；本次不开放任意地址/模型或客户端参数。
- 直接HTTP顶层`enable_thinking=false`，结构化请求`response_format=json_object`；提示词要求JSON，Zod继续检查结构。`max_completion_tokens`承接原maxTokens预算，单次/整体时限、两次格式尝试和最多一次语义修正保持，不返回隐藏思考。
- 服务端ALIYUN_AGENT_QUOTA_CONFIRMED仅精确true开放该候选请求，默认false；缺密钥或缺确认在fetch前失败。该变量只记录维护者确认，不能查询、改变或保证云端计费。须先确认控制台该模型有效免费额度及“免费额度用完即停”已生效。没有购买、充值或切换付费型号。
- 配置/HTTP/超时失败沿用既有AI_UNAVAILABLE(503)，不返回候选、不写学习数据。日志不含密钥、上游正文；无新SDK、表、公开字段或页面。

## 本机配置步骤

1. 进入[百炼北京免费额度页](https://bailian.console.aliyun.com/cn-beijing/costing-balance/free-quota)，搜索精确模型Code `qwen3.5-plus`，刷新后核对剩余额度、有效期并打开“免费额度用完即停”，等待生效。型号快照额度独立，不能用其它Code额度代替。未认证账号若系统强制保护，以控制台实际状态为准；没有该模型额度时不要确认或测试。
2. 按[官方API Key创建说明](https://help.aliyun.com/zh/model-studio/get-api-key)创建北京地域通用API Key；不用Coding Plan/Token Plan专用Key，不把Key发聊天或放前端。
3. 本次已在被忽略的`.env.local`顶部补上两个空/关闭配置；用记事本或编辑器打开`C:\Users\qwh76\Desktop\智能学习平台\.env.local`，只编辑这两行，不覆盖其它配置：

```dotenv
DASHSCOPE_API_KEY=""
ALIYUN_AGENT_QUOTA_CONFIRMED="false"
```

将Key粘贴到第一行双引号内；完成步骤1后第二行改为`"true"`。保存，网页provider和AGENT_REVIEW_READY先保持原值。本次open_in_codex返回queued，仅表示编辑入口排队，不代表密钥已配置或用户已看到编辑器。

官方说明新人额度仅北京地域；认证用户额度耗尽可能转按量计费，用完即停须在云端开启。配置生效有延迟，生效前调用仍可能计费；本地确认不消除该延迟。本次没有读取账户余额或密钥正文。见[官方免费额度及用完即停规则](https://help.aliyun.com/zh/model-studio/new-free-quota)。

## 已完成检查

12:53真实本机配置预检：`agent-model-health.ts aliyun`在1ms返回missing_key、未发请求；证据`.taskbook-working/agent-aliyun-20261011-preflight/report.json`，allAvailable=false、semanticAcceptance=false、automaticRetries=0。本机新增配置为空Key/false，原Key与默认provider未覆盖，git check-ignore确认.env.local仍被忽略。

12:54在禁用fetch的隔离进程用占位凭据检查缺确认分支，1ms返回quota_not_confirmed；证据`.taskbook-working/agent-aliyun-20261011-quota-guard/report.json`。网络钩子为同目录上层`agent-aliyun-20261011-no-network.mjs`，没有真实密钥或远程请求；不能将该结果称为云端额度已确认。

健康入口显式支持aliyun；both仍仅星火/智谱，不自动增加百炼调用。新增固定白名单业务码AllocationQuota.FreeTierOnly→usage_limit，未知错误不猜成额度耗尽；报告不输出正文、回答或敏感错误详情。新证据目录/不覆盖历史结果要求保持。

12:55–12:56相关12文件114项回归、TS strict及定向ESLint通过；新增候选路由、凭据隔离、缺Key/缺确认不请求、无回退、原路径隔离、预算/错误保护及公开API拒绝provider和503无候选检查。模拟接口通过不等于真实语义通过。§21.3保持未完成。

## 配置后复现

从桌面主仓库运行，每次使用新目录。连接检查只发送固定简短提示、输出20 tokens、20秒、一次请求无重试，不读课程或数据库；仍消耗少量额度：

```powershell
npx tsx scripts/acceptance/agent-model-health.ts aliyun .taskbook-working/agent-aliyun-new-health
```

连接通过后再回放相同30分钟视频535秒原文、三项历史错误与纯摘引正例；以下变量只影响当前PowerShell及其验收进程，运行后恢复，不改网页配置：

```powershell
$taskPreviousProvider = [Environment]::GetEnvironmentVariable('AGENT_MODEL_PROVIDER', 'Process')
try {
  $env:AGENT_MODEL_PROVIDER='aliyun'
  npx tsx scripts/acceptance/agent-faithfulness.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-aliyun-new-replay replay
} finally {
  [Environment]::SetEnvironmentVariable('AGENT_MODEL_PROVIDER', $taskPreviousProvider, 'Process')
}
```

只有回放正确拒绝错误且支持正例、人工核对原文锚定后，才运行以下受控完整请求（仍会消耗额度），结束后恢复变量，不改网页配置：

```powershell
$taskPreviousProvider = [Environment]::GetEnvironmentVariable('AGENT_MODEL_PROVIDER', 'Process')
$taskPreviousReview = [Environment]::GetEnvironmentVariable('AGENT_REVIEW_READY', 'Process')
try {
  $env:AGENT_MODEL_PROVIDER='aliyun'
  $env:AGENT_REVIEW_READY='true'
  npx tsx scripts/acceptance/agent-retrieval.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-aliyun-new-full diagnostic
} finally {
  [Environment]::SetEnvironmentVariable('AGENT_MODEL_PROVIDER', $taskPreviousProvider, 'Process')
  [Environment]::SetEnvironmentVariable('AGENT_REVIEW_READY', $taskPreviousReview, 'Process')
}
```

各入口核对十类学习数据指纹、禁止写学习资产；完整解释及引用/计划/练习需人工核对，不以审查supported或HTTP200单独验收。曾临时打开网页核对，发现漏检后已重新关闭；当前本地候选仍aliyun，原文分析成功通道关闭。

扩展回放（仍消耗少量额度，新目录不覆盖历史）：

```powershell
npx tsx scripts/acceptance/agent-faithfulness.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-aliyun-new-extended replay .taskbook-working/agent-aliyun-20261011-page-1/extended-replay-cases.json
npx tsx scripts/acceptance/agent-faithfulness.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-aliyun-new-guard guard
```

官方协议依据：[兼容Chat请求参数](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/)、[JSON模式支持型号](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。本次只补充非TODO候选范围、架构、私有契约、技术选型及验收记录，未补TODO或改变公开页面交互。
