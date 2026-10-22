# §27.2 试卷领域基础与接口契约

2026-10-16。先落契约，再建模型。27.2实现模型、加法迁移、纯校验和安全DTO投影；27.3管理员分类/共享题库/结构化导入、27.4题库整卷预览/修订/发布/下架、27.5学生目录/详情/本人开考与固定答卷只读已实现。27.6学生保存/交卷/客观评分及27.7成绩/必要人工批阅已实现并复核修正，27.8生成后台与私人草稿已实现，27.9页面/私人确认成卷已实现并验收，真实星火受控题未通过，已开放路径见实施契约。16-EXAM-CENTER为需求依据。

## 数据边界

新增13个独立对象：ExamSubject（科目）、ExamChapter（科目内章节）、ExamQuestion（题库稳定ID/所有者/可见范围/停用状态）、ExamQuestionVersion（不可变题干/答案/来源版本及可变审核状态）、ExamPaper（试卷稳定ID/所有者/科目/公开状态/发布版本指针）、ExamPaperVersion（标题/类型/时间/题数/总分/蓝图与封卷时间）、ExamPaperSection（题型分区/配额）、ExamPaperItem（位置/分值/题目快照）、ExamAttempt（本人答卷/期限/提交及评分状态）、ExamAnswer（本人逐题草稿和评分结果）、ExamGradeRecord（人工评分历史）、ExamGenerationJob（私人生成蓝图/幂等/预算/租约）、ExamGenerationBatch（批次/候选/两次上限/固定失败原因）。具体字段及索引以schema.prisma为事实来源。

类别ExamTrack=CIVIL_SERVICE/POSTGRADUATE/UNIVERSITY；科目code在同类别唯一，章节code在同科目唯一。章节不能借用另一科目；本期先平铺科目内章节，不建立无限树。题型独立ExamQuestionType=SINGLE_CHOICE/MULTIPLE_CHOICE/TRUE_FALSE/SUBJECTIVE，不改原ExerciseType。

所有分值使用整数scoreUnits，100单位=1分，禁止浮点累加。总分1至1000000单位，时间60至21600秒；题库卷1至200题，AI_SOURCE/AI_SUBJECT卷1至50题、默认20。分区计数/分值之和须与蓝图一致，缺口不得标完整。

题干/选项/答案/解析以严格questionBodySchema写入body快照：选项key固定，答案使用key而非可变位置；单选恰好一个正确key，多选至少两个，判断用布尔，主观保留参考答案/评分要点。题型、选项数量/唯一性/占位、答案存在及主观结构在领域校验。SQL仅对JSON类型/关键字段及关系做防线，不冒充完整Zod或语义验收。

source快照记录kind（OFFICIAL_PUBLIC/AUTHORIZED_IMPORT/AUTHORED/AI_GENERATED）、名称、原始年份、适用版本、链接、使用资格说明、核对日期；AI来源不得填写官方来源年份或真题URL。目标考试年份只属于蓝图，不是题源证明。URL仅https且不含账号密码；没有真实来源时不得自动编造。可选真实sourceContentId/sourcePointId使用SetNull，来源删除不删除版本/答卷。

## 版本与关系

题目版本body/source/type/difficulty/versionNo/所属题不可原地修改，改题须新版本；审核状态/审核人/审核时间可后续按审核契约更新。人工审核不由模型自检标记APPROVED。被题库停用/拒绝的题不再用于新组卷，但历史快照仍保留。

试卷版本封卷后禁止修改标题/蓝图/题数/分值/用时，也禁止增删改分区和题目快照。发布指针必须指向该卷已封版本；试卷的科目、所有者不得在已有版本后任意切换。题目快照可与原版本SetNull脱离，但正文和评分依据不变。

分区和题目通过复合外键绑定同一paperVersion；答卷与作答通过复合外键绑定同一paperVersion，防止把别卷题目塞入本人答卷。草稿唯一(attemptId,paperItemId)，题号在版本内唯一；不自动去重后缩题。答卷开考必须引用已封卷版本，保留固定questionOrder/optionOrder快照与服务器期限。

题库/试卷拥有者删号可置空以保留发布版本，空所有者的私有对象不能被任何人默认接管。用户本人的答卷/私人生成任务随删号删除；评分/审核人删除可置空保留事件，不改变原题内容。新关系不得级联删除原Exercise/ExerciseRecord/Note/Flashcard等资产。

## 状态与预算

题/科目状态DRAFT/ACTIVE/RETIRED，审核UNREVIEWED/APPROVED/REJECTED，试卷DRAFT/PUBLISHED/WITHDRAWN。27.2当时仅建约束和纯转换检查；27.4已实现发布，27.5已实现开考，27.6补保存/提交/客观评分，27.7已实现必要主观批阅。

答卷IN_PROGRESS→SUBMITTED→PENDING_REVIEW或GRADED；PENDING_REVIEW→GRADED。只向前转换，无交卷后退回草稿。IN_PROGRESS无得分/提交时间；提交后必须有submittedAt。待批阅有客观得分但finalScoreUnits=null，GRADED须有finalScoreUnits且pendingScoreUnits=0，分值范围须满足整卷总分；未批主观题不默认为0分。deadlineAt>startedAt，改客户端时间不改变该值。

生成任务QUEUED/RUNNING/INCOMPLETE/READY/FAILED/CANCELLED，候选保留在私有批次；requestedCount1至50、acceptedCount不大于请求、usedCalls不大于callBudget，READY须acceptedCount=requestedCount。每批targetCount1至5、attempts0至2、acceptedCount不大于本批目标；ACCEPTED须合格数达标。统一请求键(ownerId,requestId UUID)+requestDigest SHA256防重；同键异摘要须409，预算包括蓝图，不因手动重试清零。租约token/到期时间仅后台内部使用，不给客户端。

SQL还拒绝批次尝试次数回退、已取消任务复活、已提交作答改写/删除、过期草稿写入及最终分改写；验证选项顺序与本卷实际key一一对应、本人仅能开考当前已发布且有权限的封卷版本。评分历史追加后不可改写，删号级联可清本人答卷/任务且保留公共快照，27.7已补手工评分HTTP角色与主观题资格、答卷锁和空白批阅，详见复核契约。

固定失败码仅INVALID_JSON/QUALITY_REJECTED/INSUFFICIENT_EVIDENCE/UNAVAILABLE/TIMEOUT/CANCELLED/BUDGET_EXHAUSTED，不存原始异常/模型原文到公共错误或日志。取消/不完整不回到QUEUED重置同一任务预算；后续服务必须CAS和事务计数，本期状态纯函数不能冒充并发任务调度已完成。

## HTTP与权限（27.3–27.5已开放，其余预留）

- 27.3：GET/POST /api/admin/exam-subjects、/api/admin/exam-questions，版本创建/审核与结构化导入预览/确认；非管理员403，管理的是共享审核题库/本人明确用于发布的题，admin角色不豁免私人AI题/私人资料归属。
- 27.4已实现：/api/admin/exam-papers，版本/组卷/发布/下架通过严格action；写请求有requestId/服务端摘要、expectedRevision（见实施契约），冲突409，来源/配额不合格400或409，不允许客户端直接标APPROVED/PUBLISHED。
- 27.5已实现：GET /api/exams及详情仅已发布封卷摘要；POST /api/exams/:id/attempts创建本人答卷，复核可用版本和访问，绑定服务端时间；GET /api/exam-attempts及/:id仅本人（含管理员角色也不得读别人的私人模拟卷）。未认证401，不可见资源404，保存/提交由27.6实现，精确边界见下方实施契约。
- 27.6：PUT /api/exam-attempts/:id/answers传paperItemId、answer、marked、expectedRevision、requestId，答案JSON按该题冻结题型校验；POST .../submit只传expectedRevision/requestId，不接受客户端分数/正确答案/服务端时间。截止、已提交及版本冲突409，重复同一请求返回原结果。
- 27.7已实现：GET .../result交卷后本人可读已允许的答案/解析与待批状态（未交卷409，跨人404，不下发rubric/题源url/授权说明）；POST /api/admin/exam-attempts/:id/grades限所管理正式卷（PUBLIC+PUBLISHED且referenceOnly=false），已告知批阅范围，私人AI卷不可读/不可批阅（404）。主观批阅需scoreUnits/feedback/expectedRevision/requestId，z.strict()拒绝未知字段，留ExamGradeRecord，不覆盖历史事件；最终成绩评定后state=GRADED且数据库约束final exam score is immutable，再次批阅409。
- 27.8/27.9：/api/exam-generation-jobs本人创建/读取/取消/受控重试；只传蓝图和幂等字段，不接受provider密钥、usedCalls、acceptedCount、审核状态或租约。读取固定进度与缺口，不输出批次原始答案或提示词；预览私有卷时显式区分可见范围和是否开始正式作答。

所有实现通过withAuth/no-store薄路由→服务端领域层→Prisma，前端统一services；27.3已提供exam-subjects/exam-questions/exam-import三个管理路由，27.4新增exam-papers，27.5新增exams及本人exam-attempts目录/详情与确认开考。服务端从数据库核对当前角色、所有者、实际来源权限和状态，不能把纯canRead函数当成已实现的HTTP隔离验证。

预留输入输出的具体边界：列表page>=1、pageSize1至100，沿用{page,pageSize,total,items}外层；科目写入仅track/code/name/state（停用需单独明确操作），章节写入subjectId/code/name。题目版本输入subjectId/chapterId、difficulty1至5、body/source（分别按contracts.ts）、requestId；ownerId/type/versionNo及审核身份由服务端派生，改题需expectedVersionNo匹配最新版本并锁父题。审核输入decision/expectedReviewState/expectedReviewedAt/requestId，CAS后由服务器写reviewedById/reviewedAt及审计，不接受客户端伪造已审核。

试卷版本输入title/description/kind/sourceYear/durationSec、分区配额及题目版本引用，expectedRevision匹配ExamPaper.revision；实际questionCount/totalScoreUnits与冻结body由服务器构造并校验，不信任客户端自报已封卷。正式发布与下架为独立动作。开考成功DTO仅attemptId、revision、state、startedAt、deadlineAt、referenceOnly、整卷标题与toAttemptQuestion白名单及本人savedAnswers，不能返回body/source或标准答案；交卷后的result才按题型返回允许解析与score/pending状态。

生成创建输入为经examBlueprintSchema验证的blueprint及requestId；同键摘要由规范化请求计算，不由客户端覆盖。任务读取返回jobId/state/requestedCount/acceptedCount/rejectedCount/missingCount及固定failureCode，可用预算仅报告服务器计数，不下发leaseToken、候选原文或provider凭据。这些DTO和HTTP处理仍留对应编号实现，基础模块本轮只提供题目投影及纯schema。

## DTO与验收边界

### 27.8.1 星火输出诊断边界（2026-10-16，先于修复）

用户确认优先定位星火出题失败。仅用自编数学短文，先一次现有请求基线，再一次修复后对照，完整worker单题验证最多2次；本轮真实调用总上限4次，不循环追求成功。诊断只保存白名单HTTP状态/业务数字码/finish_reason/用量/内容长度及自编响应的脱敏摘录，凭据/请求头/私人课程不进入证据。JSON参数缺失按官方契约修复，不放宽既有候选schema或引用/去重/预算门槛；格式与真实教育质量分别记录。无新页面/表/依赖/模型切换，27.10仍未执行。

### 27.9实施契约（2026-10-16，先于代码）

新增/exams/create，试卷中心和指南提供入口；三种明确模式与10/20/30/50或1..50、四题型配额/每题分值、范围/难度/时长、目标年（不证明题源年份），服务端沿27.8蓝图校验。启动前展示题量/总分/统一调用上限、星火额度和AI待核验说明，明确确认才创建，改配置取消确认；失败保留配置和同内容请求键，不自动重放写请求。GET /api/exam-generation-options?page=&track=分页返回启用科目，不读管理题库答案；资料复用本人内容列表。

本人任务可分页恢复，有限单次串行轮询仅QUEUED/RUNNING，失败暂停、显式重读；取消/受控恢复沿27.8 CAS，读取不触发模型。新增GET /api/exam-generation-jobs/:id/preview：本人任务锁定一致读取，返回原plan/状态、terminal与canConfirm、缺口/实际分值、previewDigest、已确认paperId/versionId（如有）及候选题干/选项/实际来源摘要，绝不返回答案/解析/rubric/原始快照或租约。活动任务不可确认；终态有合格草稿可预览，撤审/来源删除或变化、科目停用时明确拒绝确认，不因历史候选计数伪报可用。

POST /api/exam-generation-jobs/:id/paper严格{expectedRevision,previewDigest,targetCount,acceptReducedTarget,requestId,confirmed:true}。targetCount必须等于当前已合格数；不足原目标须acceptReducedTarget=true明确接受新题量，不能自动缩卷或称原目标完成。保持分区相对次序/每题分值和原时长，空分区移除，实际总分由服务端计算。确认时本人User共享锁→job独占锁→题库管理锁（BANK），重查快照/来源/最新审核/配额与摘要；AuditLog以本人+job唯一确认结果，并校验同键摘要，任何新键也只返回同一已确认卷，不会重复建卷。并发不同缩卷参数409。客户端不得上传候选正文、答案、来源或公开状态。

保存PRIVATE、本人owner、封卷快照及仅本人可开考的PUBLISHED版本；此状态仅表示本人可用，不公开。BANK为MOCK，AI为AI_MOCK且sourceYear未知。新增窄范围迁移使数据库referenceOnly条件为AI_MOCK或PRIVATE；私人题库卷同样参考自测，不冒称AI生成。已有公开正式卷语义不改，旧答卷不回写。现有本人详情/开考允许本人PRIVATE（目录依然PUBLIC），仅本人确认成卷后可开始，开考计时与既有作答/交卷/成绩共用。管理员不能读私人答卷；私人主观题只对照参考、未批总分不伪造，页面明确无人工作为正式批阅。无自动公开、模型辅助判分或新依赖；真实整卷教育质量留27.11，不重复调用模型来造通过。

页面暖纸张风格、44px控件、桌面配置/蓝图两列、窄屏单列；加载/失败/空/真实0分开。进度为实际已合格/目标与累计拒绝次数，不承诺耗时。预览内容较长可展开，不提前泄露正确答案；确认成卷与开始计时分开，刷新可恢复本人任务及已确认卷。

### 27.8实施契约（先落地，2026-10-16）

实施状态18:51：后台工程完成；无页面/候选预览/确认成卷。真实星火单题两次返回不可解析JSON，0题合格且预算后停止，真实AI质量未通过。BANK撤审恢复拒绝补齐；模型状态读取不提供候选正文。BANK数据库callBudget内部占位1满足旧约束，对外模型预算/调用均0；rejectedCount为累计未通过位置次数，不表示去重题数。证据见docs/acceptance/exam-generation-20261016.md。

只做生成后台，不挂27.9页面/预览/确认开考。POST /api/exam-generation-jobs严格{plan:{blueprint:examBlueprintSchema,scope:1..1000字,difficultyMin:1..5,difficultyMax:1..5},requestId:UUID,confirmed:true}；三种mode= BANK/AI_SUBJECT/AI_SOURCE明确互斥，新服务均1..50题，默认20，管理员原BANK卷上限200不变。类别/科目/启用章节、题型配额/分值/时长服务端核对；蓝图由用户已确认配额确定，不额外调用模型规划。BANK仅当前PUBLIC+ACTIVE+最新APPROVED题，缺口不补AI；AI仅当前星火网关，不自动换模型。每人最多2个QUEUED/RUNNING任务。创建同本人requestId原子幂等，未知身份/答案/状态/计费字段拒绝。

GET集合分页与GET/:id仅本人（管理员不豁免），只返回jobId/state/revision/真实已合格、被拒、缺少数、统一调用预算/已用、创建/截止/完成时间、固定failureCode、是否需手动恢复；不输出候选题干/标准答案、来源原文、内部蓝图快照/提示/租约。GET无写入、无调用/入队。POST/:id命令严格{action:'retry'|'cancel',expectedRevision,requestId}，审计幂等和job行锁；取消保留已合格草稿，不恢复计费，READY/CANCELLED不可恢复，过总期限不可续。retry恢复QUEUED/失败或租约过期RUNNING，不能重置attempts/usedCalls/deadline；已有有效租约409，不重叠调用。

复用PRODUCT_GEN队列新增exam-generation分支，只携jobId/traceId和可选真实contentId（无资料为空字符串，不建虚构资料行）。任务/候选持久化为既有ExamGenerationJob/Batch，不新增表。外部队列重复投递不能突破数据库租约与预算；创建入队失败将QUEUED记为FAILED/UNAVAILABLE；恢复入队失败保留无租约RUNNING供显式恢复，读取不自动重排。worker在每次模型发送前事务预留usedCalls+1/batch.attempts+1，单次chat无extractJson隐藏重试，每批最多5个固定题位、最多2次尝试，整次2*ceil(N/5)调用、10分钟总期限、单次最多45秒。按题位跨分区分批避免小分区增加调用上限；一次失败保留已过候选，只补缺位。中断不返还已预留预算。租约120秒，每次调用前续租；过期恢复使旧token结果无法提交。已合格批次不修改，全部配额满足才READY，否则INCOMPLETE/FAILED及真实缺口，不创建已发布试卷。

AI_SOURCE仅本人READY资料的真实TranscriptSegment/TextBlock和有效定位，最多24段/12000字有界快照，超出明确标记覆盖范围不完整；无原文拒绝，不用旧知识点摘要冒充原文。每批前重查资料归属/就绪，原文快照变化或资料已删则停止。模型只能引用提供的证据ID与逐字原文quote，引用存在/范围由服务器恢复；AI_SUBJECT没有证据，不生成页码/时间/真题年份/URL。每题来源由服务器标AI_GENERATED/答案待核验，绝不APPROVED。候选结构/实际选项/答案范围、题位/题型/难度、解释非空、去重/近重复和内容过滤通过才计合格；来源锚定和结构通过不代表通用语义核验，实际教育质量仍需27.11人工验收。

取消立即持久化且尽力中断本进程请求，跨进程也在提交/新调用前检查；已经发送可能消耗额度，结果不再接收。进程退出或队列丢失后仅显式retry恢复；不提供无限后台扫描/自动重试/改目标缩卷或私人题公开。无新依赖/迁移/模型训练，27.9再做候选预览与完整卷确认。

### 27.7复核修正契约（2026-10-16，用户要求核对自行完成的两步）

本轮只复核并修复27.7，不顺带实现27.8。管理员读取/批阅仅已提交的PUBLIC正式答卷；读取前共享锁答卷，写前独占锁答卷，再校验幂等与整卷revision，防止并发批阅覆盖。未交卷管理读取409，不提前下发学员草稿。grades内题目ID不能重复。待批分值为所有尚未批阅主观题的满分之和（含根本没保存过的空白题），不得减去已经获得的分数或遗漏不存在的答案行；最终成绩只有所有主观题明确批阅后才能确定。

空白主观题可由管理员明确给0分并填写评语。新增单独增量迁移，仅允许PENDING_REVIEW时为本卷SUBJECTIVE题建立answer SQL NULL、marked=false、revision=0、score/correct/feedback均NULL的空评分载体，随后同批阅事务追加历史并写分；不允许迟交文字、标记、客观题插入或任何已交内容改变。旧基础迁移不修改，不修改既有成绩；隔离与生产验收通过后已应用本地主库第15项迁移，43业务表及两env指纹不变。普通保存API仍在过期/交卷后409。

成绩DTO补冻结题干及按本次固定选项顺序的options，避免只见答案key却看不到题。待批不计为错题，已批主观未满分计扣分题；题型统计correct+wrong+pending=total。来源继续只有真实摘要，不凭名称猜外部链接或视频时间。管理员每题评分初始为空（已评显示原分），只提交明确填写/改过的题，未填不会默认0分；成功后同步新revision并更新本次题，最终冻结后禁用。相同内容的失败重试沿用请求键，改内容使用新键；写入期间禁止编辑与重读，失败保留草稿。页面明确最终成绩不可更改，不再提示最终后可修订；未交/读失败不显示旧答卷可写内容。

### 27.6实施契约（2026-10-16，先于实现）

PUT /api/exam-attempts/:id/answers严格接收{paperItemId,answer,marked,expectedRevision,requestId}，expectedRevision是整份答卷版本（每次成功保存+1），不是单题版本。仅本人、IN_PROGRESS且数据库时间未到期限可保存；按冻结题型验证：单选为合法key或null，多选为无重复合法key数组，判断为布尔或null，主观为最多10000字文本或null。空字符串/空数组为未答；拒绝未知字段、分数及标准答案注入。逐题保存成功才显示已保存，失败保留本页输入；刷新只恢复服务器确认过的草稿，多标签冲突需明确重新读取并重新核对，不自动覆盖。

POST .../submit严格{expectedRevision,requestId}。本人答卷行锁→幂等记录→版本校验→提交与评分同事务；到期仍允许提交已保存内容，但不允许补写。GET无副作用；页面到期只尝试一次提交，失败提供明确手动重试，无定时循环。离页/关机时不承诺后台自动评分，再打开页面可确认提交；数据库期限始终限制改答。提交不接受答案，未保存内容不计入，手动交卷前明确未答数量并要求先保存或放弃本页草稿。

AuditLog复用exam-write前缀、本人+答卷+requestId唯一摘要，包含动作/规范化请求的digest及安全结果DTO；仅本人验证后重放相同结果，不再次保存/评分/发奖。同键异内容409；并发保存/交卷由答卷锁串行，expectedRevision冲突409。保存幂等返回原保存确认（即使其后已有新版本），前端不以迟到确认覆盖其它操作。本阶段不发XP、不写旧练习/掌握记录。

评分仅使用已封卷body和scoreUnits：单选/判断正确满分，否则0；多选正确集合完全相等满分，漏选/多选/错选0，不计部分分。未答客观0。所有主观题含未答均待批阅，其满分计pendingScoreUnits，不冒充0分；未保存的主观题无需事后插入草稿，后续批阅按题目快照读取。有主观题PENDING_REVIEW且finalScoreUnits=null；全客观GRADED且pending=0，final=objective。聚合成绩gradeSummary仅交卷后白名单提供objectiveScoreUnits/pendingScoreUnits/finalScoreUnits/submittedAt，题目正确答案、逐题分数、解析和rubric仍不下发（27.7）。历史版本修题不改变评分依据。无新依赖/表/迁移/模型请求。

### 27.5实施契约（2026-10-16历史阶段，只读限制已由27.6替代）

新增/exams试卷中心、/exams/:id说明及/exam-attempts/:id本人固定答卷阅读页，AppShell“练习与复习”和/help提供入口；旧零散题库保留。本编号实现选择/说明/确认开考/本人继续阅读，不实现27.6作答保存、自动交卷或评分。页面明确“作答保存与交卷暂未开放”，开始前告知开始后计时不停，避免将只读题目当作已可完整考试。

GET /api/exams筛选q/track/subjectId/kind/year/page/pageSize，year明确匹配封卷原始年份或其中真实题源年份，不代表上传/目标考试年。仅PUBLIC+PUBLISHED、发布指针已封卷、科目ACTIVE；返回分页摘要与当前可见科目选项，空库如实显示，禁止补示例试卷。GET /api/exams/:id返回上述可见版本说明、题数/分值/时长/题型分区、去重的来源类型/名称/年份/适用版本及本人未交答卷入口；不返回题干、选项、body/source原对象、标准答案/解析/rubric或题源答案文件URL。自组卷明确模拟卷且整卷年份未知，不把题源年份冒充原卷年份。

POST /api/exams/:id/attempts严格输入{expectedVersionId,requestId:UUID,confirmed:true}；服务端核对当前账号、PUBLIC发布/科目可用与当前封卷指针，旧版本409，不可见404。User共享锁→本人开考advisory锁→父卷共享锁，与发布/下架的父卷独占锁互斥。数据库clock_timestamp取得startedAt与deadlineAt=startedAt+冻结durationSec；原分区题序与一次随机选项key顺序保存，不能由客户端指定时间、得分或答案。创建只绑定快照，不生成/替换题目。每人每卷只保留一份未交答卷（含到期未处理）；其他新请求仍返回原未交答卷，不重置期限。原创建requestId/requestDigest和AuditLog请求别名同事务持久化，重放同键同内容返回本人原答卷、异内容409，重复开考或并发多标签不创建额外答卷；重放不受后续下架影响，也不会复活已提交答卷。

GET /api/exam-attempts分页列本人答卷（含已下架卷）；GET /api/exam-attempts/:id仅learnerId=当前账号，管理员也无跨人豁免，外人404。本人已有答卷不因后续发布新版本、科目停用或试卷下架换题/不可读。DTO仅本人attemptId/paperId/versionId/标题/版本/状态/revision/开始与截止/serverNow/expired/referenceOnly、固定分区/题序/选项及本人已保存答案白名单；题目调用toAttemptQuestion投影，不展开Prisma body/source/评分列。保存答案只允许本人值的简单JSON白名单，不回显正确性、反馈或分数；本编号不提供写答案接口。倒计时以serverNow与单调时间显示，GET无副作用，到期只读提示、不自动交卷或称评分完成。

不自动读取原私人资料/旧题库，不调用AI/ASR/Ascend，不新增依赖/表。source摘要只取白名单；所有API鉴权、当前数据库账号核对与private no-store。来源/原版年份未知如实显示；权限/重复请求/冻结与答案泄露、页面状态、真实HTTP/生产和原生宽窄屏分别验收，未做的不得以组件测试代替。

### 27.4实施契约（2026-10-16，先于实现）

`/admin/exam-papers` 仅管理PUBLIC共享题库模拟卷，PUBLIC表示管理员共享管理素材，学生后续仅能读PUBLISHED版本。PRIVATE试卷/题目（含管理员自己私人AI卷）一律404，不隐式公开。此编号只从审核题库拼卷，固定kind=MOCK、sourceYear=null，不凭所选真题将自组卷称为官方原卷；每题保留实际source年份/名称/适用范围/资格说明。无AI补题或私人资料读取，不实现学生开考。

GET `/api/admin/exam-papers` 支持id或subjectId/state/page/pageSize，分页摘要与单卷最新/发布版本、受控版本历史；POST action=preview/create/revise/publish/withdraw。preview输入plan（标题/说明/科目/章节/秒数及分区key/title/type/questionCount/scorePerQuestionUnits/difficultyMin/Max）和可选selections（按分区key的有序questionVersionIds）。1至200题、60至21600秒、总分最多1000000百分单位，服务端派生题量/分值。分区允许同题型不同难度配额；全卷稳定题ID和规范化题干不重复，语义同义不声称自动识别。

自动预览在当前PUBLIC+ACTIVE题的最新APPROVED版本、启用科目与章节中不放回抽取；章节过滤不得跨科目。使用最大匹配满足重叠难度配额，返回每区required/available/selected/missing与实际题量/总分/来源。最多检查10000个当前合格候选，超限明确缩范围，不截断后宣称不足。缺口预览不写库，cannotSave；手动替换/调序后须重新预览。客户端不得上传题干、答案或来源快照。

完整预览返回previewDigest（规范化plan/有序selections/实际题内容摘要），create/revise携带同一plan、selections、摘要、UUID requestId及confirmed=true；revise另带id/expectedRevision。服务端重新核对当前题源/配额/摘要，事务内建完整分区与快照后seal，失败全部回滚。每次修订追加新封卷版本（最多100版），不原地改已保存快照；已发布时新草稿不改变旧发布指针或使旧卷自动下架。

publish带id/versionId/expectedRevision/requestId/confirmed=true，仅最新保存版本，重新确认题库最新审核/状态、快照和分类仍有效后切发布指针；withdraw带id/expectedRevision/requestId/confirmed=true，保留指针及所有历史快照。发布/下架/修订都revision+1，旧revision409。重复同请求返回原结果，异摘要同键409；当前数据库管理员角色每次核对。复用27.3管理写事务锁及AuditLog摘要幂等，与题库修订/审核串行，父卷行锁保护指针；不新增表/迁移/依赖。预览/列表亦no-store，发布确认有明确用途说明及逐题来源/答案人工核对提示；来源不完整不假称最新版。

### 27.3实施契约（2026-10-16，先于实现）

管理员 `/admin/exam-bank` 分科目章节、题目校订、模板导入三部分。新增共享题库题 visibility=PUBLIC、state=DRAFT，指管理员可共同校订的题库素材，并非已发布试卷；本编号没有学生读题入口。任何PRIVATE题均排除，管理员本人私有AI题也不能由此隐式公开。改题新增版本并回DRAFT/UNREVIEWED；审核操作需要当前版本号、审核状态及审核时间，APPROVED才可启用。停用/删除均为RETIRED逻辑删除，版本及历史快照保留。科目类别/编码和章节所属科目创建后固定，名称/状态通过updatedAt冲突校验；停用科目/章节不删除所属题，新题及启用需分类可用。

GET `/api/admin/exam-subjects` 分页返回科目及其章节；POST接收subject.create/subject.update/chapter.create/chapter.update。GET `/api/admin/exam-questions` 支持subjectId/q/state/reviewState/page/pageSize，返回共享题最新版本；GET同路径指定id返回版本历史。POST接收question.create/question.revise/question.state/question.review。每项写请求带UUID requestId；修改需expectedUpdatedAt或expectedVersionNo等乐观锁。所有请求严格拒绝多余/重复筛选字段，当前数据库管理员角色在事务内FOR SHARE锁定核对。

POST `/api/admin/exam-import` 接收format=json|csv、text（UTF-8最多1MB）、subjectId/chapterId。preview只校验不写；confirm需previewDigest、requestId、confirmed=true，再次解析及校验同一全文/分类。每次最多100题，整批全部有效才写入，任何一行错误整批0写入；错误行及字段路径逐项展示，正文预览只给管理员。JSON为严格数组，每项difficulty/body/source；CSV固定difficulty,body,source三列，后两列为JSON对象，支持标准双引号转义、逗号和换行，提供自编示例模板。AI来源明确标模拟，来源/年份/适用范围必填规则沿基础schema，不联网抓题、不读取私人资料。预览摘要只防止确认内容意外改变，不能替代服务端重新校验。

幂等与审计复用AuditLog，不增表：exam-bank前缀、actorId+requestId摘要形成唯一id，detail只存请求摘要与写入结果ID/版本，事务内全题库管理 advisory lock 串行低频管理员写操作，防止跨管理员竞争；同键异内容409。审计与写入同事务，失败全部回滚；角色每次重新校验，即使重复请求也不豁免。API no-store，错误不输出SQL/凭据；导入仅显式确认写入，无模型调用。后续学生/组卷仍必须重新筛PUBLIC+ACTIVE+最新APPROVED及分类可用，不因visibility直接开放。

toAttemptQuestion仅投影id/sequence/scoreUnits/type/stem/options(key,text)，不展开body/source/answer/explanation/rubric/review或内部对象。开考/草稿不回显答案解析，不把整个Prisma行序列化给前端。

27.2当时的基础验收：领域单测验证题型与选项、配额/分值、AI来源年份、严格未知字段拒绝、状态/评分、权限及答案不泄露。隔离PostgreSQL验证完整从空库迁移及旧13迁移升级、真实复合FK/约束/冻结拒写与回滚、原表数据完整。记录到底是否应用主库；仅隔离通过不能声称主库已迁移。无页面/真实题源/AI调用验收，不核销27.3以后任务。

## 持久化字段索引（27.2 schema生成核对）

以下仅列scalar/enum字段，?为空值允许；关系与唯一索引见schema，JSON内容按contracts.ts及上述规则校验。

- ExamSubject：id:String，track:ExamTrack，code:String，name:String，state:ExamContentState，createdAt:DateTime，updatedAt:DateTime。
- ExamChapter：id:String，subjectId:String，code:String，name:String，state:ExamContentState，createdAt:DateTime，updatedAt:DateTime。
- ExamQuestion：id:String，ownerId:String?，subjectId:String，chapterId:String?，visibility:ExamVisibility，state:ExamContentState，createdAt:DateTime，updatedAt:DateTime。
- ExamQuestionVersion：id:String，questionId:String，versionNo:Int，type:ExamQuestionType，difficulty:Int，body:Json，source:Json，sourceContentId:String?，sourcePointId:String?，reviewState:ExamReviewState，reviewedById:String?，reviewedAt:DateTime?，createdAt:DateTime。
- ExamPaper：id:String，ownerId:String?，subjectId:String，visibility:ExamVisibility，state:ExamPaperState，publishedVersionId:String?，revision:Int，createdAt:DateTime，updatedAt:DateTime。
- ExamPaperVersion：id:String，paperId:String，versionNo:Int，title:String，description:String，kind:ExamPaperKind，sourceYear:Int?，durationSec:Int，questionCount:Int，totalScoreUnits:Int，blueprint:Json，sealedAt:DateTime?，createdAt:DateTime。
- ExamPaperSection：id:String，paperVersionId:String，sequence:Int，title:String，type:ExamQuestionType，questionCount:Int，scorePerQuestionUnits:Int。
- ExamPaperItem：id:String，paperVersionId:String，sectionId:String，questionVersionId:String?，sequence:Int，scoreUnits:Int，body:Json，source:Json。
- ExamAttempt：id:String，learnerId:String，paperVersionId:String，state:ExamAttemptState，requestId:String，requestDigest:String，revision:Int，startedAt:DateTime，deadlineAt:DateTime，submittedAt:DateTime?，gradedAt:DateTime?，totalScoreUnits:Int，objectiveScoreUnits:Int?，pendingScoreUnits:Int?，finalScoreUnits:Int?，referenceOnly:Boolean，questionOrder:Json，optionOrder:Json。
- ExamAnswer：id:String，attemptId:String，paperVersionId:String，paperItemId:String，answer:Json?，marked:Boolean，revision:Int，scoreUnits:Int?，correct:Boolean?，feedback:String?，updatedAt:DateTime。
- ExamGradeRecord：id:String，answerId:String，graderId:String?，scoreUnits:Int，feedback:String，requestId:String，requestDigest:String，createdAt:DateTime。
- ExamGenerationJob：id:String，ownerId:String，paperId:String?，state:ExamGenerationState，requestId:String，requestDigest:String，blueprint:Json，requestedCount:Int，acceptedCount:Int，rejectedCount:Int，callBudget:Int，usedCalls:Int，revision:Int，leaseToken:String?，leaseExpiresAt:DateTime?，deadlineAt:DateTime，cancelRequestedAt:DateTime?，failureCode:ExamFailureCode?，createdAt:DateTime，startedAt:DateTime?，finishedAt:DateTime?。
- ExamGenerationBatch：id:String，jobId:String，sequence:Int，targetCount:Int，acceptedCount:Int，attempts:Int，state:ExamBatchState，candidates:Json，failureCode:ExamFailureCode?，updatedAt:DateTime。
