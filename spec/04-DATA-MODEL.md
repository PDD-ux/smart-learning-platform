# 文豪智能学习平台 · 数据模型与接口说明

## §29.23 入队失败与确认并发（2026-10-21）

无新增表/字段/迁移。POST /api/contents/:id/complete事务内只允许PENDING/UPLOADING/FAILED→PARSING成功一次，竞争者409 IMPORT_IN_PROGRESS，不创建AsyncJob。入队异常、且本作业仍PENDING时，原子记录FAILED及固定安全原因，最新解析任务对应资料PARSING→FAILED，保留源文件；返回503 QUEUE_UNAVAILABLE。重试沿原complete入口，不要求重新上传。UNDERSTANDING同理将最新任务RUNNING→FAILED，资料READY及原笔记保持，使用原理解重试入口。若worker已认领/完成，不补偿其状态。补偿数据库不可用时仍报错，不伪称恢复成功；不自动改写本轮前的孤立任务。

AsyncJob认领返回false时业务函数不执行；查询/认领异常不得以mock降级调用模型。非终次失败RUNNING→PENDING后由既有队列退避重试，终次FAILED保持。失败原因用固定入队中文提示，不向客户端或日志回显Redis地址/凭据。源码API字段及成功封套保持。

## §29.17 教师身份及权限契约（2026-10-21）

现有 `User.role` 字符串支持 `student|teacher|admin`，无新表或迁移。`GET /api/admin/users?role=teacher`、`POST /api/admin/users`、`PATCH /api/admin/users/:id` 接受教师角色，只有数据库当前管理员可调用；仍负责班级或拥有共享课程的账号改角色返回409 `CLASSROOM_CONFLICT`，删除亦保留关系保护，旧数据不级联迁走。`POST /api/auth/login` 教师密码登录成功返回 `user.role=teacher`、`redirect=/teacher`；`POST /api/auth/refresh` 以当前数据库角色续期，旧令牌角色声明不直接授权班级或课程。

班级列表 `canCreate` 仅教师为true，管理员和教师只列自己 `responsibleId` 的班级，学生只列有效成员班级。`POST /api/classes` 仅当前教师创建；现有班级详情/章节/任务/正式提交/附件/批阅全部逐次核对当前角色和精确班级负责人，旧管理员只可管理本人历史班级，其他管理员与其他教师均不可跨班读取正文。课程管理列表中教师只列本人 `publisherId`，准备/发布仅本人已授权副本；管理员只能下架已公开副本，不能准备或重新发布非本人副本。公开学生课程仍按原发布状态与快照权限返回。角色或归属调整不改原提交、成绩与附件；本次数据库班级数为0，因此未执行实际移交。若未来存在待移交旧班级，当前`AssignmentReview`外键含负责人ID，已有批阅的班级不能直接改负责人，须先完成保持历史reviewerId不变的窄迁移。

### 教师工作区汇总

`GET /api/teacher/overview`：需登录且数据库当前`User.role=teacher`，其它角色返回403，未登录返回401；响应`{ generatedAt, summary: { classroomCount, activeClassroomCount, assignmentCount, pendingReviewCount }, classrooms: [{ id, title, state, activeMembers, assignmentCount, pendingReviewCount }], reviewQueue, recentAssignments }`。`reviewQueue`最多50条、`recentAssignments`最多12条，每条任务摘要包含任务/班级ID、标题、任务状态、截止时间、更新时间和正式待批阅数。查询仅按`responsibleId`筛班级，提交只取assignmentId/state聚合所需字段，不返回提交正文、附件、评语和未提交草稿。响应`Cache-Control: private, no-store`，客户端通过`src/services/teacher.ts`调用；加载失败必须与合法零结果分开呈现。

## §29.4 班级课程与作业基础（2026-10-19）

新增Classroom、ClassMember、ClassInvite、ClassChapter、ClassAssignment、AssignmentSubmission、SubmissionVersion、AssignmentReview、AssignmentAttachment、ClassroomOperation十表，独立于历史试卷/练习/私人资料与人脸。复合FK限定同班章节和成员/提交版本/附件，批阅人必须是目标班负责人；负责人不读取草稿，退出/移除后只保留本人冻结历史。字段、发布/提交/批阅状态、附件期限/格式/归属、邀请码摘要防猜和后续CAS/幂等完整契约见[28-CLASSROOM-FOUNDATION.md](28-CLASSROOM-FOUNDATION.md)。本编号没有新增HTTP请求/响应路径或业务写接口；后续29.5/29.6另行落接口契约和页面验收。

既有DELETE /api/admin/users/:id新增关联保留保护：目标账号有班级负责人/成员/操作历史时返回409 CLASSROOM_CONFLICT，不返回相关班级详情；目标用户行锁内先检查关系，再执行原照片/账号清理。无关联时沿用原删除成功/照片清理失败503契约。

## §29.15.3 粘贴正文与学习主线统一（2026-10-19已实施）

学习中心在上传文件/公开链接旁加入粘贴正文，标题与来源说明必填、作者未知留空；预览纯文本后另行确认保存，不访问正文内网址或调用AI。严格POST /api/text-imports preview/confirm，实际请求≤512KiB、正文20–100000字/单段≤20000字/最多20000段，预览前12000字且标总量。User锁、账号命名空间UUID/输入摘要、同事务摘要审计与删除后键墓碑保护；文件确定键补偿核对成功行，失败留输入，同键重试不双写。无新表/迁移/依赖。

复用LearningContent TXT READY/NONE及BookState可选pastedSource（含内部requestId/inputDigest），BookView剔除此字段；resource、ReadingContext、专题SourceCoverage只公开pasteSource白名单，标明本人提供、来源未经原站核验。普通资源响应统一private no-store，原版本/笔记保留。目录先就绪、选段文字与AI各自确认；章节/专题导出保留本人来源和原文/批注边界，专题冻结标注。导入三个面板切换保留挂载/草稿，编辑清旧预览/勾选，保存失败复用原键；桌面左右/窄屏堆叠44px，提示导入→选段→笔记/摘录→专题提问/导出。粘贴不再显示旧整份理解未启动作为导入失败提示。

29.15三子项按既定原文选摘边界完成，不承诺自由改写/全文语义质量；Lite有一次页面2–3段输出校验失败，保留记录且未写假笔记，缩小2–2段独立确认通过。现行权限/预算/DTO/生命周期见[27-PASTE-IMPORT.md](27-PASTE-IMPORT.md)；工程/真实模型/公开HTML/页面与数据保护分别见[本项验收](../docs/acceptance/paste-import-20261019.md)。下一编号29.4班级作业数据与权限基础，未提前实现。

## §29.15.2 专题与范围问答（2026-10-19已实施）

学习中心内部新增“专题学习”/topics，阅读器当前选段可预填来源、明确保存后才提问；没有默认全部私人来源。独立StudyTopic表以本人owner/UUID幂等/revision保护，最多8来源、20专题/人、30问答/专题，归档恢复、冻结引用及MD/TXT导出（包含指定范围原有摘录/个人批注）。只检索BookState已提取单元或既有转写/OCR；1–20页段/最多600秒、每来源1000单元/50万字、总200万字，候选元数据每页50。预览显示覆盖/缺失/版本及最多8个400字逐字窗口；显式确认一次Spark Lite、45秒/2000token/3次每分钟，90秒租约，源变化/取消/迟到拒绝。逐字依据非自由综合推理，不把词命中/JSON当作事实质量全面通过；来源删除保留本人历史快照并标不可回看，管理员无私人越权。

接口GET/POST /api/study-topics、GET /api/study-topics/candidates、GET/POST /api/study-topics/:id，16KiB严格白名单/private no-store，当前账号与本人资料逐项检查；单JSON1MiB、导出2MiB，原表/笔记不迁移改写。桌面左右、窄屏紧凑导航/堆叠/页内跳转、44px操作；失败保留输入、改问题/来源清预览。无新增依赖/训练/其它供应商/班级共享。具体数据/动作/预算与验收见[26-STUDY-TOPICS.md](26-STUDY-TOPICS.md)及[验收](../docs/acceptance/study-topics-20261019.md)。29.15父任务仍未完成，下一29.15.3粘贴正文与主线统一验收。

当前型号追加修订（2026-10-18用户明确指令）：默认SPARK_MODEL=lite，保留星火凭据和其它配置。generalv3.5真实11200阻塞不核销；本轮Lite有界原文笔记验证另记，不称通用语义推理质量全面通过。此前型号记录作为历史保留。

## §29.15.1 章节原文笔记与摘录批注（当前实施）

本次只在已有BookReader中提供选段星火原文笔记、划选高亮/个人批注与标签、移除恢复及本页Markdown/TXT导出。BookState增加可选readingJournal，bookView剔除journal，原目录/正文/个人Note和GeneratedNote保持；同一User锁及bookRevision CAS合并，生成单次45秒/4500字/2000token、90秒租约和逐字位置校验，确认前不发送模型，失败不伪造摘要。新API GET/POST /api/contents/:id/reading-notes，本人隔离/private no-store、32KiB请求、每份100条/1MiB，严格动作/冲突/取消与幂等；详见[25-READING-NOTES.md](25-READING-NOTES.md)。专题/粘贴与跨来源问答留29.15.2/29.15.3，父29.15未完成。暖纸张卡、44px操作、纯文本mark与范围/实际引用提示；折叠保留挂载和草稿，切章不重绑已选摘录。

## §29.14 公开链接预览与确认保存（2026-10-18实施）

仅HTTP(S)默认80/443端口、公开静态HTML/直接PDF；不带浏览器Cookie/Authorization/Referer，不执行JS或加载文章子资源。DNS每跳验证全部IPv4/IPv6为公开unicast，连接固定本次批准IP并复核remoteAddress，禁止环回/私网/链路本地/元数据/保留/映射特殊网段；最多3跳且HTTPS不降级HTTP，绝对总下载30秒。仅identity编码，HTML≤2MiB/PDF≤10MiB，按实际流字节限额并核对Content-Length，不能只信声明。

HTML通过htmlparser2@12转纯文本Markdown，优先article/main并移除导航/脚本/表单/隐藏和嵌入资源；正文至少200字、至多10万字/5万节点/64层，拒绝登录/视频/网盘入口及高链接密度/没有可靠正文的页面。PDF用既有PDF.js目录/真实页数与前3页文本预览，不自动OCR或AI。预览最多12000字，明确实际范围，不能称全书理解。

新增UrlImportDraft：本人+requestId幂等，FETCHING/PREVIEW/FAILED/CANCELLED/EXPIRED/COMMITTED；最多3条活跃预览、6次新获取/分钟/用户，30分钟有效，缓存净化正文/PDF快照Bytes≤10MiB，原HTML不保留。新LearningContent.urlSource为不可变来源JSON：请求/最终URL、实际标题/作者/发布日期（缺失为null）、获取时间、原始/内容SHA256、前版ID。确认只读已缓存快照，不再次抓取。用户行FOR UPDATE串行确认/取消/重复判断，原content和引用不更新；相同请求返回同一个资料ID。对象键由草稿ID确定，数据库失败在同一用户锁下补偿，过期维护可复原处理孤立对象。

POST /api/url-imports {requestId,url}获取预览；GET/DELETE /api/url-imports/[requestId]读取或取消（已保存返回冲突，不删除资料）；POST /api/url-imports/[requestId]/confirm {confirmed:true,mode:reuse|new}复用相同URL+内容摘要的本人资料或显式新版本。private no-store；请求≤4KiB，字段/错误白名单，不回显任意网络/解析异常或向日志写URL查询串。管理员不越本人范围。

确认创建READY的MD/PDF资料及已有BookState，正文/AI覆盖仍从0开始，只在阅读时选段。预览是临时缓存不计资料、确认后原快照版本不可自动刷新；从原链接显式重新预览并保存新版本才更新，旧ID/笔记不重指。主学习中心加入文件/链接切换，预览须可读、可取消/重新核对；学习页显示来源与获取时间。无章节AI/粘贴/专题/班级或训练。过期在本人下次访问时清理，另提供有界维护脚本；未安装定时任务不能称自动定时清理。协议及存储生命周期见24-URL-IMPORT.md。


## §29.13 EPUB首版实施契约（2026-10-18）

在原学习中心文档入口支持EPUB，≤50MiB。服务端验证ZIP中心目录/本地头、CRC、压缩方式、路径和预算，ZIP64/多盘/加密/DRM拒绝；不解包到磁盘、不读取包外文件。最多2000条目、单条4MiB、累计解压32MiB、压缩比200、XML深度64/10万节点、正文200万字/2万段/200个spine项目，每段≤2万字，超限整次失败而非截断成功。仅文本层阅读，不支持复杂排版/图片/公式呈现；不加载远程资源或执行脚本。

读取container.xml→OPF manifest/spine，导航EPUB3 nav优先、兼容EPUB2 NCX，真实锚点映射到全局稳定段号；无可靠导航明确按spine阅读顺序，未解析目录不猜。新增BookState.format=EPUB与epub-nav/epub-spine来源，复用已有BookState JSON/CAS与20段选取、50万字保存预算，无迁移。书籍上传验证后READY且自动建立目录；units仍空，选定范围后才保存正文，不入全书TextBlock或自动UNDERSTANDING，AI仍NONE。首版章节AI留29.15。

ContentRef沿用document+page=1+blockIndex（全书从0开始的稳定段号）兼容信封，EPUB不展示/推断固定页数，pageCount=null；ContentSummary仅EPUB增加可选format=EPUB，笔记接口以BookState.unitCount核验page=1和必需blockIndex边界，不借假页数通过校验。手工目录修改不改变段号；源哈希变化拒绝提取，需新资料ID重新导入。章节内位置可由目录范围对应；书签/引用/个人草稿与旧PDF/TXT/MD保持。EPUB笔记隐藏无意义页码编辑，明确全书段号；原始EPUB不放iframe。

仅新增saxes@6.0.0（ISC）严格XML事件解析及其xmlchars依赖；拒绝实体/外部DTD，仅允许不含外部标识的DOCTYPE html，解析错误统一固定提示，不输出书内路径/文本。ZIP采用Node zlib有界inflateRawSync与crc32，不引入ZIP解包器。详见23-EPUB-READING.md，URL/专题/章节AI均不在本编号。


## 现行模型契约：§29.12.1 统一星火（2026-10-18用户修订）

全部文本AI仅使用讯飞星火，删除OpenAI运行分支、凭据入口与部署配置；默认LLM_PROVIDER=spark，不支持其它供应商。沿用本机已选generalv3.5，不自动升级型号、回退或重跑已有资料。笔记/问答/Agent/抽取共用spark.ts，ASR、MindSpore及人脸独立保留。JSON指令与response_format并用，按型号限制输出预算，关闭支持型号的内建联网搜索；原Zod、引用及事实保护保留。AGENT_REVIEW_READY=false不因切换变true，AGENT_REVIEW_THINKING仅是显式开启逐句覆盖/术语复核的内部开关，不表示模型具备隐藏推理或已通过教学质量验收。无新表或API路径，EPUB摘要有可选format字段，ChatResult和安全错误保持；真实短请求与教学质量分开验收。旧OpenAI说明及失败记录仅为历史，当前以[22-SPARK-ONLY.md](22-SPARK-ONLY.md)为准。


§29.12实施契约：LearningContent新增bookState Json?与bookRevision Int默认0；旧行NULL/0，不回填、改写来源或清理数据。bookState版本1：format、sourceDigest、unitKind(page|paragraph)、unitCount、chapters[{id,title,start,end,origin}]、cursor、bookmarks[{position,label}]、units[单元号→{text,status:text|needs-ocr|empty}]、requests[{id,digest}]。该JSON只归原owner，不在共享课程快照/内容列表/普通详情DTO中下发。旧ContentRef不变，文本单位n对应page1/blockIndex=n-1，PDF对应实际page=n；章节ID不作为旧引用依据。

GET /api/contents/:id/book 可选start/end正整数，最多20单位，返回{book:null}或BookView（revision及元数据、已处理/有字/待OCR计数、当前范围已保存单元），不自动建立目录或读取文件；默认读取已保存cursor起最多20单位。POST严格判别action：initialize、chapters、extract、cursor、bookmark、removeBookmark；均带expectedRevision非负整数/requestId UUID；非initialize带sourceDigest64位十六进制。chapters传title/start/end，extract传start/end（最多20），cursor/bookmark/removeBookmark传position，bookmark可传label≤80字。本人且READY的PDF/TXT/MD才可用；当前数据库账号必须存在且状态合法，跨人含管理员不例外。CAS/源文件改变409、字段/范围400、无权403、无内容404、超预算/解析不可用409，不暴露路径/原始解析异常。重复同键同内容返回当前状态、不重复保存；同键不同内容409，过期键/旧revision409。响应private no-store，不下发请求摘要/存储路径；新JSON有界且请求体≤64KiB，旧数据/迁移保留。无新AI/章节笔记或EPUB/URL接口。

§29.3试卷退场现行契约：/api/exams（含/:id、/:id/attempts）、/api/exam-attempts（含/:id、/answers、/submit、/result）、/api/exam-generation-options、/api/exam-generation-jobs（含/:id、/preview、/paper）、/api/admin/exam-subjects、exam-questions、exam-import、exam-papers、exam-attempts/:id及/grades，19条路径的GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS均返回410和固定EXAM_RETIRED（HEAD无正文），统一失败封套、Cache-Control: private, no-store。不读取ID/令牌/正文/数据库，不透露记录是否存在；匿名、学生、管理员及旧请求键一致，不提供数据或新写入。旧页面仅停用说明，无历史成绩在线查询/导出。全部Exam*表、原状态、答卷、分数、题源和迁移保留，旧QUEUED/RUNNING状态不批量改写；旧队列消息在新worker直接丢弃，不计为成功生成或取消。不改变其它练习/学习API与PRODUCT_GEN用途。以下§27描述仅为历史已停用协议，不再代表当前可调用能力。

§28.1（2026-10-18）：无数据表、业务API或公开DTO变化。内部ModelProvider只允许openai|spark，统一由LLM_PROVIDER服务端选择；旧智谱/百炼和按场景选择配置不再生效。OpenAI默认gpt-6-luna/medium，以Responses的assistant/output_text映射原ChatResult，拒答/截断/错误不写学习产物，usage按input_tokens/output_tokens映射旧统计。凭据和隐藏推理不进入公开响应。当前具体契约见18-OPENAI-MIGRATION，后文百炼/智谱描述为历史协议和验收，不代表当前可用接入。

§27.9 无新表/字段。GET /api/exam-generation-options?page=&track=启用科目分页50；GET /api/exam-generation-jobs/:id/preview仅本人，返回status/plan/subjectName/terminal/canConfirm/unavailableReason/previewDigest/totalScoreUnits/questions/confirmedPaper。questions仅id/sequence/type/stem/options/scoreUnits/sectionKey/sectionTitle/source(kind/name/sourceYear/edition)，不含答案/解析/rubric/原文/租约。POST .../:id/paper严格{expectedRevision,previewDigest,targetCount,acceptReducedTarget,requestId:UUID,confirmed:true}，未知字段400、他人含管理员404、冲突/不完整未确认/来源已变409。targetCount须等于已合格量，不足原目标须明确acceptReducedTarget=true，足量时false；不支持客户端改候选或静默截断。返回paperId/versionId/questionCount/totalScoreUnits/durationSec/referenceOnly:true。

PRIVATE卷封卷与PUBLISHED只代表本人可用，不进入公开目录；BANK kind=MOCK，AI kind=AI_MOCK，sourceYear未知。AuditLog按本人+job唯一成卷记录，确认摘要不含requestId以兼容相同内容新键；改任何确认字段409，同结果重复返回、不新建。生成任务原目标题量/状态保留，不因较短成卷假称原生成已完成。ExamDetail可含referenceOnly；开考沿既有owner限制和DB时钟，新增窄迁移要求所有PRIVATE或AI_MOCK新答卷referenceOnly=true，不回写旧答卷。私人主观题保持待批与最终null，不安排管理员读卷或模型自动评分。

§27.8 复用既有ExamGenerationJob/Batch，无schema/迁移变化。POST /api/exam-generation-jobs严格{plan:{blueprint:examBlueprintSchema,scope,difficultyMin,difficultyMax},requestId:UUID,confirmed:true}，新服务所有模式1..50，默认20。GET集合page/pageSize或GET /:id仅本人状态：jobId/state/revision/mode/requestedCount/acceptedCount/rejectedCount/missingCount/callBudget/usedCalls/remainingCalls/failureCode/createdAt/deadlineAt/finishedAt/needsRecovery/evidenceTruncated；不回题目/答案/原始资料/蓝图/摘要/租约。POST /:id严格{action:retry|cancel,expectedRevision,requestId}，同键同内容重放、冲突409/跨人含管理员404/未知字段400，鉴权及private no-store。retry不延长截止/重置预算；READY/CANCELLED不重试，活跃租约409。BANK模型预算DTO为0（既有数据库最小1约束使用内部未消耗占位值1，不是假调用）。私有候选及来源引用仅持久化在批次JSON供后续27.9确认，当前不创建/发布试卷。rejectedCount累计未通过候选位置次数，重试可能累计超过目标题量，不等于独立题数；missingCount=目标减已合格。完整规则见17。

§27.7 GET /api/exam-attempts/:id/result 已交卷本人可读：{attempt基础字段,gradeSummary,typeStats[],questions[],wrongCount,sourceReview[]}；questions 逐题给本人作答、封卷正确答案、解析、客观正确/得分、主观 pending 与批阅评语，来源只 kind/name/sourceYear/edition。未交卷 409，他人/管理员跨人 404，仍不下发 rubric/题源 url/授权说明/requestDigest。GET /api/admin/exam-attempts/:id 仅管理员、限 PUBLIC+PUBLISHED 正式卷且 referenceOnly=false 的答卷，揭示主观作答/参考答案/rubric/当前分数；私人 AI 练习卷 404。POST /api/admin/exam-attempts/:id/grades={expectedRevision,requestId,grades[{paperItemId,scoreUnits,feedback}]}，z.strict() 拒绝未知字段；只批主观题，超满分/非本卷题/空白题给正分 400；空白主观题可明确给0分，版本冲突或已评定最终成绩 409（最终成绩冻结），非管理员 403，私人 AI 卷 404。每次批阅写 ExamGradeRecord 留痕（同 requestId 幂等不重复），重算 pending/final，最终评定后 state=GRADED 不可再批。无新表/字段；本轮新增窄范围空白批阅触发器迁移，旧迁移保留。

§27.7复核修正：ExamResultQuestion新增stem/options，options遵循开考optionOrder；pending不计wrong，题型统计correct+wrong+pending=total。gradeExamSchema拒绝同批重复paperItemId；管理读未交卷409，批阅以答卷独占锁保护expectedRevision与幂等。pendingScoreUnits=所有未评主观题满分之和，缺失草稿同样待批；空白主观题只允许明确0分，管理员同事务建立SQL NULL空载体→ExamGradeRecord→写score→汇总，不接受迟交文本。新迁移只替换exam_answer_guard函数且强化GRADED逐题分不可变，旧基础迁移/成绩不重写，未新增表/字段。

#§27.6 PUT /api/exam-attempts/:id/answers={paperItemId,answer,marked,expectedRevision,requestId}；expectedRevision为整卷整数版本，成功+1，返回{revision,paperItemId,answerRevision}。POST .../submit仅{expectedRevision,requestId}，返回{revision,state,gradeSummary}。本人/当前账号限定，无权404，未知字段/题型不匹配400，过期改答/版本或请求冲突/已交写409。保存确认和提交确认幂等持久化在AuditLog，无原文/标准答案入审计；读取本页草稿不等于已保存。交卷后StudentAttempt可含gradeSummary={objectiveScoreUnits,pendingScoreUnits,finalScoreUnits,submittedAt}，未交无该字段；百分整数，主观待批最终null，全客观最终=客观。空客观0、空主观待批，迟交只评分既有保存内容。仍无逐题答案/解析/分数DTO。复用已有字段/状态/SQL期限和冻结防线，无schema变更。下述27.5只读限制为历史阶段。

§27.5 GET /api/exams、GET /api/exams/:id、POST /api/exams/:id/attempts、GET /api/exam-attempts及GET /api/exam-attempts/:id已实现，精确字段见17/student-contracts。仅PUBLIC当前发布封卷及启用科目可新开考；POST只接expectedVersionId/requestId/confirmed，版本或请求冲突EXAM_CONFLICT=409，外人/不可见404、未认证或账号失效401。来源摘要只kind/name/sourceYear/edition/count，题干与答案文件URL不在开考前DTO。答卷只本人、固定题序/选项/服务端期限和安全问题DTO/本人输入，不回传正确性/解析/参考答案/rubric/分数。原ExamAttempt.requestId/requestDigest及AuditLog记录原请求和续读别名；无新表/字段/迁移。过期只读，未实现保存/提交接口。

§27.4 GET/POST `/api/admin/exam-papers` 已实现：PUBLIC共享题库模拟卷列表/历史详情及preview/paper.create/paper.revise/paper.publish/paper.withdraw命令，精确字段见17/paper-contracts.ts。题数/总分由分区和服务器快照派生，客户端不传body/source；preview返回实际配额/缺口、选择ID和完整时才有digest，确认写需UUID/confirmed/digest，修订/发布/下架需expectedRevision（409）。当前kind固定MOCK、sourceYear=null；每题真实题源字段保留，不伪称官方原卷。已有ExamPaper/Version/Section/Item及AuditLog复用，无新字段/迁移；学生接口仍留27.5以后。

§27.3三个管理员接口已实现，具体严格命令/返回DTO/分页/预览摘要/审核CAS见17及bank-contracts.ts。科目与章节GET分页，题目GET共享最新版本及受控历史，三个POST分别分类写、题目版本/审核/停用、模板预览/确认。EXAM_BANK_CONFLICT=409；未认证401、数据库当前非管理员403、PRIVATE题404、模板错误400，错误行预览200但不保存。JSON/CSV确认必须confirmed=true、previewDigest及UUID requestId，全批有效后写PUBLIC+DRAFT+UNREVIEWED。AuditLog现有字段保存幂等摘要和结果ID，不增加模型/迁移；不提供学生答案或私人题目读取。余下整卷HTTP仍预留。

§27.2新增试卷领域契约以[17-EXAM-FOUNDATION.md](17-EXAM-FOUNDATION.md)和schema.prisma为具体依据：13个独立Exam*对象，原30业务表/16枚举为迁移前历史基线。新题型含多选/主观，原ExerciseType不改；分数scoreUnits为整数（100=1分），版本/同卷复合外键/答卷待批状态/生成预算/来源与答案DTO规则见17。27.2当时仅预留HTTP，27.3已实现管理题库三条路径，其余仍预留；迁移应用状态及数量以基础验收记录为准。

§26.12补充（唯一真实请求后发现）：5题选项通过但人工发现重复答案事实及歧义，不能核销质量。标记原文精选的知识点在本批单选中同一标准答案最多一次，忽略空白/尾句号的相同答案保守拒绝为DUPLICATE_FACT；不对所有题型/历史题或相同数值题做普遍语义判断。失败仍整批0保存，不宣称可检测所有近义重复。题库显式选择1/3/5题、默认1题，count仍按用户选择精确提交，不追加第二次真实模型复验。

§26.12实现前：单选题内部模型优先返回question/correctOption/wrongOption/explanation，两个选项均须为具体内容；后端为每题独立选择正确选项位置，再转换为原题目结构并执行既有内容/重复/答案/解析校验。兼容旧options+answerIndex与questions格式，不放宽校验或强行删除重复选项。模型可明确资料不足弃答，整批失败仍0保存；给模型本批已通过的同知识点题干与答案事实避免重复出题，不写日志/公开DTO。请求count和成功DTO/表不变，不自动缩题、换题型或换供应商。

§26.11实现前契约：视频新知识点改为AI选择本窗连续原文来源，服务器恢复原文摘录及真实时间，标题明确“原文精选”而非已核验定义；不使用旧摘要或个人笔记作为事实。保留相邻上下文、未知编号/无依据拒绝，不纠正ASR术语或推断单射/满射结论。失败先于原产物替换；旧视频不自动重跑，隔离副本验收。公开字段/表不变，摘录忠实不等于转写或教学事实准确。

§26.10实现前补充：POST /api/exercises/generate仍整批通过后才保存，失败503/AI_UNAVAILABLE且不保存前面成功题。质量错误可附error.details={traceId,reason,failedQuestion,requestedCount,diagnostic}，只含固定分类/字段/规则码、整数和追踪标识，不含模型原文/问题/选项/答案/摘要/任意异常文案。reason对应JSON格式、选项内容/重复、答案范围、解析冲突、题干重复或通用结构问题；无明确细分依据则通用，不猜余额/NPU状态。原请求与成功DTO不变，无新表/字段；不得关闭质量校验换成功。

本轮受控5题结构通过但人工内容未通过：发现仅用“表述错误/混淆规则不符”充当选项，原摘要有概念混淆。先拒绝这种没有具体事实的元评价选项，保留真实数学/技术短答案；内部模型可返回严格{insufficientEvidence:true}明确弃答，不重试该弃答，不保存前面题目。外部仍503/AI_UNAVAILABLE，reason=INSUFFICIENT_EVIDENCE，固定提示先核对知识点，不能据此声称所有语义错误已自动检测。原产物不重写，视频知识点质量另列后续任务。

§25.10已修复25.9发现的私人接口admin归属旁路：读写按数据库实际owner与当前user.id一致，所有角色适用；跨owner统一校验返回403且不附resourceOwnerId。原按owner筛选的列表/计划保留空列表或404契约，管理员专用用户/签到/共享讨论管理保持明确角色范围。98项隔离HTTP含原3个问题接口、写入拒绝和本人增删改通过；字段/API/30表未改变。见[13-PRIVATE-OWNERSHIP.md](13-PRIVATE-OWNERSHIP.md)，25.9完整复验仍待执行。

§25.8已迁移Notification及NotificationKind，详细字段/白名单/消息已读与参与列表契约见11-NOTIFICATIONS.md。已有结果事件按相同key/原时间映射，不回填旧回复；当前共30表/16枚举，业务读写仍只本人，私人模型不变。

§25.7已迁移DiscussionReport/DiscussionEvent，具体字段、DTO、管理/举报接口和隐私规则以10-DISCUSSION-MODERATION.md为准。学生举报跟随正式门控；管理员课程DTO的discussionEnabled返回真实持久化值，学生DTO仍门控。事件仅为举报结果来源，无Notification/readAt/未读接口，25.8待办。

§25.6已实现（契约先于代码）新增讨论/回复具体契约见09-DISCUSSIONS.md；只新增两表与删号匿名化触发器，不迁移举报/通知。正式入口默认门控关闭，中间阶段仅隔离验收。

§25.5具体SharedCourse表、DTO、复制幂等/版本、读媒体鉴权与范围规则见[08-SHARED-COURSE.md](08-SHARED-COURSE.md)，契约先落地后已实现及迁移；新增一张共享表，私人模型不改字段。原HttpOnly Cookie中的access JWT经Bearer格式适配验证，显式Authorization仍优先，Cookie不允许刷新JWT进入业务。07中的讨论/回复已在25.6迁移；25.7举报和结果事件已迁移，通知仍未迁移。

§25.3仅新增前端导航参数：/study-plans和/assistant接收contentId?:string|string[]，只有单一非空且长度<=128、命中本人既有可用列表的值才预选；显式无效/重复/未命中值提示并保持未选择，不回退其它资料。助手列表仍需已就绪且理解完成，计划沿用原本人资料列表。无参数保留原默认（计划未选、助手首项），没有新后端入参/DTO/表/权限捷径；现有API仍独立鉴权。query变化重挂载workspace清旧临时会话/隔离迟到回答，列表重读不覆盖有效的本人手动选择。

## Phase25 契约索引（25.5–25.7已迁移，消息待办）

2026-10-14 §25.1确认独立SharedCourse、DiscussionThread/Reply/Report、Notification模型，草约束详见07 §4–6；§25.5已按08具体契约迁移SharedCourse，25.6另迁移DiscussionThread/Reply；25.7迁移DiscussionReport与DiscussionEvent；Notification模型仍未实现、不计入现有表数。现有LearningContent/Note/学习记录/个人API数据契约不改变。

关键契约：管理员只能从本人持有且确认传播授权的READY内容发布独立快照；只发布显式白名单，不含私人笔记/作答/进度/账号或人脸。学生只读published课程，媒体同源逐请求鉴权/Range，不返回storageKey。主题/回复纯文本、单层、本人写入、expectedVersion>=1冲突409；requestId UUID创建去重。ref类型与真实时长/页码严格匹配共享快照，不能链接私人sourceContentId。

匿名401，不可读草稿/下架目标404，非本人修改403，关闭讨论/版本冲突409，字段/定位不合法400，限流429。回复通知与发帖、举报结果与处理事务一致；仅本人事件/未读计数，不存旧帖子正文。删除/隐藏/关闭/下架的可见范围、用户删除匿名化和独立媒体生命周期按07验证，禁止仅隐藏前端入口即核销权限。

§23.7补修：watched-note模型私有响应只允许points[{sourceNumbers:number[]}]，不允许keyword/title/summary字段；公开DTO的mode=source-extract及其它字段不变。服务器固定原文要点编号标题，不再校验模型关键词文字；保留真实编号/连续摘录/4500字符和安全检查。SCHEMA_INVALID显示固定中文重试说明。

> 本文档定位：**数据模型速查表 + 接口契约索引**。详细 TS 类型、领域类图、字段定义见 [`spec/03-ARCHITECTURE.md §2.2 / §2.3`](03-ARCHITECTURE.md)。

---

## 1. 数据范围

§22.9：短VAD片段有界合并后，TranscriptSegment起止为参与区间最早真实start/最晚真实end，中间可能含≤1秒间隙。无字段或公开API变化，仍为段落级时间，不能作为逐字准确性依据。

§22.8本地ASR私有进程响应{durationMs,segments:[{seq,startMs,endMs,text}]}，时间均为音频窗口内整数毫秒，非重叠且不越界，text为非空段落；FSMN-VAD提供区间而非逐字对齐。原流水线加真实窗口startSec后写既有TranscriptSegment，数据表/公开接口不变；失败不提交该窗口伪转写或自动调用付费服务。

2026-10-10 §10.4：新导入单张PNG/JPEG的既有pageCount在READY前设为1，对应OCR的document/page=1引用；页码范围校验保持严格，视频/PDF/文本规则不变。没有新增字段或迁移，不自动回填旧图片。

2026-10-10 §10.4 云端格式补修：闪卡模型的推荐内部输出为按输入顺序排列的[问题,答案]二维数组，行数须与本批（最多8点）相等、每行恰好两个字符串（单条也必须保留外层数组，扁平字符串数组明确拒绝并提示行格式）；后端通过校验后映射为既有pointIndex/front/back，再映射pointId。原合法cards/pointIndex格式仍兼容，未知/重复索引拒绝。数量或JSON错误不补卡、不修字符串；原问答长度、问号、安全检查和各批全部成功才替换规则保留。没有新增数据库或公开接口字段。

2026-10-10 §10.4：长视频窗口的空窗由内部stats.transcriptCount/textBlockCount均为0判断；有解析记录但没有通过类型/全片范围校验的保留来源，属于SCHEMA_INVALID，不作为空窗跳过，也不提交部分知识点。该校验不新增字段或公开接口，不改变短内容原降级契约。

2026-10-09 §10.4 长视频覆盖：时间窗口仅为内部查询及模型调用参数，不新增数据库或公开接口字段。视频转写按startMs的左闭右开区间归属窗口，FRAME/OCR块按真实ref.timestampSec归属；最后一窗上界略大于全片时长以包含恰好末尾定位，全片范围校验仍有效。每窗来源编号独立，入库前映射回既有全片ContentRef；不允许跨窗借引用。有来源窗口无安全有引用知识点或模型失败时保留旧知识点，不提交部分结果。闪卡模型pointIndex按每8个知识点的批内序号映射，外部pointId/ContentRef契约不变。

2026-10-09 §10.4：知识点模型内部可返回sourceIds，后端只将本次保留来源编号映射成现有refs: ContentRef[]；sourceIds不新增数据库字段或公开响应。来源类型/范围和白名单继续校验；有来源时每个安全知识点都须至少一处有效引用，任一点缺失引用或返回未知编号须进入既有最多两次模型校验，仍失败使理解失败且不删除原知识点。无可引用来源仍保留原空refs契约。

### 1.1 数据库保存（43 张业务表）

用户数据 + 内容元数据 + 端云协同产物 + 学习闭环记录。

### 1.2 对象存储（不落库）

- 视频原文件（≤2GB / 个）
- 文档原文件（≤50MB / 个）
- 图片原文件
- 视频关键帧图（筛选后保留）
- 人脸录入照片：仅首次录入的单张照片；独立 AEAD 加密、私有 `face-enrollment/` 前缀、无公开 URL，`photoExpiresAt` 到期后自动删除（默认 30 天）

### 1.3 静态 / 客户端

- 学习者个人信息（暂用 JWT payload 携带，不单独建表）
- 系统配置 / 文案（写死在 `src/lib/`，后续可迁数据库）

### 1.4 Redis（瞬时态）

- 学习进度短期缓存（TTL 5 分钟，异步刷 PostgreSQL）
- 限流计数（INCR + EXPIRE）
- BullMQ 队列（异步任务）

---

## 2. 数据表清单（既有30张＋试卷13张）

完整字段定义见 `prisma/schema.prisma`（单文件真相）+ [`spec/03-ARCHITECTURE.md §2.3`](03-ARCHITECTURE.md)（领域语义）。

| # | 表名 | 关键字段 | 索引策略 | 关联 |
|---|------|---------|---------|------|
| 1 | **User** | `id / email? / phone? / passwordHash / nickname / role / xpTotal / createdAt` | `email` 唯一、`phone` 唯一 | 所有内容归属 |
| 2 | **LearningContent** | `id / ownerId / contentType / title / status / understandingStatus / storageKey` | `ownerId, status` 复合、`status` 部分索引 | 笔记、转写、文本块、知识点、闪卡、进度 |
| 3 | **Note** | `id / contentId / ownerId / content / ref / version` | `(contentId, ref)`、`content` 的 `pg_trgm` GIN 三元组索引（中英文子串匹配）| LearningContent（组合）|
| 4 | **TranscriptSegment** | `id / contentId / seq / startMs / endMs / text` | `(contentId, seq)` 唯一有序、`text` tsvector | LearningContent（组合）|
| 5 | **TextBlock** | `id / contentId / source / sequence / ref / text` | `(contentId, sequence)` 有序 | LearningContent（组合）|
| 6 | **KnowledgePoint** | `id / contentId / ownerId / title / summary / importance / refs` | `(contentId)`、`(ownerId)` | Flashcard、GraphNode |
| 7 | **Flashcard** | `id / contentId / ownerId / pointId / front / back / status / easeFactor / intervalDays / nextReviewAt` | `(ownerId, nextReviewAt)` 部分索引 `WHERE status IN ('new','learning','review')` | KnowledgePoint、ReviewLog |
| 8 | **ReviewLog** | `id / flashcardId / rating / prevInterval / newInterval / streakAfter / reviewedAt` | `(flashcardId, reviewedAt)` | Flashcard（组合）|
| 9 | **Mastery** | `id / learnerId / pointId / score / reviewCount / isWeak` | `(learnerId, pointId)` 唯一、`(learnerId, isWeak)` 部分索引 `WHERE score < 0.6` | KnowledgePoint |
| 10 | **GraphNode** | `id / pointId / nodeType / aliases` | `pointId` 唯一 | KnowledgePoint（图谱节点引用）|
| 11 | **GraphEdge** | `id / sourcePointId / targetPointId / relation / weight` | `(sourcePointId)`、`(targetPointId)` | GraphNode |
| 12 | **Exercise** | `id / contentId / pointId / type / question / options / correctAnswer` | `(contentId, pointId)` | KnowledgePoint |
| 13 | **ExerciseRecord** | `id / exerciseId / learnerId / userAnswer / correct / masteryDelta` | `(exerciseId, learnerId)` | Exercise |
| 14 | **LearningProgress** | `id / learnerId / contentId / ref / lastStudiedAt` | `(learnerId, contentId)` 唯一 | LearningContent（聚合）|
| 15 | **AsyncJob** | `id / jobType / contentId / state / attempts / stage / traceId` | `(contentId, state)`、`(jobType, state)` | LearningContent |
| 16 | **AuditLog** | `id / actorId / action / targetType / targetId / payload / createdAt` | `(actorId, createdAt)`、`(targetType, targetId)` | 全局审计 |
| 17 | **UserAchievement** | `id / userId / achievementKey / unlockedAt` | `(userId, achievementKey)` 唯一、`userId` 索引 | User |
| 18 | **GeneratedNote** | `id / contentId / markdown / sourceCount / generatedAt` | `contentId` 唯一 | LearningContent（组合）|
| 19 | **FaceTemplate** | `id / userId / encryptedVector / encryptionIv / authTag / keyId / enrollmentPhotoKey? / photoExpiresAt? / photoEncryptionIv? / photoAuthTag? / photoKeyId? / modelVersion / consentVersion / enrolledAt` | `userId` 唯一、`photoExpiresAt` 清理索引 | User（一对一）|
| 21 | **LearningPlan** | `id / ownerId / contentId / title / targetMinutes / scheduledAt / remindAt / completedAt` | `(ownerId, completedAt, remindAt)` | User / LearningContent |
| 22 | **FaceLoginChallenge** | `tokenHash / expiresAt` | `tokenHash` 主键、`expiresAt` | 无生物信息/账号 |
| 20 | **AttendanceRecord** | `id / userId / status / verificationVersion / signedAt / checkInDay?` | `(userId, signedAt)`、`(userId, checkInDay)` 唯一 | User |

| 23 | **LiveSession** | 本人录音会话/片段租约/摘要元数据，见§23.1 | ownerId/createdAt | User |
| 24 | **LiveChunk** | sequence/digest/状态/转写，见§23.1 | sessionId/sequence唯一 | LiveSession |
| 25 | **SharedCourse** | 独立授权快照/媒体内部键/状态/版本/准备与请求摘要，见08 | publisherId/requestId唯一，state/publishedAt/id | User / LearningContent（SetNull，不级联副本） |
| 26 | **DiscussionThread** | 共享课程纯文本主题/引用/作者状态/版本/请求摘要，见09 | authorId/courseId/createRequestId唯一，courseId/createdAt/id | SharedCourse级联；User删除清正文并SetNull |
| 27 | **DiscussionReply** | 单层纯文本回复/删除占位/版本/请求摘要，见09 | authorId/threadId/createRequestId唯一，threadId/createdAt/id | DiscussionThread级联；User删除清正文并SetNull |
| 28 | **DiscussionReport** | 本人举报原因/处理结果/版本/请求摘要，见10 | reporterId/requestId唯一；reporterId/targetKey仅OPEN部分唯一；courseId/state/createdAt/id | 举报人/课程/主题/回复级联；处理管理员SetNull |
| 29 | **DiscussionEvent** | 举报结果固定类型与关联，无旧正文，见10 | reportId唯一、eventKey唯一、recipientId/createdAt | 接收人及举报级联 |
| 30 | **Notification** | 本人站内消息/事件关联/已读时间，无正文快照，见11 | eventKey全局唯一、recipientId/readAt/createdAt/id，来源类型SQL CHECK | 接收人及共享课程/主题/回复/举报级联 |

> 既有30张表保留；§27.2新增ExamSubject/ExamChapter/ExamQuestion/ExamQuestionVersion/ExamPaper/ExamPaperVersion/ExamPaperSection/ExamPaperItem/ExamAttempt/ExamAnswer/ExamGradeRecord/ExamGenerationJob/ExamGenerationBatch，共43张业务表（不含_prisma_migrations）。字段/索引/版本及权限契约见17-EXAM-FOUNDATION与schema.prisma。新表目前为空，不代表页面、题源或AI已上线。人脸照片仅私有加密对象保存30天；音视频/base64/向量明文/精确比对分数不属于数据库持久化内容。

---

## 3. 关键字段类型

### 3.1 既有枚举（16个，另新增11个Exam枚举，当前共27个）

| 枚举 | 取值 | 说明 |
|------|------|------|
| `SharedCourseState` | `DRAFT / PUBLISHED / WITHDRAWN` | 共享副本状态 |
| `DiscussionKind` | `QUESTION / DISCUSSION` | 主题类型 |
| `DiscussionReportState` | `OPEN / HANDLED` | 举报状态 |
| `NotificationKind` | `REPLY / REPORT_RESULT` | 站内事件类型，无私信 |
| `ContentType` | `VIDEO / DOCUMENT` | 内容类型 |
| `ContentStatus` | `待导入 / 上传中 / 解析中 / 已就绪 / 失败` | 内容生命周期 |
| `UnderstandStatus` | `none / running / completed / failed` | 端云理解流水线状态 |
| `TextSource` | `PDF / MD / OCR / FRAME` | 文本块来源；视频的 `FRAME` 仅来自 MindSpore 判为 `blackboard/screen` 的有效帧；`invalid` 跳过 OCR |
| `CardType` | `QA / CLOZE / FORMULA` | 闪卡类型 |
| `CardStatus` | `new / learning / review / graduated` | SM-2 状态机 |
| `NodeType` | `CONCEPT / FORMULA / METHOD / THEOREM` | 图谱节点类型 |
| `EdgeRelation` | `PREREQUISITE / RELATED / EXAMPLE_OF` | 图谱关系边 |
| `ExerciseType` | `SINGLE_CHOICE / TRUE_FALSE / SHORT_ANSWER` | 练习题型 |
| `JobType` | `CONTENT_PARSE / UNDERSTANDING / PRODUCT_GEN` | 异步任务类型 |
| `JobState` | `pending / running / succeeded / failed` | 异步任务状态 |
| `AttendanceStatus` | `SIGNED_IN / SELF_CHECK_IN / MANUAL_CONFIRMATION` | 签到结论；不记录生物信息 |

### 3.2 ContentRef（联合类型）

```ts
type ContentRef =
  | { type: 'video'; timestampSec: number }
  | { type: 'document'; page: number; blockIndex?: number };
```

- 视频：`timestampSec ∈ [0, durationSec]`
- 文档：`page ∈ [1, pageCount]`
- 知识点抽取 refs 必须来自本次实际保留的转写/文本块定位且满足内容类型和区间；视频转写使用 startMs 向下取整到秒，图文可引用有依据的页码及 blockIndex。未知、越界、重复及被截断来源的定位不写入；个人笔记正文不作为定位白名单。仅内部上下文增加来源元数据，不增加 API 字段或数据库字段。（2026-10-08 §6.4）

---

## 4. 校验规则总览

> 详细错误码映射见 [`spec/03-ARCHITECTURE.md §2.2`](03-ARCHITECTURE.md)。

### 4.1 内容导入

| 字段 | 规则 | 错误码 |
|------|------|--------|
| `contentType` | 必须是 `video` / `document` | `UNSUPPORTED_FORMAT`(400) |
| `fileName` | 必须有合法扩展名 | `UNSUPPORTED_FORMAT`(400) |
| `fileSize` | 视频 ≤ 2GB；文档 ≤ 50MB | `FILE_TOO_LARGE`(400) |
| `mimeType` | 视频：MP4/MOV/WEBM/MKV；文档：PDF/MD/TXT/PNG/JPEG | `UNSUPPORTED_FORMAT`(400) |
| 本地预签名上传 | HMAC 签名、`storageKey` 必须命中预创建内容；流式实际字节数必须等于 `fileSize`；upload-intent 成功响应为 `Cache-Control: private, no-store` | `FORBIDDEN`(403) / `UPLOAD_SIZE_MISMATCH`(409) |

### 4.2 笔记

| 字段 | 规则 | 错误码 |
|------|------|--------|
| `content` | 非空，≤ 5000 字符 | `NOTE_EMPTY`(400) |
| `ref.timestampSec` | 视频必填，`∈ [0, durationSec]` | `REF_OUT_OF_RANGE`(400) |
| `ref.page` | 文档必填，`∈ [1, pageCount]` | `REF_OUT_OF_RANGE`(400) |
| `expectedVersion` | 乐观锁必填，整数 ≥ 0 | 冲突走「后写覆盖」：返回 `isOverwritten=true`（HTTP 200）|

### 4.3 闪卡（SM-2）

| 字段 | 规则 |
|------|------|
| AI 生成 `front` | 非空、最多 100 字，以 `？` 或 `?` 结尾的可作答问题；不与 `back` 相同 |
| AI 生成 `back` | 非空、最多 700 字；仅依据输入知识点回答 |
| AI 生成 `hint` | 可省略，最多 500 字 |
| `easeFactor` | 范围 [1.3, 3.0]，初始 2.5 |
| `intervalDays` | 非负整数 |
| `repetitions` | 非负整数 |
| `nextReviewAt` | 必填，UTC datetime |
| `rating` | 0-3 整数 |

### 4.4 掌握度

| 字段 | 规则 |
|------|------|
| `score` | [0, 1]，< 0.6 视为薄弱 |
| `isWeak` | 由 score < 0.6 自动维护（写库时计算）|

### 4.5 人脸登录与签到（敏感个人信息）

| 字段 | 规则 | 错误码 |
|------|------|--------|
| `consent` | 录入必须为 `true`，当前 `consentVersion=face-login-attendance-v2` 明确授权本人登录与自动打卡 | `FACE_CONSENT_REQUIRED`(400) |
| `captures` | 仅本次请求使用的摄像头 JPEG/PNG，录入1~3张、登录2~12张连续动作画面，每张 ≤ 1MiB；处理后立即丢弃 | `FACE_CAPTURE_INVALID`(400) |
| `encryptedVector` | 只允许服务端以 AEAD 加密写入；不得通过任何外部 API 返回 | `INTERNAL_ERROR`(500) |
| `enrollmentPhotoKey` | 仅保存私有对象键，不保存 URL 或图片二进制；对象必须独立 AEAD 加密 | `INTERNAL_ERROR`(500) |
| `photoExpiresAt` | 录入成功起 30 天；到期任务删除对象并清空对象键及照片加密元数据，重录/删模板时立即删除旧对象 | `INTERNAL_ERROR`(500) |
| `modelVersion` | 必填；重录时替换旧模板并记录当前版本 | `FACE_CAPTURE_INVALID`(400) |
| `challengeId` | 必须是服务端签发、绑定当前用户和眨眼/转头动作、2 分钟内有效的令牌；过期、篡改或跨用户复用被拒绝 | `FACE_CAPTURE_INVALID`(400) |
| 删除模板 | 硬删除 FaceTemplate 和对应私有照片对象；保留不含生物数据的 AttendanceRecord | — |

---

## 5. API 清单（52 个业务接口 + 1 个运维接口）

> 按模块分组。完整 TS 类型、参数说明、异常映射见 [`spec/03-ARCHITECTURE.md §2.2`](03-ARCHITECTURE.md)。

### 5.1 内容导入与管理（7 个）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| POST | `/api/contents/upload-intent` | 申请上传预签名 | 需登录 |
| POST | `/api/contents/:id/complete` | 确认上传触发解析 | 需登录 + 归属 |
| GET | `/api/contents` | 内容列表（分页）| 需登录 |
| GET | `/api/contents/:id` | 内容详情 | 需登录 + 归属 |
| PATCH | `/api/contents/:id` | 编辑标题/描述 | 需登录 + 归属 |
| DELETE | `/api/contents/:id` | 删除（级联）| 需登录 + 归属 |
| GET | `/api/contents/:id/resource` | 浏览资源下发（视频 Range / 图文预览）| 需登录 + 归属 |

### 5.2 笔记与进度（8 个）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| GET | `/api/contents/:id/notes` | 笔记列表（视频按 timestampSec / 文档按 page 升序）| 需登录 + 归属 |
| POST | `/api/contents/:id/notes` | 创建笔记 | 需登录 + 归属 |
| PATCH | `/api/notes/:id` | 更新笔记（乐观锁 expectedVersion）| 需登录 + 归属 |
| DELETE | `/api/notes/:id` | 删除笔记 | 需登录 + 归属 |
| PUT | `/api/contents/:id/progress` | 上报进度（幂等，5s 心跳）| 需登录 + 归属 |
| GET | `/api/contents/:id/progress` | 读取上次进度（续播/续读）| 需登录 + 归属 |
| GET | `/api/contents/:id/generated-note` | 读取 AI 整理笔记 | 需登录 + 归属 |
| POST | `/api/contents/:id/generated-note` | 按当前解析知识点重新整理 AI 笔记；不覆盖个人笔记 | 需登录 + 归属 |

### 5.3 端云理解流水线（3 个）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| GET | `/api/contents/:id/understanding/status` | 流水线阶段状态（phase + stageDetail）| 需登录 + 归属 |
| GET | `/api/contents/:id/understanding` | 理解产物（转写/文本块/知识点）| 需登录 + 归属 |
| POST | `/api/contents/:id/understanding/retry` | 手动重试（终态失败）| 需登录 + 归属 |

### 5.4 复习与掌握度（4 个）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| GET | `/api/flashcards?contentId=&due=` | 闪卡列表（due=true 取待复习卡）| 需登录 |
| POST | `/api/flashcards/:id/review` | 答题评分（SM-2）| 需登录 + 归属 |
| GET | `/api/mastery/weak-points` | 薄弱点清单（按 score 升序，含知识点 tags 供学科/标签筛选）| 需登录 |
| GET | `/api/mastery` | 掌握度汇总（reviewCount/correctRate/isWeak）| 需登录 |

### 5.5 游戏化（1 个）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| GET | `/api/gamification/profile` | 当前用户昵称/角色、XP、等级与成就档案 | 需登录 |

### 5.5 AI 深度理解（2 个）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| POST | `/api/contents/:id/ai/summary` | 摘要生成（60s 超时）| 需登录 + 归属 |
| POST | `/api/contents/:id/ai/qa` | 内容问答（30s 超时，带 citations）| 需登录 + 归属 |

后续修复（2026-10-09 §10.2）：当前模型内部仅输出 answer/sourceIds，后端校验本次合法保留来源编号，并读取其 ref/单段原文前 500 字组成原 citations；模型不生成摘录或定位。未知编号、占位答案仍校验重试，资料不足允许空编号。下述摘录匹配为前轮实现记录，外部响应字段不变。
问答编号只覆盖本次选中的合法来源：具体问题按文字匹配主题锚点及后三段，视频限制 25 秒邻域、文档限制同页，匹配不足沿用有界上下文。提供最多 3000 字连续阅读文本辅助断句理解，摘录仍取原始单段；不新增数据库字段。

问答 citations（2026-10-09 §10.2）：返回 ref 必须匹配当前资料类型、区间与实际保留的来源；excerpt 为单段原文的连续摘录（最多 500 字）。拼接摘录仅在开头至少 12 字逐字对应来源（短来源需完整开头）且来源可确定时替换为该段原文；模型定位错误时，唯有保留来源中唯一的原文/开头匹配可纠正 ref，不按相邻时间猜测。文档同页多块且省略 blockIndex 时需逐字唯一匹配后补齐块定位；无依据、歧义、已截断来源与重复引用丢弃。全部模型引用无依据或回答为已知格式占位文字时，既有模型校验重试仍失败返回 AI_UNAVAILABLE(503)。个人笔记不授权来源；返回摘录经过内容安全检查。响应字段不变，不修改原始 ASR/OCR 数据。

### 5.6 知识图谱（2 个）

2026-10-09 §10.2：关系抽取模型内部使用短编号而非长数据库 ID；必须返回 mergeGroups/edges/examples。edges 的 relationCode 0/1 分别转换为 PREREQUISITE/RELATED，examples 的 examplePointId 指向 conceptPointId，转换为 EXAMPLE_OF。当前来源端点/非自环与必需字段校验失败后有界重试，仍失败保留已有图谱；可靠空数组仍允许。该协议不新增数据库或外部 API 字段，不从模型省略字段推断空关系，不代表语义正确性保证。
同日 §10.2 补充：主抽取缺少前置或相关边时，每种缺失类型可分别定向补抽一次，仍校验本次端点、非自环、权重范围，并沿用当前 GraphEdge 去重/归一化；任一补抽失败不清除主抽取的有效关系。明确空边仍合法，模型生成关系的语义仍需人工核对。外部字段和枚举不变。

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| GET | `/api/contents/:id/graph` | 内容局部图谱（nodes + edges）| 需登录 + 归属 |
| GET | `/api/graph/overview` | 图谱全局视图（跨内容聚合）| 需登录 |

`GET /api/graph/overview` 仅聚合当前账号拥有的内容。响应 `data` 为 `{ nodes, edges, summary }`：节点按归一化标题/别名与节点类型跨内容合并，包含代表 `pointId`、`pointIds`、`contentIds`、`aliases`、掌握度均值、复习次数、加权练习正确率、最近复习时间、关联笔记/闪卡数量、`isWeak` 和 `weakPointCount`；笔记只在其定位与知识点来源定位一致时计为关联。练习正确率按本人实际 `ExerciseRecord` 的正确条数 / 总条数聚合，同义节点按作答次数加权，不能按复习次数过滤或加权；无作答为 `null`，全部错误为 `0`。复习次数与最近复习仍只反映真实复习，不因做题补造；仅有作答也属于有学习记录。边按聚合节点与关系去重并携带来源 `contentIds`；摘要包含内容、节点、薄弱知识点和边数量。掌握度均值中，无掌握记录按 0 计；空图返回空数组与零摘要。完整类型见 `spec/03-ARCHITECTURE.md §2.2.2-(6)`。

### 5.7 练习（2 个）

2026-10-10 §10.4：生成内部逐题调用（每题60秒/1200输出token/至多一次格式修正），按本次知识点和题型绑定模型单题对象；省略type默认单选，显式判断/简答保留。单选合法唯一answerIndex映射为选项原文，判断的明确真假值映射为原true/false字符串；仅兼容无歧义的单元素答案数组，多答案/越界/未知值拒绝。判断题拒绝明显提问句及解析开头与标准答案相反的明确结论，此规则不保证所有题目语义准确。全数通过既有总题数、题干去重、题型/答案及内容安全检查后一次事务入库，失败不存半套题。无新数据库字段或公开接口变更，生成和未作答列表继续隐藏答案/解析。

2026-10-09 §10.2 题目质量修复：模型返回题目数量必须等于请求 count，同批去首尾空白/小写归一化题干不能重复；题干、选项、标准答案和解析去首尾空白后不能为空。提示要求题干写明比较条件、干扰项确实不成立，条件不足时换题，解析说明正确依据与干扰项错误原因。保留已有唯一标准答案文本/选项不重复校验，不增加自检字段、外部 API 或数据库字段；结构校验不能证明语义唯一性，仍需人工核对。校验失败沿用一次修正重试和 AI_UNAVAILABLE(503)。

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| POST | `/api/exercises/generate` | AI 生成练习（偏薄弱点，≤10 题）| 需登录 |
| POST | `/api/exercises/:id/answer` | 作答判分（回写掌握度）| 需登录 |

### 5.8 笔记管理（2 个）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| GET | `/api/notes/search?q=&page=&pageSize=` | 当前用户笔记分页子串检索（pg_trgm，支持中文）| 需登录 |
| POST | `/api/contents/:id/notes/export` | 笔记导出（Markdown/TXT 预签名下发）| 需登录 + 归属 |

### 5.9 鉴权（5 个）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| POST | `/api/auth/register` | 注册 | 公开 |
| POST | `/api/auth/login` | 登录（5 次/分钟/IP 限流）| 公开 |
| POST | `/api/auth/send-code` | 发送验证码 | 公开（1 次/分钟/IP 限流）|
| POST | `/api/auth/logout` | 幂等清除鉴权Cookie | 同源保护；无需有效access |
| POST | `/api/auth/refresh` | 原登录期限内续签访问令牌 | HttpOnly refresh_cookie + 同源保护 |

### 5.10 运维监控（1 个，不落库）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| GET | `/api/metrics` | Prometheus 文本指标：导入/流水线完成率、MindSpore 与 LLM 可用性和 P95、复习量 | `Authorization: Bearer <METRICS_TOKEN>` |

> `METRICS_TOKEN` 未配置时返回 `METRICS_DISABLED(503)`；该端点只输出进程内瞬时聚合，不写 PostgreSQL 或 Redis，多副本由 Prometheus 在抓取端聚合。

### 5.11 管理员管理（5 个）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| GET | `/api/admin/users` | 管理员分页查询用户，可按关键词和角色筛选 | 需 `admin` |
| POST | `/api/admin/users` | 管理员直接创建用户 | 需 `admin` |
| PATCH | `/api/admin/users/:id` | 修改昵称、角色或重置密码 | 需 `admin` |
| DELETE | `/api/admin/users/:id` | 删除用户及其级联学习数据，禁止删除当前管理员；角色变更也禁止降级当前管理员 | 需 `admin` |
| GET | `/api/admin/overview` | 账号角色计数、今日签到计数、最近新增账号 | 需 `admin` |

`GET /api/gamification/profile` 返回当前账号的 `{ nickname, role, xpTotal, currentLevel, achievements }`；`nickname` 和 `role` 来自登录用户的 `User` 记录，不暴露账号标识或密码字段。`GET /api/admin/overview` 无入参，返回 `{ date, generatedAt, users, attendance }`。`date` 是 `Asia/Shanghai` 的 `YYYY-MM-DD`；`users` 为 `{ total, students, admins, recent }`，`recent` 最多 5 项且每项只含 `{ id, nickname, role, createdAt }`；`attendance` 为 `{ total, signedIn, selfCheckIn, manualConfirmation }`，按该本地日期统计，`total = signedIn + selfCheckIn + manualConfirmation`。响应不含邮箱/手机号、密码哈希、学习内容或人脸信息；管理员角色从数据库当前值校验。无登录返回 `UNAUTHENTICATED(401)`，非管理员返回 `FORBIDDEN(403)`。此接口为只读聚合，不新增数据库模型或字段。

### 5.12 人脸签到（7 个，实验）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| GET | `/api/face/template` | 获取本人模板状态，不返回特征数据 | 当前教师或学生本人 |
| POST | `/api/face/enroll` | 独立授权后录入/重录加密人脸特征模板 | 当前教师或学生本人 |
| DELETE | `/api/face/template` | 硬删除本人加密模板 | 当前教师或学生本人 |
| POST | `/api/attendance/challenge` | 签发一次性基础活体动作 | 当前教师或学生本人；历史兼容，用户页停用 |
| POST | `/api/attendance/verify` | 基础活体交互后完成人脸签到 | 当前教师或学生本人 |
| POST | `/api/attendance/manual` | 历史兼容的待确认记录，用户页停用 | 当前教师或学生本人 |
| GET | `/api/admin/attendance` | 管理员分页查询签到结论 | 需 `admin` |

**接口契约（tasks.md §1.4）**

| 接口 | 入参 | 成功出参 | 异常 |
|------|------|---------|------|
| `POST /api/auth/send-code` | `{ account }`（邮箱或手机号）| `{ sent, account, channel, expiresIn }`（非生产额外返回 `devCode`）| `VALIDATION_FAILED(400)` / `RATE_LIMITED(429，1 次/分钟/IP)` |
| `POST /api/auth/register` | `{ account, code, nickname, password, confirm, agree }`（`account` 邮箱或手机号；`agree` 必须 `true`）| `{ user:{id,email,phone,nickname,role}, accessToken, redirect }` + 下发 `access_token`/`refresh_token` httpOnly Cookie | `CODE_NOT_SENT(400)` / `CODE_EXPIRED(400)` / `CODE_MISMATCH(400)` / `EMAIL_TAKEN(409)` / `PHONE_TAKEN(409)` / `RATE_LIMITED(429)` |
| `POST /api/auth/login` | `{ account, password, remember? }`（`account` 为邮箱或手机号）| `{ user, accessToken, redirect }` + 下发 Cookie；admin redirect=`/admin`，student redirect=`/dashboard` | `INVALID_CREDENTIALS(401，不区分账号/密码)` / `RATE_LIMITED(429，5 次/分钟/IP)` |
| `POST /api/auth/logout` | —；`X-Session-Refresh:1`、同源Origin | `{ loggedOut: true }`，幂等清除鉴权 Cookie | `FORBIDDEN(403)` |
| `POST /api/auth/refresh` | —；`X-Session-Refresh:1`、同源Origin；仅Cookie接收refresh | `{ user:{id,email,phone,nickname,role}, accessToken, expiresInSec }`；仅更新access Cookie | `UNAUTHENTICATED(401)` / `FORBIDDEN(403)` / `RATE_LIMITED(429)` / `INTERNAL(503)` |

| `GET /api/admin/users` | `page/pageSize/query/role?` | `{ page,pageSize,total,items:[{id,email,phone,nickname,role,createdAt,updatedAt}] }` | `UNAUTHENTICATED(401)` / `FORBIDDEN(403)` |
| `POST /api/admin/users` | `{ account,nickname,password,role }` | `{ user }` | `VALIDATION_FAILED(400)` / `EMAIL_TAKEN(409)` / `PHONE_TAKEN(409)` / `FORBIDDEN(403)` |
| `PATCH /api/admin/users/:id` | `{ nickname?,password?,role? }` | `{ user }` | `VALIDATION_FAILED(400)` / `NOT_FOUND(404)` / `FORBIDDEN(403)` |
| `DELETE /api/admin/users/:id` | — | `{ id,deleted:true }` | `NOT_FOUND(404)` / `FORBIDDEN(403)` |
| `GET /api/admin/overview` | — | `{ date,generatedAt,users:{total,students,admins,recent:[{id,nickname,role,createdAt}]},attendance:{total,signedIn,selfCheckIn,manualConfirmation} }` | `UNAUTHENTICATED(401)` / `FORBIDDEN(403)` |

> 令牌：access默认15min（随响应体返回 + httpOnly Cookie），refresh默认30d（仅HttpOnly Cookie）。§22.1未记住时refresh签名及Cookie均最长2h，记住时使用配置期限；续期不轮换refresh、不延长原期限，access不得超过剩余期限。验证码存Redis（TTL 300s），Redis不可用时降级进程内Map。

### 5.13 人脸登录与每日打卡（4 个，§19）

| 方法 | 路径 | 用途 | 鉴权 |
|------|------|------|------|
| POST | /api/auth/face/challenge | 账号绑定、两分钟一次性挑战；不查询账号存在性 | 公开，IP限流 |
| POST | /api/auth/face/login | 仅教师/学生通过真实服务完成本人核验后签发角色会话与每日打卡；管理员统一拒绝 | 公开，账号绑定挑战及IP限流 |
| GET | /api/attendance/today | 本人上海日期、当天打卡状态/方式/首次时间 | 当前教师或学生本人 |
| POST | /api/attendance/today | 直接普通打卡；当天幂等，无需审批 | 当前教师或学生本人 |

> **合计：7（内容导入）+ 8（笔记进度）+ 3（理解）+ 5（复习掌握度/游戏化）+ 2（AI）+ 2（图谱）+ 2（练习）+ 2（笔记管理）+ 5（鉴权）+ 5（管理员管理）+ 7（人脸签到）+ 4（人脸登录与每日打卡）= 52 个业务接口，另有 1 个运维接口。**

---

## 6. 鉴权机制

### 6.1 账号体系

- 账号标识支持**邮箱或手机号**（二选一，均唯一；`email?` / `phone?` 可空）
- JWT（HS256）签发，载荷包含 `sub(userId) / email / role / iat / exp / tokenUse(access|refresh)`；refresh额外含credentialVersion（密码哈希SHA256，私有，不入响应/日志）。刷新必须复核用户存在、当前角色与密码版本；业务Bearer拒绝refresh用途。
- 密钥从环境变量 `JWT_SECRET` 读取，**生产必须改默认值**
- 过期时间：访问token默认15min，刷新token默认30d，未记住最多2h；续期只更新access且不超剩余refresh期限，不轮换refresh。旧用途未标记refresh拒绝续期，旧access仅兼容不超访问预算的有效签名。临时故障不清会话；401确认失效清Cookie。POST refresh/logout须同源Origin及固定头，不接受请求体中的凭据；响应no-store。客户端SESSION_CHANGED、SESSION_REFRESH_UNAVAILABLE、SESSION_RENEWED_RETRY仅是本地错误码，不新增后端枚举或数据库。

### 6.2 密码

- bcrypt 加盐哈希，cost = **12**（[`src/lib/auth/password.ts`](../src/lib/auth/password.ts)）
- 校验失败统一返回「账号或密码错误」，不暴露账号存在性

### 6.3 资源归属校验

- 所有写接口依赖 [`src/lib/auth/ownership.ts`](../src/lib/auth/ownership.ts) 的 `assertOwnership(ownerId, userId)`
- 不匹配抛 `FORBIDDEN(403)`

### 6.4 限流（按接口分级）

| 接口类型 | 阈值 | 实现 |
|---------|------|------|
| 公开登录/注册 | 5 次/分钟/IP | Redis + Lua 原子计数 |
| 验证码发送 | 1 次/分钟/IP | 同上 |
| AI/推理调用 | 更严格阈值（默认 20 次/分钟/用户，可调）| 同上 |
| 人脸录入/验证/挑战 | 5 次/分钟/用户；连续 3 次失败冷却 5 分钟 | Redis + 内存故障兜底；键仅使用用户 ID 哈希 |
| 普通读写 | 60 次/分钟/用户 | 同上 |

详见 [`src/lib/api/rate-limit.ts`](../src/lib/api/rate-limit.ts)（P1 待落地）。

### 6.5 统一响应格式

```ts
// 成功
{ success: true, data: T, message?: string, timestamp: string }

// 失败
{ success: false, error: { code: ErrorCode, message: string, details?: any }, timestamp: string }
```

详见 [`src/lib/api/response.ts`](../src/lib/api/response.ts) 与 [`src/lib/api/errors.ts`](../src/lib/api/errors.ts)。

---

## 7. 错误码总览

> 完整错误码定义见 [`spec/03-ARCHITECTURE.md §2.2`](03-ARCHITECTURE.md) 与 [`src/lib/api/errors.ts`](../src/lib/api/errors.ts)。

| 模块 | 错误码前缀 | 示例 |
|------|-----------|------|
| 鉴权 | `UNAUTHENTICATED` / `INVALID_CREDENTIALS` | `UNAUTHENTICATED`(401) / `INVALID_CREDENTIALS`(401) / `FORBIDDEN`(403) |
| 内容导入 | `CONTENT_*` / `UNSUPPORTED_FORMAT` / `FILE_TOO_LARGE` | `CONTENT_NOT_FOUND`(404) / `UPLOAD_SIZE_MISMATCH`(409) |
| 笔记 | `NOTE_*` / `REF_*` | `NOTE_EMPTY`(400) / `REF_OUT_OF_RANGE`(400) |
| 流水线 | `UNDERSTANDING_*` / `PIPELINE_*` | `PIPELINE_FAILED`(500) |
| AI | `AI_*` | `AI_UNAVAILABLE`(503) / `QUESTION_EMPTY`(400) |
| 推理 | `INFER_*` | `INFER_UNAVAILABLE`(503) / `INFER_TIMEOUT`(504) |
| 存储 | `STORAGE_*` | `STORAGE_UNAVAILABLE`(503) |
| 通用 | `INTERNAL_*` / `RATE_LIMITED` | `INTERNAL_ERROR`(500) / `RATE_LIMITED`(429) |
| 人脸签到 | `FACE_*` | `FACE_CONSENT_REQUIRED`(400) / `FACE_CAPTURE_INVALID`(400) / `FACE_NOT_ENROLLED`(409) / `FACE_VERIFICATION_FAILED`(422) / `FACE_ATTENDANCE_COOLDOWN`(429) / `FACE_SERVICE_UNAVAILABLE`(503) |

---

**最近核对**：2026-09-24（补充经用户确认的人脸特征模板与签到记录设计；实现前仍需以 `prisma/schema.prisma` 迁移结果为准）

## 10. 教师评审增量契约（2026-10-08）

### 学习计划
新增 LearningPlan 表：id、ownerId（User 级联）、contentId（LearningContent 级联）、title（1–100 字）、targetMinutes（整数 1–600）、scheduledAt（UTC 时间）、remindAt（UTC 时间，不晚于 scheduledAt）、completedAt（可空）、createdAt、updatedAt；索引 ownerId/completedAt/remindAt。不存短信、邮件或推送凭据。
GET /api/study-plans?page=&pageSize=&due= 返回本人分页计划（含 contentTitle）；due=true 仅筛未完成且 remindAt 不晚于当前时间。
POST /api/study-plans 接收 contentId/title/targetMinutes/scheduledAt/remindAt，所选内容必须属于本人。
PATCH /api/study-plans/:id 接收 completed:boolean，可完成或撤销完成；DELETE 删除本人计划。非本人资源统一不可访问；缺失返回 NOT_FOUND(404)，入参错误 VALIDATION_FAILED(400)，资源归属错误 FORBIDDEN(403)。
计划完成进度 = 已完成计划数 / 全部计划数，完成操作为手动确认，不伪装成实际学习时长。提醒仅在登录工作台/计划页时显示，每分钟刷新，无后台系统推送。

### 复习题库
GET /api/exercises?contentId=&type=&status=all|unanswered|wrong&page=&pageSize= 返回本人资料/知识点下的分页题目（pageSize 1–50）。wrong 指历史曾经答错，可再次作答；unanswered 指当前学习者尚无记录。
列表项目为 exerciseId/contentId/contentTitle/pointId/pointTitle/type/question/options/index/latestRecord；latestRecord 仅含本人最近作答 userAnswer/correct/createdAt/correctAnswer/explanation，没有本人作答记录时为 null。未作答题目不返回正确答案和解析。
生成接口同样不再下发正确答案/解析；答案只在既有作答判分接口返回。每次作答仍写记录并重算掌握度。

2026-10-10 §20.8 既有判分行为说明（无字段或接口变更）：简答将用户答案和存储答案分别 trim、连续空白合并为一个空格、转小写后比较是否完全相同；不移除标点或词间空格，不识别同义表达，不做语义判分或部分给分。单选继续接受选项原文或 A–F 编号，判断继续归一化既有中英文真假表达。correct 及练习组正确率代表此规则下的判分结果，不代表模型对语义掌握程度的评估；页面说明不得改变已有记录或掌握度算法。

### 学习中心
/import 作为统一学习中心，展示全部资料、导入表单、解析状态、按标题搜索、按视频/图文筛选、继续学习。侧栏以一个学习中心入口覆盖 /import 和 /study/:id，保留原深链接；学习页增加返回学习中心入口。

## 19. 人脸登录与每日打卡契约（2026-10-09）

2026-10-09用户要求scan：公开challenge增加verificationMode:'action'|'scan'；公开login保持原入参（2–12帧）且忽略客户端模式，由服务端FACE_LOGIN_MODE决定。私有模型verify入参/响应均含verificationMode（缺省action），scan保留单人/matched/modelVersion，livenessPassed恒false且不作为登录门槛，明确不代表活体。旧action仍要求活体，响应模式不符关闭登录；无新数据库字段。模板授权仍v2，仅用途和特征存储不变。

§19真人补修：动作采集改约4秒，12帧上限不变。独立模型health的受Bearer保护lastVerification为单条进程内结论，不是数据库字段；只含时间、动作、singleFace/identityMatched/actionPassed与动作失败阶段枚举，无账号、原始生物信息或分值，公开登录响应仍统一401。

本轮补验新增本地 CPU 模型部署，不修改数据库/公开接口。模型向量为归一化的 128 个 float32 小端数（512 字节），模型版本 `yunet2023-sface2021-mp1-c045-action-v1`；新服务拒绝其它长度、非有限值及非单位向量。模型服务 enroll 只向受 Bearer 保护的 Next 后端返回 embeddingBase64，不向浏览器泄露；verify 只返回 faceCount/matched/livenessPassed/modelVersion。基础动作要求起始正视/睁眼、指定动作、结束回正/睁眼；不以静态图身份匹配代替活体。

- POST /api/auth/face/challenge：account（邮箱或手机号，最长254），不查账号存在性；服务配置完整才签发两分钟账号绑定HMAC挑战，返回 challengeId/action/expiresAt，挑战摘要写 FaceLoginChallenge。POST /api/auth/face/login：account/challengeId（最长2048）/captures（2–12张JPEG/PNG，每张≤1MiB；前端连续采集动作约4秒）/remember。共享密码登录IP限流5次/分钟；数据库原子消费挑战，过期、跨账号、重放拒绝。不存在/管理员/未授权/不匹配统一INVALID_CREDENTIALS(401)，服务故障FACE_SERVICE_UNAVAILABLE(503)，无生物数据日志。
- 模板授权版本 face-login-attendance-v2。仅数据库当前student或teacher可录入该版本用于登录，管理员始终拒绝；旧模板不授予登录权限。服务端检查单人、匹配、模型版本与服务端模式（仅action要求活体），完成验证后事务内锁定当前用户/模板并复核角色及updatedAt；当天本人打卡落库后才返回与密码登录一致的user/accessToken/redirect及HttpOnly cookies，教师重定向`/teacher`、学生重定向`/dashboard`。
- GET /api/attendance/today 返回 {date,checkedIn,method:'manual'|'face'|null,signedAt:string|null}；POST同路径无业务入参，由服务端日期写普通打卡。仅数据库当前student或teacher可查看/写入本人记录，管理员拒绝；教师不能读取全站签到列表。AttendanceRecord新增checkInDay可空YYYY-MM-DD，(userId,checkInDay)唯一；普通使用SELF_CHECK_IN、人脸SIGNED_IN，历史MANUAL_CONFIRMATION保留。已打卡返回原记录，不改变首次方式与时间；历史字段null不追溯伪造日期。
- FaceLoginChallenge {tokenHash SHA256主键,expiresAt datetime索引}；不存账号、图像或token原文。消费用deleteMany原子count=1，每次签发清理到期摘要。人脸模型HTTP请求15秒上限，未知故障关闭登录，不回退伪造身份。模板和用户行锁防止验证期间删除/重录/角色变更绕过复核。
- 管理员列表增self_check_in筛选，总览增selfCheckIn计数；total=signedIn+selfCheckIn+manualConfirmation。历史人工确认接口保留兼容，用户页面不再调用；每日成功接口不依赖审批。网页不新增依赖；本次真实服务补验新增隔离Python依赖，见§19.1及README。

## 10.4 列表及资料管理一致性补充（2026-10-09）

GET /api/contents 与 GET /api/flashcards 保留原 page/pageSize/total/items 契约和1–50单页上限；前端共享服务顺序汇总各页，不扩大服务端pageSize。内容排序 createdAt desc/id desc；闪卡排序 nextReviewAt asc/createdAt asc/id asc。待复习统计使用due=true，未来到期卡不计入；所选资料继续传contentId。
学习中心标题修改/删除调用已有PATCH/DELETE，标题继续沿用既有校验；跨用户修改和删除返回403，内容删除沿用现有级联规则。没有新增表、字段或接口；客户端LIST_CHANGED只表示聚合未推进，不是后端错误码。

## 21.1 学习Agent增量接口（2026-10-10）

新增POST /api/assistant/agent（需登录、本人资料归属、AI限流），不改变既有接口和22张数据库表。入参contentId（1–100字符）、message（trim后1–1000字）、minutes（整数5–120，默认20）、history（最多6条，每条role=user|assistant及1–1500字content，默认空）；未知字段拒绝，不接收客户端掌握度/成绩、工具结果、角色权限或执行参数。资料须READY且COMPLETED，否则CONTENT_NOT_READY/NO_UNDERSTANDING(409)，不存在404、非本人403、匿名401、字段错误400、限流429、内容安全403、模型不可用503。

成功data：runId/contentId/answer/citations（既有ref/excerpt配对）/steps（tool/label/summary，仅实际工具执行）/practice（至多5条BankQuestion，但latestRecord恒null，隐藏标准答案/解析）/plan（null或title/targetMinutes/steps，steps为title/minutes/pointTitles）/createdAt。计划targetMinutes为步骤分钟之和且不超过输入minutes；原文引用仅来自实际检索，资料类型/范围合法。模型内部知识点/题目/来源短编号严格映射，不写入新字段。不持久化Agent会话，不由Agent提交作答、评分、完成计划或增加XP；保存计划继续使用既有POST /api/study-plans，由前端明确点击发起。

pointTitles可为空表示综合复习步骤；计划仅将既有title/targetMinutes/scheduledAt/remindAt字段持久化，步骤与会话刷新后清空。内部模型Schema丢弃未知元数据后，仅允许参数进入只读工具；不改变公开请求的严格校验。状态工具逐项返回score:number|null，真实0分不能当null；页面摘要最多展示前5项分数并标出未知数量。来源匹配与有限中文矛盾校验不构成全文覆盖或自动语义正确性保证。

一般分析允许plan=null；用户message明确包含计划/方案/安排时要求非空计划，仍校验步骤分钟之和。知识点摘要不进入最终回答的原文输入，仅用于模型决策定位。公开响应结构不变。

### 21.3 私有忠实性校验

2026-10-11 20:47：当前本地演练已通过真实回放、完整请求及本人页面人工核对，显式设置AGENT_REVIEW_READY/AGENT_REVIEW_THINKING=true；默认false不变。术语审查同时读取既有真实learning/exercises，知识点目录不等于掌握记录；没有新增公开字段。后文未验收/关闭的描述为默认限制或历史状态，最新证据见docs/acceptance/agent-review-thinking-20261011.md。

思考私有wire verdict/coverage可使用supported或rejected；rejected必须有1–3条真实候选锚定问题，sourceQuote仍验证实际所选原文编号或连续摘录，空串仅代表缺课程锚点。后端将全有锚点的rejected转为contradicted，含空锚点转为insufficient，再经过原reviewSchema；绝不将rejected改成supported。既有三态及其contradicted非空锚点约束保留，无公开返回字段变更。

2026-10-11定向补修：思考审查supported后可进行私有术语提取，输出unsupported数组（最多3项），每项claim为实际候选句整数编号、term为该句连续出现的2–30字符文字；后端验证term不在任一所选原文中，生成既有insufficient/claim/sourceQuote空串/problem结构。编号越界、虚构术语或已在原文中的术语均按格式错误拒绝，不改公开DTO。ChatOptions私有deadlineAt为有限的绝对毫秒时间戳，全部模型尝试共享该期限，超期前不发新请求，迟到响应不作为成功结果。

2026-10-11续修：内部claim同sourceQuote可用实际连续候选片段整数编号，后端映射为6–300字逐字文本后再校验，精确字符串保留兼容，不向公开DTO添加字段。审查员看完整候选、原文和真实状态；片段编号只保证对应，不证明语义。私有AGENT_REVIEW_THINKING精确true且供应商aliyun时，审查请求固定enable_thinking=true/thinking_budget=512，max_completion_tokens增加512以保留原回答预算；其它阶段仍非思考。私有boundedThinking不允许用于其它供应商，超时/格式/权限错误响应不变，思维链不公开或留日志。

有界思考审查内部coverage须覆盖最多60个实际候选片段编号，每项{claim:整数,verdict:supported|contradicted|insufficient}；遗漏/重复/越界或整体supported与局部拒绝不一致均Schema失败，候选超过60个不同片段时在模型请求前失败，不截断遗漏事实。coverage仅私有校验，不进入公开结果或存储；逐句覆盖不等于语义准确证明。

2026-10-11证据模式补修：公开AgentResult保持原字段。answer显式说明解释未通过核验，内容只由服务端实际学习摘要和连续原文构造；citations/practice严格来自当前工具状态，不透传候选模型answer/plan。plan在用户明确要求方案时按预算生成回看/已有练习/疑问整理步骤，没有题目时不安排虚构练习，目标与分钟仍须学习者点击才保存。未开启AGENT_REVIEW_READY或两次语义拒绝进入此模式，前者不调用最终生成/审查；配置/权限/内容安全/工具失败沿用原错误响应。证据模式不使用新成功字段冒充模型核验通过。

2026-10-11短摘引保护：answer内所有非空引号内容均须逐字匹配所选来源，1–180字且合计最多5处；另须至少一处≥6字的真实摘引，不能用四字术语规避核心依据要求。这里只强化私有校验，不改变公开DTO；来源匹配不证明未加引号的解释正确，独立语义审查保持。

13:23候选审查引用纠正：内部模型sourceQuote允许选择服务端sourceQuoteChoices中整数quoteNumber；仅所选sources、最多每来源12段、每段6–160字符连续原文、步长120。服务器映射为字符串再执行原FaithfulnessReview契约；精确原文字符串仍可兼容，非连续改写/越界编号均Schema失败，不放宽contradicted必须真实摘引。公开DTO保持，不新增表或客户端配置。

最终模型私有quoteNumbers为最多5个片段整数编号，默认空；映射前校验实际白名单及其sourceId属于所选sourceIds，服务器前置真实原文到answer，再执行既有摘引及全回答审查，quoteNumbers不进入公开AgentResult或数据库。无编号兼容原合法摘引，不能因自动引用而免除语义审查。

2026-10-11 增加内部provider=aliyun，服务端DASHSCOPE_API_KEY仅用于固定北京百炼qwen3.5-plus；ALIYUN_AGENT_QUOTA_CONFIRMED须精确true才能发起该候选请求，默认关闭且只表示维护者已确认免费额度和云端用完即停生效，不能作为厂商计费保证。缺Key/缺确认（私有MISSING_API_KEY/QUOTA_NOT_CONFIRMED）继续映射AI_UNAVAILABLE(503)，不回退其它模型、不新增客户端配置、公开字段或数据表。同一provider用于所有Agent阶段，AGENT_REVIEW_READY仍需真实语义及完整请求验收后开启。

2026-10-11 仅增加内部模型选择：ChatOptions.provider可为spark|bigmodel，src/lib/agent/model.ts从服务端AGENT_MODEL_PROVIDER读取；公开请求不接收供应商/模型/地址/密钥。bigmodel固定glm-4.7-flash且只读ZHIPU_API_KEY，缺失或配置错误沿用AI_UNAVAILABLE(503)，不回退其它模型。决策/生成/审查共享选择，原接口和数据库保持；AGENT_REVIEW_READY仍关闭直至真实验收，不向页面返回思考过程或上游错误正文。

公开请求、成功DTO与数据库字段保持§21.1契约。内部回答的所有非空引号内容1–180字符、最多5处，逐字匹配所选sourceIds的excerpt（只折叠空白）；有原文时必须至少一处6字符以上摘引。独立模型审查返回verdict=supported|contradicted|insufficient、issues最多3项{claim:候选逐字6–300字符,sourceQuote:原文逐字6–180字符或空串,problem:1–180字符}；contradicted必须非空sourceQuote，insufficient可为空。supported要求空issues，其余要求至少一条，多余字段丢弃，不公开审查意见或隐藏推理。只允许一次语义修正，再次未获支持则丢弃全部候选解释/计划，按本节证据模式返回实际工具结果及后端预算安排；不输出不可靠候选或伪造来源。模型/格式/超时失败保持503，不因校验失败保存计划、题目答案、笔记或成绩。

真实生成式解释尚未通过稳定语义验收，服务端验收开关AGENT_REVIEW_READY默认关闭（仅精确true开放原文解释候选通道）。关闭时受控工具决策仍须成功；涉及原文的结果返回HTTP200证据模式，说明解释未通过核验并展示实际原文、已有练习及请求的安排，不包含模型解释或候选计划。此行为替代历史REVIEW_NOT_READY一律503；历史失败记录保持。无原文的状态分析仍可用，其他既有接口无变更。不能因为证据模式成功或模型自行返回supported而开启未经验收的生成式解释。

### §22.10 上传地址兼容约定

upload-intent的uploadUrl:string在local驱动为以/api/storage/upload开头的同源相对URL，原key/expires/sig完整保留；S3为原始绝对预签名URL。Node客户端必须new URL(uploadUrl,网站base)解析；无字段/数据库变更。NETWORK_UNAVAILABLE和UPLOAD_NETWORK_UNAVAILABLE仅客户端连接错误（status=0），不代表文件格式或解析失败。

### §22.11 PDF分页修复
ParsedDocument内部接口改为Promise，按PDF.js真实页码及字体映射提取正文。没有公开字段或表变化；resource.url在local驱动返回同源相对路径，S3原绝对签名不变。222页资料的AI摘要只覆盖选取来源，不代表逐页处理完成。


### §22.13 会话来源校验
refresh/logout公开字段、状态码与Cookie期限不变；合法公开Origin与APP_URL匹配，本地回环别名仅同协议/端口；外站、非规范Origin、缺自定义保护头、Sec-Fetch-Site=cross-site仍403。不根据未可信Host或转发头扩大允许源。


### §22.14 练习生成校验补充
单选options仍2-6条，必须包含实际可选内容，不能仅A-F/选项编号/待补充等占位；NFKC、空白及编号前缀规范化后不能重复，正确答案仍精确匹配一个原选项。数字、数学符号或含字母的实际内容允许。两次模型纠正耗尽时AI_UNAVAILABLE/503且本批不保存，提示质量校验失败；字段及历史题目不变。


§22.14补充：若单选解析明确写某选项正确/错误或正确选项编号，必须与correctAnswer在options中的位置一致；矛盾时走原质量纠正/拒绝，不根据解析擅自改答案。不宣称检查所有自然语言语义。


### §22.15 长文档来源覆盖
PDF/MD/TXT理解采用有界页段逐批处理，来源仍使用原ContentRef，没有新增接口或字段。每批必须有真实引用，全部通过后才写知识点；超限/来源缺失/失败显式报错。AI笔记按真实文档页码排列，个人Note独立保存。全量处理不等于每页引用或总结准确率。专项旧PDF补修仅增加知识点/闪卡和更新GeneratedNote，不删除原ID及关联记录。

### §22.16 复习巩固契约
Flashcard列表DTO新增可空contentTitle与pointTitle，不返回跨归属或跨内容知识点标题。题库查询新增可选pointId（非空字符串），必须与原本人资料/知识点过滤共同生效；未作答仍不返回标准答案和解析。数据库模型与review响应不变，客户端使用服务端已有nextReviewAt与XP字段展示反馈。显示忘记/模糊/记住/熟练仍映射旧rating0/1/2/3，仅文案调整；该记录是自评，不是客观正确率。

### §22.20 上传意图恢复契约
createUploadIntent请求新增可选contentId，响应仍contentId/uploadUrl/expiresInSec；仅本人待导入且未开始理解/异步任务的相同文件允许续签。状态/文件不一致返回409 IMPORT_IN_PROGRESS（消息区分），不存在404、外来403。数据库无新字段/迁移，续签更新既有updatedAt。原遗留标失败使用既有FAILED/failReason且仅受控维护，不新增公开恢复/批量清理接口。

### §22.24 错误原因提示

AiError及公开失败响应字段/错误码不变，仅星火已知业务错误的中文message由固定白名单生成；understanding/status既有failureReason显示该安全原因。审核失败不能冒充额度耗尽，11200明确授权或业务量限制、不查询余额；上游原message、文档正文、凭据不出现在响应中，无新表/迁移。

### §23.1 LiveSession与LiveChunk（历史模型，业务已退场）

当前API契约：LiveSession/LiveChunk现有表、迁移和历史行保留，不自动删除或转换。五个旧录音API路径的GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS统一返回410 `LIVE_NOTES_RETIRED` 与private/no-store；HEAD无正文。路由不检查凭据、资源ID或请求体，不读取/写入数据库，不调用ASR/大模型，也不提供旧录音记录在线查询。当前播放器随看笔记接口见§23.2。下方旧字段和接口说明只作为历史实现记录。

LiveSession(id,ownerId,title,state LIVE|FINISHED,nextSequence,totalSamples,processingSequence?,highlights JSON,lastHighlightSequence,highlightVersion,summaryMarkdown?,createdAt,updatedAt)。LiveChunk(id,sessionId,sequence,digest,sampleCount,startMs,endMs,state RUNNING|DONE|FAILED,text,reason?,createdAt)；唯一sessionId+sequence，索引ownerId/createdAt，归属随User删除级联。音频不落数据库，WAV只临时文件。

POST /api/live-notes {title}创建；GET列表至多20条；GET/:id返回本人会话和按sequence片段；POST/:id/chunks {sequence,pcmBase64}仅16k mono PCM16，100ms至5秒/片，30分钟/会话；hash冲突或乱序409，同序DONE幂等返回。POST/:id/highlights仅当6片新完成或结束前尾段生成当前窗口重点，所有sourceSequences必须属于该窗口，白名单固定引用正文。POST/:id/finish要求无处理中的片段，将state置FINISHED并组织全部转写/重点Markdown，重复结束返回同笔记。所有接口鉴权+本人所有权，非本人403、不存在404；已有统一错误/响应沿用，无原学习数据字段变更。

§23.1补充契约：LiveSession另含processingToken?/processingStartedAt?，仅服务端锁字段，不公开token。片段取得独立token后提交必须匹配；超过2分钟的中断租约只在用户重试片段或结束时恢复，GET无副作用。正常finish拒绝FAILED/RUNNING；显式POST {keepSuccessfulOnly:true}允许仅保存成功文本，Markdown明确不完整，仍拒绝有效处理中的片段。LIVE_CONFLICT为409，LIVE_ASR_UNAVAILABLE为503。highlights接口支持手动小窗口，浏览器每6片自动触发；单进程互斥加highlightVersion CAS防重复提交，不保证跨副本模型请求去重。创建事务限制每人2条LIVE。

### §23.2 随看笔记无新表
POST /api/contents/:id/ai/watched-note {segmentIds:唯一非空string[1..12],throughSec:有限非负number}；需本人READY VIDEO、位置不越时长。来源都在当前内容且起止合法，endMs<=throughSec*1000、总正文<=6000；服务器只校验范围，不证明用户真实观看。响应{markdown,sources:[{segmentId,startMs,endMs,text}],generatedAt}，原文由数据库提供，标题摘要AI辅助待核对。字段/来源错误400、无权限403、未就绪409、限流429、模型失败503。生成不落库，保存仍用Note无新字段。

### §25.4 本人笔记列表（实现前契约）

GET /api/notes：鉴权；q可选、trim后0..200字，contentId可选1..128字，page默认1（1..100000）、pageSize默认20（1..50）；同名重复参数400。指定资料必须属于本人，否则404。查询同时约束Note.ownerId与lesson.ownerId，管理员也仅列本人；关键词只匹配个人笔记正文。按updatedAt降序、id升序分页，返回{page,pageSize,total,items:[NoteItem & {contentTitle:string}]}，版本及ISO日期沿用NoteItem。无匹配返回空列表；不含GeneratedNote或随看草稿。旧/notes/search必填q规则不变。

前端编辑/删除复用原PATCH/DELETE，保留expectedVersion及isOverwritten后写覆盖提示，不新增锁规则。按所选本人资料导出全部个人笔记，复用原export，明确并非当前关键词/分页导出；来源回看使用原ref真实时间或页码。无schema/依赖变更。

### §23.6 摘录生成契约
watched-note成功DTO新增mode:source-extract，客户端类型可选以兼容旧内存批次；原markdown/sources/generatedAt不变，无新表/迁移。模型私有points={keyword:2..30字单行连续原词,sourceNumbers:当前来源编号1..12}，1..3点，未知/空/原词不对应或Markdown>4500拒绝503。不允许summary/title自由文本字段，拒绝额外字段。服务端从所选编号最小到最大及前后一条已看来源逐字摘录，安全检查仍生效，来源窗可能有时间空隙且边界上下文不完整。新保存前缀注明原文摘录，不追溯旧Note。

### §29.5 班级HTTP契约（28基础上的业务入口）

- GET /api/classes?page=1：{canCreate,items:[id/title/description/state/revision],page,hasMore}，每页20；只查本人负责或当前ACTIVE学生成员的班。
- POST /api/classes：{requestId(UUID),title(1–100),description(≤2000)}；仅当前admin。负责人由服务端确定。
- POST /api/classes/join：{requestId,code(22位base64url),confirmed:true}；当前student，账号/IP各5次每分钟，包括坏输入。失效统一400不泄漏班级信息；LEFT可主动新加入，REMOVED由负责人恢复。每班200名成员含退出/移除历史，不硬清除成员。
- GET /api/classes/:id：{classroom,canManage,memberCount,chapters,assignments,members,invites}；学生members/invites为空且章节/任务经过发布状态过滤。日期ISO，无邀请码摘要/原码、存储键、用户联系方式、提交草稿。最多100章/100任务/200成员/100邀请历史；正文总量150000字符。
- GET /api/classes/:id/sources?page=1：仅负责人，当前PUBLISHED、preparedAt非空、rightsConfirmed且非空白rightsStatement的现有共享课程id/title，每页50；不列私人资料、不改权限。
- POST /api/classes/:id：通用requestId/expectedRevision；action=class（title/description）、archive（state、confirmed）、invite（days1–30/maxUses1–5000/confirmed）、revoke（inviteId）、member（studentId/memberRevision/state ACTIVE或REMOVED/confirmed）、leave（confirmed）、chapter（可空id/entityRevision、title/body/sequence/state/sharedCourseId/publishConfirmed）、assignment（可空id/entityRevision、title/instructions/chapterId/state/dueAt/publishConfirmed）。编辑需实体版本，创建不传ID。schema拒绝额外字段。

写响应{classroomId,resultId,replayed,code?}；只有新建邀请码首次成功有code，不持久化原码，相同请求重放不再展示。新码撤销旧码；归档撤码、恢复不复活。归档只允许恢复和学生主动退出，其它写409。未来截止才能发布任务，CLOSED需截止但可为过去；绑定章节须同班，隐藏章任务对学生不可读。PUBLISHED及已发布/CLOSED内容修改须确认。说明正文≤20000，输入流128KiB支持完整中文正文，未知/重复分页参数拒绝。

幂等与审计同事务，完整规范化输入（含URL班级ID）摘要，不保存正文/邀请码；相同键不同输入409，当前权限检查先于重放。每负责人≤20班，每班≤100章/100任务/100邀请历史。不存在/越权404、状态/并发/容量冲突409、非法字段400、限流429，全部private/no-store。详细类型见src/lib/classrooms/contracts.ts，[29实施协议](29-CLASSROOM-WORKFLOW.md)。29.6提交/批阅/附件新增契约如下。

### §29.6 作业提交与附件接口

GET /api/class-assignments/:id?page=1返回assignment白名单、classroom摘要、canManage/canEditDraft/canSubmit及本人submission或仅负责人board；board每页20真实成员，不select draftText。GET /api/class-submissions?page=1返回本人正式历史，每页20；GET /api/class-submissions/:id返回最多50冻结版本、任务/截止快照及评语，草稿仅本人允许状态可见。跨班/跨人包括其它管理员统一404，退出学生只保留本人已交历史。

POST /api/class-assignments/:id：draft带requestId(UUID)、expectedRevision（首次0）、bodyText≤50000；submit带requestId、expectedRevision≥1、assignmentRevision、attachmentIds≤5且唯一、confirmed:true。先保存，再冻结已存正文/当前就绪附件；正文和附件不能同时空。仅ACTIVE班/成员及当前PUBLISHED任务可提交，服务端截止前再次核对，CLOSED/到期仅允许符合条件的草稿保存。正式版本最多50，状态DRAFT或RETURNED可编辑→SUBMITTED；同键重放在鉴权后、CAS/截止前，学生保存不改班级revision。

POST /api/class-submissions/:id：review带requestId、expectedRevision、versionId、state RETURNED/GRADED、score、feedback1–10000、confirmed:true；仅当前负责人/ACTIVE班、最新尚未批阅SUBMITTED。RETURNED分数null，GRADED整数0–100。评语追加，退回恢复文字，新提交独立新版本，旧附件和评语不覆盖。写返回{submissionId,resultId,replayed}。

POST /api/class-submissions/:id/attachments为意图：requestId、expectedRevision、fileName、mimeType、sizeBytes。PDF/TXT/MD/PNG/JPEG扩展名和实际结构均须符合；最多5个有效草稿文件、单个20MiB/总50MiB、24小时意图、单提交历史最多250行。POST /api/class-attachments/:id/upload为认证原始字节，先鉴权再读流，60秒/20MiB，大小/结构/摘要一致且条件写成功后重新鉴权READY；同字节可重试，不覆盖已存在不同字节。POST /api/class-attachments/:id接受remove、requestId、expectedRevision；仅本人未绑定附件先DELETED再删固定对象，失败墓碑可重试。

POST /api/class-attachments/:id/download返回{expires,sig,expiresInSec:60}，签名绑定当前账号/附件ID，base64url43字符；POST /download/file将{expires,sig}放JSON，再认证/验签/逐次复核授权并返回字节流。签名不进URL/日志/localStorage，不返回存储键或通用对象地址。强制attachment/nosniff/sandbox/private-no-store。清理仅versionId=null且过期UPLOADING/READY/DELETED，保留墓碑和正式附件。

JSON流上限256KiB，普通写40次/分钟、意图/上传10次/分钟，真实状态或字节大小与声明冲突409、格式/分数/确认或文件超限400（沿用FILE_TOO_LARGE映射）、存储不可用503，读取失败不冒充空列表。完整DTO及细节以assignment-contracts.ts和[30规格](30-ASSIGNMENT-WORKFLOW.md)为准，无数据库字段/迁移变化。

### §29.7 作业校对数据/接口（实施契约）
新增HomeworkDraft，字段、CHECK、90秒租约、100条/100操作上限和五状态详见31-HOMEWORK-RECOGNITION.md。GET/POST /api/homework为本人分页/显式创建；GET/POST /api/homework/:id为读取和CAS保存/确认/归档，输入严格联合text/file/submission，不接受ownerId或对象键。确认要求1–20题唯一题号、题目/答案、参考答案或评分依据、逐题及总确认；不完整保存与已确认冻结分别处理。来源摘要与原识别只读，不暴露字节、存储键和操作日志。全部当前student及owner复核/private-no-store。文件4MiB/JSON6MiB、PDF20页/文字50000字，不静默截断；错误明确保留，低置信无伪造分数。

§29.7本地迁移已应用，现有56业务表；校对confirmed只表示本人确认，不等于参考答案已被外部核验或AI评分。当前图片服务不可达的失败保留，用户明确先使用文字/PDF，29.7.1真实OCR另验，模型及人脸字段未改变。

§29.7.1 20:02追加：实际source.method=ocr，DRAFT经人工补齐题号/断行后CONFIRMED，rawText保持原识别值、issues两警告保留。同键重放id/revision/rawText一致；临时清理后56表完整摘要/env一致，无字段/API变化。

### §29.8 作业批改与订正报告

新增`HomeworkGradingReport`窄表，`draftId`级联引用`HomeworkDraft`；只能在父记录为本人`CONFIRMED`时创建，所有读取/写入仍先检查当前student及父记录owner。报告字段：UUID `id`、`draftId`、`requestId`、完整输入`requestDigest`与`sourceDigest`（SHA-256）、确认时`sourceRevision`、含`draftDigest`及1–8题冻结内容的`snapshot` JSON、`state`（PENDING/RUNNING/READY/FAILED/CANCELLED）、正整数`revision`、经校验的`result` JSON、最多50项`corrections` JSON、最多100项幂等`operations` JSON、固定白名单`errorCode`、`leaseExpiresAt`、创建/更新日期。唯一键`(draftId,requestId)`；按`(draftId,createdAt)`索引。创建批改报告和订正请求均须提交`consent:true`；报告/订正创建时间记录本次明确同意。CHECK约束限定状态、revision、摘要长度、JSON类型和数组上限，READY必须有完整result；不在原HomeworkDraft加字段，不覆盖其冻结问题。

`result.items`每项包含题号、AI建议状态（正确/部分/不匹配/待核验）、0–100的AI建议分（待核验为null）、错因枚举、理由、下一步提示、在用户参考答案/评分依据中逐字命中的证据短句，以及服务端计算的`objectiveMatch/objectiveScore`（仅可解析的选择/判断题）。正确必须为100、错误必须为0、部分符合为1–99、待核验必须为null；AI建议结论与百分制分数矛盾，或与严格客观规则结果冲突时均改为待核验并清空AI分数，规则比对结果单独保留。`corrections`追加保存`requestId/digest/题号/订正前答案/订正后答案/状态/复核result/固定errorCode/时间`，不含原模型响应。修改使用行锁、revision CAS、同键内容摘要和最多50项的硬上限。

GET/POST `/api/homework/:id/grading`读取/预留报告；POST必须提交`consent:true`，创建时间作为同意记录；POST `.../:reportId/run`领取PENDING并调用模型；POST `.../:reportId`用于订正或取消，订正也必须提交`consent:true`；GET `/api/homework/mistakes`聚合本人最近最多50条未解决作业错因，仅用于现有练习与错题页展示，不接收分页参数。以上都private/no-store，DTO不返回内部快照摘要、模型原始响应或操作日志。不得写AssignmentReview、班级正式成绩、ExerciseRecord或Mastery。真实模型和自然语言教学质量分别验收。
## §29.21 视频直链输入增量契约（2026-10-21）

POST /api/video-imports严格{requestId:UUID,url:string<=2048,confirmed:true}，返回既有UrlDraftView（视频无正文preview，FETCHING/FAILED/CANCELLED/EXPIRED/COMMITTED）。本人GET/DELETE /api/url-imports/:requestId恢复/取消；同键异URL409、未授权401/403、超限429。UrlImportDraft视频不写snapshot，prepared仅标记kind=video；requestDigest区分视频/文章，来源仅入LearningContent.urlSource既有白名单。VIDEO和CONTENT_PARSE AsyncJob先同事务保存为PENDING，入队成功后内容更新PARSING（worker已进入终态则不回退）；进程在入队前退出时可通过原complete手动重试。真实源size/format/duration保存；入队失败FAILED和固定错误码QUEUE_FAILED，可走既有complete重试。无新表/迁移，临时私有视频对象由草稿期限和维护清理；来源和状态细节见[34号契约](34-VIDEO-URL-IMPORT.md)。
