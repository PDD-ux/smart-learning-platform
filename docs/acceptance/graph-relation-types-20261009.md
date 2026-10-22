# §10.2 前置/相关关系真实模型与页面验收（2026-10-09）

本轮只继续 §10.2。上轮已验收“举例”关系；本轮检验前置与同层相关。为避免改动用户资料，在独立临时账号的无对象 Markdown 资料里放入三个**人工撰写**的知识点摘要，明确表述“先理解梯度才能学更新公式”和“更新公式与学习率选择同层相关”。知识点不是本轮 AI 抽取的；关系生成是真实星火 Lite 请求，结果经真实 PostgreSQL、局部图谱 API 和本地浏览器核对。未重新上传、调用 Ascend/ASR、重生成旧资料或修改现有用户数据。

原主抽取返回合法 `edges:[]`，API 为 3 节点/0 边，不能算通过：[失败入口结果](graph-relations-oct09-relation-types-v1.json)、[原始模型响应](graph-relation-types-diagnostic-20261009.json)。追加综合提示的[诊断 v2](graph-relation-types-diagnostic-v2-20261009.json)将公式误当举例；仅抽前置的[诊断 v3](graph-relation-types-diagnostic-v3-20261009.json)得到正确梯度→公式，但漏相关；仅抽相关的[诊断 v4](graph-relation-types-diagnostic-v4-20261009.json)得到正确公式↔学习率。[诊断 v5](graph-relation-types-diagnostic-v5-20261009.json)表明省掉前置关系码又会返回空边，因此最终前置补抽保留 `relationCode:0`。没有把任何错误或诊断调用计作产品通过。

修复保留原主抽取协议，主调用缺少某种边时，只针对缺失的前置/相关分别补抽一次。各次仍校验当前点 ID、非自环、权重，之后统一映射真实 ID、去重写库；补抽失败不破坏主调用其他有效关系，主调用失败继续保留旧图谱。可靠空图仍允许，不强行造边。代价是图谱子阶段最多额外两次模型调用。

[最终隔离验收 JSON](graph-relations-oct09-relation-types-v2.json)：真实模型调用后 3 节点、2 边，局部 API HTTP 200；梯度→梯度下降参数更新公式为 `prerequisite`，公式与学习率选择为 `related`，方向/类型与摘要逐项人工核对一致。失败 v1 和成功 v2 的临时账号及资料均已清理，记录 `cleanup.remaining=0`，没有创建对象存储文件或共享媒体。

本地浏览器登录成功 v2 的临时账号，全部内容与单资料图谱均显示 3 节点/2 条关系；单资料显示“前置”“相关”标签，前置实线、相关虚线，SVG 路径均有非零宽高；点击公式节点打开详情。[DOM 与线型证据](graph-relation-types-20261009-browser.json)、[页面截图](graph-relation-types-20261009.jpg)。验收后退出账号并关闭临时标签页。

复现：配置本项目现有数据库、星火环境变量，启动本地 `npm run dev`，用环境变量 `UI_ACCEPTANCE_PASSWORD` 提供至少 12 位临时密码；在主仓库执行：

```powershell
npx tsx scripts/acceptance/graph-relations.ts setup your-unique-run-id relation-types
# 查看报告中的账号，在本地 /graph 切换到临时资料，核对两类关系。
npx tsx scripts/acceptance/graph-relations.ts cleanup your-unique-run-id relation-types
```

setup 会实际调用模型并保留临时资料供页面验收；失败时也必须 cleanup。每轮用新的 runId，避免覆盖旧证据。当前仅证明此明确样本与本次模型响应；不能保证任意资料的关系质量、模型长期稳定、旧资料自动重生成、完整长视频或生产部署。没有新增页面、字段、依赖或 TODO；更新 ARCHITECTURE/DATA-MODEL 的非 TODO 行为说明。

回归：81 文件/473 测试通过，图谱定向端点校验包含未知 ID、自环与错误关系字段；TypeScript、Lint、Next.js 生产构建通过。Lint 保留既有字体和 `<img>` 提示，构建保留可选 Valkey 提示；构建后恢复本地开发网页，`/login` HTTP 200。全仓库 `git diff --check` 仍受此前未提交 CSS 换行/空白问题影响，本轮未清理无关改动。
