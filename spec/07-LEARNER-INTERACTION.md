# Phase25 用户交流与功能可发现性契约

2026-10-14 23:30 §25.9整体验收未通过：学生之间隔离/共享交流已验，旧私人API的admin免归属校验存在冲突，见25.10与docs/acceptance/phase25-acceptance-20261014.md。正式开关不得以1180项回归通过为理由提前打开；需要25.10修复并复验25.9。原三份不公开，没有正式共享素材。

§25.8消息与参与记录已实现（2026-10-14），具体见11：Notification、回复及举报事务通知、本人未读/单条/截至asOf全部已读、当前目标跳回及可见参与列表。正式仍缺省关闭，25.9完整发现性验收下一编号，原三份不公开。历史阶段记录保留当时范围。

2026-10-14 §25.7管理与举报已实现，详见10；管理员/admin/discussions仅曾发布共享讨论，学生本人举报与结果核对。举报处理与DiscussionEvent/审计事务一致，现有删号级联和副本保留验收通过。25.8消息仍待办，正式DISCUSSION_RELEASE_READY继续默认关闭。

2026-10-14用户确认“可以按计划来”；§25.1文档落地，§25.2导航/指南、§25.3学习页入口、§25.4本人笔记聚合、§25.5管理员本人授权副本发布/下架和学生只读课程已实现，具体见08-SHARED-COURSE.md。25.6讨论/回复路由及模型已实现，具体见09；正式DISCUSSION_RELEASE_READY默认关闭，仅隔离课程验证。举报/管理已于25.7完成，消息待25.8，不显示占位消息入口。原三份仍为私人；本轮四门自建隔离课程已清理，没有正式发布素材。依赖任务见05-TASKS Phase25。

## 1. 两种空间与首版边界

- 我的资料：现有LearningContent及其Note/学习产物属于本人，原接口与归属规则保留。原三份演示资料不因本次确认自动发布。
- 共享课程：管理员从自己持有的READY资料创建独立快照与独立媒体副本，显式确认持有传播授权；只有发布成功后，已登录学生可以阅读及参与开启的讨论。匿名用户不能读。
- 管理员不能通过发布接口选择他人私人资料；管理角色不等于传播授权。需要他人授权资料时由实际持有人提供授权副本，首版不做委托发布。
- 首版共享页是只读媒体/已选择解析摘要及课程讨论，不提供私人资料的重解析、AI生成、成绩或他人笔记。原个人空间仍有完整笔记、练习、复习、计划与Agent功能，不自动复制或迁移用户记录。
- 共享内容内记个人笔记/练习/计划的复用属于后续独立扩展，不靠放宽现有owner检查完成。帮助明确首版两种空间能做什么，不显示不能使用的按钮。
- 不做全网公开媒体、任意用户公开上传、好友/私信/即时聊天、排名、附件或自动AI评论。题目纠错为阶段后置候选，不自动修改答案。

## 2. 入口与用户流程

导航最终目标八项：我的学习(/dashboard)、学习中心(/import)、我的笔记(/notes)、练习题库(/question-bank)、复习巩固(/review)、学习计划(/study-plans)、AI学习助手(/assistant)、知识图谱(/graph)。八项可按“学习资料 / 练习与复习 / 学习工具”分组，不用只剩图标表达核心入口。

顶栏搜索先保持已实现的本人资料标题搜索；帮助(/help)、消息(/messages)、账号/打卡设置(/attendance)有文字或明确可访问名称，退出可见。新增模块上线才出现对应入口，不链接404或用占位假未读数。管理员独立AdminShell不加入学生导航和XP。

我的学习：新用户空库突出“导入第一份资料”、可关闭/重开简短指引；已有资料保留续学/真实待办。指引是说明，不以点击次数伪造已完成学习。首版不需要新增账号状态字段，可用页面状态隐藏，刷新后能重新阅读。

个人学习页：可見的随看笔记、我的笔记、预解析重点入口；辅助转写/OCR/处理详情仍折叠。切换只改变展示，不清草稿/生成批次/视频时间；文档无随看视频模式。题库/计划/助手带现有contentId范围，不能自动出题或保存计划。真实“未保存/已保存”独立呈现。

我的笔记：仅聚合本人现有Note，过滤资料/关键词、分页、编辑删除和来源回看；导出按资料复用原接口。未落库的随看草稿不出现在聚合数量里，AI完整GeneratedNote与个人Note不混称同一资产。列表增补DTO需在25.4前落契约，不把search成功冒充所有筛选已存在。

共享课程：学习中心“共享课程”标签与/courses/:courseId阅读页；显式“平台共享内容”标识。共享页“内容 / 课程讨论”标签，视频评论可选当前时间，文档可选当前页；点击定位暂停回看。没有私人进度或个人产物服务时不显示假续学/掌握分。关闭讨论明确显示停止写入状态（管理员操作理由仅审计），已发布课程仍可读。

讨论：从课程入口发提问/学习心得，单层回复；同一课程内有我发布筛选，/messages可回到我参与的讨论。用户退出、下架、删除或隐藏后回看均按当前权限与状态重新检查。

## 3. 共享发布与媒体职责

SharedCourse独立于原LearningContent保存已批准发布的快照：标题/简介/类型/格式/时长或页数、独立媒体键、正文块/转写/知识点和完整AI笔记的明确选择。发布前预览具体可见内容；AI笔记显示原生成时间及“需核对”，不重新调用模型。原个人Note、QA、ReviewLog、ExerciseRecord、Mastery、LearningProgress、模板/照片/邮箱/手机号从不进入快照。

发布只读取当前管理员自己的READY资料。媒体/文档页图及结构化快照先准备到私有新前缀shared-courses，全数成功后才设published；失败保持draft并清理自身临时副本，不改原对象。对象键不得引用原uploads键，删除或修改原资料不得破坏发布副本；快照不跟随后续个人修改。初版不热更新已发布快照，修改正文先下架再新建发布版本，不改变已存在评论的定位语义。

媒体通过新共享鉴权路由输出，不向前端发对象存储直接URL/公共静态地址。每次GET/HEAD/Range或PDF页图读取校验有效账号及课程published；本地/S3均在应用服务端读取并流式传递，S3不得302跳转外部签名URL。响应private,no-store，支持Range 206及非法范围416，禁止解压/任意路径；复用存储封装并按需增加有界流接口，不把逻辑写入页面fetch。

下架后的新请求、旧URL重用和下一Range请求拒绝；已传到客户端的字节无法追回，已打开流可结束，不能宣称截图/下载副本被撤回。首版不缓存公开媒体、不提供离线下载。原私有内容预签名路径和期限不因共享功能而改变。

## 4. 数据模型（共享/讨论/举报/结果事件已迁移，通知已迁移）

SharedCourse在25.5迁移，具体见08；Thread/Reply在25.6迁移，具体见09；Report和DiscussionEvent在25.7迁移，具体见10。Notification在25.8已迁移，共30张现有表，具体以11为准。

- SharedCourse：id、publisherId、sourceContentId（仅内部来源）、title(1–120)、description(0–2000)、contentType、format、durationSec/pageCount、fileSizeBytes、mediaKey、snapshot(Json)、state(draft/published/withdrawn)、discussionEnabled、version、publishedAt、createdAt/updatedAt。媒体键/来源ID不进入学生DTO。发布需要非空授权说明(1–500)及rightsConfirmed=true，授权说明只给管理员。publisher/source删除不级联删除发布副本，来源标识可清空，删除副本须按独立存储职责处理。
- DiscussionThread：id、courseId、authorId、kind(question/discussion)、title(1–120)、body(1–3000)、ref(ContentRef或null)、solvedAt、pinnedAt、hiddenAt、deletedAt、version、createRequestId、createdAt/updatedAt。courseId必须属于published且discussionEnabled；标题正文纯文本，不接受附件/HTML。authorId关联用户删除时匿名化并清空公开正文（讨论状态改deleted），保留不含隐私的结构与审计。
- DiscussionReply：id、threadId、authorId、body(1–1500)、hiddenAt/deletedAt、version、createRequestId、createdAt/updatedAt。无parentReplyId，所有回复仅挂主题；自回复允许，不通知自己。
- DiscussionReport：id、reporterId、courseId、threadId、replyId?、reason(1–500)、state(open/handled)、resolution?、handledBy?、handledAt、createdAt；每用户每目标只允许一个未处理举报，已处理后允许新理由再次提交。只给举报人/管理员，不给被举报者披露举报人。
- DiscussionEvent（25.7已实现）：接收人/唯一reportId及eventKey/REPORT_RESULT类型/课程主题回复关联/createdAt；无readAt或私密正文，作为25.8结果事件来源。
- Notification（25.8已实现）：id、recipientId、kind(discussion_reply/report_result)、eventKey、courseId/threadId/replyId?/reportId?、readAt、createdAt。仅存事件关联和固定摘要，不保存旧帖子正文、敏感原因或私人资料摘录。eventKey全局唯一，按recipientId/readAt/createdAt/id索引，来源类型有SQL CHECK（详见11）。

新增角色仍只有student/admin；不造teacher身份、点赞XP、评论完成率或学习成绩。删除账号需在现有用户删除事务中清理本人通知/举报私密字段、匿名化本人讨论/回复，并核对课程发布副本不被误级联，25.7已通过现有删除行为兼容测试。

## 5. API与DTO草约束（后续编号实现）

统一沿用success/data/error包装和分页page>=1、pageSize1–50默认20，日期ISO/显示北京时间。未登录401；不向学生透露草稿/下架对象，读取404；已能访问对象上的非本人写入403；讨论已关闭/版本冲突409；无效正文/定位400；限流429。跨课程的thread/reply参数也须校验真实父链，不能只校验其中一层。

管理员发布接口：POST /api/admin/courses {sourceContentId,title,description,rightsConfirmed,rightsStatement,include:{transcripts,textBlocks,knowledgePoints,generatedNote},requestId}→{courseId,state:'draft',version}。include明确布尔值而非默默全分享；复制失败不返回可发布草稿成功。GET /api/admin/courses与/:id用于列表/预览；PATCH /:id {expectedVersion,action:'publish'|'withdraw'}→{courseId,state,discussionEnabled,version}；25.7开关独立PATCH /:id/discussion {expectedVersion,enabled,reason}。首次publish再校验快照与授权，不在普通列表请求自动发布。

学生只读：GET /api/courses→{page,pageSize,total,items}；GET /api/courses/:id→{courseId,title,description,contentType,format,durationSec,pageCount,discussionEnabled,version,resourceUrl,snapshot}。list不返回长正文或源owner信息，snapshot只含白名单内容与真实ref；resourceUrl同源共享鉴权地址。GET/HEAD /api/courses/:id/media及GET /pages/:page为上述媒体范围校验路径，不下发storageKey。

主题：GET/POST /api/courses/:id/discussions；GET/PATCH/DELETE /api/discussions/:id。创建{kind,title,body,ref?,requestId}，修改{expectedVersion,title?,body?,solved?}；DELETE携带expectedVersion做软删除。回复GET/POST /api/discussions/:id/replies，PATCH/DELETE /api/discussion-replies/:id，编辑同样expectedVersion。thread/reply DTO白名单{id,author:{nickname,role},body,createdAt,updatedAt,version,canEdit}及thread的title/kind/ref/solved/pinned/replyCount；不返回邮箱/token或在未授权列表暴露内部authorId。没有未提交练习答案从这些API透传。

ref必须匹配发布快照类型及实际视频范围/文档页码；讨论引用只能链接/courses/:id?t=...或?page=...，不暴露原/study私有ID。编辑归属只限本人，管理员通过下述管理接口隐藏，不代写用户正文或标成教师正确答案。

举报：POST /api/discussions/:id/reports {replyId?,reason,requestId}；GET /api/discussion-reports?mine=true。管理员GET /api/admin/discussions、GET /api/admin/discussion-reports；PATCH /api/admin/discussions/:id、/api/admin/discussion-replies/:id {expectedVersion,action:'hide'|'restore'|'pin'|'unpin',reason}（pin只限主题）；PATCH /api/admin/discussion-reports/:id {expectedVersion,resolution}。处理举报不隐式修改题目或内容，所需隐藏动作显式执行并记录。

消息：GET /api/notifications→分页items加unreadCount；PATCH /api/notifications/:id {read:true}、POST /api/notifications/read-all {before:ISO时间}仅标已读本人截至该时间事件。GET /api/discussions/participated为本人发布或成功回复的可见主题分页。通知DTO包含固定类型说明、createdAt/readAt及当前可见targetUrl|null；隐藏/下架/删除时显示“相关讨论暂不可用”，不回显原文，read-all不将此后到达事件标已读。

每次创建请求requestId为UUID，服务端按作者+操作作用域+requestId唯一去重；同ID不同payload返回409，重复同payload返回原结果，不重复通知/审计。更新/删除expectedVersion为>=1整数，冲突返回409和重读指引，不后写覆盖。课程、帖子、举报须实际version字段，迁移/代码前补齐具体TS类型和索引。

## 6. 讨论状态与事务

线程/回复软删除不返正文；作者删主题使普通列表/链接不可见，子回复不变成孤立公开内容；作者删回复在主题显示“回复已删除”占位，replyCount仅计可见非删除回复。管理员隐藏主题使子回复及消息跳转全部不可见；恢复仅移除hiddenAt，不恢复作者删除内容。关闭讨论保留可读线程，禁止学生创建/编辑/回复/标解决，允许本人删除及举报；下架阻断所有学生读取/交互，原个人空间不受影响。

首次新回复成功与thread作者通知在同一事务提交；只通知主题作者，不默认订阅全站/所有参与者，不通知自己。处理举报与report_result事件同事务。事件可先写入，但消息入口仅25.8完成后显露，不冒充前阶段已提醒用户。消息列表轻量重读+手动刷新，无WebSocket、浏览器推送权限或短信。

正文按纯文本渲染，长度/归属/课程状态由服务端再次校验。25.6起新增写入限流建议每账号课程10次/分钟，举报5次/小时；使用现有限流封装，不能因模型服务缺额度影响基本评论。与下架/关闭/隐藏的竞态在事务内检查状态/version；审计只记录动作/目标/原因及最少操作者信息，不写凭据、私人资料、照片或模型输入。

## 7. 文件职责、发布与验收

src/services封装courses/discussions/notifications调用；src/lib下领域服务分别做发布副本、访问、讨论/举报/消息事务，src/app/api只编排鉴权校验和响应；组件不直接fetch/Prisma。沿用Next/React/Prisma/存储与限流，不预设新依赖。共享媒体必须独立流读职责，临时副本清理需验证实际绝对路径和归属，不能删除原上传。

新增数据库迁移逐编号执行，不在25.1运行。正式开启学生讨论需25.6–25.8的举报管理/消息闭环和权限验收完成；中间阶段仅隔离测试，不让用户使用缺少管理的评论入口。课程发布操作须管理员页面具体预览授权及可见范围，再明确点击，不自动迁移或发布已有三份。

验收包括隔离新/老学生无口头提示找到资料/笔记/练习/复习、桌面/窄窗/键盘；A提问B回复A消息回到定位；越权编辑/跨课程/私有资料/匿名拒绝；隐藏恢复/作者删除/关闭/下架、旧媒体URL/Range；消息并发与幂等；发布失败清理不影响原资料；原数据/env指纹保护。以真实记录核对计数，不以静态示例或页面200替代完整通过。

目前未选定可发布的具体文件，未改现有资料权限；是否有权传播要在实际发布素材预览时确认，不能从本次同意规划推断原课程视频传播授权。
