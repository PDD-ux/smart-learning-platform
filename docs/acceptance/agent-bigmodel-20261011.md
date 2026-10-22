# §21.3 智谱候选接入与真实回放（2026-10-11）

执行仓库为`C:\Users\qwh76\Desktop\智能学习平台`。用户已创建API Key，最初本机尚未配置；准备记事本编辑入口后检测到本人已保存ZHIPU_API_KEY，实际智谱连接通过，旧错误回放失败且随后服务繁忙。接入代码与失败保护完成检查，解释语义、思考模式效果及完整成功请求仍未通过，§21.3保持未完成。

## 12:42–12:43 可复现双模型诊断入口

新增`scripts/acceptance/agent-model-health.ts`，替代仅存在于忽略目录的临时最小请求入口。从桌面主仓库运行：

```powershell
npx tsx scripts/acceptance/agent-model-health.ts both .taskbook-working/agent-model-health-next-run
```

每次须用新目录；也可把both换成spark或bigmodel。入口固定官方星火Lite和智谱GLM-4.7-Flash，固定最小提示与20-token输出上限，智谱关闭思考；只从本机服务端环境变量读取相应Key，顺序各调用一次，每次20秒，不重试/回退/购买。不传真实课程或个人数据，不读数据库，不改网页或自动打开验收开关；该入口检查固定候选API连通性，不检查其它SPARK_MODEL/SPARK_BASE_URL配置或账户余额。用量少量但非零，是否免费以账户授权为准。

结果只保留固定provider/model、时间/耗时、HTTP状态、数字业务码、固定outcome分类和纯数字Retry-After秒数；不保留原始响应、回答文本、URL、Key或异常正文。分类明确区分available、service_overloaded(1305)、account_rate_limited(1302)、billing_rejected(1113)、usage_limit、鉴权/权限/参数、超时/连接及未知错误；未知429不猜成欠费。输出report.json标记semanticAcceptance=false；任何一家不可用，入口exit=1，表示检查失败而非脚本故障。

12:42实际运行：星火HTTP200/业务0、available，2397ms；智谱HTTP429/1305、service_overloaded，1383ms，报告位于`.taskbook-working/agent-model-health-20261011-1`。TS strict和定向ESLint通过。重复已有目录明确拒绝、原报告SHA256保持`FDC6DDC832C21CA299AA8938A83171BA6C91B755B843A02D9E88AC5832BDF34F`；未知provider/仓库工作目录之外输出目标均拒绝且不创建目录；在独立子进程临时置空智谱变量立即返回missing_key，没有更改.env.local/网页配置。以上不替代语义回放或完整Agent验收，任务保持未完成。

## 12:36 阻塞原因核对

绕过Agent、资料检索和结构化JSON，只向官方固定glm-4.7-flash接口单独发送“只回复好”，关闭思考、输出上限20 tokens。1209ms返回HTTP429/业务码1305，脱敏说明“该模型当前访问量过大，请您稍后再试”，无Retry-After、无回答。见`.taskbook-working/agent-bigmodel-20261011-cause/minimal-request.json`。该最小请求也失败，当前阻塞不能归因于本项目的长资料、Agent工具编排或JSON校验；它也不因延长客户端等待而解除。

已读取智谱[官方错误码](https://docs.bigmodel.cn/cn/api/api-code)及[速率限制](https://docs.bigmodel.cn/cn/api/rate-limit)：1305明确定义为平台服务过载，1302是账户速率限制，1113是欠费，1308/1310分别是周期使用上限。当前响应为1305，因此无需据此重新配置Key或充值；不代表已读取账户余额/并发权益，也不保证之后不会出现其它错误。此前20秒超时只证明客户端到时未收到结果，具体内部排队/生成原因不能从该超时单独确定。对繁忙采用延迟处理、增加重试间隔；本轮不自动高频重试、不切付费型号。

原非思考语义回放误判是另一项未解决的问题，服务恢复后仍须独立验收，不能将1305消失写成Agent可靠。产品代码/配置及学习数据未修改，仅追记本编号诊断结果。

## 12:33–12:34 双服务分工前续验

用户确认两家模型配合使用后，继续当前唯一未完成编号§21.3。原笔记/知识点/题库/普通问答沿用星火，智谱作为Agent候选；本轮只做隔离诊断，不修改网页provider或打开AGENT_REVIEW_READY，也不将“具备接入能力”写成“智谱Agent已启用”。

- 复用隔离thinking=enabled/max_tokens=4096探针、原审查提示和错误/纯摘引正例，错误解释请求在20025ms超时，正例在1272ms返回HTTP429。证据为`.taskbook-working/agent-bigmodel-20261011-thinking-next-1`。超时不证明模型已接受、完成推理或解释质量通过。
- 为区分响应预算与服务繁忙，仅在独立诊断脚本把单次超时提高至60000ms，单独发送同一错误解释；1302ms即HTTP429，没有获得可审查回答。证据为`.taskbook-working/agent-bigmodel-20261011-thinking-long-1`。产品20秒单次及90秒整体预算保持，不根据诊断放宽。
- 12:34真实网页guardPassed=true：本人503/AI_UNAVAILABLE明确提示原文解释核验尚未通过且无回答data，匿名401、跨用户admin403。证据为`.taskbook-working/agent-bigmodel-20261011-next-guard`；保护指纹前后仍为`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`，所检查的十类学习数据保持。
- 没有新的产品代码、配置、公开接口、页面、数据库或依赖变更。本轮没有重复跑模拟回归，100项通过仍是12:16–12:17的历史结果。§21.3保留未完成；等待候选服务可用后，须先通过错误样本拒绝/正例支持及完整真实Agent请求人工核对，再接入网页。

复现本轮隔离诊断（均须用新的输出目录，不能覆盖历史失败；长诊断只改变独立脚本超时，不改变产品配置）：

```powershell
npx tsx .taskbook-working/agent-bigmodel-20261011-thinking-probe.ts .taskbook-working/agent-bigmodel-new-thinking
npx tsx .taskbook-working/agent-bigmodel-20261011-thinking-long.ts .taskbook-working/agent-bigmodel-new-long
npx tsx scripts/acceptance/agent-faithfulness.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-bigmodel-new-guard guard
```

## 12:18–12:22 真实结果

- 固定候选glm-4.7-flash真实接口HTTP200，thinking=disabled、response_format=json_object、max_tokens=100返回可解析ready=true；凭据仅在请求头内存使用，输出只有时间/型号/状态/布尔结果。见`.taskbook-working/agent-bigmodel-20261011-connection/report.json`。这证明连接和该小请求的字段被接受，不能证明语义质量。
- 在验收子进程显式选择bigmodel，运行既有只读agent-faithfulness回放。两个旧主体错误候选均被错误审查为supported；真实摘引附错误解释与纯摘引正例均HTTP429，回放exit=1、replayPassed=false。失败文件完整保留在`.taskbook-working/agent-bigmodel-20261011-replay`，所用535秒实际原文与历史失败样本相同。
- 隔离诊断仅在测试进程把请求thinking改enabled、max_tokens提高至4096，原单次20秒/两次格式预算保持；首次及延后再检查的两项均HTTP429，不能声称思考模式同样解释错误或已改进。产品仍用disabled，没有据未完成探针调整生产提示、预算或模型。证据在`...-thinking-probe`和`...-thinking-retry`。
- HTTP429进一步核对上游数值错误码1305，经过仅保留中文字符的说明是“该模型当前访问量过大，请您稍后再试”，没有Retry-After。只记录错误码/状态/说明，不记录密钥或原始响应体；见connection/rate-status.json与rate-description.json。不是密钥认证失败，也不推断为每日额度耗尽、收费或账户未实名。
- 首次网页guard入口失败，3000无监听、没有guard.json；失败报告保留在`...-guard`，不可当权限检查通过。恢复本仓库npm run dev后（统一exec会话14170，端口3000），`...-guard-web`真实返回503明确原文解释未核验、匿名401、跨用户admin403，guardPassed=true，无候选data。网页维持原provider=spark、原文分析开关false，没有让未验收的候选对用户返回成功。
- 模型回放及两次guard报告保护指纹前后均`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`，本人XP/资料标题状态/笔记/掌握度/作答/计划和当前自动笔记/知识点/转写/OCR未变。未代登录、浏览器注入令牌、生成题、保存计划、重跑视频或连接Ascend。

未购买、更换付费型号或尝试其它服务；本机密钥已具备，但候选服务当前语义漏检和繁忙仍阻止验收。完整成功请求及人工语义核对尚未执行，原文分析保持关闭。既有错误样本及新失败证据全部保留。

## 实现与验证

既有自写HTTP网关增加内部provider选项，默认spark；新agent/model.ts仅按服务端AGENT_MODEL_PROVIDER=spark|bigmodel选择，供决策、最终回答和独立审查共同使用。bigmodel只调用固定官方端点`https://open.bigmodel.cn/api/paas/v4/chat/completions`、固定候选`glm-4.7-flash`、服务端ZHIPU_API_KEY；不接受客户端选模型/地址、不回退或自动购买。结构化请求发送JSON对象要求，关闭思考输出，仍强制Zod校验及最多两次格式尝试；整体Agent权限、只读工具、语义修正及90秒预算保持。没有新SDK、公开字段、数据库或写工具。

2026-10-11 12:16–12:17，12文件100项相关回归通过；TS strict及定向ESLint均通过。新增测试覆盖固定官方端点/模型与独立凭据、原AI默认星火不变、有Key不隐式切换、未知provider拒绝、缺Key无回退、两次格式预算、上游错误正文脱敏和最终内容类型；Agent单测验证决策/回答/审查全部使用同一选择。这些都是模拟接口检查；后续真实请求结果单列在上方，不能用模拟通过证明解释可靠。未覆盖运行中的.next执行生产构建。

官方候选能力参考[GLM-4.7-Flash文档](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash)，文档包含工具调用与结构化输出；当前账户免费可调用性、限速及实际响应必须通过真实请求确认。官方能力介绍不作为本项目语义通过证据。

## 本机配置

已在被忽略的.env.local顶部准备空ZHIPU_API_KEY行（如原文件存在同名项则保留），并打开记事本供本人粘贴；没有覆盖其它配置、输出任何密钥或读取剪贴板。本人把控制台Key粘到双引号之间后保存，不将Key发到聊天里。

密钥已由本人保存；验收子进程可选择服务，网页仍保持原配置和原文分析关闭：

```dotenv
AGENT_MODEL_PROVIDER="bigmodel"
ZHIPU_API_KEY="本人在本机填写，不提交"
AGENT_REVIEW_READY="false"
```

这段只是配置说明，不应整段覆盖已有.env.local，也不能用占位文字当密钥。本轮没有设置运行provider或打开验收开关；模型选择需要重启网页服务后生效，读配置的验收入口需要启动新进程。

## 后续复现

固定候选服务繁忙缓解后用新证据目录回放，绝不覆盖此前失败记录；下面provider只对当前PowerShell及其验收子进程生效，不修改网页配置：

```powershell
$env:AGENT_MODEL_PROVIDER='bigmodel'
npx tsx scripts/acceptance/agent-faithfulness.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-bigmodel-new-replay replay
npx vitest run tests/unit/agent tests/unit/ai/agent-provider.test.ts tests/unit/ai/extract-json.test.ts tests/unit/api/learning-agent.test.ts tests/e2e/assistant.test.tsx tests/e2e/exercise-group.test.tsx tests/unit/api/ai-qa.test.ts tests/unit/api/study-plans-bank.test.ts tests/e2e/app-shell-states.test.tsx
npm run type-check
npx eslint src/lib/ai/spark.ts src/lib/agent/model.ts src/lib/agent/learning-agent.ts src/lib/agent/faithfulness.ts tests/unit/ai/agent-provider.test.ts tests/unit/agent/learning-agent.test.ts
```

回放独立于关闭的产品成功通道；三项旧错误须正确拒绝且理由由原文支持，纯摘引正例须通过。还须受控完整真实请求、人工主体核对、匿名401/跨用户403及保护指纹检查，不能只因审查返回supported开放生产路径。没有原文的状态路径与既有问答不因候选接入宣称全部可靠。后续真实结果应在本记录追记，与本轮模拟测试明确区分。
