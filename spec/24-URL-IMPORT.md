# §29.14 公开链接导入实施契约

## §29.14 公开链接预览与确认保存（2026-10-18实施）

仅HTTP(S)默认80/443端口、公开静态HTML/直接PDF；不带浏览器Cookie/Authorization/Referer，不执行JS或加载文章子资源。DNS每跳验证全部IPv4/IPv6为公开unicast，连接固定本次批准IP并复核remoteAddress，禁止环回/私网/链路本地/元数据/保留/映射特殊网段；最多3跳且HTTPS不降级HTTP，绝对总下载30秒。仅identity编码，HTML≤2MiB/PDF≤10MiB，按实际流字节限额并核对Content-Length，不能只信声明。

HTML通过htmlparser2@12转纯文本Markdown，优先article/main并移除导航/脚本/表单/隐藏和嵌入资源；正文至少200字、至多10万字/5万节点/64层，拒绝登录/视频/网盘入口及高链接密度/没有可靠正文的页面。PDF用既有PDF.js目录/真实页数与前3页文本预览，不自动OCR或AI。预览最多12000字，明确实际范围，不能称全书理解。

新增UrlImportDraft：本人+requestId幂等，FETCHING/PREVIEW/FAILED/CANCELLED/EXPIRED/COMMITTED；最多3条活跃预览、6次新获取/分钟/用户，30分钟有效，缓存净化正文/PDF快照Bytes≤10MiB，原HTML不保留。新LearningContent.urlSource为不可变来源JSON：请求/最终URL、实际标题/作者/发布日期（缺失为null）、获取时间、原始/内容SHA256、前版ID。确认只读已缓存快照，不再次抓取。用户行FOR UPDATE串行确认/取消/重复判断，原content和引用不更新；相同请求返回同一个资料ID。对象键由草稿ID确定，数据库失败在同一用户锁下补偿，过期维护可复原处理孤立对象。

POST /api/url-imports {requestId,url}获取预览；GET/DELETE /api/url-imports/[requestId]读取或取消（已保存返回冲突，不删除资料）；POST /api/url-imports/[requestId]/confirm {confirmed:true,mode:reuse|new}复用相同URL+内容摘要的本人资料或显式新版本。private no-store；请求≤4KiB，字段/错误白名单，不回显任意网络/解析异常或向日志写URL查询串。管理员不越本人范围。

确认创建READY的MD/PDF资料及已有BookState，正文/AI覆盖仍从0开始，只在阅读时选段。预览是临时缓存不计资料、确认后原快照版本不可自动刷新；从原链接显式重新预览并保存新版本才更新，旧ID/笔记不重指。主学习中心加入文件/链接切换，预览须可读、可取消/重新核对；学习页显示来源与获取时间。无章节AI/粘贴/专题/班级或训练。过期在本人下次访问时清理，另提供有界维护脚本；未安装定时任务不能称自动定时清理。协议及存储生命周期见24-URL-IMPORT.md。

## 边界与验收

受控网络层单元验证特殊地址/混合DNS/固定IP/实际socket/逐跳重定向/降级/超限/编码/取消/超时；真实公网HTML和PDF独立获取，不能仅用mock通过称已可访问。原创HTML提取、脚本/事件/嵌入/登录页、长文与实际标题/来源/空元数据分别验收。隔离真实HTTP/数据库覆盖预览不入资料、确认/同请求重放/并发重复/另存版本/取消/过期/跨人/失败补偿/旧数据保护，宽窄屏入口。任何公网失败保留可复现证据，不能放行内网作为替代。不会自动调用文本模型，不把阅读就绪称AI整理完成。

## 2026-10-21 视频直链增量

用户确认新增§29.21公开MP4/WebM文件直链输入，下载前确认授权和解析额度，独立受控流式下载后复用既有视频链路；原文档预览/确认规则保持。具体预算、来源与清理按[34-VIDEO-URL-IMPORT.md](34-VIDEO-URL-IMPORT.md)，实现完成但正常公网DNS和原生页面验收仍待核对，不能把受控网络验证当作公网导入成功。
