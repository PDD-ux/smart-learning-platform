# §25.6 课程讨论与单层回复（具体实现契约）

2026-10-14 §25.8在新回复同事务写Notification，重复requestId不再发、自回复不发；回看thread URL自动选当前主题/当前引用。本文25.6阶段未通知的历史范围保留，当前扩展以11-NOTIFICATIONS.md为准，正式仍默认关闭。

2026-10-14 §25.7扩展已实现，具体见10-DISCUSSION-MODERATION.md。本文件25.6完成记录保留其当时范围；管理/举报现已完成，消息仍待25.8，正式默认门控不变。

2026-10-14 15:33已实现并迁移；契约先于代码。1145项全量、30项针对性、真实62项HTTP及删号/门控恢复验收通过，临时数据清理，原数据与两env指纹一致。正式默认关闭，管理/举报与消息仍待25.7–25.8。详见docs/acceptance/discussions-20261014.md。

CourseDetail 增加可选 discussionAvailable 布尔值，由服务端正式开放开关决定；它与 discussionEnabled（课程是否允许写入）分开，以便关闭课程讨论后仍能阅读旧主题。开关关闭时无入口。

继承07，不实现25.7举报/管理入口或25.8消息。正式开放前DISCUSSION_RELEASE_READY必须精确true（默认关闭），且课程published、prepared、discussionEnabled=true；本阶段仅以临时网页进程开关和隔离自建课程验收，不改.env或原三份。关闭开关时讨论API404且无页面入口，媒体照常只读；课程关闭讨论仍可读已有主题，写入409，本人删除仍允许。无消息表/假未读，回复成功只写审计；真实通知事务在25.8引入时再落地。

新增DiscussionThread(id UUID,courseId,authorId可空,kind QUESTION|DISCUSSION,title1..120/body1..3000纯文本,ref JSON可空,solvedAt/pinnedAt/hiddenAt/deletedAt,version1,createRequestId UUID,requestDigest,createdAt/updatedAt)与DiscussionReply(id UUID,threadId,authorId可空,body1..1500,hiddenAt/deletedAt,version1,createRequestId/requestDigest,createdAt/updatedAt)。unique(authorId,courseId,createRequestId)及unique(authorId,threadId,createRequestId)，索引父ID/createdAt/id、authorId。course删除级联主题/回复，author删除SetNull；数据库删除User前触发器清空本人主题标题/正文/ref和回复正文、标deleted/version+1，所有删除路径都不留公开正文，其他作者回复不变为独立公开。

沿用统一响应，所有端点withAuth并no-store，当前账号复核，纯文本不接受HTML标签、控制字符及额外字段。线程创建{kind:question|discussion,title,body,ref?:ContentRef|null,requestId}；可选引用需匹配共享媒体类型和实际秒/页界限。GET /api/courses/:id/discussions ?page1..100000&pageSize1..50&mine=true|false&sort=newest|oldest（默认newest），重复/非法参数400；置顶优先、创建时间及id稳定排序，DTO{id,courseId,kind,title,body,ref,solvedAt,pinnedAt,version,author:{nickname,role}|null,createdAt,updatedAt,canEdit,replyCount}不返authorId/requestDigest/私有源ID。GET /api/discussions/:id同DTO。PATCH{expectedVersion,title?,body?,solved?}非空，DELETE JSON{expectedVersion}软删除且清正文。仅作者可写，即使管理员也不能改他人内容。

GET /api/discussions/:id/replies分页按createdAt asc/id asc；父主题当前可见才可读。回复POST{body,requestId}，PATCH{body,expectedVersion}、DELETE{expectedVersion}。ReplyDTO{id,threadId,author,body|null,deleted:boolean,version,createdAt,updatedAt,canEdit}；删除回复仅“回复已删除”占位，无原正文/作者，canEdit=false；replyCount仅当前可见非删除项。隐藏主题/回复不返正文，主题作者删除/隐藏/下架使子回复不可读，缺对象404、非本人403、冲突/关闭409 DISCUSSION_CONFLICT、错误正文/定位400、限流429、匿名401。

创建按作者+父链+requestId唯一幂等，同payload返回既有可见项；异payload409；被删除/隐藏原项不因重试复活或泄露正文。创建/编辑/解决/删除每用户每课程10次/分钟，复用限流；幂等命中不重复审计。事务锁顺序当前User FOR SHARE→SharedCourse FOR UPDATE→Thread FOR UPDATE→Reply CAS；课程发布/隐藏/关闭/删号与写入串行，更新/软删除expectedVersion必须当前值，冲突不覆盖。读取事务课程/父链共享锁，禁止跨课程参数拼接绕过。

页面同一课程显示“课程内容 / 课程讨论”，切换隐藏不卸载播放器/输入；讨论标题/正文、类型、可选手动时间或页码（无需猜测观看位置），点击引用回到真实共享位置并暂停，讨论草稿保留。列表有全部/我发布、最新/最早、分页、显式刷新及加载/失败/真实为空；主题详情单层回复，本人编辑/确认软删除/解决或重开。写失败保留正文/requestId，修改草稿才换ID；同步提交锁、迟到响应守卫，不自动重放。不发XP、不写私人学习数据、无默认模型调用。
