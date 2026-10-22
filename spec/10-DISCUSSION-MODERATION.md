# §25.7 讨论管理与举报具体契约

2026-10-14 §25.8扩展举报处理事务：DiscussionEvent及Notification都必须成功，通知失败则Report/Event/Audit全部回滚；既有结果事件按同key/原时间迁移，当前消息和已读接口见11。以下25.7记录保留当时范围，不再代表消息未实现。

2026-10-14 22:10已完成并迁移20261014080000_discussion_moderation。1163项/148文件全量、28项针对性、TS/完整lint通过；真实HTTP、原生页面双角色、事件回滚/唯一性、跨课程请求去重、作者删除不可恢复、现有删号与默认门控验收通过。临时行与副本文件全部清理，原学习数据及两env指纹一致。验收记录：docs/acceptance/moderation-20261014.md。

既有管理员课程列表/详情中的discussionEnabled返回真实持久化值（不是学生正式门控值），供开启/关闭确认；学生DTO仍门控。管理员页面课程选项使用现有adminCourses分页，不假设前20门等于全部，保留已选课程并明确选项页码。

举报管理“查看举报对象”以GET /api/admin/discussions/:id读取当前管理主题DTO；回复列表可加replyId UUID仅匹配该主题下指定回复，支持定位不在第一页的被举报回复，并可切回全部回复。目标删除仅占位，不能恢复/回显旧正文。

实现前落地，继承07/09；只做25.7，不实现25.8消息页面/未读数。正式DISCUSSION_RELEASE_READY继续默认关闭，学生举报与讨论同门控；管理员管理在关闭正式入口时仍可准备/复查。只处理明确曾发布且prepared的SharedCourse讨论，永不读取私人LearningContent/Note/问答/人脸。

新增DiscussionReport UUID：reporterId(User Cascade)、courseId/SharedCourse Cascade、threadId/Thread Cascade、replyId?/Reply Cascade、targetKey内部、reason纯文本1..500、state OPEN/HANDLED、resolution可空纯文本1..500、handledBy?(User SetNull)、handledAt、version1、requestId UUID、requestDigest、createdAt/updatedAt。unique(reporterId,requestId)；部分唯一索引(reporterId,targetKey) WHERE state=OPEN，同用户每目标只有一个待处理举报；处理后可再次创建。删除举报人级联本人举报及事件，删除处理管理员仅清关联，不公开账号身份。

准备DiscussionEvent UUID：recipientId(User Cascade)、reportId唯一(Report Cascade)、eventKey唯一、kind REPORT_RESULT、courseId/threadId/replyId关联字段、createdAt。只存关联/固定类型，无正文/原因/处理内容；处理举报与事件/审计同事务，状态只OPEN→HANDLED一次。此表为25.8适配的事件来源，当前无消息入口或假通知。回复事件将在25.8补齐。

API全部sharedRoute/withAuth/no-store；当前User角色以数据库为准并事务FOR SHARE；写入锁顺序User→课程FOR UPDATE→主题FOR UPDATE→回复或举报FOR UPDATE/CAS，读取用共享锁。管理员仅publishedAt非空且prepared课程（下架后可管理）；学生当前published课程/可见父链，关闭讨论仍可举报。删除/删号内容不能恢复，隐藏主题子回复对学生不可读，恢复只移除hiddenAt，管理员不能代写正文/改作者解决状态。

- GET /api/admin/discussions?page1..100000&pageSize1..50&courseId?UUID&visibility=all|visible|hidden|deleted：分页/课程筛选，DTO线程白名单+hidden/deleted、courseTitle/courseState/courseVersion/discussionEnabled（实际持久化状态，不受正式门控篡改）。含作者删除或软删占位时标题/正文/ref为空；不返邮箱/作者ID/存储键/私人来源。
- GET /api/admin/discussions/:id/replies：同分页，含隐藏与删除占位，ReplyDTO+hidden；学生计数排除隐藏/删除项。
- PATCH /api/admin/discussions/:id {expectedVersion,action:hide|restore|pin|unpin,reason1..500}；PATCH /api/admin/discussion-replies/:id只hide|restore。CAS冲突409；仅非删除/作者存在目标。操作原因只进审计，不更改用户正文。每管理员60次/分钟限流。
- PATCH /api/admin/courses/:id/discussion {expectedVersion,enabled:boolean,reason1..500}，独立于发布/下架接口，版本CAS；必须当前published/prepared，开启或关闭都不改变发布状态。正式开关关闭时仅准备状态，不让学生使用。
- POST /api/discussions/:id/reports {replyId?:UUID,reason1..500,requestId:UUID}。参数父链严格匹配、纯文本/额外字段拒绝；同ID同payload返回本人原举报，同ID异payload409，不重复审计；每举报人5次/小时，重复待处理目标409，隐含SQL唯一索引兜底。
- GET /api/discussion-reports?mine=true&page&pageSize：只能本人，不接受mine=false；DTO{id,courseId,threadId,replyId,reason,state,version,resolution,handledAt,createdAt}，不返回举报人/处理人内部ID或被举报正文。隐藏/下架后本人仍可核对自己的处理结果，不借此读取目标正文。
- GET /api/admin/discussion-reports?courseId?&state=all|open|handled&page&pageSize：仅管理员，举报DTO白名单，不披露账号标识。PATCH /api/admin/discussion-reports/:id {expectedVersion,resolution1..500}，明确处理不自动隐藏；OPEN→HANDLED及结果事件、审计一次提交。已处理或版本冲突409。

分页重复/非法参数400，匿名401、当前学生访问管理员403、失效账号401、不可访问父链404、状态/版本/重复待处理冲突409 DISCUSSION_CONFLICT、纯文本校验400、限流429；均无凭据日志。管理员降级/删号与写入使用相同User行锁，不能凭旧JWT继续操作。

页面/admin/discussions独立导航，课程筛选、主题可见状态筛选、真实加载/空/失败、页码；逐主题查看回复，置顶/取消、隐藏/恢复和关闭/开启课程需填写理由与明确确认，失败保留输入/版本，冲突提示重读，不自动重放。举报处理区独立状态筛选与页码，展示原因/处理结果，处理要求填写结果、确认，并说明需单独执行隐藏。学生主题详情举报目标选择仅当前可见主题/回复，原因与稳定requestId保留；本人举报记录独立刷新和分页，在此核对处理状态，消息入口下一编号。沿用纸张颜色/44px控件，管理员不出现XP或学习导航。普通课程及原私有资料不自动开启/发布；仅隔离自建素材验收与清理。
