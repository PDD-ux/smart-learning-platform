# §29.6 作业提交、批阅、退回修改与反馈

本项在28/29基础上交付人工作业闭环，不调用OCR或AI、不复用旧试卷成绩。沿用admin/student和当前班级负责人；无新角色或表迁移。

## 页面与读取

班级任务卡进入/classes/assignments/:id或/admin/classes/assignments/:id。学生查看发布要求/截止、保存本人文字草稿、附允许文件后明确提交；负责人按任务查看成员和真实提交状态，仅进入正式提交详情批阅。/classes/submissions及/:id提供本人已交历史，即使退出/移除仍可看本人冻结版本与反馈；负责人详情在/admin/classes/submissions/:id。草稿不算提交、不制造零分。已交版本展示当时标题/要求/截止/版本号与时间，评语与成绩只追加；退出成员正式历史单独注明，不算当前有效学生。

GET /api/class-assignments/:id?page=1返回任务白名单、班级摘要、canManage/canEditDraft/canSubmit、本人submission（或null）及仅负责人的board。board每页20成员，ACTIVE人数、已有正式提交人数/待批阅/退回/已批阅、有效成员尚未正式提交人数均从真实行计算，包含退出历史的数量明确区分。负责人查询始终不select draftText或未提交附件。GET /api/class-submissions/:id按28授权返回最近50正式版本及反馈、本人允许的草稿和未过期附件；GET /api/class-submissions?page=1只返回本人正式历史摘要，每页20。跨人/跨班/其它管理员均404。响应private/no-store。

## 写事务与截止

POST /api/class-assignments/:id接受action=draft（requestId UUID、expectedRevision，首次0、bodyText≤50000）；action=submit（requestId、expectedRevision≥1、assignmentRevision、attachmentIds≤5且唯一、confirmed:true）。先保存再提交，提交只冻结服务端已保存正文和选择的READY附件。须正文非空或至少一个附件，无未完成上传；当前班级ACTIVE/学生ACTIVE/任务PUBLISHED/关联章PUBLISHED/服务端now<dueAt。已截止可查看和保存允许状态草稿，但不得提交；负责人显式延长截止后才可重交。未发布/撤回任务不能保存新草稿；CLOSED可读而不可提交。新draft及RETURNED可编辑，SUBMITTED/GRADED不可改。

POST /api/class-submissions/:id为review（requestId、expectedRevision、versionId、state RETURNED/GRADED、score、feedback1–10000、confirmed:true）；仅当前本班负责人、ACTIVE班级、最新SUBMITTED版本，无已有批阅。RETURNED分数null，GRADED整数0–100；退回后学生保存新草稿再提交新版本，旧正文/任务依据/评语/附件保留。最多50正式版本，不覆盖历史。

锁顺序当前User→Classroom→Submission→Attachment，幂等授权先于重放、重放先于版本/截止检查；同键完整规范化输入必须一致。班级锁与29.5发布/归档/成员管理串行，不因学生保存草稿更改班级revision。提交与批阅记录、submission CAS及ClassroomOperation/审计同事务。实体状态及成员现状决定写权限。JSON流256KiB支持50000中文字符，不接受客户端学生ID/分数自动判定/存储键。保存失败不清草稿，不自动重放写；读取失败不冒充零。

## 附件

POST /api/class-submissions/:id/attachments意图（requestId、expectedRevision、fileName、mimeType、sizeBytes）；最多5个未过期UPLOADING/READY草稿附件、各≤20MiB、总≤50MiB，单提交最多250个附件历史行含已绑定/墓碑，防无限取消占存储。每个意图24小时过期，固定28键，原码/私钥不入响应。响应attachmentId/当前submission版本，原意图重放不重建。只允许PDF/TXT/MD/PNG/JPEG且扩展名匹配。

POST /api/class-attachments/:id/upload为已认证原始字节，先核对本人可写草稿/有效意图，60秒和20MiB流上限；实际大小、文本UTF8/文档或图像结构与摘要校验后才写对象。StorageClient新增可选putObjectIfAbsent，真实local用wx、S3用IfNoneMatch:*，防同ID并发或迟到上传覆盖已交文件。已存在对象须大小/摘要相同才允许恢复；不支持条件写的存储明确503。对象写入不持DB锁，之后重新锁和复核归属/状态/截止意图再READY，并递增submission版本。同一已完成字节重试不再递增；不同字节409。失败/断网保留选中文件，损坏已占用键需显式移除并新建意图，不能覆盖。

POST /api/class-attachments/:id（action remove、requestId、expectedRevision）仅本人未绑定附件，先DELETED墓碑/CAS，再删确定对象；删除失败留墓碑可重试。ATTACHED不移除，不随退出或归档过期。提交必须明确选择所有当前READY附件、拒绝UPLOADING和过期/跨人/重复附件，原READY→ATTACHED与版本同事务；不把附件只写进文本地址。

POST /api/class-attachments/:id/download签发60秒以内、绑定当前账号/附件ID的专用{expires,sig}；客户端仅在内存接收，再POST /download/file以JSON传递签名，服务端逐次认证/验签/复核28授权后流式下载，强制attachment、nosniff、sandbox、private/no-store，签名不进网址、访问日志或本地存储；下载经services会话封装读取Blob。无存储键或通用S3地址，签名不能复用到原通用对象接口。READY仅本人当前可写草稿可读，正式版本附件只允许本人历史或该班负责人，签名不绕过移除/角色变更。

scripts/cleanup-class-attachments.ts有界清理过期未绑定对象：class→submission→attachment锁后复核versionId为null和非ATTACHED，先DELETED再删固定键。重复处理过期DELETED收敛迟到对象/失败删除；不删除已提交附件或整目录。不自动开外部定时服务，演示前可手动运行；未提交对象最多24小时有效，后续维护可重复清理。

## 交互及验收

沿用纸张卡片/44px控件，宽屏要求与编辑/批阅区分栏，窄屏单列；任务页显示文字/附件保存状态及明确提交确认，批阅页显示原提交与当时依据，评分/退回二选一且需确认。busy防双击，失败保留文字/文件和相同幂等键；有未保存文字禁止上传/提交，先保存或放弃；冲突不自动覆盖。可独立重读，刷新/页内导航前草稿提示，浏览器后退不宣称自动保存。正式历史可随时从班级列表进入。

真实隔离PostgreSQL验证首次草稿/并发/CAS/提交重复/到期/延期重交/冻结/跨人跨班/撤回归档/角色变更/批阅回放；本地存储实际五格式和大小/摘要/并发覆盖/私有签名/清理；原生负责人及两学生网页核对提交退回重交评分与1440/390px。旧55表/环境与原媒体前后保护，测试账号/对象精确清理。模型质量/云存储故障/生产发布分别留边界。

29.6实施补充：过期清理按attachment ID游标、每批100行，单次CLI最多10批并返回nextCursor；未到末尾可下次显式按游标继续。成功DELETED墓碑仍保留，重复运行可核对迟到对象，不以最早100个墓碑永久阻塞后续清理。提交只收集当前未过期UPLOADING/READY；过期且未选择的历史附件不参与提交，携带过期ID仍被拒绝。PNG执行容器/像素/压缩数据长度校验，JPEG执行标记/尺寸/扫描与结束结构校验，PDF解析页树、文本严格UTF8；附件均强制下载，不把结构校验称杀毒或全像素图像解码认证。

