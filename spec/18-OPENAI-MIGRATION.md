# §28.1 OpenAI统一接入与改动复核

> 历史迁移记录：2026-10-18用户已取消该接入。当前运行实现和部署以[22-SPARK-ONLY.md](22-SPARK-ONLY.md)为准，本文件不再作为配置指引。

用户于2026-10-18明确指定OpenAI 6 Luna、中等推理，星火备用，其余大模型接入删除。全部文本生成场景包括资料抽取、回忆卡、图谱、摘要、问答、学习Agent决策/解释/审查、随看笔记、旧录音整理、零散题库和整卷生成；MindSpore视觉及ASR属于独立模型职责，继续保留。

## 配置与协议

- 唯一服务端选择为`LLM_PROVIDER=openai|spark`，默认openai；切换spark须维护者明确改环境并重启Web/worker。废弃分散的Agent/文档/练习/组卷供应商选择，不因缺Key、额度或语义失败自动换服务。
- OpenAI默认`OPENAI_MODEL=gpt-6-luna`、`OPENAI_REASONING_EFFORT=medium`，凭据`OPENAI_API_KEY`仅服务端读取。走官方`https://api.openai.com/v1/responses`，`store=false`，无temperature/max_tokens/旧chat-completions输出假设；自定义根地址必须HTTPS且无userinfo/query/hash，重定向不携带凭据跟随。
- JSON任务使用`text.format.type=json_object`及JSON文字约束，保留已有Zod与至多一次格式修正；允许原有需要数组输出的非JSON任务沿原提示处理。格式合法不代表语义正确。
- OpenAI`max_output_tokens`含隐藏推理。既有maxTokens作为场景输出需求，另保留4096推理额度并限制总输出不超过模型上限；所有尝试共享原绝对期限、外部取消与任务调用预算。截断/拒答/非completed/空回答不能当成功或触发格式纠正重试。
- 只读取REST `output`中的assistant/output_text，忽略reasoning内容；usage映射回内部原token统计。HTTP401/403/429与insufficient_quota只映射固定安全错误，不输出厂商正文、凭据或隐藏思考。
- 保留星火现有官方HTTP、已知业务错误白名单及JSON能力，只使用SPARK_*配置。无新增依赖或客户端密钥选择。
- Agent原语义开关与只读工具/真实引用/用户点击保存规则保留；扩展审查协议改为OpenAI选项，不能沿用百炼验收结果证明OpenAI审查可靠。旧验收与失败记录保持历史身份。

## 核查和验收

1. 先保存1319项现有测试基线、TS/lint结果及用户提交差异，保留未跟踪_repro2.ts。
2. 补请求协议、默认/备用全场景路由、废弃选择拒绝、拒答/截断/预算/取消/无隐式回退及脱敏回归。
3. 验证本机密钥是否存在且网络/账号确实可访问gpt-6-luna，使用原创短文与有界调用，不发送已有用户课程、不循环刷成功。失败保留可复现入口及白名单阻塞证据，不猜余额。
4. 全量测试/非增量TS/lint/生产编译和现有隔离HTTP/数据库验收。配置存在、请求成功、学科语义正确、浏览器表现及外部视觉/ASR分别记录。

参考：[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[推理预算](https://developers.openai.com/api/docs/guides/reasoning)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)、[Responses参考](https://developers.openai.com/api/reference/resources/responses/methods/create)。
