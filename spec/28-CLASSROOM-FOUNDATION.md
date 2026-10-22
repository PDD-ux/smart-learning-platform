# §29.4 班级课程与作业数据、权限基础

日期：2026-10-19。产品依据为PRD三核心、20规格及任务29.4。本项只交付实体、约束、只读权限服务与状态/输入基础；创建/加入/发布页面和业务写接口属于29.5，提交/批阅/附件上传下载接口属于29.6，OCR和AI属于29.7–29.8。本项不新增导航、角色、公开HTTP入口或AI调用。

## 1. 数据边界

新增独立的Classroom、ClassMember、ClassInvite、ClassChapter、ClassAssignment、AssignmentSubmission、SubmissionVersion、AssignmentReview、AssignmentAttachment、ClassroomOperation共十表；不复用Exam/Exercise/个人笔记/人脸记录，不迁移历史成绩。User仅添加Prisma反向关系；SharedCourse仅添加章节引用反向关系，不改共享授权范围。

- Classroom：id、responsibleId、title(1–100)、description(≤2000)、state(ACTIVE/ARCHIVED)、revision(≥1)、时间；负责人由创建者admin确定。首版不转移负责人、不硬删除班级及已提交历史。
- ClassMember：复合主键(classroomId,studentId)，state(ACTIVE/LEFT/REMOVED)、revision、joinedAt/updatedAt。只允许student加入；退出/移除保留成员行和历史，重新加入不复活被移除资格（由负责人后续显式恢复）。
- ClassInvite：id、classroomId、codeHash(SHA256，唯一)、expiresAt、maxUses(1–5000)、usedCount(0–maxUses)、revokedAt、revision、createdAt。不保存原码。随机16字节的base64url原码（22字符）仅创建/旋转时显示一次；默认7天、最多30天。归档、撤销、到期、次数用尽均拒绝；失效返回统一不可加入。后续加入接口按账号/IP限流（每分钟5次），严禁列表返回hash、明文码或猜测详情；本项只实现生成/摘要和纯有效性规则，不发邀请码或实现加入接口。
- ClassChapter：id、classroomId、title、body(≤20000)、sequence(≥0，同班唯一)、state(DRAFT/PUBLISHED/WITHDRAWN)、可空sharedCourseId、revision、时间。可绑定已获授权、preparedAt非空且当前PUBLISHED的SharedCourse，rightsConfirmed和非空rightsStatement均须保留，不绑定负责人私人LearningContent；公开课撤回后不继续返回可用学习链接。元数据就绪不替代媒体读取验收。班级不是共享课副本的权限替代。
- ClassAssignment：id、classroomId、可空chapterId（复合FK确保同班）、title、instructions(≤20000)、state(DRAFT/PUBLISHED/CLOSED/WITHDRAWN)、dueAt、revision、时间。发布必须有截止时间；首版百分制整数分数，截止时刻及以后不得提交、不自动宽限；退回后需在当前截止前重交，负责人可在29.5显式延长。CLOSED可读但不能提交，WITHDRAWN学生不可新读任务。
- AssignmentSubmission：id、classroomId、assignmentId、studentId（同班成员复合FK）、state(DRAFT/SUBMITTED/RETURNED/GRADED)、draftText(≤50000)、revision、时间。同一任务/学生唯一。草稿只供本人；SUBMITTED表示待批阅，不能直接编辑覆盖正式版本；RETURNED允许新草稿并再次提交，GRADED冻结。缺行才表示未提交，不能制造零分。
- SubmissionVersion：id、submissionId、classroomId、studentId、versionNo(≥1)、bodyText、assignmentTitle、instructionsSnapshot、dueAtSnapshot、assignmentRevision、submittedAt。与提交行复合FK绑定，同一submission/versionNo唯一。显式提交时冻结正文和当时任务依据，发布后任务改动不重写历史。后续服务只追加，不提供更新/删除冻结版本的接口；附件可承担非空正文，提交时必须正文或至少一个有效附件。
- AssignmentReview：id、versionId、classroomId、reviewerId、state(RETURNED/GRADED)、score、feedback(1–10000)、createdAt。每冻结版本最多一次正式批阅，复合FK确保版本和负责人同班；RETURNED分数必须null，GRADED分数0–100。由负责人明确确认，不能由AI自动写成绩。退回再次提交生成新版本和后续新批阅；不覆盖旧评语。首版不支持已批阅成绩静默改分。
- AssignmentAttachment：id、submissionId/classroomId/studentId（复合FK）、可空versionId（复合FK绑定同一提交）、state(UPLOADING/READY/ATTACHED/DELETED)、fileName、mimeType、sizeBytes、可空sha256、唯一storageKey、expiresAt、时间。生命周期见§4。
- ClassroomOperation：id、classroomId、actorId、requestId(UUID)、action(白名单场景)、inputDigest(SHA256)、resultId、createdAt；(actorId,requestId)唯一。只记录动作/摘要/结果ID，不存输入正文、邀请码、附件URL或模型内容。后续业务操作与幂等行同事务提交；重试需动作和完整输入摘要相同，键冲突409，不能只按requestId重放不同业务。删除/归档不清墓碑。

## 2. 服务端权限

每次从数据库读取当前User.role、负责人、班级状态及成员状态，不信任客户端role或缓存JWT角色。不开放全体管理员豁免。不存在或越权统一NOT_FOUND(404)，归档写操作/版本冲突统一CLASSROOM_CONFLICT(409)，字段非法VALIDATION_FAILED(400)。

- 负责人必须当前仍为admin且id等于该班responsibleId；可读本班元数据、草稿章节/任务、成员必要信息及正式提交，永远不能读学生未提交的draftText或未绑定正式版本的附件。
- 当前ACTIVE学生成员可读本人班级元数据、PUBLISHED章节以及PUBLISHED/CLOSED任务；绑定未发布章节的任务也不对学生开放。不能读其他学生草稿/提交/反馈，不因共享课公开扩大作业权限。
- ACTIVE班级的ACTIVE学生成员可管理本人的DRAFT/RETURNED草稿；提交还须任务PUBLISHED、当前截止前及同班已发布章节（若有）。归档禁止写，当前成员仍可读已发布内容和自己的提交。
- LEFT/REMOVED学生不再读取班级、章节、任务或草稿；只允许凭自己的提交ID查看已冻结版本、本人批阅及这些版本已绑定附件。未正式提交的内容不借历史入口泄露。负责人可保留本班已提交历史，包括退出学生；其他管理员不能读取。
- 正式批阅只允许本班负责人，且目标是最新SUBMITTED版本，通过版本/CAS和同班外键约束。负责人身份被撤销后不可继续批阅；不引入teacher角色或跨班“教务”读取。

只读基础函数集中在src/lib/classrooms/access.ts，由后续认证路由传真实actorId调用；只公开必要DTO，未提交正文按权限分支另行查询，负责人分支不查询draftText。内部附件授权函数只向服务端返回storageKey供后续短期私有下载签名；本项没有实际下载端点。

既有DELETE /api/admin/users/:id在目标User行FOR UPDATE后先核对三类班级关系计数：负责人、成员、班级幂等操作任一存在则409 CLASSROOM_CONFLICT，先于照片/内容对象清理。无关系的原删除链路继续工作；15秒事务避免无限持锁，FK写入需等待目标用户锁，拒绝不能先删人脸照片再发现班级外键限制。关联历史保留，首版不提供账号关联历史的硬清理；数据库与外部存储不是分布式原子事务，存储异常沿用503保留账号。

## 3. 并发、状态与幂等实施规则

现有revision≥1；每次业务写操作传expectedRevision。后续29.5/29.6用Prisma事务锁Classroom行作为同班写串行前置，再复核数据库角色/成员/班级状态，检查幂等行、截止与版本，CAS更新并同事务记录ClassroomOperation/必要审计。固定锁顺序class→submission→attachments，不持事务等待上传/OCR/模型。

状态基础只允许DRAFT→SUBMITTED、SUBMITTED→RETURNED/GRADED、RETURNED→SUBMITTED；GRADED无后继。自保存草稿不改变DRAFT/RETURNED状态。发布时校验deadline；实际提交时间以服务端时钟为准，now < dueAt，恰好截止拒绝。重复提交相同请求重读原结果，不追加版本；不同请求同时提交只有一个CAS成功。正式版本和评语仅追加，后续写服务必须遵循，本项不假称提交/批阅写流程已经实现。

完整JSON幂等输入按稳定键序生成摘要，上限256KiB，足够容纳50000字中文正文和附件元数据；不能以较小字节上限使已声明合法的正文无法提交。只读提交视图最多返回最近50个版本并标记historyTruncated，附件元数据最多5个，日期为ISO、字节为安全整数，不泄露storageKey或邀请码摘要。

PostgreSQL迁移只创建新枚举/表/索引/FK/CHECK，包含同班章节、同班同学生提交版本/附件、同班负责人评语、整数分值/正文长度/状态字段组合及幂等摘要约束。不能依赖只在前端检查；成员当前角色、邀请码消费、截止时间、最新版本和CAS仍需后续事务服务核验，FK不替代权限。

## 4. 附件与删除规则

首版每份作业≤5个附件、单个≤20MiB、总计≤50MiB，仅PDF/TXT/Markdown/PNG/JPEG；fileName 1–180且无路径/控制字符，白名单扩展名与MIME必须一致。后续上传完成核对真实字节/格式/摘要才UPLOADING→READY；不能只相信Content-Type。未就绪不提交、不提供下载。

对象键固定class-assignments/{classroomId}/{studentId}/{attachmentId}/source.{白名单扩展名}，禁止任意路径/URL。UPLOADING和READY最迟24小时过期，DELETED保留元数据墓碑；清理先锁提交、核对没有绑定版本，再改DELETED并只删除该确定键。READY→ATTACHED需与冻结版本同事务，ATTACHED必须有versionId且sha256非空；已绑定版本附件不能按草稿过期清理。正式附件长期保留到明确业务保留策略，不自动随退出/归档删除。先保留历史，不提供班级/作业硬删除接口。

后续下载逐次复核角色、成员或本人历史及附件归属，签名有效期≤60秒、private/no-store；原通用LearningContent上传/资源接口不能读取新附件。取消上传/断网/存储失败仅影响当前草稿，不误删其它资料或正式版本。本项没有上传、签名或自动清理任务，不能称附件功能已可用。

## 5. 验收与迁移范围

单测输入边界、状态迁移、邀请码摘要/到期/撤销/次数、截止和附件路径；独立临时PostgreSQL数据库应用全迁移后由一名负责人、另一名管理员、两名学生和外班成员验证真实查询、草稿隔离、退出/归档历史及FK/CHECK/唯一约束。临时库名固定安全前缀并校验后才能清理，禁止reset/drop现有业务库。

先通过隔离库再将新增迁移部署到本地演示库；记录原业务表逐表行数和内容摘要及env摘要前后相同，新表为空。页面、创建/加入/提交/批阅业务写接口、真实附件/AI、生产构建和云端部署均不属于本项。
