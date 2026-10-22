# §22.24 星火业务错误提示验收

完成：2026-10-13 13:59（北京时间），桌面主仓库。

## 问题与修复

§22.15同页段真实复现10013，但网关只显示HTTP500，掩盖输入审核原因。src/lib/ai/spark.ts现在仅将官方白名单数字业务码映射为固定中文消息：审核10013/10014/10019、输入长度10907、流量10007、授权或业务量11200、日/秒级/并发11201/11202/11203。11200不推断余额耗尽。

支持非2xx与HTTP200业务失败，非零业务码即使附有回答也拒绝成功。未知/非法/非JSON失败仍通用提示；不回显上游原message、正文或凭据。沿用AiError UPSTREAM_ERROR/502、原任务errorReason及状态接口failureReason，无公开字段/接口、重试、模型切换、跳过页段或新依赖。

官方依据：https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html 。此处错误分类不是控制台余额查询。

## 验证

- 新增tests/unit/ai/spark-errors.test.ts共16项：旧实现11失败/5通过，修复后16通过；与模型选择/结构化抽取合计49定向通过。
- 全量125文件979项通过，TypeScript/本次源码及测试ESLint通过，普通demo:check通过。
- 真实隔离复制原PDF被拒页段（第13—24页范围）。使用已解析文本，light-filter为明确空操作，不做重新导入或云视觉验收；实际deep-extract调用星火一次，再次得到10013。
- 实际编排保留READY原文、understanding FAILED、零知识点/卡片，错误原因入库为固定中文消息。以临时账号真实登录查询本地网页状态接口，phase=failed且failureReason与数据库/网关一致。
- 临时账号及关联资料/任务清理，媒体创建0；原学习数据及.env/.env.local指纹一致。首次fixture用错TextSource枚举在模型调用前失败，清理/保护通过；修正为PDF后真实验收通过，历史失败日志保留。

证据：.taskbook-working/spark-errors-20261013/ 下before.log、after.log、full.log、types-final.log、lint.log、real.json、real-2.log、protection.json、demo-check.log。私有复现入口npx tsx .taskbook-working/spark-errors-20261013/real.ts，会创建并清理隔离页段，仅一次真实星火请求，需要现有样例与本地网页/数据库。

## 未完成与限制

本编号仅完成安全原因提示，不核销§22.15全量222页理解/笔记/复习产物或语义质量。原资料未重新生成，未绕过审核、换模型或充值；未真人浏览器点击验收、生产构建及公网验证。未知业务码保守显示通用原因，不凭HTTP状态猜测余额。
