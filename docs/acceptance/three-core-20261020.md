# §29.11 三主线整合与毕设演练：阶段记录

日期：2026-10-20，桌面主仓库。§29.11 **仍未完成**；已补同一组三角色的班级→提交→私人AI批改连续服务层演练，尚未完成三输入与三角色原生页面整链。先前§29.8单题真实模型通过及MindSpore分类器OM链路通过各有独立证据，不能代替三主线产品验收。

## 本轮修复与实测

- 侧栏第四项改称“智能批改”；工作台三步指引分别指向学习中心、班级课程、智能批改。帮助页去除“AI批改尚未开放”“EPUB尚无章节AI”等过期说明，明确本人提供依据、AI建议和负责人正式批阅的界限。
- 新作业错因面板使三个旧题库组件测试的`@/services/api` mock缺少`apiRequest`而失败。题库测试现隔离模拟该独立面板，其专门测试仍验证真实显示和操作。架构测试增加新批改路由适配器的认证、私有缓存断言；不放宽旧作业路由要求。
- `npm test -- --reporter=dot`：192文件、1733项通过；`npm run type-check`、`npm run lint`、改动测试/演示脚本的显式ESLint通过。
- `npx tsx scripts/acceptance/classroom-workflow.ts`：61项通过；`npx tsx scripts/acceptance/assignment-workflow.ts`：59项通过。均使用独立临时PostgreSQL库，回执标识`isolatedDatabaseCleaned=true`、`localMigrationApplied=false`；这两个脚本独立验证班级与提交，不声称同一批真实页面用户完成全链。
- `npx tsx scripts/acceptance/book-reading.ts`：PDF/TXT/MD目录、选段、来源保护共26项通过，222页PDF仅处理3页。该脚本暂留隔离浏览器夹具；本轮未做页面核对，已立即运行`npx tsx scripts/acceptance/book-reading.ts cleanup`，回执`usersRemoved=true`、`contentsRemoved=true`、`onlySyntheticObjectsDeleted=true`。这不替代新EPUB或URL页面演练。
- `npx tsx scripts/acceptance/url-import.ts`：38项真实HTTP与公网预览/确认、跨人拒绝、来源版本、取消过期及对象写入失败恢复检查通过；回执`checks:38, ok:true, contents:5`，`cleanup.json`确认剩余隔离账号/资料/草稿均为0、本地对象删除5个。本轮仍未在同一三角色原生页面链中完成URL阅读。
- 本地网页启动后更新只读`e2e-walkthrough.ts`，纳入三核心本人列表、专题、作业错因、旧试卷API 410及对应页面，移除旧麦克风页面作为现行入口。最后一轮：58项中57 PASS、1 WARN、0 FAIL。WARN为现有演示账号没有已建立目录的书籍，脚本没有用视频冒充书籍；另对管理员读取学员个人作业列表预期404，实际404。原读链路的48项全PASS是修改前的旧范围，不能作为本轮三核心结论。
- `npm run face:status`返回CPU真实模型已加载、`loginMode=scan`；未做本轮真人摄像头登录。网页/数据库/三份既有资料/鉴权/本地存储通过。Notebook启动前新导入预检曾因`ascend: blocked`退出码1；用户提供已启动的SSH 31637后连接成功，以独立`known_hosts`和临时云端目录启动真Ascend服务。本轮再运行`npm run demo:check -- --import`退出码0，云端`/health`为真模型就绪，仍须以实际推理结果验收。模型`configured`只表示密钥存在，未核对余额或普遍教学质量。
- 首次用用户此前提供的30秒课堂视频做**本机私有**新导入，资料`READY`、理解任务`COMPLETED`、本地ASR 5段与笔记1条，但2帧OCR请求超时，`visualComplete:false`、文字块0，脚本正确判失败并清理临时账号/资料，原报告留在`.taskbook-working/phase29-11/video-product.json`。未确认该录像有对外分享授权，不将其发布为班级课程。云端ONNX Runtime默认大线程池出现大量CPU亲和性错误；对RapidOCR显式设`intra_op_num_threads=4, inter_op_num_threads=1`后重新上传同一服务代码，同一文件SHA256重跑成功：30秒、15抽帧/5保留、2帧OCR得146文字块、5段ASR、1知识点、1生成笔记，`visualComplete:true`且没有`infer_unavailable`；理解耗时52.858秒，播放Range 206/1024字节、引用位置、手记定位、进度往返均通过。隔离账号/资料已清理，原9份资料产物未变。重跑报告`.taskbook-working/phase29-11/video-product-thread4.json`；这只证明本样本端到端运行，不是OCR准确率或普遍课堂质量评估。
- 另外在本机制作一份原创32秒“小课：函数的概念”（原创课件PNG＋本机中文语音，合成MP4留在忽略目录`.taskbook-working/phase29-11/original-lesson.mp4`），避免最终演练只能依赖已有录屏。真实上传/推理重跑两次，第二次启用验收脚本新增的可选OCR和ASR关键词断言；两者都在真实结果中找到“函数”。最终6转写段、6文字块、1知识点、1生成笔记，理解任务11.632秒，媒体Range/时间引用/手记/进度通过，隔离账号及产物清理、原9份资料未变。报告`.taskbook-working/phase29-11/video-product-original-quality.json`。关键词命中证明这张清晰课件没有完全空识别，不代表整页逐字准确或真实复杂课堂泛化。
- 尝试原生浏览器页面核对时，浏览器工具的URL安全策略拒绝本地页访问；没有改走其它浏览器接口规避。故本轮没有新增桌面/窄屏页面证据。
- 新增`scripts/acceptance/three-core-roles.ts`：单个**隔离PostgreSQL库**中，同一负责人创建原创函数班，甲乙学生邀请码加入，负责人发布章节和有截止时间的任务；两份草稿不计提交，正式提交后看板计2，乙不能读甲版本；负责人退回甲第1版，甲补充后交第2版，负责人分别给甲88、乙92，旧版/评语保持。甲再从**自己的第2版**创建私人作业校对、冻结一题，乙不能读甲草稿或运行其报告；真实Spark Lite分析错选A返回`READY/incorrect`，订正B返回`READY/correct`，规则比对从mismatch/0到match/100，正式88/92评分不变，乙私人错因列表为空。11项连续检查通过，临时库删除、本地原业务表逐表摘要及`.env`哈希均保持。脱敏报告`.taskbook-working/phase29-11/three-core-roles.json`。这是服务层连续流程与**一题合成选择题**，不声称复杂题型教学质量或原生页面通过。
- 继续用`scripts/acceptance/three-core-learning.ts`做同一临时学生的资料学习连续验收：原创Markdown函数课文由本人建立，真实HTTP分章/选段/原文摘录、带原文位置的Markdown导出、书签与续读；再真实抓取MDN公开JavaScript入门文章，先预览且确认前不入库，确认后核对请求来源/快照摘要，按相同接口阅读、摘录和续读。另一临时学生读不到本人摘录和URL预览。25项HTTP状态及内容断言通过；初次脚本运行发现阅读摘录写入后书籍CAS版本变化，已让脚本刷新版本再发书签；URL确认时已带书籍索引，脚本兼容现有索引。报告`.taskbook-working/phase29-11/three-core-learning.json`；清理回执2账号/2资料/草稿均0，精确清除2个测试对象。此处原创书籍源是为验收直接写入测试账号的存储/资料表，**并未演练UI上传动作**；公网样本会变，不能据此推断其它URL可用。
- 成品展示核对时发现公开首页仍以闪卡/复习为三项主卖点且插画显示虚构78%，与现行PRD矛盾；已按三核心修正文案和示意图文字，保留原纸张布局、链接及数据边界。补[当前演示动线](../demo/三主线成品演示-20261020.md)。`npm run build`退出0，显示BullMQ的可选`@valkey/valkey-glide`解析告警；当前本地演示明确使用memory队列，不能把构建告警称为生产BullMQ已验证。`npm run lint`通过。无并发上限全测因启动负载出现4项5秒超时，单独复跑相关3文件179项通过；`npx vitest run --reporter=dot --maxWorkers=4`全量192文件1733项通过，日志`.taskbook-working/phase29-11-final-test.log`。人脸服务由offline恢复真实CPU模型ready；网页已启动。未用浏览器工具规避既有URL安全策略，因此首页宽窄屏和三角色实际点击流程仍待人工/获准页面验收。
- 用户再次启动ModelArts后，原SSH端口31637真实连通；保存配置的旧主机指纹与当前RSA不符，首次控制器拒绝启动且未启远端服务。以本次独立known_hosts记录当前指纹`SHA256:wLKpeKGXpqDwGyg0DK5rjk2F3DH3oFZ8qG+3RUuy/G0`并保留旧记录，重新运行已保存控制器。四模型预热后`status=ready`，本地隧道健康为`ascend/modelsLoaded=true/mock=false/ocrFallbackAvailable=false`。在当前云端服务下重新通过真实产品上传原创32秒函数小课：`READY/COMPLETED`、6转写/6视频文字块、1知识点/1闪卡/1生成笔记，OCR/ASR均命中预设“函数”；来源引用、时间定位、Range206/1024字节及学习进度往返通过。隔离账号及资料清理、原有资料产物摘要不变。脱敏结果`.taskbook-working/phase29-11/video-product-cloud-resume-20261020.json`。限时控制器默认3600秒，仅自动停本次服务/隧道/网页，Notebook仍需用户在控制台停止。该结果不验证任意长视频、复杂板书准确率或原生三角色整链。
- 前述ModelArts推理/网页控制器是限时进程，2026-10-20 15:42（北京时间）状态已为`stopped/complete`。重复新视频导入前需按既有启动流程重启；此状态不代表用户的Notebook实例自动停机。
- 2026-10-20 20:03 在用户重新启动的本轮限时控制器下，`npm run demo:check -- --import`再次通过（网页/数据库/媒体/ASR配置/真实Ascend及CPU人脸均就绪，配置项本身不证明外部额度）。只读查询本轮19:45:56启动后业务库新增资料为0；最新用户资料日期仍是10月17日。网页日志的上传请求只属于已清理的隔离验收夹具。用户明确确认**尚未上传**自己的新视频，所以“已就绪”指旧资料，不能用来核销本人新导入。现场步骤已在当前演示动线注明；未修改用户资料。
- 20:32追加同账号三输入连续回放：`npx tsx scripts/acceptance/three-core-learning.ts --with-video`以一次性学员真实走原创32秒视频上传/Ascend推理（6段ASR、6个画面文字块、生成笔记），再读原创MD书籍、预览确认MDN公开[函数文章](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Functions)、选第4–8段正文提取、摘录/书签/续读，建立两资料专题问答。33项认证HTTP与来源检查通过；Spark Lite回答`READY`，两条引用分别来自原创书和公开文章，引用字节逐段回核。URL首章只有标题/页脚，先前两轮“全部已解析范围”虽然有两来源预览却不能得出双来源答案；选择正文后通过。一次模型调用实际`FAILED`且未保存正文，演练脚本仅重预览后允许一次重试；最终这次一轮成功不掩盖失败波动。脱敏报告`.taskbook-working/phase29-11/three-core-learning.json`，清理回执用户0、资料0、URL草稿0、专题0，精确对象键2个；只读复查本轮业务库新增资料0。因签名上传地址成功响应缺`Cache-Control`，补`private,no-store`及测试，上传单元/集成15项、TS与脚本lint通过。仍未进行本人原生页面或与负责人＋两学生**同一批角色**的整链；§29.11不勾选。

- 20:37用户澄清：此前“新条目可播放并能定位笔记”实际是打开**已有视频**，并未从本人账号上传新视频。只读数据库核对本轮控制器19:45:56启动后新增用户资料仍为0，最新个人视频创建于10月17日；因此只记录“旧视频播放与旧笔记定位由用户口头确认”，不记为新视频原生页面导入通过。隔离学员自动化新导入及清理的成功证据保持独立。

## 21:08 工程巡检追加

- 当前仓库非忽略文件约1301个；227份Markdown的本地相对链接做静态检查，修复当前设计/数据规格和两份历史PRD共21处搬移后的断链，复查0处。绝对路径指向被忽略的旧验收图片不算可交付文件，历史记录仍保留其原始路径。README前部从旧试卷/XP主线改为三核心现行入口，并标明后文早期P0矩阵与目录树是历史基线；PRD中29.7.1/29.8实施状态同步到有限样本已验，不把§29.11写成完成。
- `npm run type-check`、`npm run lint`、`npx vitest run --reporter=dot --maxWorkers=4`（192文件1733项）、`npm run build`、Prisma validate/migrate status（22迁移已应用）、Python `compileall`通过。构建仅出现BullMQ可选`@valkey/valkey-glide`解析告警；本机memory队列通过不证明生产BullMQ/Valkey运行。修正复习测试中的异步`act`告警，16项专项复跑通过。
- 本机网页曾因限时控制器到期而offline；使用现行`npm run demo:start`启动后`demo:check`必需项通过，`e2e-walkthrough.ts`只读58项为57 PASS/1 WARN/0 FAIL。WARN是演示账号没有已建目录书籍；脚本未写测试书籍冒充本人资料。脚本报告现落在`.taskbook-working/local-demo/e2e-walkthrough-report.json`，根目录旧忽略报告已删除。Ascend当前offline，Agent/ASR仅配置检查，真人脸、教学质量与原生三角色页面仍待独立验收。

## 完成门槛仍缺

1. 同组三角色的班级→提交→私人批改**服务层**连续链已通过；另一同一临时学员的视频→原创书籍→公开URL→双来源问答也连续通过。仍需在真实页面把三输入的导入、选章/续读/笔记定位/问答和班级闭环串成一条演示。两次连续测试角色并非同一批账号，不能自动拼成原生页面整链。
2. 云端Ascend与新视频真实导入现已通过既有30秒录屏和原创32秒清晰课件。尚缺课堂长视频、复杂板书/画质、更多书籍和网页样本的连续原生页面演练；前者146文字块只是数量，后者只核对“函数”关键词，不证明完整识别准确。Notebook由用户启动，推理服务和网页为本轮限时演示进程，停机后新视频导入仍需重新启动。
3. 原生桌面与窄屏三角色交互、URL真实获取与来源版本、跨班/跨人页面、失败恢复和真人脸登录本轮未重做；浏览器工具对当前本地页拒绝访问，不能伪称页面通过。旧试卷API 410已复核，但所有旧页面/后台迟到任务的完整回归沿用§29.3证据。
4. Spark Lite§29.8的一题合成样本之前通过；没有新的跨学科批改质量样本，也没有把模型可用配置称为教学质量通过。

## 复现

在桌面主仓库运行`npm run demo:start`保留网页终端；另一终端运行`npm run demo:check`、`npm run face:status`、`npx tsx scripts/demo/e2e-walkthrough.ts`。新视频须先按`DEPLOY.md`启动原Notebook与限时转发，再运行`npm run demo:check -- --import`和`npx tsx scripts/acceptance/video-product.ts <报告路径> <本地授权视频路径> [期望OCR词] [期望ASR词]`。同组三角色的服务层连续回放用`npx tsx scripts/acceptance/three-core-roles.ts`；同一临时学生的书籍→公开URL阅读回放用`npx tsx scripts/acceptance/three-core-learning.ts`；独立业务深度回归用前述课堂与作业两条脚本。测试日志：`.taskbook-working/phase29-11-tests-final.log`；两个隔离回归日志：`.taskbook-working/phase29-11-classroom.log`和`.taskbook-working/phase29-11-assignment.log`。只读演练报告现写入忽略目录`.taskbook-working/local-demo/e2e-walkthrough-report.json`；其PASS表示入口可访问，不证明页面完整交互。

下一次继续§29.11时，以本轮原创视频及隔离三角色服务层连续通过为起点，准备有授权的书籍/网页样本并执行原生宽窄屏连续页面流程；只有全部完成并保护旧数据后才勾选任务。
