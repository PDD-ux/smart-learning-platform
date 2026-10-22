# §25.8 站内消息与参与记录具体契约

2026-10-14 22:42已完成并迁移20261014090000_notifications。1178项/151文件全量、27项针对性、最终TS/完整lint通过，47项真实HTTP及额外举报通知失败回滚/历史事件映射/删号/门控复验通过；原生双学习者本人消息/已读/回看/参与入口及1280/900验收完成。临时数据及凭据清理，原数据两env指纹全true。见docs/acceptance/notifications-20261014.md。

实现前落地，继承07/09/10；仅25.8，不执行25.9。正式DISCUSSION_RELEASE_READY仍缺省false，消息/参与API及顶栏同门控，中间仅隔离自建共享课程验收；原私人资料不公开。

Notification UUID：recipientId(User Cascade)、kind REPLY|REPORT_RESULT、eventKey String（全局唯一，内部固定源ID前缀）、courseId/course(SharedCourse Cascade)、threadId/thread(Thread Cascade)、replyId?/reply(Reply Cascade)、reportId?/report(Report Cascade)、readAt?、createdAt。recipientId/readAt/createdAt/id索引。没有摘要正文/用户名/旧标题/私人内容。SQLCHECK要求REPLY有replyId无reportId，REPORT_RESULT有reportId（replyId可空）；应用再次检查实际父链。共30表。

新回复仅通知主题作者，不通知自己或全体参与者；回复、Notification、审计同事务，重复requestId不新增。先锁发送者/主题作者当前User共享行，再课程/主题，防删号级联竞态；作者已删不可回复。举报处理同时写原DiscussionEvent及Notification，任一失败整事务回滚。迁移将既有REPORT_RESULT事件映射成未读通知，沿用原createdAt/同eventKey，只迁移仍存在的本人举报；不回填旧回复、不冒充其已送达。处理人/举报人身份不进入DTO。

GET /api/notifications?page1..100000&pageSize1..50：仅本人，{page,pageSize,total,unreadCount,asOf,items}。事务先获取当前接收人User独占行锁，与所有发送方的接收人共享锁串行，采用READ COMMITTED在等待写事务完成后读取clock_timestamp()截点及统一计数/列表；防止较早开始但较晚提交的通知被全部已读误涵盖。新通知createdAt取数据库时钟加1毫秒，避免ISO毫秒精度下后续写入与截点相等。createdAt<=asOf，稳定时间降序/id升序。DTO{id,kind:'reply'|'report_result',summary固定中文,createdAt,readAt,targetUrl:string|null,resolution:string|null}。举报结果resolution仅从recipientId=reporterId且已HANDLED的本人报告读取；隐藏/下架仍能核对本人的结果，无旧帖子正文。targetUrl只在当前published/prepared课程、可见非删除且有作者主题、若replyId存在则回复也可见非删除且有作者时返回 /courses/:id?thread=:UUID&t=:当前实际秒 或 &page=:实际页；每次查询复核，无可访问目标则null及固定“相关讨论暂不可用”。不回传存储键/原私人sourceID。

PATCH /api/notifications/:id {read:true}：仅本人，陌生对象404，严格拒绝read:false/额外字段，幂等保持首次readAt，失败不在前端假标成功。POST /api/notifications/read-all {before:ISO UTC日期}：只能本人截至before的未读项；before不能晚于服务端当前时间，含额外字段/无效日期400。使用GET的asOf而非客户端当前时间，后来到达消息不误读，返回{updated:number}；无写入重试重放。读操作无成绩或XP。匿名401、失效账号401、非法分页/重复键400，门控关闭404（在解析/目标查询之前），均private/no-store。

GET /api/discussions/participated?page&pageSize：当前用户发布或可见成功回复过的当前可见主题，父课程published/prepared（关闭写入不影响阅读），结果按主题创建时间降序/id升序，跨课程只查共享对象，白名单{id,title,courseTitle,targetUrl,createdAt}，无个人资料/旧删除正文；隐藏/删主题/下架均移出，回复已删除或隐藏不再作为参与依据，作者仍保留本人发布依据。角色仍student/admin，都仅本人。

/messages：消息/我参与的讨论文字标签、真实计数/分页/显式刷新/空与失败分开；单条已读和“将当前读取时刻前的消息全部设为已读”，写失败保持未读/错误，成功刷新计数。不点击链接自动标已读；跳回课程自动打开指定当前主题，引用按现有播放器范围校验，不自动播放。顶栏文字“消息”显示已确认真实未读数，读取失败显示暂不可用而非0；可每60秒、window focus及消息已读后轻量重读，退出/卸载迟到响应不恢复旧计数，无WebSocket/推送权限。预览模式/门控404无假入口。沿用暖纸张/44px键盘控件。

验收：A发主题B回复A真实消息回到主题与来源；自回复不通知、幂等唯一、事件插入失败回滚；B不可读取/已读A消息；全部已读只截至asOf，之后消息仍未读；举报结果/隐藏恢复/下架/作者删除/删号级联与旧链接保护；真实UI、宽/窄窗及工程回归，隔离数据清理、原数据/env指纹保护，无新模型请求/依赖。
