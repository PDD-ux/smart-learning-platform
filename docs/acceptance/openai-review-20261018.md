# §28.1 项目改动复查与OpenAI迁移（2026-10-18）

本轮在用户指定的桌面主仓库执行；原worktree为旧快照。只处理28.1：复查近期改动、统一文本模型及验证。没有新增业务页面、数据库迁移或依赖，也没有批量重跑用户导入。用户未跟踪的`scripts/demo/_repro2.ts`保持原样且未执行。

## 已发现并处理

- 用户新增的OpenAI分支默认仍是gpt-4o-mini，沿用旧Chat Completions参数。现为官方Responses、gpt-6-luna、medium；不发送temperature/max_tokens。响应只读取assistant/output_text，不返回隐藏推理；拒答、截断、未完成、空响应不算成功。
- Agent、文档、练习与组卷曾各选供应商，漏掉其它文本任务。现统一LLM_PROVIDER=openai|spark，默认为openai，所有文本任务经同一网关；星火仅人工切换。删除智谱/百炼运行分支、有效配置样例及本机旧选择/凭据项；保留历史验收证据。
- 本机OpenAI凭据曾为中文说明文字，导致HTTP发出前ByteString失败。用户已明确尚无API Key，因此清空该占位值；增加格式检查、固定脱敏错误。可复现检查为MISSING_API_KEY，不能推断为网络、余额不足或模型无权限。
- 演示体检原先不识别OpenAI且生成项只看星火，已统一检查；configured仍不等于在线或质量通过。
- 用户新增的组卷限流退避原先固定等待15秒，取消不能立即释放工作者。保留原重试次数/总期限，改为支持AbortSignal且不超绝对期限；额度不足、鉴权及其它错误不触发限流重试。
- 隔离验收脚本原先只清除旧模型凭据；现显式禁用OpenAI和星火，避免以后配置真实Key后回归意外调用。旧客户端provider注入仍拒绝。

## 最近用户修改的复核

复核了OpenAI可选接入、组卷限流、组卷蓝图提示、视频编号修复和视频精选弃权重试等提交。保留视频最多3次精选及格式边界、真实来源编号、逐字原文与失败保旧；没有为制造成功放宽题目、引用或忠实性校验。视频摘录策略及模型题目质量仍须真实内容复验，现有回归不证明所有课堂内容均正确。

## 验证结果

- 改动前基线：166文件、1319测试通过，TS/lint通过。
- 最终全量：166文件、1325测试通过；非增量TypeScript及eslint src通过。
- 新网关回归覆盖默认/备用路由、Responses参数、JSON校正、隐藏推理隔离、使用量统计、缺Key/非法地址、限流与额度区别、拒答/截断/超时/取消及不自动回退。保留Agent逐句覆盖、术语核对与证据模式；真实新模型验收前AGENT_REVIEW_READY=false。
- `node scripts/acceptance/exam-students.cjs --generation-page`：121项隔离PostgreSQL/NextRequest检查通过，包括取消限流等待、既有答卷/题目快照、组卷预算/租约/引用与确认保存。临时库已清理，主库、媒体、两份环境文件在该验收前后指纹一致。
- `node scripts/acceptance/production-demo-smoke.cjs --watched-notes --output-dir .taskbook-working/openai-review-20261018/production`：隔离生产构建与standalone真实HTTP/PostgreSQL通过；登录、安全Cookie、未登录/越权拒绝、退出、随看来源校验、缺模型明确503且不写笔记、旧入口跳转通过。临时账号、快照和服务均已清理，原开发构建未替换。
- 普通`npm run demo:check`通过已有资料预检；Agent/generation如实blocked，ASR配置与人脸health不作为本轮新推理验收。
- npm镜像审计接口返回404；显式官方registry复核（未修改持久registry）：生产依赖0告警，全依赖7个high，集中于braces及开发工具传递链。自动建议涉及Tailwind4大版本与ESLint配置降级，未在模型迁移中自动执行。构建另有BullMQ可选@valkey/valkey-glide模块缺失警告；当前构建/HTTP使用ioredis通路已通过，不等于Valkey后端验收。

工程证据在忽略目录`.taskbook-working/openai-review-20261018/`：baseline-tests.log、final-tests.log、typecheck-final.log、lint.log、database-page-regression.log、production/production.json、audit-official.json、audit-production.json、real-probe/report.json。历史首次迁移失败日志保留，最终结果以上述文件为准。

## 未完成与复现入口

用户尚无OpenAI API Key。本次真实检查在网关发出请求前以MISSING_API_KEY阻塞，未产生OpenAI推理请求；未验证账号对gpt-6-luna的权限、网络通路、额度、真实出题或语义质量。没有以模型存在、配置存在或mock通过冒充真实通过。当前主模型缺Key会明确不可用，保留的星火不会自动接管。

取得真实Key后，在桌面主仓库`.env.local`填写OPENAI_API_KEY并重启网页/worker；不要发到聊天。其余已设置：

```dotenv
LLM_PROVIDER="openai"
OPENAI_MODEL="gpt-6-luna"
OPENAI_REASONING_EFFORT="medium"
AGENT_REVIEW_READY="false"
```

先执行有界短请求（目录名须新建，不覆盖旧证据）：

```powershell
npx tsx scripts/acceptance/agent-model-health.ts openai .taskbook-working/openai-live-repeat
```

该入口每provider最多两次格式尝试、共享30秒期限，只记录白名单状态及token用量；available仅是短句通路与JSON格式通过。之后仍须做忠实性历史错误/正例回放及完整Agent/文档/试卷短样本，才可评估是否开启生成式原文解释。现有历史语义失败不核销。

若现在只需演示旧星火功能，可人工将LLM_PROVIDER改为spark并重启Web/worker。不会购买额度、自动降级或修改已有学习成果。

本轮未执行浏览器全页面视觉、摄像头真人识别、新视频ASR/Ascend与公网部署；7个开发工具依赖告警仍需独立升级验证。既有演示账号脚本/历史手册采用固定演示口令，不应将其原样用于公网部署，本轮未重置用户账号。

接口依据：[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[推理预算](https://developers.openai.com/api/docs/guides/reasoning)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)。
