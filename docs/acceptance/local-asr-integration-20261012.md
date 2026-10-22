# §22.8 本地ASR产品接入验收

2026-10-12 09:41完成。仅本编号，正式增加可选funasr-local并在本机显式使用，不训练模型、不重生成原三份演示资料、不改变账号/页面/数据库表或公开接口。

## 实现与实际配置

src/lib/ai/asr-local.ts通过无shell execFile运行services/local-asr/transcribe.py，ASR_LOCAL_PYTHON与ASR_LOCAL_MODEL_DIR只读服务端配置。模型台账/时间校验位于服务模块，旧诊断脚本共享它；固定版本、九文件SHA256与依赖沿用§22.7。没有新增npm/Python依赖。

子进程环境仅系统路径/临时目录/NODE_ENV/PYTHONIOENCODING，不传API凭据；Python网络connect/create_connection阻断，无HTTP服务端口、无模型远程代码。每窗≤300秒16k mono PCM16，模型校验、180秒超时和2MiB输出限制；同一Node进程串行避免并行加载多模型。stdout纯JSON，失败不记录底层stdout/stderr/路径，仅固定不可用原因。

结果durationMs/segments严格验证：seq按序、非空文本、整数时间不重叠/不越界，实测WAV时长与预期最多差1秒；静音可返回空数组，整视频无有效转写仍由原流水线失败。所有时间窗口内起算，原light-filter负责加一次视频窗口偏移。失败不自动选择讯飞/mock或提交部分假结果。

本机.env.local明确ASR_PROVIDER=funasr-local，Python/模型均为桌面仓库local-asr路径，原讯飞密钥和其它配置保留、没有输出或提交密钥。Next dev热加载后真实日志provider=funasr-local；普通启动继承此配置。其它机器/生产须自己准备Python/模型，当前Docker未验证，不自动安装。

## 真实验收

- 实际provider入口：30秒3段，首轮4657ms，服务模块整理后再次4400ms；独立300秒课堂窗口23段11963ms。所有时间在本窗内，无全片偏移重复。未以这些样本承诺冷启动/全课/P95。
- 独立30秒视频由原535–565秒片段重新编码，使用临时账号经真实登录/上传/complete，Ascend15帧/1 OCR帧/92块，本地ASR3段；真实星火生成3知识点/3闪卡/1笔记。理解COMPLETED、转写范围/来源引用/窗口覆盖/整理笔记、个人笔记定位、进度往返、媒体206及1024字节全部通过。09:36:53结束，临时账号和资料清理成功，所有既有内容产物指纹保持。
- 61项相关TS测试、3项Python时间测试通过；类型检查/5文件ESLint及Python编译通过。覆盖后窗口偏移、坏区间/输出拒绝、失败无付费fetch、固定原因无路径和失败后队列释放。首次TS NODE_ENV字段缺失修复后通过；无修改默认测试超时或全量并行设置。
- 原学习保护指纹前后cf384122c28cf08cbef616ec39de7305ab66a21c9a5642f0ab77104ff080ad13一致，modelCalled=false（保护入口）。完整视频验收确实调用了星火，因此并非所有验收均无大模型调用；ASR部分没有讯飞请求。未做本人浏览器播放或实际重新导入原视频。

本地证据：.taskbook-working/local-asr-integration/provider-1.json、provider-300.json、provider-final.json、video-1/report.json及progress、checks/vitest.json；前后只读报告local-asr-integration-before/after。真实网页日志ascend-demo/20261012T010334Z/web.log包含funasr-local阶段结论；原报告和失败未覆盖。报告中的课堂文字只保留本机。

## 复现

先按§22.7准备依赖模型，在.env.local配置上述三项。视频样例必须新目录，完整验收会消耗配置的大模型调用但不调用讯飞ASR：

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
node --import tsx scripts/acceptance/local-asr-product.ts .taskbook-working/local-asr-integration/provider-NEXT.json
# 已准备好新的30秒视频及新的证据目录时：
node --import tsx scripts/acceptance/video-product.ts .taskbook-working/local-asr-integration/video-NEXT/report.json .taskbook-working/local-asr-integration/video-1/sample.mp4
```

provider入口拒绝非funasr-local配置，输出已存在时在运行前拒绝。单独300秒入口传AUDIO.wav和300为末两参数；只读适配器诊断不写数据库。生产入口无常驻服务需要启停，按需子进程退出后释放模型。希望恢复讯飞可人工改ASR_PROVIDER=xunfei并重载配置，不删除密钥/转写数据。

本轮未完成全30分钟新导入、逐字对齐/人工准确率、多人噪声/生产Docker/长期稳定性；语音时间为段落级。免费本地转写不代表知识点/Agent免费，也不替代Ascend视觉推理。文档无TODO补全；非TODO同步已授权接入、配置/依赖与验收边界。
