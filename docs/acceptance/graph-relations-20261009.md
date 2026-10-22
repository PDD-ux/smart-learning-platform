# 图谱关系生成与浏览器展示验收（2026-10-09）

本轮仅继续 §10.2。此前短讲义闭环只能证明节点/掌握度回读，关系边为空；本轮复用其真实 AI 生成的三个知识点，在独立临时账号和资料上重新调用真实星火生成关系，再核对真实页面。没有重新上传、执行知识点抽取、ASR 或 Ascend，不改旧内容和图谱。

## 修复

模型内部改用短编号，后端映射回当前资料真实知识点 ID。必需 mergeGroups/edges/examples 数组不能省略；前置/相关关系使用整数 relationCode 0/1，例子关系明确命名 examplePointId/conceptPointId，后端转换为例子指向概念的 EXAMPLE_OF。来源端点、自环、字段和类型校验失败仍有一次修正重试，持续失败保留已有图谱。可靠空数组仍合法，不为展示强制生成关系。外部 API 和数据库字段不变。

React Flow 自定义节点缺少连线 Handle，已补上透明且不可连接的输入/输出锚点，避免有 edge 数据却没有可渲染连线。节点外观、拖动、点选和关系标签保留，没有引入依赖。

## 失败和成功证据

- [入口首次失败](graph-relations-oct09-graph-final.json)：把 API 的 pointId 误当作数据库字段，已改为显式选择标题/摘要等字段，临时账号清理完成。
- [长 ID 协议失败](graph-relations-oct09-graph-final2.json)：真实模型 SCHEMA_INVALID，没有关系；清理完成。
- [短编号但关系反向](graph-relations-oct09-graph-final3.json)：实际得到三条关系，却把公式指向算例作为 EXAMPLE_OF；验收明确失败，没有把“有线”当作语义正确，清理完成。
- [例子命名协议、英文关系仍失败](graph-relations-oct09-graph-final4.json)：真实 SCHEMA_INVALID，清理完成。[独立诊断](graph-relations-named-diagnostic-20261009.json)表明例子编号正确，但模型另造 COMPLEMENT 枚举；诊断不算产品验收通过。
- [最终真实通过](graph-relations-oct09-graph-final5.json)：09:04:22–09:04:27 附近执行，真实 PostgreSQL 写入三节点、两条 EXAMPLE_OF，局部图谱 API HTTP 200；算例分别指向梯度下降原理和更新公式。算例展示了原理应用与公式数值计算，方向和依据人工核对一致。没有合并三个不同知识点；没有生成前置/相关边，不能宣称本轮验证了所有关系类型。

最终使用的是既有真实抽取知识点的副本，不是人工预置关系，也不是全新导入解析成功。所有关系均来自本轮实际模型请求。源证据：[原始真实知识点](real-ai-flow-20261009-a290c048-362f-4c5d-b0ad-66ca1bad8356.json)。各临时资料没有对象存储文件；全部五轮账号和资料最终清理，没有共享媒体需要删除。

## 浏览器

真实本地页面登录临时账号后，全部内容视图和单资料视图均显示 3 节点/2 关系。点击算例节点正常打开详情；切换范围重新加载后仍有两条“举例”线。

[浏览器 DOM/连线路径证据](graph-relations-20261009-browser.json)记录两条有非零宽高的 SVG path。控制台无 error；保留一条既有 React Flow 隐藏归属标识的提示，不能记为控制台完全无警告。没有在本轮确认 Pro 订阅配置或扩展该问题范围。

![单资料实际图谱](graph-relations-20261009.jpg)

截图与知识点详情点选来自本轮实际页面；全页截图呈现完整三个节点与两条线。随后已退出临时账号、关闭验收标签页并清理数据。

## 复现

配置现有本机环境变量，启动 npm run dev，为临时账号密码设置 UI_ACCEPTANCE_PASSWORD（不要写入报告或提交）。使用新的独立 runId：

```powershell
npx tsx scripts/acceptance/graph-relations.ts setup your-unique-run-id
```

根据输出账号在本地登录，打开图谱并切换单资料，检查点选与连线。结束后退出账号并执行：

```powershell
npx tsx scripts/acceptance/graph-relations.ts cleanup your-unique-run-id
```

setup 保留临时资料供 UI 验收，失败也需 cleanup；不要重复同一 runId 覆盖历史证据。入口依赖本仓库已保存的真实知识点 JSON，清理只针对命名临时账号。setup 会实际调用模型。

全量 81 文件/472 项通过，TypeScript 检查通过。新增模型端点校验、短编号/例子方向映射回归。真实成功样本不保证所有资料的模型稳定性或语义正确性；完整长视频、生产配置、全部关系类型和旧资料重生成没有在本轮完成。

Lint 和 Next.js 生产构建通过（既有字体/img/可选 Valkey 提示保留）。构建期间停止本任务的开发服务以避免 .next 并发写入，构建后恢复开发演示网页。
