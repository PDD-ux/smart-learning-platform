# §10.4 知识点来源修复与46分钟真实复验

2026-10-09 20:09完成。仅处理§10.4来源校验阻塞，使用桌面主仓库；原失败证据[19:45验收](video-46m-20261009.md)保留。本轮真实HTTP验收exit0/status=passed，不等同于全项目、浏览器实播或整课知识覆盖验收通过。

## 修复

`src/lib/jobs/pipeline/deep-extract.stage.ts`向模型提供本次实际保留、类型和区间有效的来源编号与文本。模型选择sourceIds，后端从编号读取精确ContentRef；原refs格式仍须命中来源白名单。有可引用来源时，每个安全知识点至少一处有效引用；未知编号或任一点缺引用进入既有extractJson最多两次校验，仍SCHEMA_INVALID使理解失败。校验成功前不删除旧知识点。不根据正文数字、邻近时间或个人笔记猜测来源，不增加公开字段、数据库字段或依赖。

`scripts/acceptance/video-product.ts`补充逐点引用数量及零引用知识点断言。本次长任务在补充该入口断言前已经启动，因此其product.json不含新增计数字段；额外的有界只读数据库观察在清理前保存了每点引用及与实际转写/OCR定位的匹配结果，见refs.json。不能把后来编辑的入口当作本次已执行的逐点断言。

## 实际结果

- 同一独立剪辑190132514字节、2760.083秒，SHA256为`90603076e50283dfd10b5df42eef9a15cfaeb6110a70df34eb10807a37a542a3`。不修改原视频。
- 19:54:16开始，20:09:04结束。真实登录、上传、complete及两任务完成；解析332ms、理解878060ms（约14分38秒），各一次队列尝试。
- 1380帧、96保留帧、94实际OCR帧、10585文本块，visualComplete=true。10个真实讯飞音轨窗口全部成功，769转写，末尾2759980ms，序号/顺序/区间检查通过。infer/asr均未降级，mock及后备OCR关闭。
- 6个知识点、6张闪卡、1份整理笔记。逐点引用数量为1/2/5/3/5/6，共22处（跨知识点允许重复）；全部非空、区间有效，均命中实际保存的转写/OCR定位。整理笔记sourceCount=6，理解及整理笔记API可访问。
- 45分钟（2700秒）人工笔记创建/回读、学习进度保存/回读通过；媒体Range返回206及1024字节。
- 临时账号和资料通过本人删除接口清理；独立数据库复核验收账号0、验收资料0，原18份资料产物指纹不变。没有重跑旧视频，没有改原学习记录或9月28日遗留任务。

## 明确限制

AI上下文仍truncated=true；本次引用仅分布在29–296秒，集中在前5分钟。虽然整段视觉/音轨处理成功，后40分钟重点覆盖没有通过验收，不能把6个知识点称为全46分钟课程笔记。图谱只有6节点、0边，练习未在此入口生成。本轮目标是修复缺引用仍COMPLETED的校验缺口，进一步分段知识抽取需后续独立任务与文档设计。

Range和定位接口通过不证明浏览器解码、实际点击回看或摘要语义准确。真实来源匹配只证明定位有依据，不是模型总结正确率评分。网页3000、真实Ascend8001和独立人脸8002仍运行，服务检查见services.json；演示19:26启动、最长约21:26结束，不能视为公网常驻部署。

## 验证与证据

TypeScript检查和改动文件ESLint通过；92文件551测试全部通过。新增3项回归覆盖来源编号到精确时间的映射和去重、未知/全无/部分缺引用进入schema重试门、校验耗尽前不删除旧知识点。复用既有extractJson受限重试测试，不增加新依赖或接口。

证据：[产品结果](video-refs-fixed-20261009/product.json)、[终态进度](video-refs-fixed-20261009/progress.json)、[逐点来源观察](video-refs-fixed-20261009/refs.json)、[脱敏阶段记录](video-refs-fixed-20261009/pipeline.json)、[清理复核](video-refs-fixed-20261009/cleanup.json)、[服务状态](video-refs-fixed-20261009/services.json)、[启动快照](video-refs-fixed-20261009/startup.json)、[文件哈希](video-refs-fixed-20261009/manifest.json)。只保存元数据与定位，不保存课堂正文、签名、令牌、密码或模型原始回答。

## 复现

依照DEPLOY现有真实演示入口启动，等待ready；为隔离验收加`--queue-retries 0`，仅影响演示子进程。剪辑需放在既有忽略目录，真实ASR和大模型凭据仍留本机环境变量。

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
node --import tsx scripts/acceptance/video-product.ts .taskbook-working/long-video-46m/product-next.json
npx vitest run tests/unit/jobs/deep-extract.stage.test.ts tests/unit/ai/extract-json.test.ts
npm run type-check
```

完整入口真实调用外部ASR和大模型，会产生对应服务用量。每次选择新输出路径，不覆盖已归档结果；超时且仍有运行任务时保留验收资料，终态后再清理，不删除运行中的资料。
