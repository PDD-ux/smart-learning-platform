# §10.4 云端恢复与真实推理补验（2026-10-10）

桌面主仓库的ModelArts Ascend服务已恢复，关闭mock及后备OCR，本地网页已接入。历史SSH断开的根因仍未确定，不能把当前恢复写成永久稳定或公网部署完成。

## 修复与实际结果

- 910B4健康OK，四模型加载，MindSpore可用、device=ascend/mock=false。复用解释器及模型，在taskbook-demo-EI9yIHhj隔离运行；不覆盖旧目录、不改.env。随机令牌仅stdin/进程环境传递。
- 就绪后SSH退出最多3次、120秒内重连，受原两小时总时限限制。实际终止本轮隧道58024，4.605382秒恢复到61424，原网页37960、远端监督/服务70211/70212不变；不重放任务。断线中的请求仍可能失败。
- 远端lifecycle.json记录信号、到期及服务退出码；3项标准库测试通过。容器强杀可能无法记录，不能据此判断根因。
- 新PNG/JPEG READY前保存既有pageCount=1，让OCR第1页引用有效，不放宽页码校验、不回填旧图。
- 闪卡内部推荐严格按序二维问答数组，最多8点/批，行数等量、两字符串；单条保留外层数组。验证后映射pointIndex/pointId，兼容原合法对象格式，原问号/长度/安全及所有批成功才替换规则保留。知识抽取提示明确既有每点最多20条来源，建议1–5直接依据，不截断错误输出冒充通过。
- 30分钟独立新上传：真实视觉6窗900帧/60 OCR帧/6336文字块，真实ASR六窗510转写，无降级；6窗抽取12知识点/1笔记后闪卡JSON两次失败，入口FAILED。此为补修前结果，保留失败。
- 补修后独立语义复验：复制原30分钟资料已有真实510转写/1383 OCR，实际模型6窗12知识点/12闪卡/1笔记，所有点有依据、所有窗口有定位、闪卡关联正确；1740秒笔记/进度往返、整理笔记API、媒体206/1024字节通过。第一次语义失败及第二次成功都保存。此入口不重跑视觉或ASR。
- 最终图片完整链路10:17通过：真实登录/上传/complete，两任务SUCCEEDED；95 OCR与Ascend基线一致，pageCount=1、1有效引用知识点/1闪卡、理解COMPLETED。此前页码缺失、单卡扁平数组、来源超20失败独立保留。
- 临时样例清理，原18份资料产物指纹不变；独立复核总资料18、临时图片账号0、先前失败样例0。原有1条RUNNING遗留任务保留。
- 92文件568测试通过，TypeScript及相关TS文件ESLint通过，Python编译及3项生命周期测试通过。未执行会冲突开发服务的生产构建。BullMQ可选valkey模块编译警告仍存在，memory队列实际通过不代表Redis生产worker通过。

## 运行状态与未完成项

当前09:49:04启动，最多至约11:49本地时间，云端实例可能提前到期。快照ready、登录200、真实Ascend热就绪；原视频仍保留原5知识点/17定位，临时12点不写回原资料。

旧SSH日志closed by remote host；旧云端只有Acl store env context failed警告、无退出原因。新服务出现同样警告仍完成真实推理，所以不能把警告当作断线根因；当前cgroup OOM计数0也不排除历史容器事件。

剩余：最终闪卡提示补修后，30分钟从重新上传至全部产物的单次完整复验尚未重跑。大模型仍可能两次返回不合格结果，应记录失败；历史SSH根因、长期稳定性、生产worker、公网常驻部署待独立验收。不将分阶段成功替代整段新导入成功。

## 可复现入口

启动/停止详见DEPLOY.md §8.5，已运行时勿重复占用端口。使用新输出文件保留失败：

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
node --import tsx scripts/demo/accept-local-product.ts .taskbook-working/cloud-recovery-20261010/image-next.json
node --import tsx scripts/acceptance/video-windowed-semantic.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/cloud-recovery-20261010/semantic-next.json --playback
node --import tsx scripts/acceptance/video-product.ts .taskbook-working/cloud-recovery-20261010/video-next.json .taskbook-working/video-30m-20261010/sample.mp4
D:\python\python.exe -m unittest discover -s scripts/demo -p test_demo_lifecycle.py
```

[最终图片](cloud-recovery-20261010/image-bounded.json)、[新上传失败](cloud-recovery-20261010/video-product.json)、[语义通过](cloud-recovery-20261010/semantic-fixed-repeat.json)、[重连](cloud-recovery-20261010/after-reconnect.json)、[服务](cloud-recovery-20261010/final-services.json)、[清理](cloud-recovery-20261010/cleanup.json)、[阶段](cloud-recovery-20261010/pipeline.json)、[哈希](cloud-recovery-20261010/manifest.json)。归档移除课堂正文与模型回答，不保存凭据。

更新ARCHITECTURE/DATA-MODEL内部协议及图片元数据、DEPLOY运行方式、TASKS/PROGRESS状态和LEARNINGS踩坑。均为非TODO补修，无新增依赖、公开API、数据表或页面，只执行§10.4。
