# §29.12.1 星火唯一文本模型验收

完成时间：2026-10-18 18:22（Asia/Shanghai）。本轮仅执行用户优先指定的29.12.1，不执行EPUB/URL/班级/批改或LoRA训练。

## 改动

- src/lib/ai/spark.ts删除OpenAI Responses路由/解析/推理预算，仅支持spark；Agent、资料抽取、笔记/问答/练习沿现有网关统一调用。保留安全业务错误、JSON两次上限、截止/取消、来源及学习质量校验，不自动换供应商/型号。
- 本机.env/.env.local删除OPENAI_*，LLM_PROVIDER=spark，沿用原SPARK_MODEL=generalv3.5及凭据。env-protection.json证明其它配置值未变；随后review-config-protection.json单独记录把原AGENT_REVIEW_THINKING=true关闭为false，其余值不变。AGENT_REVIEW_READY仍false。env不进入版本控制或输出凭据。
- 按官方HTTP文档补输出型号限额、stream:false、支持型号的web_search.enable=false及截断/拒答/工具结果拒绝；Lite不传不支持的搜索参数。不是把联网关闭当成语义准确保证。
- 扩展审查是显式可选的逐句覆盖/术语核对，不再依赖已删除供应商；本机关闭，避免沿用之前未经本型号完整验收的额外调用。标准审查、证据模式与引用校验仍保留。
- .env.example、Compose、普通演示预检、agent-model-health、生产烟测隔离配置和测试夹具同步；新增spark-study-quality原创有界检查，不读数据库或用户课程。README/DEPLOY/PRD/03/04/05/22同步当前配置，18加历史标识，历史验收/spec资产保留。没有新增依赖、数据迁移或页面。没有待补TODO；修订的是现行供应商等非TODO说明，原因是用户明确取消OpenAI。

## 验证

证据目录：.taskbook-working/spark-only-20261018/。

- full-tests.log：169文件1480测试通过（初轮targeted.log的3处失败是遗留OpenAI响应夹具，已改星火格式并由全量复验通过）。覆盖默认/显式路由、拒绝废弃供应商、JSON/行协议、搜索禁用、型号预算/原型名拒绝、截断/拒答、取消/超时与原业务回归。
- type-check-final2.log：非增量TypeScript通过；lint.log：源码ESLint通过；tooling-lint-final.log：对修改测试/脚本使用--no-ignore实际检查通过。保留最初脚本类型遗漏及默认ESLint忽略告警，不把忽略当检查通过。
- health/spark.json：真实generalv3.5短JSON请求一次通过，1797ms，43总tokens；仅证明短调用通路，不查询余额或承诺长期可用。
- quality/report.json：原配置扩展审查尚开时，原创两主体资料笔记格式第二次通过，语义人工核对正确；错误解释被拒绝但分类为insufficient而非contradicted，因此严格样本未全通过。保留原失败，不改成通过。初版脚本未限制扩展审查，实际共5次模型请求（笔记2、主审查1、术语2），未触及业务写入。
- quality-basic/report.json：关闭实验开关后，有界新配置核对，真实笔记一次通过约4415ms，两个主体/真实摘引正确、无补造速度成本；标准审查一次约4098ms，明确contradicted并指出主体颠倒，2项通过。这只是2个原创短样本，不证明长课/所有学科/自由解释质量通过，不据此开启AGENT_REVIEW_READY。
- 新脚本固定只检查基本审查，最多2项×2格式请求；没有循环重跑碰成功。两次分别用于原开关及关闭后配置，原失败保留。模型调用走已有型号，未切付费新型号/购买额度；真实探测会消耗原账号token。
- server-restart.json：身份核对后仅重启本项目Next开发服务，加载最终配置。web.json：登录页HTTP200；demo-check.log：已有资料演示预检通过，数据/认证/人脸健康通过，AI/ASR配置和Ascend在线分别记录。未占用或停止人脸/Ascend进程。

## 边界与复现

运行 npx tsx scripts/acceptance/agent-model-health.ts spark .taskbook-working/自定义新目录 核对短接口；运行 npx tsx scripts/acceptance/spark-study-quality.ts .taskbook-working/另一新目录 核对原创样本。新目录必须不存在；脚本不输出密钥或上游私有错误，样本正文均为原创非私人。

本轮未执行原课程重新解析或学习数据写入脚本，无新增媒体/训练/迁移；未做逐表/对象目录前后全量指纹，因此不声称原数据库和媒体全量哈希核验通过。未重新构建生产包、未操作真实用户登录或跑完整新上传，未证明云视觉在线或原全部教学质量问题修复。原笔记保持，需要用户另行明确重新整理才使用当前模型。下一编号仍29.13。

官方核对：[星火HTTP接口](https://www.xfyun.cn/doc/spark/HTTP调用文档.html)，2026-10-18。
