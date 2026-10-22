# §29.12 PDF/TXT/Markdown书籍阅读验收

完成：2026-10-18 15:42。桌面主仓库，仅本编号；不包含EPUB、URL、章节AI笔记、摘录/高亮、专题、班级或作业批改。

## 使用方法与实际范围

学习中心选择已有或新上传的PDF/TXT/Markdown，进入学习页，在“书籍目录与分章阅读”点击“建立书籍目录”。旧资料不会自动生成索引、重跑理解或改写笔记。PDF优先内置目录；无可靠目录时按文件页段显示，明确不是原书目录。文本标题识别可校订，无可靠标题则明确自动分组；正文空行分段与旧parser一致，段n始终对应page1/blockIndex=n-1。

展开目录跳转；“校订目录”每行是标题、起点、终点，保存检查顺序、不重叠和边界，允许有未覆盖区间但不会编造章节。选择最多20页/段提取正文；扫描/空白PDF没有文本层时标待OCR，不执行识别或AI补写。显示索引已处理/有文字/待OCR数量，原导入的文字和AI产物分别保留；这不是整本AI理解或本章AI笔记。

TXT/MD展示已保存的原段落、未提取数量以及原文件入口；纯文本显示，不执行HTML或脚本。PDF仍用原页图和原页码进度；书签和“记住当前页”保存书籍位置。文本切章/分段跳转和提取范围保存续读起点，刷新恢复；不承诺记录到某段内部的像素位置。页码/段落引用仍按源文件物理位置，重新分章不改旧ContentRef。段落链接新增page=1&block=n兼容，旧视频和仅page的链接保留。

目录/个人笔记草稿切章不清；元数据读取失败保留原阅读器；失败保留范围和校订，手动同请求重试，重读有未保存目录时确认放弃。新书签不自动分享给课程。原页面摘要/问答仍使用原解析来源，本轮没有新增按章AI接口。

## 数据与资源边界

LearningContent新增bookState JSONB和bookRevision整数默认0，迁移20261018070000_book_reading已实际应用，旧行NULL/0不回填。新增API GET/POST /api/contents/:id/book只允许当前有效账号访问本人READY的PDF/TXT/MD，管理员没有跨人豁免。响应private no-store及Vary Cookie/Authorization，公开BookView排除内部请求摘要/原存储路径；正文仅返回所选范围的已保存单元。冲突沿用NOTE_CONFLICT=409；源改变拒绝继续，请重新导入，旧索引不覆盖。

原文件SHA256绑定、严格判别命令、64KiB请求体；最大50MiB源、2000PDF页/20000段、200章/100书签、每次20单元、单单元20000字符、累计500000字符。读取流和PDF操作各30秒预算，提取/初始化另有每用户12次/分钟限制，其它写入120次/分钟。超限整次不提交，不截断后称完成。CAS保护并发，保留最近32个请求摘要：同键同内容重放不重复保存；同键改内容或过期版本拒绝。旧键超出窗口不自动重做。

bookState是首版有界阅读索引，包含所选正文快照；没有新表/依赖、全量AI请求或自动重新解析。源对象由原上传路径管理，书籍读取不获取外部URL。删资料仍沿原生命周期；本轮原有资料没有任何显式转换写入。

## 验证

- 全量169文件1480项通过；含21项初始书籍专项、2项草稿/读取故障回归、2项真实PDF字节样本测试，原视频/笔记/进度/试卷退场回归保留。复用原最小PDF软件fixture验证无目录、实际两页与第二页无文本层，损坏PDF拒绝；不能把空白软件页称真人扫描教材OCR通过。
- 非增量TypeScript和改动源码、测试/脚本显式ESLint通过。两份旧LearningContent测试工厂补NULL/0新默认字段；两个旧学习页测试增加书籍服务空状态替身，原PDF图片失败/文本导航断言保留。
- 真实HTTP主链26项：PDF/TXT/MD、跨学生/管理员拒绝、失效账号、无自动初始化、源哈希、范围/字段/重叠、旧版本、幂等、书签、目录校订及续读。使用现有有权读取的222页PDF只提取前3页（3页有文本，未假称扫描识别）；252段原创MD有12个真实标题，先提取22–24段，未处理范围保持未知。旧笔记/文本块和原ref完全不变。
- 真实并发补验：相同请求同时两次200、只增一次revision/一个书签；不同请求争用同revision，一次200一次409、只增一次revision。源文件变化用验收TXT独立对象模拟，409且原索引版本不变。
- 独立临时IAB会话实际切章、目录草稿/个人草稿保留；实际提取127–129段、书签与刷新续读；个人笔记冻结page1/blockIndex22（原第23段），未随跳转改到127段。PDF查询page2加载真实1241×1754页图且记住第2页。1280宽度及390×844窄屏核对，新控件44px或更高；窄屏scrollWidth382≤390，临时视口恢复。测试标签已关闭，不宣称退出跳转另项验收通过。
- 临时三账号、三资料、正文对象、笔记及验收审计已清理；源PDF对象复用只读，清理仅acceptance/当前run前缀，未通过DELETE资料接口误删复用原对象。临时密码已从本机fixture状态清空。
- 原43张业务表的全部行摘要前后一致（对LearningContent剔除新增两列，迁移记录单独排除），其中13张Exam表保留。两env/旧迁移/登录和人脸页指纹不变。媒体旧snapshot只采public/uploads空目录（0文件），**不能作为实际对象存储全量指纹或视频字节核对**；本轮通过读写代码和限定验收对象清理保证不主动修改原媒体，没有宣称全量媒体已验证。该范围修正也适用于前轮沿用同旧snapshot的结论。

工程、实际提取和界面已验；本轮不运行付费模型、OCR/ASR或LoRA，不重建生产包，也不核销旧模型质量阻塞。

## 文件与证据

主要新增lib/books/contracts.ts、source.ts、service.ts，services/books.ts，components/study/BookReader.tsx及contents/:id/book路由；修改原study页和study-location、Prisma schema/窄迁移及相应测试。同步01/02/03/04/05/06/20/21、PROGRESS、LEARNINGS；无新依赖，无需改变README技术栈。

本机证据：.taskbook-working/book-reading-20261018/中的unit-final2.log、type-check-final2.log、lint-final2.log、lint-tests-final.log、http.json、concurrency.json、browser-data.json、protection.json、cleanup.json、migrate.log、prisma-generate-final.log及md-1280.png、md-390.png、pdf-reading.png。首轮JWT配置差异、标题误识别、DLL占用及测试替身错误日志保留；修复后验收通过，不以失败结果冒充正文质量结论。

复现：正常环境先npx prisma migrate deploy及npx prisma generate（Windows DLL占用时核对并正常重启网页），本地服务3000运行后npx tsx scripts/acceptance/book-reading.ts。此验收会创建独立临时账号/对象并保留到页面核对；完成后执行同脚本加cleanup，仅清该run的测试数据。需已有一份本人有权使用的长PDF；不自动下载教材或调用AI。书籍界面从原学习中心进入，不新增侧栏。下一编号29.13安全支持EPUB。
