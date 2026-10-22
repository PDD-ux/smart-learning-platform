# §22.15 星火222页文档真实复验

时间：2026-10-13 13:44—13:47（北京时间）。桌面主仓库，继续既有未完成§22.15。

## 结果：未通过，保留原资料

使用当前配置星火lite，在隔离临时账号复制真实222页PDF的解析文本，共规划23批、113799字符。实际4次模型响应、约28秒后第三页段返回HTTP500，网关UPSTREAM_ERROR。前两批完成（第1—13页），产生6条内存候选；第二批第一次输出多余“知识点:”行，经既有一次格式纠正通过。第三批提交失败，整个知识抽取没有提交替换；没有进入笔记/闪卡生成，不存在完整产品或语义质量验收通过。

实际尝试前三批，涵盖第1—24页、20122字符；并非222页已送达模型。原run/report.json的submittedPages/submittedCharacters当轮仍代表规划值，保留历史不覆写；真实完成/尝试统计另存real-coverage-clarification.json。不能据HTTP500认定额度用尽或服务永久不可用。

## 本轮工具修正

scripts/acceptance/document-coverage.ts先读取Next开发环境再动态加载Prisma，避免环境加载顺序不一致；记录响应次数和耗时，最多70次响应、10分钟后不再发新请求，不自动重跑整份或换模型。覆盖统计区分planned与实际初始来源提交，相同页段的格式纠正不重复计算；非JSON错误响应不会被证据采集误转成JSON解析错误。

工具统计另经隔离真实数据库+受控非JSON HTTP500验证：计划222页、实际1批/3页/7000字符，模型响应1，UPSTREAM_ERROR保留；临时数据清理。受控回放没有外网模型请求，不冒充第二轮真实模型验收。第一种CJS加载测试入口未支持动态TS模块，失败日志保留；改用tsx入口后通过预期失败断言。

TypeScript及工具ESLint通过；全量124文件963项测试通过（见full.log）。未改正式模型配置、语义校验、公共API、数据表或页面，无新依赖。

## 数据保护与复现

临时账号及资料已清理；原资料/笔记/成绩/计划及.env/.env.local指纹一致。原PDF知识点、闪卡、AI笔记没有增补或重生成。已有资料demo:check通过。

真实复现：npx tsx scripts/acceptance/document-coverage.ts run cmv50hdl7001lzh2svs7pjypg .taskbook-working/pdf-spark-replay-新时间。需要已有PDF解析记录、PostgreSQL和本机星火凭据；只使用当前明确配置模型，禁止把密钥发到聊天或写入报告。新目录避免覆盖历史。

证据：.taskbook-working/pdf-replay-20261013/real/model-1至model-4.json、real/report.json、real/batches.json、run.log、real-coverage-clarification.json、telemetry-check/report.json、protection.json及types-final/lint-final/full日志。

§22.15仍未完成。待上游可稳定完成请求后，继续首中尾引用、知识点/闪卡数量及AI笔记质量核对；通过前不运行原PDF补修apply。未新增题库验收或触发付费模型/云ASR/Ascend。

