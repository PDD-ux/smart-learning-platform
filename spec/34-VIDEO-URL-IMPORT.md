# §29.21 公开视频直链导入

2026-10-21 用户明确要求补上视频URL导入，优先于§29.11剩余演练；本轮只实施本编号。

## 输入与交互

学习中心的公开链接面板增加“文章/PDF”和“视频直链”选项。仅支持直接返回video/mp4或video/webm的HTTP(S)地址；不从视频网站HTML解析播放源、不执行脚本、不带Cookie，不支持网盘、DRM、HLS/DASH。用户在下载前明确确认有权使用，并同意后续既有OCR/ASR/AI解析可能消耗已配置服务额度。

POST /api/video-imports严格接收{requestId:UUID,url,confirmed:true}；同账号同键同URL只下载一次，异URL409。复用本人UrlImportDraft状态及GET/DELETE /api/url-imports/:requestId。前端仅保存不透明编号，刷新/失败先重读状态，禁止自动重发。成功刷新资料列表并提供进入学习；解析失败通过原资料重试，不伪造READY。

## 下载与生命周期

复用原DNS全部地址/固定IP/实际socket/逐跳HTTPS安全边界。视频限制100MiB、120秒总下载、最多3跳，检查声明和实际字节、MIME及MP4 ftyp/WebM EBML签名。流式写系统随机临时目录，不把视频放数据库Bytes或整段内存。ffprobe仅file/pipe协议核验真实视频轨、有效尺寸和0–7200秒时长；缺工具/格式无效明确失败。MP4首版限H.264，WebM限VP8/VP9/AV1。

校验后流式写私有contents/url-<draftId>/source.mp4|webm。LearningContent VIDEO保存真实format/size/duration和既有urlSource来源，作者未知留空。确认时VIDEO/PENDING和一次AsyncJob同事务保存，入队成功后转PARSING并走既有CONTENT_PARSE→UNDERSTANDING；入队前进程退出时原complete可手动重试；入队失败资料标FAILED、提示手动重试，保留正式源视频。

用户行锁/状态复核防重复下载、取消迟到。取消/过期/失败清理未提交对象和临时目录，已提交对象保留。进程崩溃的孤立对象由30分钟草稿期限和有界cleanup-url-imports维护清理，不声称已安装定时器。无新表/迁移，不改变旧文章/PDF快照。

## 验收

覆盖DNS/重定向/socket保护、声明/实际超限、取消/超时、伪装MIME/文件头、无视频轨/超时长/编码、流失败和临时清理；同键重放/异URL冲突、跨人拒绝、取消迟到、存储/数据库/队列失败、正式对象保护、文章/PDF回归及授权/状态重读/进入学习UI。公网获取和受控测试分别记录；若DNS仍映射198.18.0.0/15，保留阻塞，不放宽SSRF。
