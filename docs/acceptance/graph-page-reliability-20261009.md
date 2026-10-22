# 图谱页面可靠性验收 · 2026-10-09

仅继续§10.4，桌面主仓库；完成时间18:38（上海时间）。

修复：各读取失败明确提示并可重试，掌握度失败/无记录不显示为0%；图谱失败不显示零节点成功态；无可用薄弱点不提供一键复习。切换图谱清空旧范围并忽略迟到响应，局部节点提供当前资料来源。画布恢复默认React Flow标识。

验证：新增7项页面回归，图谱相关19项通过；全量92文件548项通过；type-check和lint通过（3条原有字体/原生图片提示）。最后标识配置修正后9项定向复验通过。没有重跑生产构建。

真实HTTP/PostgreSQL：临时学习者、人工讲义/知识点与0.75掌握记录，局部图谱返回200且含正确节点；网页局部节点显示75%、来源入口指向所选资料，画像75%，薄弱点真实为空时无一键复习。初次发现隐藏React Flow标识警告，恢复默认标识后刷新，无新增error/warn。失败网络场景由页面回归模拟，不宣称对用户真实网络进行断网验收。隔离账号/资料已清理；不改变真人资料或模板，不调用外部AI、摄像头或打卡。

![局部来源与掌握度](screenshots/graph-page-reliability-20261009.png)

复现（本地网页及PostgreSQL运行，.env.local配置有效）：

```powershell
npx tsx scripts/acceptance/graph-page-reliability.ts
npx vitest run tests/e2e/graph-reliability.test.tsx
npm run type-check
npm run lint
```

默认验收finally清理临时用户。浏览器需保留人工数据时可--keep-ui，凭据仅保存在被忽略.taskbook-working/graph-page-ui.json；结束执行--cleanup-ui，不能分享该文件。JSON结果见[接口证据](graph-page-reliability-20261009.json)。

未改变登录15分钟契约；自动续期、外部AI/ASR/Ascend与长视频质量、生产部署仍是原边界。文档非TODO同步仅涉及既有交互表现，无新增依赖、数据字段或公开接口。
