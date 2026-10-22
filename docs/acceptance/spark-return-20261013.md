# 切回星火运行配置（2026-10-13）

用户明确要求“还是用回星火”，本次只完成§22.15的运行配置恢复，不重新生成旧资料。

## 已执行

私有.env.local将AGENT_MODEL_PROVIDER、EXERCISE_MODEL_PROVIDER、DOCUMENT_MODEL_PROVIDER设为spark，保留SPARK_MODEL=lite、已有星火凭据以及其它模型密钥；ALIYUN_AGENT_QUOTA_CONFIRMED保持false，百炼不发调用。星火此前解释忠实性回放未通过，因此AGENT_REVIEW_READY设false，学习助手保留既有证据模式和实际原文/练习/计划入口，不发布未经核验的生成解释。没有放宽出题选项、答案解析、来源和权限门禁。

## 实际验证

- 2026-10-13北京时间08:12:32，已有agent-model-health入口对星火Lite单次最小请求，HTTP200、业务码0、耗时2323ms，outcome=available。证据为.taskbook-working/zhipu-document-20261013/spark-return/。
- 3000端口原未运行网页；在桌面主仓库启动全新Next开发进程，加载.env.local及.env，PID107816。启动1533ms，实际GET http://127.0.0.1:3000/login 返回200。日志保存在同一工作目录spark-web.stdout.log/stderr.log。
- 只读取并核对非敏感provider/型号/开关配置，.env.local仍被git忽略；未修改数据库、已有题目、学习记录或手写笔记，无其它模型网络调用。
- 本轮没有代码或依赖变更，不重复运行回归/构建。最小连接成功与登录页200不等于知识总结、出题和Agent解释质量全部通过。

## 复现与待办

```powershell
npx tsx scripts/acceptance/agent-model-health.ts spark .taskbook-working/zhipu-document-20261013/spark-next
```

使用新的不存在的证据目录，凭据只从本机环境变量读取，单次调用无自动重试。

§22.15的222页文档知识点+闪卡完整验收及旧PDF补修仍待完成。恢复星火是用户选择，不核销此前语义质量问题；原失败结果保留。网站可通过http://127.0.0.1:3000/login访问，已有生成笔记和题目继续可展示。
