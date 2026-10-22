# §22.4 Agent响应速度与故障定位

2026-10-12 08:32完成。用户确认下一项，并询问是否因为API接法没有遵循官方文档。本轮只检查并优化既有Agent调用链，先在TASKS明确范围、ARCHITECTURE记录诊断与调度，再修改代码；不执行下一模块。

## 官方文档核对

百炼[OpenAI兼容HTTP说明](https://www.alibabacloud.com/help/zh/model-studio/qwen-api-via-openai-chat-completions)列出直接POST、JSON对象模式、max_completion_tokens、finish_reason及现有域名仍可使用。项目使用固定北京dashscope.aliyuncs.com/compatible-mode/v1/chat/completions、Bearer服务端密钥、JSON对象模式及明确JSON提示，符合该HTTP路径；SDK中的extra_body是封装参数用法，直接HTTP不需再包extra_body。没有依据认为换SDK就会更快，没有获取业务空间ID或擅自迁移地址。

[思考预算说明](https://www.alibabacloud.com/help/zh/model-studio/deep-thinking)支持enable_thinking/thinking_budget。当前决策和生成关闭思考，审查与术语核对启用固定512-token预算；max_completion_tokens合计包含思考与回答。官方支持这些参数，不代表厂商承诺当前时延。

## 实测与修改

基线仅增加观测，不改变原调用顺序：`.taskbook-working/agent-latency-20261012-baseline-1/timings.json`总用时33642ms，三次决策2482/1077/1201ms、生成5901ms、审查12822ms、术语10137ms；六项均一次格式尝试。审查+术语共22959ms、约68.2%，不是格式重试造成这一轮的等待。数字是完整结构化调用耗时，包含网络及模型处理，无法分辨排队/网络/计算，也不是首token时延。

`faithfulness.ts`将相同候选/来源下互不依赖的审查与术语检查并行启动，allSettled收齐：主审失败仍失败、主审拒绝仍拒绝；只有主审supported且术语成功/无新增项才支持候选。主审拒绝时可能多做了一项最后不使用的术语请求；一次负例回放该项UPSTREAM_ERROR，但主审contradicted仍拒绝，不使错误答案通过。这会消耗部分额外额度，最大模型尝试仍18，单次20秒及全部90秒期限保持。不并行有依赖的工具、生成或纠正，不改变只读归属、模型/思考开关、输出预算或安全标准。

同一固定目标优化后`agent-latency-20261012-parallel-1/timings.json`为26008ms，相对基线少7634ms（约22.7%）；审查12753ms与术语11348ms的开始相差1ms，实际重叠等待。生成本轮反而8114ms，说明响应随机性与服务时延仍存在。基线/优化各一次，不能作为平均速度、P95或保证每次快23%。两个实际回答已人工对照第七题原文：来袭方饱和/成片、防御方单一目标限制、系统集合升级方向正确，保留口语噪声与未知掌握；不以supported自评替代人工核对。

最终真实HTTP `agent-latency-20261012-http-1`本人200（服务器30409ms）、匿名401、跨用户admin403，8:55原文、1道已有题、预算内20分钟方案正常且人工核对主体/方向。`stages.txt`包含脱敏的同一runId阶段/HTTP记录，审查15703ms和术语11512ms也同时开始。此次30.4秒比独立26.0秒更长，保留波动而不只引用最快数字。

## 故障定位与隐私

- `model.ts`集中记录固定stage、开始/耗时、成功格式尝试、输入/输出token计数及失败错误码。AsyncLocalStorage让诊断入口并发隔离；普通后台日志带既有traceId。没有原文、提示词、答案、错误正文、凭据或隐藏推理。失败尝试次数未知时省略，不补造为两次。
- `spark.ts`私有agentStage不发送到供应商，也不进入公开DTO。带阶段的Agent响应若官方finish_reason=length，则分类OUTPUT_TRUNCATED，关闭结果且不以相同输出预算再次格式修复；其它AI保持原行为。该分支由测试验证，本轮真实请求未出现截断，不能用它追溯宣称昨日SCHEMA_INVALID根因已找到。
- 诊断入口`agent-retrieval.ts ... diagnostic`保存timings；后台也能按runId关联阶段。原非Agent路径、API权限/字段、数据库、页面、训练、云端推理及.env.local不变，无新依赖或业务模块。

## 验证与边界

- 初次全量checks-2有7项旧串行次数/Date.now调用顺序假设失败，证据保留。测试按两类核对的实际请求内容分别模拟，保留主审至多两次格式尝试和独立术语次数；过期检查改为真实固定过期时刻，不按Date.now第几次调用制造期限。没有删除安全断言或改全局测试超时/并行设置。
- 新增并行启动但两项都完成才发布、术语故障关闭、并发诊断隔离/脱敏、日志异常不改变结果、截断不重试等测试。最终`agent-latency-20261012-final-checks/vitest.json`默认并行115文件844/844通过；TS strict与7份实现/验收/测试文件ESLint通过。
- `agent-latency-20261012-replay-1/report.json`八个真实历史错误/正例回放全部符合预期，六负例拒绝、两正例支持。额外术语请求的一次上游错误与两次格式尝试留在原过程输出；不是八次服务全无故障，也不证明任意资料普遍准确。
- 基线、优化、回放和最终HTTP十类学习数据保护指纹均`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`。无真实作答、计划写入、重新解析或本人资料改动；本项没有操作浏览器或改变电脑端尺寸，已有页面对话未清空。

复现：桌面主仓库运行`npx tsx scripts/acceptance/agent-retrieval.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/新的独立目录 diagnostic`；读取新目录timings.json/result，不覆盖旧证据。API验收把末项改为model，需本机网页运行。模型真实调用消耗已配置额度；无隐式模型回退、SDK安装或费用保护改动。

本项已完成测量、并行优化、故障定位及相关真实/回归验证。仍可能遇到供应商波动、真实格式错误或90秒期限；没有保证秒回或宣称全部间歇性故障消除。无TODO补全，TASKS/ARCHITECTURE/PROGRESS/LEARNINGS非TODO更新原因是已授权诊断与调用调度变化，公开字段与接口不变。
