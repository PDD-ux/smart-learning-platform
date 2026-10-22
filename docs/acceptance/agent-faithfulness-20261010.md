# §21.3 Agent忠实性检查与阻塞记录（2026-10-10 23:15）

执行仓库：`C:\Users\qwh76\Desktop\智能学习平台`。本轮仅§21.3，功能保护已实现，模型语义验收未通过，TASKS保持未完成。没有执行下一项、训练、购买/更换模型、改密钥、部署或写本人学习数据。

## 当前结果

有原文的候选答案必须至少一处6–180字符的真实引号摘引、最多5处，逐字匹配所选sourceIds；只折叠空白，不改词、删除有意义的英语空格或拼接不连续文本。未选来源/虚构摘引拒绝，不能自动给错误模型补引用。

新增`src/lib/agent/faithfulness.ts`通过既有Spark网关独立核对整个回答/计划标题。只输入所选真实原文、去除旧摘要的学习状态、所选题干及候选，未给标准答案/选项/旧聊天。拒绝理由含claim/sourceQuote/problem；前两者逐字匹配候选/实际来源，矛盾必须有原文锚点，缺依据可空。审查反馈也经过内容安全检查，不执行其指令或额外字段。至多一次语义修正再核对，仍失败返回503，无虚构成功结果。格式每次最多两试、决策≤3、最终生成≤2、审查≤2、实际工具≤4、总90秒；每次模型调用前后检查期限，校验不增写工具或权限。

**重要限制：当前lite不能可靠完成语义核对。** 真正错误的解释加上真实摘引后，审查仍输出supported。不能靠合法锚点或更长提示宣布解决。因此Agent原文分析受服务端`AGENT_REVIEW_READY`约束，默认关闭；明确原文/解释目标在本人状态读取后直接503，未调用生成模型；其它目标若实际检索到了原文，也在最终生成前拒绝。没有原文的状态分析路径保留（本轮仅组件/单元验证，没有宣称其真实模型全量准确）。已有笔记、题库、原资料问答接口不变；原问答未经过这次语义验收，不能声称其准确性同步提高。

公开失败提示为“当前模型的原文解释核验尚未通过，请到学习页回看原文；没有保存计划或提交答案”。私有REVIEW_NOT_READY/GROUNDING_FAILED均映射原AI_UNAVAILABLE(503)，不暴露候选/审查原文/密钥。只在更合适的模型通过回放及完整真实请求后开启验收开关，不能单独把开关设true掩盖现有失败。

## 检查与证据

- 23:14最终10文件87项回归、TypeScript strict、定向ESLint通过，日志在`.taskbook-working/agent-faithfulness-20261010-guard/{checks,types,lint}.txt`。覆盖摘引/未选来源/英语空格、原文与候选审查锚点、全段审查输入隔离、一次修正、两次拒绝/不确定、审查故障/安全/期限、验收开关、401/403/429及原助手/练习组/计划/问答回归。模拟审查通过仅证明代码路径，不等于真实模型准确。
- `...-replay/report.json`：首版审查拒绝旧倒置回答，但理由也误读原文；另一旧错误仅因plan=null拒绝。真实摘引+错误解释审查格式失败，纯摘引正例误拒。本轮不把“返回拒绝”自动认作语义检查成功。
- `...-replay-anchors/report.json`：加强双向逐字锚点与缩短提示后，两个旧错误及真实摘引+错误解释均supported，正例supported。**真实回放失败**，实际错误样本原文与当前535秒检索逐字一致，不能归因于来源缺失。
- `...-model/report.json`与`...-model-anchors/report.json`：两次真实产品请求503/AI_UNAVAILABLE，日志SCHEMA_INVALID；匿名401/跨用户admin403。`...-diagnostic/diagnostic.json`确认两次摘引未逐字匹配所选来源，未自动补句或放宽规则。
- 私有`.taskbook-working/agent-faithfulness-probe-0.json`及`...-probe-1.json`进一步记录直接比对仍错误认可，后一轮把候选句称为原文；另一次超时没有内容证据，不能算通过。`agent-faithfulness-source-0.json`来源单独阅读仍混淆限制归属，`...source-1.json`改变输入顺序也混淆事实；`...user-probe.json`将核对要求写入user角色后仍错误认可，不能直接归因于system角色兼容性。探针不改变生产提示或配置，不包含密钥。
- `...-guard/{guard,report}.json`：最终原文分析返回真实503及明确未核验提示，无data；匿名401、跨用户即使admin403，guardPassed=true。这是失败保护通过，**不是解释语义通过**。
- 所有有报告的回放/产品请求前后保护指纹均`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`，与§21.2一致。范围为XP、本人资料标题/状态、笔记/掌握度/作答/计划、当前自动笔记/知识点/转写/OCR；不包括普通浏览器进度元数据或未列资源。本轮没有浏览器操作/代作答/保存计划/题库生成/原文改写。

## 复现

桌面仓库既有数据库、网页及Spark配置可用。新入口用独占目录/文件保存结果，拒绝覆盖；内部JWT只用于本机API检查，未打印、落盘或注入浏览器。replay直接检查真实审查器，独立于关闭的产品成功通道；需要此前§21.2两个错误样本文件。guard检查本地开发服务的默认关闭行为。replay当前应非零退出、guard应通过；不应开验收开关只为让脚本通过。

```powershell
npx tsx scripts/acceptance/agent-faithfulness.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/faithfulness-new-replay replay
npx tsx scripts/acceptance/agent-faithfulness.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/faithfulness-new-guard guard
npx vitest run tests/unit/agent tests/unit/api/learning-agent.test.ts tests/e2e/assistant.test.tsx tests/e2e/exercise-group.test.tsx tests/unit/api/ai-qa.test.ts tests/unit/api/study-plans-bank.test.ts tests/e2e/app-shell-states.test.tsx
npm run type-check
npx eslint src/lib/agent src/app/api/assistant/agent/route.ts tests/unit/agent tests/unit/api/learning-agent.test.ts scripts/acceptance/agent-faithfulness.ts
```

未运行生产构建或修改开发`.next`构建流程。没有新浏览器UI验收，组件/API保护不能替代真人页面展示；已有历史回答不当作新通过证据。

## 后续依赖及模型建议

用户表示没有其它已开通API，并询问建议。建议先试现有供应商的星火Ultra：本项目已有自写星火HTTP客户端，沿用接口预计改动最少；官方接口说明Ultra支持system/Function Call，各版本APIPassword不同，并提供申请试用额度入口。具体额度/付费套餐由控制台确认，本轮未查到可可靠引用的具体价格，不给虚构费用。参考[讯飞官方HTTP文档](https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html)。

能力更强是候选选择，不是已在本产品验证过。拿到对应服务后仍需三项错误样本拒绝、纯摘引正例通过、原问题真实完整调用与人工主体核对、权限及只读保护通过，才可开启原文分析。本项目现阶段不需要自行训练大模型；已有检索、只读学习工具与计划确认流程，主要阻塞是当前配置服务的理解/审查能力。未加入其它provider或升级付费型号。

无TODO补全。非TODO变更为架构预算/验收开关、私有字段与失败提示、页面错误行为及任务进度，原因均为真实失败证据；没有新公开DTO、页面、表或依赖。§21.3保留未完成，未继续后续编号任务。
