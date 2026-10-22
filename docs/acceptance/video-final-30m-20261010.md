# §10.4 修复后30分钟完整新导入验收

2026-10-10 10:22:02–10:37:18，在桌面主仓库、本地网页和真实ModelArts Ascend环境，对已有30分钟视频的独立副本执行一次完整上传验收。入口exit=0/status=passed；不复制旧转写或OCR来替代新解析，不重跑原学习资料。

## 实际结果

- 样例119039256字节，ffprobe时长1800.032秒；SHA256为f9b9f78fabe1481dbfd2b584dcacfb371902a79794744846a005b454e91e5a5b。使用隔离临时账号，经登录、upload-intent、真实上传、complete进入流水线。
- CONTENT_PARSE及UNDERSTANDING均SUCCEEDED、各一次尝试；基础解析378ms、理解910293ms。两项推理/ASR降级标志均false。
- 真实Ascend六个画面分段，每段150帧/10 OCR关键帧，共900帧、60 OCR帧、6336文字块；visualComplete=true。健康检查device=ascend、modelsLoaded=true、mock=false、后备OCR关闭。
- 真实语音六个分段分别93/86/76/86/86/83条，共510条转写；seq及时间范围校验通过，最后结束1799980ms。
- 大模型生成11知识点、11闪卡、1份整理笔记，六个时间窗均有定位；所有知识点引用非空，57处引用均在视频范围内，整理笔记sourceCount=11，理解和笔记API可访问。图谱阶段记录11节点/0关系，本次不宣称关系质量、摘要准确率或每分钟全覆盖。
- 1740秒（29分钟）个人笔记创建/回读、进度保存/回读通过，视频Range返回206及1024字节。这些是接口验收；浏览器播放已在此前独立记录，本次未连续观看全片或听辨音频。
- 临时资料及账号删除完成，独立复核均0，总资料18。入口既有产物指纹一致，额外复核原18份资料及转写、OCR、知识点/图谱节点/掌握度、闪卡/复习、笔记、练习、进度、图谱边、异步任务完整指纹相同。额外快照在临时上传后取得，因此同时保留入口上传前的指纹结果，不将晚取快照描述为上传前快照。
- 演示Web37960、隧道61424保持运行；当前ready、网页登录200、真实Ascend热就绪。既有重连记录只有09:52的故障注入恢复，本次完整验收没有新重连。原有1条RUNNING遗留任务保持，不处理其它编号任务。

## 修改与剩余边界

本次没有修改产品代码、接口、字段、依赖或页面，仅执行既有真实验收入口并更新TASKS/PROGRESS非TODO验收状态及本记录。上轮568项测试及TS/ESLint已通过，本次代码未变化、哈希复核一致，不重复构建或业务测试。此前失败记录全部保留，不将这次11点与独立预解析演练12点混为同一次结果，也不写回原视频的5点/17定位。

已完成此前待办的修复后30分钟单次完整新导入。历史SSH断线根因、长期稳定性、生产Redis worker和公网常驻部署仍未验收；当前限时演示09:49启动，最多至约11:49，实例可能提前到期。不能凭一次通过宣称生产稳定。

## 复现与证据

保持DEPLOY.md §8.5真实Ascend演示ready，使用新输出文件保留历史记录：

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
node --import tsx scripts/acceptance/video-product.ts .taskbook-working/video-final-30m-20261010/product-next.json .taskbook-working/video-30m-20261010/sample.mp4
```

入口创建自己的账号和副本，只有任务终态才清理；超时保留仍在执行的资料。凭据留在本机环境，不归档课堂正文、模型回答、密码、token或上传签名。

[完整结果](video-final-30m-20261010/product.json)、[阶段日志](video-final-30m-20261010/pipeline.json)、[扩展指纹及清理](video-final-30m-20261010/cleanup.json)、[最终服务](video-final-30m-20261010/final-services.json)、[源码一致性及降级结论](video-final-30m-20261010/verification.json)、[证据哈希](video-final-30m-20261010/manifest.json)。
