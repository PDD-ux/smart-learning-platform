# §29.15.1 章节原文笔记与个人摘录实施契约

29.15父任务仍未完成，专题问答/粘贴正文分别留29.15.2/29.15.3。本次只在已有PDF/TXT/MD/EPUB的BookReader内扩展；视频随看笔记、原GeneratedNote/Note、模型配置不改，无新表/依赖。

## 输入与呈现

阅读区“章节笔记与摘录”按需首次打开后挂载，折叠只隐藏、不卸载。选择已提取的1–20页/段；目录章节超20单元须拆分，不隐式全章截断。原文选择用实际文字偏移，显示高亮、独立批注/最多5个标签；切范围保留已选原文和批注草稿，保存仍绑定选中时范围。失效引用需重新选择，不把旧草稿套到新章。

AI仅在本人确认“将本次范围文字发送至星火”后单次调用，最多4500输入字、2000输出token、45秒，不自动重试/回退/联网。每份资料同时最多一项RUNNING、每用户6次生成/分钟。提示模型从原文选择最多5条、每条180字的逐字摘录，服务端验证位置/逐字包含/重复/安全；标题与范围由服务端提供。拒绝不在原文内的改写、错误定位和空输出，不以有效JSON冒充忠实摘要。标识“AI精选原文要点，非改写摘要；要点可能有遗漏”，输入页段数与实际引用页段分别列出，不改变整书AI状态或旧笔记。

## 数据与并发

BookState.version仍1，增加可选readingJournal（旧记录缺失视空）。journal含revision、entries、最近32个变更请求。每份资料最多100条含移除记录、JSON序列化最多1MiB；单条摘录2000字、批注4000字。entry：id=创建requestId UUID、inputDigest、kind=AI|EXCERPT、state=RUNNING|READY|FAILED|CANCELLED、version、sourceDigest、start/end、unitKind、totalUnits、title/章节范围快照、points[{position,start,end,quote}]、annotation/tags、reason、createdAt/updatedAt、leaseUntil、removed。原文点与源摘要不可编辑，批注与标签以expectedVersion冲突保护；移除可恢复，不物理清除历史。

文档文件/原文范围必须属于当前账号且READY；生成及新增摘录前核对实际文件SHA与bookState.sourceDigest。选段所有单元必须已提取且有文本，缺页/空白/待OCR失败，不暗中跳过。contextDigest绑定源摘要、起止及全部选段原文；生成落库前再核对当前缓存范围一致。批注可以在旧来源不可用时继续保存，回看需显示版本不一致。

写入先锁User FOR UPDATE、再读取最新LearningContent并合并journal，updateMany带bookRevision CAS并增一；书籍原写路径FOR SHARE及CAS继续生效，冲突不覆盖journal。bookView明确排除journal，防止目录DTO顺带返回全部笔记。生成预留RUNNING后释放事务再调用模型，90秒租约；读/写时把过期RUNNING标FAILED、不再次调用。成功只在RUNNING/租约有效/输入仍一致时写入；取消或迟到结果不能复活。相同创建UUID与相同inputDigest返回同条，不同负载409；变更最近32个请求重放可识别，过旧版本409，不重复改写。

## API与导出

GET /api/contents/:id/reading-notes?start=&end=&page=&removed=0|1：本人就绪书籍，返回context（digest、真实范围与全文缓存单元）、journalRevision、分页20条/total/items。GET不发起模型；私有no-store。POST相同路径受限32KiB，Zod严格白名单动作generate/excerpt/update/remove/restore/cancel；每个UUID，生成/摘录附sourceDigest、contextDigest与起止，摘录附position/字符起止，编辑附entryId/expectedVersion。错误固定中文，无书中文字/凭据/模型原始错误入日志；管理员无私人越权。

导出为用户明确点击后从已成功读取的当前页记录生成Markdown/TXT，带资料ID/标题、固定源摘要、实际页段/引用偏移、AI/本人批注界限及本页范围；失败/运行项不冒充正文。不能用本页导出称全书/全部笔记导出。HTML按React文本显示，mark仅包裹已验证字符，不执行内容。

## 验收

逐字引用、重复文字偏移、空白/缺页/源变化、幂等/编辑冲突/过期/取消迟到、原书籍写入保留journal、权限和预算分别回归；真实隔离数据库/HTTP与星火短原创文本（严格有限请求），人工核对引用内容和范围。原生桌面/390px划选、批注、导出、草稿保持。失败不核销父任务；保护原业务表/配置/媒体，测试资料精确清理。

2026-10-18用户追加指令：generalv3.5真实请求11200阻塞后，默认型号改回已开通的免费Spark Lite，沿用凭据，不回退其它供应商；本轮只变SPARK_MODEL并重启网页，保留原失败证据。

实现补充：原文件核验每用户12次/分钟；整段摘录按钮作为触屏/键盘替代，超2000字禁用，局部划选仍按UTF-16真实偏移保存，纯标点/空白拒绝。导出通过私有POST /api/contents/:id/reading-notes/export，输入最多1KiB、当前页20条，成功前写reading-note.export元数据审计（不含笔记正文）；客户端再生成下载。未保存批注只保留本页，刷新/离页不保证恢复。
