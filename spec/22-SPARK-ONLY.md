# §29.12.1 星火唯一文本模型

现行型号追加修订：2026-10-19用户明确改回SPARK_MODEL=lite；29.12.1当时的generalv3.5保留为历史。新章节原文笔记以Lite真实回放核对，失败与通过分别见29.15.1验收。

2026-10-18用户明确取消OpenAI，只用星火。该修订覆盖18的现行运行配置，18及历史验收保留作历史。

- 服务端LLM_PROVIDER仅spark或留空默认spark；旧供应商值明确配置错误，不自动发送其它服务。SPARK_API_PASSWORD只在服务端读取，SPARK_BASE_URL默认官方HTTPS/v1，无userinfo/query/hash，redirect:error。
- 沿用本机SPARK_MODEL=generalv3.5（官方Max），不切换新的收费型号；样例提供lite作为可显式选择的低成本型号，不自动回退。按官方范围校验Lite4096、Max/Pro8192、Ultra/Max32K/Pro128K32768最大输出。temperature保留原场景值与默认0.3。
- POST chat/completions，JSON对象模式带response_format和明确JSON指令，非JSON数组/行协议不强制对象。支持内建搜索的型号明确web_search.enable=false，防止默认联网引入资料外事实；Lite不传不支持的tools参数。
- HTTP/业务错误固定白名单脱敏；空、截断、拒答、意外工具调用不能作为正文成功。共享绝对截止与取消、最多两次格式修正、无服务商/型号自动回退。现有引用/原文/题目质量保护不删，AGENT_REVIEW_READY=false仍保留证据模式。
- 移除OpenAI运行代码、env样例/本机配置及Compose传入/诊断选项；不删除spec历史或验收证据、不改MindSpore/ASR/人脸/数据库和旧笔记。
- 验证默认/显式星火全场景路由、旧选择拒绝、JSON/行协议/预算/取消/拒答/业务脱敏；有界原创短文核对接口及主体颠倒样本，未通过明确留证。切换不意味着历史学习质量问题全部解决。

官方依据：[星火HTTP接口](https://www.xfyun.cn/doc/spark/HTTP调用文档.html)，核对日期2026-10-18。
